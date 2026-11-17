import { prisma } from '../../../../config/prisma.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { isId } from '../../../../utils/helpers.js';

/**
 * Rider cohorts: groups of riders (by shift, vehicle, region ...) that incentive
 * schemes and pay rules can target, each serving a set of zones.
 *
 * A rider has one home zone (FoodDeliveryPartner.zoneId) and at most one cohort.
 * The zones they may serve are their home zone plus their cohort's zones.
 * Dispatch enforces it only in zones set to ridersFromZoneOnly (see
 * shared/riderServiceArea.js); elsewhere riders are still offered by distance.
 */

const ZONE_SUMMARY = { id: true, name: true, isActive: true };

const serialize = (row, zonesById, riderCount = 0) => ({
    id: row.id,
    _id: row.id,
    name: row.name,
    description: row.description || '',
    zoneIds: row.zoneIds || [],
    zones: (row.zoneIds || []).map((id) => zonesById.get(id)).filter(Boolean),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    riderCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const zoneMap = async (ids) => {
    const unique = [...new Set(ids.filter(isId))];
    if (!unique.length) return new Map();
    const zones = await prisma.foodZone.findMany({ where: { id: { in: unique } }, select: ZONE_SUMMARY });
    return new Map(zones.map((z) => [z.id, z]));
};

/** Validates a list of zone ids: all must exist. Returns them de-duplicated. */
const checkZoneIds = async (value) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new ValidationError('zoneIds must be a list');
    const ids = [...new Set(value.map((v) => String(v ?? '').trim()).filter(Boolean))];
    if (ids.length > 200) throw new ValidationError('Too many zones');
    if (ids.some((id) => !isId(id))) throw new ValidationError('Unknown zone');
    if (ids.length) {
        const count = await prisma.foodZone.count({ where: { id: { in: ids } } });
        if (count !== ids.length) throw new ValidationError('Unknown zone');
    }
    return ids;
};

const cleanName = (value) => {
    const name = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new ValidationError('Cohort name is required');
    if (name.length > 80) throw new ValidationError('Cohort name is too long (max 80 characters)');
    return name;
};

const nameTaken = async (name, exceptId = null) => {
    const clash = await prisma.foodRiderCohort.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: { name: true },
    });
    if (clash) throw new ValidationError(`"${clash.name}" already exists`);
};

const riderCounts = async (cohortIds) => {
    if (!cohortIds.length) return new Map();
    const rows = await prisma.foodDeliveryPartner.groupBy({
        by: ['cohortId'],
        where: { cohortId: { in: cohortIds } },
        _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.cohortId, r._count._all]));
};

export async function listRiderCohorts(query = {}) {
    const includeInactive = query.includeInactive === true || query.includeInactive === 'true';
    const rows = await prisma.foodRiderCohort.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const [zones, counts] = await Promise.all([
        zoneMap(rows.flatMap((r) => r.zoneIds || [])),
        riderCounts(rows.map((r) => r.id)),
    ]);
    return { cohorts: rows.map((row) => serialize(row, zones, counts.get(row.id) || 0)) };
}

export async function createRiderCohort(body = {}) {
    const name = cleanName(body.name);
    await nameTaken(name);
    const zoneIds = (await checkZoneIds(body.zoneIds)) || [];
    const row = await prisma.foodRiderCohort.create({
        data: {
            name,
            description: String(body.description ?? '').trim().slice(0, 300),
            zoneIds,
            isActive: body.isActive !== false,
            sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0,
        },
    });
    return { cohort: serialize(row, await zoneMap(zoneIds), 0) };
}

export async function updateRiderCohort(id, body = {}) {
    if (!isId(id)) throw new ValidationError('Cohort not found');
    const existing = await prisma.foodRiderCohort.findUnique({ where: { id: String(id) } });
    if (!existing) throw new ValidationError('Cohort not found');

    const data = {};
    if (body.name !== undefined) {
        data.name = cleanName(body.name);
        await nameTaken(data.name, existing.id);
    }
    if (body.description !== undefined) data.description = String(body.description ?? '').trim().slice(0, 300);
    const zoneIds = await checkZoneIds(body.zoneIds);
    if (zoneIds !== undefined) data.zoneIds = zoneIds;
    if (body.isActive !== undefined) data.isActive = body.isActive !== false;
    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
        data.sortOrder = Math.trunc(Number(body.sortOrder));
    }

    const row = await prisma.foodRiderCohort.update({ where: { id: existing.id }, data });
    const [zones, counts] = await Promise.all([zoneMap(row.zoneIds || []), riderCounts([row.id])]);
    return { cohort: serialize(row, zones, counts.get(row.id) || 0) };
}

/** Deletes the cohort; its riders are left with no cohort, not deleted. */
export async function deleteRiderCohort(id) {
    if (!isId(id)) throw new ValidationError('Cohort not found');
    const existing = await prisma.foodRiderCohort.findUnique({ where: { id: String(id) } });
    if (!existing) throw new ValidationError('Cohort not found');

    const [released] = await prisma.$transaction([
        prisma.foodDeliveryPartner.updateMany({ where: { cohortId: existing.id }, data: { cohortId: null } }),
        prisma.foodRiderCohort.delete({ where: { id: existing.id } }),
    ]);
    return { deleted: true, ridersReleased: released.count };
}

/** Puts riders into a cohort (moving them out of any other one). */
export async function addRidersToCohort(cohortId, body = {}) {
    if (!isId(cohortId)) throw new ValidationError('Cohort not found');
    const cohort = await prisma.foodRiderCohort.findUnique({ where: { id: String(cohortId) }, select: { id: true } });
    if (!cohort) throw new ValidationError('Cohort not found');

    const raw = Array.isArray(body.riderIds) ? body.riderIds : null;
    if (!raw || !raw.length) throw new ValidationError('riderIds must be a non-empty list');
    const ids = [...new Set(raw.map((v) => String(v ?? '').trim()))];
    if (ids.length > 500) throw new ValidationError('Too many riders at once (max 500)');
    if (ids.some((v) => !isId(v))) throw new ValidationError('Unknown rider');

    const found = await prisma.foodDeliveryPartner.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw new ValidationError('Unknown rider');

    const result = await prisma.foodDeliveryPartner.updateMany({
        where: { id: { in: ids } },
        data: { cohortId: cohort.id },
    });
    return { cohortId: cohort.id, ridersUpdated: result.count };
}

/**
 * Sets a rider's home zone and/or cohort. `null` clears either one; a field left
 * out is left as it is.
 */
export async function setRiderServiceArea(riderId, body = {}) {
    if (!isId(riderId)) throw new ValidationError('Rider not found');
    const rider = await prisma.foodDeliveryPartner.findUnique({
        where: { id: String(riderId) },
        select: { id: true, deletedAt: true },
    });
    if (!rider || rider.deletedAt) throw new ValidationError('Rider not found');

    const data = {};
    if (body.zoneId !== undefined) {
        if (body.zoneId === null || body.zoneId === '') data.zoneId = null;
        else {
            const zoneId = String(body.zoneId).trim();
            if (!isId(zoneId) || !(await prisma.foodZone.count({ where: { id: zoneId } }))) {
                throw new ValidationError('Unknown zone');
            }
            data.zoneId = zoneId;
        }
    }
    if (body.cohortId !== undefined) {
        if (body.cohortId === null || body.cohortId === '') data.cohortId = null;
        else {
            const cohortId = String(body.cohortId).trim();
            if (!isId(cohortId) || !(await prisma.foodRiderCohort.count({ where: { id: cohortId } }))) {
                throw new ValidationError('Unknown cohort');
            }
            data.cohortId = cohortId;
        }
    }
    if (!Object.keys(data).length) throw new ValidationError('Nothing to change: send zoneId and/or cohortId');

    const updated = await prisma.foodDeliveryPartner.update({
        where: { id: rider.id },
        data,
        select: { id: true, name: true, zoneId: true, cohortId: true },
    });
    return { rider: updated };
}

/**
 * What the rider app shows on its map: the rider's home zone and their cohort's
 * zones, each with its boundary. `zones` is the union, home zone first.
 */
export async function getRiderServiceArea(riderId) {
    if (!isId(riderId)) throw new ValidationError('Rider not found');
    const rider = await prisma.foodDeliveryPartner.findUnique({
        where: { id: String(riderId) },
        select: { id: true, zoneId: true, cohortId: true },
    });
    if (!rider) throw new ValidationError('Rider not found');

    const cohort = rider.cohortId
        ? await prisma.foodRiderCohort.findUnique({
            where: { id: rider.cohortId },
            select: { id: true, name: true, description: true, zoneIds: true, isActive: true },
        })
        : null;
    const cohortZoneIds = cohort?.isActive ? cohort.zoneIds || [] : [];
    const ids = [...new Set([rider.zoneId, ...cohortZoneIds].filter(isId))];
    const zones = ids.length
        ? await prisma.foodZone.findMany({
            where: { id: { in: ids }, isActive: true },
            select: { id: true, name: true, serviceLocation: true, coordinates: true },
        })
        : [];
    const byId = new Map(zones.map((z) => [z.id, z]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean)
        .map((z) => ({ ...z, isHomeZone: z.id === rider.zoneId }));

    return {
        homeZone: ordered.find((z) => z.isHomeZone) || null,
        cohort: cohort ? { id: cohort.id, name: cohort.name, description: cohort.description, isActive: cohort.isActive } : null,
        zones: ordered,
    };
}
