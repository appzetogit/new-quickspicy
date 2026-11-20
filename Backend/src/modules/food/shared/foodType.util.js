/**
 * FoodType's Prisma name for 'Non-Veg' is NonVeg — the hyphen is a `@map`, so
 * the value on the wire and the value in the client differ and have to be
 * translated in both directions. Getting this wrong does not throw; it silently
 * marks a dish as the wrong diet, which is why it lives in one place.
 *
 * Three diets: Veg, Egg (eggetarian: no meat or fish, but contains egg) and
 * Non-Veg. Egg is NOT vegetarian: "veg only" filters and pure-veg restaurants
 * exclude it, the same as Non-Veg.
 */

/**
 * Whether a food type value means vegetarian. Case and spacing are ignored:
 * an exact 'Veg' match turned 'veg' (the bulk-upload template's own sample),
 * 'VEG' or 'Pure Veg' into Non-Veg without a word.
 */
export const isVegFoodType = (value) => /^(pure\s*)?veg(etarian)?$/i.test(String(value || '').trim());

/** 'Egg', 'egg', 'Eggetarian', 'Contains Egg' — case and spacing ignored. */
export const isEggFoodType = (value) => /^(contains\s*)?egg(etarian)?$/i.test(String(value || '').trim());

/** Client value → Prisma enum member. Anything unrecognised is NonVeg. */
export const toFoodTypeColumn = (value) => {
    if (isVegFoodType(value)) return 'Veg';
    if (isEggFoodType(value)) return 'Egg';
    return 'NonVeg';
};

/**
 * Prisma enum member (or a client value) → the form the apps read:
 * 'Veg', 'Egg' or 'Non-Veg'. Anything unrecognised counts as non-veg.
 */
export const fromFoodTypeColumn = (value) => {
    if (isVegFoodType(value)) return 'Veg';
    if (isEggFoodType(value)) return 'Egg';
    return 'Non-Veg';
};

/** The client-facing values, in display order. */
export const FOOD_TYPES = ['Veg', 'Egg', 'Non-Veg'];

/**
 * Prisma `foodType` filter from a list query.
 *
 * - `foodType=Egg` / `foodType=Veg,Egg` / `foodType=Non-Veg` (also `NonVeg`):
 *   only those diets. Unknown values are ignored.
 * - `isVeg=true`: Veg only — Egg is excluded, as it is from pure-veg.
 *
 * Both together intersect (isVeg=true&foodType=Egg matches nothing).
 * Returns null when there is nothing to filter on.
 */
export const foodTypeWhereFromQuery = (query = {}) => {
    const raw = query.foodType ?? query.foodTypes;
    const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .map((v) => (isVegFoodType(v) ? 'Veg' : isEggFoodType(v) ? 'Egg' : /^non[\s_-]*veg$/i.test(v) ? 'NonVeg' : null))
        .filter(Boolean);
    let wanted = list.length ? [...new Set(list)] : null;
    if (String(query.isVeg) === 'true') wanted = wanted ? wanted.filter((v) => v === 'Veg') : ['Veg'];
    if (!wanted) return null;
    return { foodType: { in: wanted } };
};
