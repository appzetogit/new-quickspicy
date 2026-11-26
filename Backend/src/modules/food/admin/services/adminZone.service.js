import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { resolveZoneCity } from './adminCity.service.js';
import { invalidateActiveZonesCache } from '../../landing/controllers/zonePublic.controller.js';
import { invalidateZoneTree } from '../../shared/zoneHierarchy.js';

/**
 * Service-zone CRUD, extracted from the 6,258-line admin.service.js.
 *
 * `coordinates` stays the editable record — it is the ring the admin map draws
 * and sends back — and the GIST-indexed `boundary` polygon beside it is derived
 * by the zone_boundary_sync trigger. So there is still one thing to write, and
 * zone matching is an indexed ST_Contains rather than a ray-casting scan.
 */

const normalizeRing = (coordinates) =>
    (Array.isArray(coordinates) ? coordinates : []).map((c) => ({
        latitude: Number(c.latitude) || 0,
        longitude: Number(c.longitude) || 0,
    }));

/**
 * Main zones and small zones (see shared/zoneHierarchy.js).
 *
 * The parent a request names, checked: it must exist, be a main zone itself
 * (one level only), and not be the zone being saved. `undefined` = not sent,
 * null = "make this a main zone".
 */
async function resolveParentZone(body, selfId = null, db = prisma) {
    if (!Object.prototype.hasOwnProperty.call(body, 'parentZoneId')) return undefined;
    const raw = body.parentZoneId;
    if (raw === null || raw === '' || raw === undefined) return null;
    if (!isId(raw)) throw new ValidationError('Choose a valid main zone');
    const id = String(raw);
    if (selfId && id === String(selfId)) throw new ValidationError('A zone cannot be inside itself');
    const parent = await db.foodZone.findUnique({
        where: { id },
        select: { id: true, name: true, parentZoneId: true, cityId: true, city: true },
    });
    if (!parent) throw new ValidationError('That main zone no longer exists');
    if (parent.parentZoneId) {
        throw new ValidationError(`${parent.name} is itself a small zone. Pick a main zone.`);
    }
    return parent;
}

/**
 * How far a small zone may poke out of its main zone and still count as
 * inside, in degrees (about 5 m). Two shapes drawn by hand along the same road
 * never share an edge exactly.
 */
const EDGE_TOLERANCE_DEG = 0.00005;
/** Overlap smaller than this (square degrees, roughly 100 m²) is a drawing slip, not an overlap. */
const OVERLAP_TOLERANCE = 1e-8;

/**
 * After a write, inside the same transaction: a small zone must lie inside its
 * main zone and not overlap the other small zones of that main zone; a main
 * zone that was redrawn must still contain all its small zones. Throws, which
 * rolls the write back.
 */
async function assertZoneShapes(tx, zoneId) {
    const [zone] = await tx.$queryRaw`
        SELECT "id", "name", "parentZoneId", "boundary" IS NOT NULL AS "hasShape"
        FROM "food_zones" WHERE "id" = ${zoneId}`;
    if (!zone || !zone.hasShape) return;

    if (zone.parentZoneId) {
        const [inside] = await tx.$queryRaw`
            SELECT p."name",
                   ST_Covers(ST_Buffer(p."boundary"::geometry, ${EDGE_TOLERANCE_DEG}), z."boundary"::geometry) AS "covered"
            FROM "food_zones" z JOIN "food_zones" p ON p."id" = z."parentZoneId"
            WHERE z."id" = ${zoneId}`;
        if (inside && inside.covered === false) {
            throw new ValidationError(`The small zone must be drawn inside its main zone (${inside.name}).`);
        }
        const overlaps = await tx.$queryRaw`
            SELECT s."name"
            FROM "food_zones" z
            JOIN "food_zones" s
              ON s."parentZoneId" = z."parentZoneId" AND s."id" <> z."id" AND s."boundary" IS NOT NULL
            WHERE z."id" = ${zoneId}
              AND ST_Area(ST_Intersection(s."boundary"::geometry, z."boundary"::geometry)) > ${OVERLAP_TOLERANCE}`;
        if (overlaps.length) {
            throw new ValidationError(
                `Small zones of the same main zone cannot overlap. This one overlaps ${overlaps.map((o) => o.name).join(', ')}.`,
            );
        }
        return;
    }

    const outside = await tx.$queryRaw`
        SELECT s."name"
        FROM "food_zones" s JOIN "food_zones" z ON z."id" = s."parentZoneId"
        WHERE z."id" = ${zoneId} AND s."boundary" IS NOT NULL
          AND NOT ST_Covers(ST_Buffer(z."boundary"::geometry, ${EDGE_TOLERANCE_DEG}), s."boundary"::geometry)`;
    if (outside.length) {
        throw new ValidationError(
            `The main zone must still contain its small zones. Outside it now: ${outside.map((o) => o.name).join(', ')}.`,
        );
    }
}

/**
 * Puts each restaurant of a main zone's family (the main zone and its small
 * zones) in the tightest active zone of that family containing its location.
 *
 * A restaurant's zone is set once, at signup. Without this, drawing a small
 * zone around existing restaurants would leave them in the main zone, so their
 * orders would still go to every rider. Restaurants with no location, or whose
 * location is in none of the family's zones, keep the zone they have.
 *
 * @returns {Promise<number>} restaurants moved
 */
export async function resortRestaurantsInFamily(zoneId) {
    if (!isId(zoneId)) return 0;
    const zone = await prisma.foodZone.findUnique({ where: { id: String(zoneId) }, select: { id: true, parentZoneId: true } });
    if (!zone) return 0;
    const mainId = zone.parentZoneId || zone.id;
    const small = await prisma.foodZone.findMany({ where: { parentZoneId: mainId }, select: { id: true } });
    const family = [mainId, ...small.map((z) => z.id)];

    return prisma.$executeRaw`
        UPDATE "food_restaurants" r
        SET "zoneId" = pick."zid", "updatedAt" = now()
        FROM (
            SELECT r2."id" AS "rid",
                   (SELECT z."id" FROM "food_zones" z
                    WHERE z."id" = ANY(${family}) AND z."isActive" = true AND z."boundary" IS NOT NULL
                      AND ST_Contains(z."boundary"::geometry, ST_SetSRID(ST_MakePoint(r2."longitude", r2."latitude"), 4326))
                    ORDER BY ST_Area(z."boundary"::geometry) ASC
                    LIMIT 1) AS "zid"
            FROM "food_restaurants" r2
            WHERE r2."zoneId" = ANY(${family})
              AND r2."latitude" IS NOT NULL AND r2."longitude" IS NOT NULL
        ) pick
        WHERE r."id" = pick."rid" AND pick."zid" IS NOT NULL AND pick."zid" <> r."zoneId"`;
}

const zoneWritten = () => {
    invalidateZoneTree();
    void invalidateActiveZonesCache();
};

export async function getZones(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const city = typeof query.city === 'string' ? query.city.trim() : '';
    const { isActive } = query;

    const where = {};
    if (isActive !== undefined && isActive !== '') {
        where.isActive = isActive === 'true' || isActive === '1';
    }
    if (isId(query.cityId)) where.cityId = String(query.cityId);
    // ?kind=main -> main zones only, ?kind=small -> small zones only;
    // ?parentZoneId= -> the small zones of one main zone.
    if (query.kind === 'main') where.parentZoneId = null;
    else if (query.kind === 'small') where.parentZoneId = { not: null };
    if (isId(query.parentZoneId)) where.parentZoneId = String(query.parentZoneId);
    if (city) {
        // Exact, not contains: the filter is fed from the city list below, so a
        // loose match would make "Indore" also select "Indore Rural".
        where.city = city;
    }
    if (search) {
        const contains = { contains: search, mode: 'insensitive' };
        where.OR = [
            { name: contains },
            { zoneName: contains },
            { serviceLocation: contains },
            { city: contains },
            { country: contains },
        ];
    }

    const [zones, total] = await Promise.all([
        prisma.foodZone.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            include: {
                cityRef: { select: { id: true, name: true } },
                parentZone: { select: { id: true, name: true } },
                _count: { select: { smallZones: true } },
            },
        }),
        prisma.foodZone.count({ where }),
    ]);

    return { zones: zones.map(withKind), total, page, limit };
}

/**
 * kind: 'main' (has small zones), 'small' (inside a main zone) or 'zone' (a
 * plain zone with neither, which is also a main zone to everything else).
 */
function withKind(zone) {
    const { _count, ...rest } = zone;
    const smallZoneCount = _count?.smallZones ?? 0;
    return {
        ...rest,
        smallZoneCount,
        kind: rest.parentZoneId ? 'small' : smallZoneCount > 0 ? 'main' : 'zone',
    };
}

/**
 * The cities that actually have zones, for the filter dropdown.
 *
 * Derived rather than kept as its own list: a city with no zones is nothing a
 * zone filter can usefully offer, and a stored list would drift the moment a
 * zone moved or was deleted.
 */
export async function getZoneCities() {
    const rows = await prisma.foodZone.groupBy({
        by: ['city'],
        where: { city: { not: null } },
        _count: { _all: true },
    });

    const cities = rows
        .filter((r) => String(r.city || '').trim())
        .map((r) => ({ city: r.city, zones: r._count._all }))
        .sort((a, b) => a.city.localeCompare(b.city));

    return { cities };
}

export async function getZoneById(id) {
    if (!isId(id)) return null;
    const zone = await prisma.foodZone.findUnique({
        where: { id: String(id) },
        include: {
            parentZone: { select: { id: true, name: true, coordinates: true } },
            smallZones: { select: { id: true, name: true, coordinates: true, isActive: true }, orderBy: { name: 'asc' } },
            _count: { select: { smallZones: true } },
        },
    });
    return zone ? withKind(zone) : null;
}

export async function createZone(body = {}) {
    const name =
        typeof body.name === 'string' && body.name.trim()
            ? body.name.trim()
            : (body.zoneName || '').trim();
    if (!name) return { error: 'Zone name is required' };

    const coordinates = normalizeRing(body.coordinates);
    // Checked here as well as by the database CHECK, so the admin gets a plain
    // message rather than a constraint violation.
    if (coordinates.length < 3) {
        return { error: 'At least 3 coordinates (polygon points) are required' };
    }

    // A small zone is in its main zone's city; anything else names its own.
    const parent = await resolveParentZone(body);
    const cityRow = parent?.cityId
        ? { id: parent.cityId, name: parent.city }
        : await resolveZoneCity(body);
    if (!cityRow) return { error: 'Choose the city this zone is in' };

    const zone = await prisma.$transaction(async (tx) => {
        const row = await tx.foodZone.create({
            data: {
                cityId: cityRow.id,
                name,
                zoneName: body.zoneName?.trim() || name,
                country: body.country?.trim() || 'India',
                serviceLocation: body.serviceLocation?.trim() || name,
                city: cityRow.name,
                unit: body.unit === 'miles' ? 'miles' : 'kilometer',
                coordinates,
                isActive: body.isActive !== false,
                parentZoneId: parent ? parent.id : null,
            },
        });
        await assertZoneShapes(tx, row.id);
        return row;
    });

    zoneWritten();
    // A new small zone takes in the restaurants already inside it.
    const restaurantsMoved = await resortRestaurantsInFamily(zone.id);
    return { zone, restaurantsMoved };
}

export async function updateZone(id, body = {}) {
    if (!isId(id)) return null;

    const existing = await prisma.foodZone.findUnique({ where: { id: String(id) } });
    if (!existing) return null;

    const data = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.zoneName !== undefined) data.zoneName = String(body.zoneName).trim();
    if (body.country !== undefined) data.country = String(body.country).trim();

    const parent = await resolveParentZone(body, existing.id);
    if (parent !== undefined) {
        if (parent) {
            const hasSmallZones = await prisma.foodZone.count({ where: { parentZoneId: existing.id } });
            if (hasSmallZones) {
                throw new ValidationError('This zone has small zones of its own, so it cannot go inside another zone.');
            }
        }
        data.parentZoneId = parent ? parent.id : null;
    }
    const effectiveParent = parent !== undefined ? parent : existing.parentZoneId
        ? await prisma.foodZone.findUnique({ where: { id: existing.parentZoneId }, select: { cityId: true, city: true } })
        : null;

    if (effectiveParent?.cityId) {
        // A small zone is always in its main zone's city.
        data.cityId = effectiveParent.cityId;
        data.city = effectiveParent.city;
    } else {
        const cityRow = await resolveZoneCity(body);
        if (cityRow) {
            data.cityId = cityRow.id;
            data.city = cityRow.name;
        } else if (cityRow === null) {
            throw new ValidationError('Choose the city this zone is in');
        }
    }
    if (body.codEnabled !== undefined) {
        // null is a real answer here -- "follow the platform" -- and is not the
        // same as false, which is "off in this zone whatever the platform says".
        data.codEnabled = body.codEnabled === null ? null : body.codEnabled !== false;
    }
    if (body.codMinDeliveredOrders !== undefined) {
        const n = Number(body.codMinDeliveredOrders);
        data.codMinDeliveredOrders = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    if (body.serviceLocation !== undefined) {
        data.serviceLocation = String(body.serviceLocation).trim();
    }
    if (body.unit !== undefined) data.unit = body.unit === 'miles' ? 'miles' : 'kilometer';
    if (body.isActive !== undefined) data.isActive = body.isActive !== false;

    // A ring shorter than 3 points is ignored rather than saved — it would make
    // the zone match nothing, and the database would refuse it anyway.
    if (Array.isArray(body.coordinates) && body.coordinates.length >= 3) {
        data.coordinates = normalizeRing(body.coordinates);
    }

    // serviceLocation is the label the app shows; never let it go blank.
    const nextName = data.name ?? existing.name;
    if (nextName && !(data.serviceLocation ?? existing.serviceLocation)) {
        data.serviceLocation = nextName;
    }

    const zone = await prisma.$transaction(async (tx) => {
        const row = await tx.foodZone.update({ where: { id: existing.id }, data });
        await assertZoneShapes(tx, row.id);
        return row;
    });

    // A main zone's city moves its small zones with it.
    if (!zone.parentZoneId && data.cityId) {
        await prisma.foodZone.updateMany({
            where: { parentZoneId: zone.id },
            data: { cityId: data.cityId, city: data.city },
        });
    }

    zoneWritten();
    // Restaurants follow a redrawn, moved or switched-off small zone. A zone
    // that changed main zone re-sorts its old family too.
    let restaurantsMoved = await resortRestaurantsInFamily(zone.id);
    if (existing.parentZoneId && existing.parentZoneId !== zone.parentZoneId) {
        restaurantsMoved += await resortRestaurantsInFamily(existing.parentZoneId);
    }
    return { zone, restaurantsMoved };
}

export async function deleteZone(id) {
    if (!isId(id)) return null;

    const smallZones = await prisma.foodZone.count({ where: { parentZoneId: String(id) } });
    if (smallZones) {
        throw new ValidationError(
            `This main zone has ${smallZones} small zone${smallZones === 1 ? '' : 's'}. Delete or move them first.`,
        );
    }

    // A small zone's restaurants go back to its main zone rather than to no zone.
    const doomed = await prisma.foodZone.findUnique({ where: { id: String(id) }, select: { parentZoneId: true } });
    if (doomed?.parentZoneId) {
        await prisma.foodRestaurant.updateMany({ where: { zoneId: String(id) }, data: { zoneId: doomed.parentZoneId } });
    }

    // deleteMany, so a zone that has already gone returns null rather than
    // throwing P2025 out of the controller.
    const { count } = await prisma.foodZone.deleteMany({ where: { id: String(id) } });
    if (!count) return null;

    // Riders lose the deleted zone from the zones they serve.
    await prisma.$executeRaw`
        UPDATE "food_delivery_partners"
        SET "serviceZoneIds" = array_remove("serviceZoneIds", ${String(id)})
        WHERE ${String(id)} = ANY("serviceZoneIds")`;

    zoneWritten();
    return { id: String(id) };
}
