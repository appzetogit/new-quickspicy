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
 * The zones a rider serves, from what a form sent.
 *
 * `zoneId` is the home zone and `serviceZoneIds` the other zones they serve:
 * the small zones of their main zone. All of them must be in one main zone (a
 * rider works in one main zone). Fields not sent keep their current value.
 * Returns {} when neither was sent, else { zoneId, serviceZoneIds }.
 *
 * @param {object} body
 * @param {{zoneId?: string|null, serviceZoneIds?: string[]}} current
 */
export async function resolveRiderZones(body = {}, current = {}) {
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    if (!has('zoneId') && !has('serviceZoneIds')) return {};

    let zoneId = has('zoneId') ? String(body.zoneId ?? '').trim() || null : current.zoneId || null;
    let list = current.serviceZoneIds || [];
    if (has('serviceZoneIds')) {
        const raw = body.serviceZoneIds;
        // Multipart forms send a list as a JSON string or a comma-separated one.
        let parsed = raw;
        if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw); } catch { parsed = raw.split(','); }
        }
        if (parsed !== null && parsed !== undefined && !Array.isArray(parsed)) {
            throw new ValidationError('serviceZoneIds must be a list');
        }
        list = (parsed || []).map((v) => String(v ?? '').trim()).filter(Boolean);
    }

    const all = [...new Set([zoneId, ...list].filter(Boolean))];
    if (all.length > 50) throw new ValidationError('Too many zones for one rider');
    if (all.some((id) => !isId(id))) throw new ValidationError('Choose a valid zone');
    const zones = all.length
        ? await prisma.foodZone.findMany({ where: { id: { in: all } }, select: { id: true, name: true, parentZoneId: true } })
        : [];
    if (zones.length !== all.length) throw new ValidationError('Choose a valid zone');

    const mains = new Map();
    for (const z of zones) mains.set(z.parentZoneId || z.id, z.name);
    if (mains.size > 1) {
        throw new ValidationError(
            `A rider works in one main zone. These zones are in different main zones: ${zones.map((z) => z.name).join(', ')}.`,
        );
    }

    if (!zoneId && list.length) [zoneId] = list;
    const serviceZoneIds = [...new Set(list)].filter((id) => id !== zoneId);
    return { zoneId: zoneId || null, serviceZoneIds };
}

/**
 * A cohortId sent for a rider: undefined when not sent (leave as is), null when
 * cleared ('' or null), else the id of an existing cohort. Used by the service
 * area endpoint and the Add / Edit Deliveryman forms.
 */
export async function resolveCohortId(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const cohortId = String(value).trim();
    if (!cohortId || cohortId === 'null') return null;
    if (!isId(cohortId) || !(await prisma.foodRiderCohort.count({ where: { id: cohortId } }))) {
        throw new ValidationError('Unknown cohort');
    }
    return cohortId;
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

    const current = await prisma.foodDeliveryPartner.findUnique({
        where: { id: rider.id },
        select: { zoneId: true, serviceZoneIds: true },
    });
    const data = await resolveRiderZones(body, current || {});
    if (!Object.keys(data).length) throw new ValidationError('Nothing to change: send zoneId and/or serviceZoneIds');

    const updated = await prisma.foodDeliveryPartner.update({
        where: { id: rider.id },
        data,
        select: { id: true, name: true, zoneId: true, serviceZoneIds: true },
    });
    return { rider: updated };
}

/**
 * What the rider app shows on its map: the zones the rider serves (home zone
 * first), each with its boundary, plus the main zone they are in. Only orders
 * from restaurants in these zones are offered to them when the zone is a small
 * zone. `cohort` is always null now (cohorts were retired) and kept so older
 * app builds still parse the response.
 */
export async function getRiderServiceArea(riderId) {
    if (!isId(riderId)) throw new ValidationError('Rider not found');
    const rider = await prisma.foodDeliveryPartner.findUnique({
        where: { id: String(riderId) },
        select: { id: true, zoneId: true, serviceZoneIds: true },
    });
    if (!rider) throw new ValidationError('Rider not found');

    const ids = [...new Set([rider.zoneId, ...(rider.serviceZoneIds || [])].filter(isId))];
    const zones = ids.length
        ? await prisma.foodZone.findMany({
            where: { id: { in: ids }, isActive: true },
            select: {
                id: true, name: true, serviceLocation: true, coordinates: true, parentZoneId: true,
                parentZone: { select: { id: true, name: true, coordinates: true } },
            },
        })
        : [];
    const byId = new Map(zones.map((z) => [z.id, z]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean)
        .map(({ parentZone, ...z }) => ({ ...z, isHomeZone: z.id === rider.zoneId, isSmallZone: Boolean(z.parentZoneId) }));
    const main = zones.find((z) => z.parentZone)?.parentZone || null;

    return {
        homeZone: ordered.find((z) => z.isHomeZone) || null,
        mainZone: main,
        cohort: null,
        zones: ordered,
    };
}
