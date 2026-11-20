import { prisma } from '../../../config/prisma.js';
import { isId } from '../../../utils/helpers.js';
import { ValidationError } from '../../../core/auth/errors.js';
import { invalidatePublicAddonCache } from '../restaurant/services/restaurantAddon.service.js';

/**
 * Add-on mapping from the dish's side (Add/Edit Food: "Add-ons").
 *
 * FoodAddon.foodIds stays the single source of truth; this only adds or
 * removes one dish id in it. Two rules follow from "empty foodIds means the
 * whole menu":
 *
 * - A whole-menu add-on already applies to every dish. It is listed (locked)
 *   but never written here: selecting it would narrow it to this one dish.
 * - Taking a dish off an add-on whose only dish it is would turn that add-on
 *   into a whole-menu one. That is refused; delete or remap it from Add-ons.
 *
 * Only add-ons that are approved (or have a published, customer-visible
 * version) can be picked. Pending-only ones are left exactly as they are.
 */

const isMappable = (a) => a.approvalStatus === 'approved' || (a.published && typeof a.published === 'object');

const addonName = (a) => String(a.published?.name || a.draft?.name || '').trim();

const serializeOption = (a, foodId) => {
    const foodIds = Array.isArray(a.foodIds) ? a.foodIds.map(String) : [];
    const wholeMenu = foodIds.length === 0;
    const content = a.published || a.draft || {};
    return {
        id: a.id,
        _id: a.id,
        name: addonName(a),
        price: Number(content.price) || 0,
        foodType: content.foodType === 'non-veg' ? 'non-veg' : 'veg',
        image: content.image || '',
        approvalStatus: a.approvalStatus,
        isAvailable: a.isAvailable !== false,
        groupName: a.groupName || '',
        appliesToWholeMenu: wholeMenu,
        selected: wholeMenu || foodIds.includes(foodId),
        // Unticking would leave it with no dish, i.e. whole menu: not allowed.
        onlyThisFood: foodIds.length === 1 && foodIds[0] === foodId,
        foodCount: foodIds.length,
    };
};

async function loadFood(foodId, restaurantId) {
    if (!isId(foodId)) throw new ValidationError('Invalid food id');
    const food = await prisma.foodItem.findUnique({
        where: { id: String(foodId) },
        select: { id: true, restaurantId: true, name: true },
    });
    // A restaurant only ever sees its own dishes; someone else's is "not found".
    if (!food || (restaurantId && food.restaurantId !== String(restaurantId))) return null;
    return food;
}

const loadAddons = (restaurantId) =>
    prisma.foodAddon.findMany({
        where: { restaurantId, isDeleted: false },
        select: {
            id: true, foodIds: true, draft: true, published: true, approvalStatus: true,
            isAvailable: true, groupName: true,
        },
        orderBy: [{ groupSortOrder: 'asc' }, { createdAt: 'asc' }],
    });

/**
 * GET: the dish's restaurant's approved add-ons, each marked selected or not.
 * `restaurantId` (restaurant panel) limits it to that restaurant's own dish.
 * Returns null when the dish is not found (or not the restaurant's).
 */
export async function getFoodAddonMapping(foodId, { restaurantId } = {}) {
    const food = await loadFood(foodId, restaurantId);
    if (!food) return null;
    const addons = (await loadAddons(food.restaurantId)).filter(isMappable);
    return {
        foodId: food.id,
        restaurantId: food.restaurantId,
        addons: addons.map((a) => serializeOption(a, food.id)),
        addonIds: addons
            .filter((a) => Array.isArray(a.foodIds) && a.foodIds.includes(food.id))
            .map((a) => a.id),
    };
}

/**
 * PUT { addonIds }: after this, the dish is on exactly these item-specific
 * add-ons (among the approved ones). One transaction.
 */
export async function setFoodAddons(foodId, addonIds, { restaurantId } = {}) {
    if (!Array.isArray(addonIds)) throw new ValidationError('addonIds must be an array');
    const wanted = new Set(addonIds.map((v) => String(v || '').trim()).filter(Boolean));
    if ([...wanted].some((id) => !isId(id))) throw new ValidationError('Invalid add-on id');
    if (wanted.size > 200) throw new ValidationError('Too many add-ons');

    const food = await loadFood(foodId, restaurantId);
    if (!food) return null;

    const all = await loadAddons(food.restaurantId);
    const byId = new Map(all.map((a) => [a.id, a]));
    for (const id of wanted) {
        const a = byId.get(id);
        if (!a) throw new ValidationError('One or more add-ons do not belong to this restaurant');
        if (!isMappable(a)) throw new ValidationError(`Add-on "${addonName(a)}" is not approved yet`);
    }

    const toAdd = [];
    const toRemove = [];
    const stranded = [];
    for (const a of all) {
        if (!isMappable(a)) continue;
        const ids = Array.isArray(a.foodIds) ? a.foodIds.map(String) : [];
        if (!ids.length) continue; // whole menu: never touched here
        const has = ids.includes(food.id);
        if (wanted.has(a.id) && !has) toAdd.push({ id: a.id, foodIds: [...ids, food.id] });
        if (!wanted.has(a.id) && has) {
            const next = ids.filter((id) => id !== food.id);
            if (!next.length) stranded.push(addonName(a) || a.id);
            else toRemove.push({ id: a.id, foodIds: next });
        }
    }
    if (stranded.length) {
        throw new ValidationError(
            `This is the only item on add-on${stranded.length > 1 ? 's' : ''} ${stranded.map((n) => `"${n}"`).join(', ')}. ` +
            'Removing it would show the add-on on the whole menu; edit or delete it from Add-ons instead.',
        );
    }

    if (toAdd.length || toRemove.length) {
        await prisma.$transaction(async (tx) => {
            for (const { id, foodIds } of [...toAdd, ...toRemove]) {
                await tx.foodAddon.update({ where: { id }, data: { foodIds } });
            }
            // An add-on taken off the dish keeps no price for that dish's sizes.
            if (toRemove.length) {
                await tx.foodAddonVariantPrice.deleteMany({
                    where: { addonId: { in: toRemove.map((r) => r.id) }, variant: { foodItemId: food.id } },
                });
            }
        });
        await invalidatePublicAddonCache();
    }

    return {
        ...(await getFoodAddonMapping(food.id)),
        added: toAdd.map((a) => a.id),
        removed: toRemove.map((a) => a.id),
    };
}
