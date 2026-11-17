import { prisma } from '../../../config/prisma.js';
import { isId } from '../../../utils/helpers.js';

/**
 * Business verticals: "Food", "Home Food", "Grocery" ...
 *
 * A restaurant lists the verticals it trades under in `verticalIds`. An empty
 * list means the default vertical (Food), so every restaurant created before
 * verticals existed -- and every one whose owner never picked -- keeps showing
 * in the Food section rather than disappearing from all of them.
 */

/** Lowercased, whitespace collapsed: what two spellings of one vertical share. */
export const verticalSlug = (name) =>
    String(name ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

/** A vertical by id or by slug/name ("home food", "Home Food"). Null if unknown. */
export const findVertical = async (ref) => {
    const raw = String(ref ?? '').trim();
    if (!raw) return null;
    if (isId(raw)) {
        const byId = await prisma.foodVertical.findUnique({ where: { id: raw } });
        if (byId) return byId;
    }
    return prisma.foodVertical.findUnique({ where: { slug: verticalSlug(raw) } });
};

/**
 * Prisma `where` for restaurants in a vertical. The default vertical also
 * claims restaurants that have no verticals at all.
 */
export const restaurantVerticalWhere = (vertical) =>
    vertical.isDefault
        ? { OR: [{ verticalIds: { has: vertical.id } }, { verticalIds: { isEmpty: true } }] }
        : { verticalIds: { has: vertical.id } };

/**
 * Reads `verticalId` (or `vertical`, a slug/name) from a query string.
 *
 *   { filter: null }   no vertical asked for: apply nothing
 *   { filter: where }  restrict to that vertical
 *   { none: true }     asked for one that does not exist or is switched off:
 *                      the answer is "nothing", not "ignore the filter"
 */
export const verticalFilterFromQuery = async (query = {}) => {
    const ref = query?.verticalId ?? query?.vertical;
    if (ref === undefined || ref === null || String(ref).trim() === '') return { filter: null, vertical: null };
    const vertical = await findVertical(ref);
    if (!vertical || !vertical.isActive) return { none: true, vertical: null };
    return { filter: restaurantVerticalWhere(vertical), vertical };
};

/**
 * Category filter for a vertical: categories tied to it, plus categories with
 * no vertical (those belong everywhere).
 */
export const categoryVerticalWhere = (vertical) => ({
    OR: [{ verticalId: null }, { verticalId: vertical.id }],
});
