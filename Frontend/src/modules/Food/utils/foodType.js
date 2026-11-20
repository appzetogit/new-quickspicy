/**
 * Dish diet: 'Veg', 'Egg' or 'Non-Veg'.
 *
 * The API sends the Prisma enum name for non-veg ('NonVeg') on some screens
 * and 'Non-Veg' on others; older items may say 'veg' / 'non veg'. Egg
 * (eggetarian) is not veg: veg-only filters and pure-veg checks leave it out.
 */
export const FOOD_TYPE_OPTIONS = [
  { value: "Veg", label: "Veg" },
  { value: "Egg", label: "Egg" },
  { value: "Non-Veg", label: "Non-veg" },
]

/** Colours for the square-and-dot mark (Indian convention: green / amber / red). */
export const FOOD_TYPE_COLORS = {
  Veg: "#16a34a",
  Egg: "#d97706",
  "Non-Veg": "#dc2626",
}

export const normalizeFoodType = (value, { isVeg } = {}) => {
  const v = String(value ?? "").trim().toLowerCase()
  if (/^(pure\s*)?veg(etarian)?$/.test(v)) return "Veg"
  if (/^(contains\s*)?egg(etarian)?$/.test(v)) return "Egg"
  if (!v && isVeg === true) return "Veg"
  return "Non-Veg"
}

/** Type of a dish-like object: foodType first, then the isVeg flag. */
export const foodTypeOf = (item) =>
  item?.foodType ? normalizeFoodType(item.foodType) : item?.isVeg === true ? "Veg" : "Non-Veg"

export const isVegItem = (item) => foodTypeOf(item) === "Veg"
export const isEggItem = (item) => foodTypeOf(item) === "Egg"
export const foodTypeColor = (value) => FOOD_TYPE_COLORS[normalizeFoodType(value)]
