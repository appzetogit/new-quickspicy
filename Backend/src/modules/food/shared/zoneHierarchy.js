import { prisma } from '../../../config/prisma.js';
import { isId } from '../../../utils/helpers.js';

/**
 * Main zones and small zones.
 *
 * A zone with no parentZoneId is a main zone: the area customers order in. A
 * zone with a parent is a small zone drawn inside its main zone. Small zones
 * only decide which riders get an order (the restaurant's small zone, riders
 * who serve it, never widened), and their settings fall back to the main
 * zone's when blank. One level only: a small zone cannot have small zones.
 *
 * The parent links barely change, so they are cached for a short while. Each
 * process keeps its own copy; a zone saved in the API is seen by the worker
 * within TREE_TTL_MS.
 */

// Off under tests, which create zones straight in the database.
const TREE_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 10_000;
let tree = { at: 0, byId: null };

export function invalidateZoneTree() {
    tree = { at: 0, byId: null };
}

/**
 * id -> { id, parentZoneId, name, isActive } for every zone. `mustHave` is a
 * zone id the caller is about to look up: when the cached copy does not know
 * it (a zone created in another process moments ago), it is reloaded at once.
 */
export async function loadZoneTree(mustHave = null) {
    const fresh = tree.byId && Date.now() - tree.at < TREE_TTL_MS;
    if (fresh && (!mustHave || tree.byId.has(String(mustHave)))) return tree.byId;
    const rows = await prisma.foodZone.findMany({
        select: { id: true, parentZoneId: true, name: true, zoneName: true, isActive: true },
    });
    const byId = new Map(rows.map((z) => [z.id, z]));
    tree = { at: Date.now(), byId };
    return byId;
}

/** The main zone of a zone: its parent, or itself when it is a main zone. */
export async function mainZoneIdOf(zoneId) {
    if (!isId(zoneId)) return null;
    const byId = await loadZoneTree(zoneId);
    const zone = byId.get(String(zoneId));
    if (!zone) return String(zoneId);
    return zone.parentZoneId || zone.id;
}

/** True when the zone is a small zone (has a main zone). */
export async function isSmallZone(zoneId) {
    if (!isId(zoneId)) return false;
    return Boolean((await loadZoneTree(zoneId)).get(String(zoneId))?.parentZoneId);
}

/** [zone, its main zone] -- the order a setting is looked up in. */
export async function zoneChain(zoneId) {
    if (!isId(zoneId)) return [];
    const id = String(zoneId);
    const parent = (await loadZoneTree(id)).get(id)?.parentZoneId;
    return parent ? [id, parent] : [id];
}

/** The given zones plus their main zones, for "is any of these paused". */
export async function withMainZones(zoneIds = []) {
    const ids = (Array.isArray(zoneIds) ? zoneIds : [zoneIds]).filter(isId).map(String);
    if (!ids.length) return [];
    const byId = await loadZoneTree(ids.find((i) => !tree.byId?.has(i)) || null);
    const out = new Set(ids);
    for (const id of ids) {
        const parent = byId.get(id)?.parentZoneId;
        if (parent) out.add(parent);
    }
    return [...out];
}

/** The small zones of a main zone (empty for a small zone or a plain zone). */
export async function smallZoneIdsOf(zoneId) {
    if (!isId(zoneId)) return [];
    const byId = await loadZoneTree();
    const id = String(zoneId);
    return [...byId.values()].filter((z) => z.parentZoneId === id).map((z) => z.id);
}

/**
 * A zone and, for a main zone, all of its small zones. What a report or list
 * filtered "by zone" should include: picking a main zone means everything in it.
 */
export async function zoneFamilyIds(zoneId) {
    if (!isId(zoneId)) return [];
    return [String(zoneId), ...(await smallZoneIdsOf(zoneId))];
}

/**
 * What to put in a Prisma `zoneId` filter for a zone picked in an admin
 * report or list: the id itself, or `{ in: [main, ...small zones] }` for a main
 * zone that has small zones, so picking it shows everything inside it. Passes
 * null/undefined through unchanged.
 */
export async function zoneMatch(zoneId) {
    if (!isId(zoneId)) return zoneId;
    const family = await zoneFamilyIds(zoneId);
    return family.length > 1 ? { in: family } : String(zoneId);
}

/** Each given zone plus, for main zones, their small zones. */
export async function expandZoneFamilies(zoneIds = []) {
    const ids = (Array.isArray(zoneIds) ? zoneIds : [zoneIds]).filter(isId).map(String);
    if (!ids.length) return [];
    const byId = await loadZoneTree();
    const want = new Set(ids);
    const out = new Set(ids);
    for (const z of byId.values()) if (z.parentZoneId && want.has(z.parentZoneId)) out.add(z.id);
    return [...out];
}

/**
 * A zone's settings with blanks filled from its main zone.
 *
 * `fields` are FoodZone columns. For each, the small zone's value wins unless
 * it is null, then the main zone's; a field null on both stays null, which
 * callers already read as "follow the platform". Read fresh, not cached: these
 * are switches an admin flips to stop something right now.
 *
 * @param {string|null} zoneId
 * @param {string[]} fields
 * @returns {Promise<object|null>} null when there is no such zone
 */
export async function effectiveZoneSettings(zoneId, fields = []) {
    if (!isId(zoneId)) return null;
    const select = { id: true, parentZoneId: true };
    for (const f of fields) select[f] = true;

    const zone = await prisma.foodZone.findUnique({ where: { id: String(zoneId) }, select });
    if (!zone) return null;
    if (!zone.parentZoneId) return zone;

    const main = await prisma.foodZone.findUnique({ where: { id: zone.parentZoneId }, select });
    if (!main) return zone;
    const merged = { ...zone };
    for (const f of fields) {
        if (merged[f] === null || merged[f] === undefined) merged[f] = main[f];
    }
    return merged;
}
