import { FOOD_TYPE_COLORS, normalizeFoodType } from "@food/utils/foodType"

/**
 * The square-with-dot diet mark: green Veg, amber Egg, red Non-veg.
 * `type` is any foodType spelling the API sends; without it, `isVeg` decides.
 */
export default function FoodTypeIcon({ type, isVeg, size = 14, className = "" }) {
  const value = type ? normalizeFoodType(type) : isVeg === true ? "Veg" : "Non-Veg"
  const color = FOOD_TYPE_COLORS[value]
  const label = value === "Non-Veg" ? "Non-veg" : value
  const inner = Math.max(4, Math.round(size * 0.5))
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center border bg-white ${className}`}
      style={{ width: size, height: size, borderColor: color, borderRadius: 2 }}
    >
      <span className="rounded-full" style={{ width: inner, height: inner, backgroundColor: color }} />
    </span>
  )
}
