/**
 * A restaurant's card tags (Bestseller, Popular, ...), as the API sends them:
 * `highlightBadgesInfo` is every tag with its label and colour; older
 * responses carry only the single `highlightBadgeInfo`.
 */
export function restaurantTags(restaurant) {
  const list = Array.isArray(restaurant?.highlightBadgesInfo) ? restaurant.highlightBadgesInfo : []
  const tags = list.length ? list : restaurant?.highlightBadgeInfo ? [restaurant.highlightBadgeInfo] : []
  const seen = new Set()
  return tags.filter((t) => {
    if (!t || !t.label || seen.has(t.key || t.label)) return false
    seen.add(t.key || t.label)
    return true
  })
}

export default function RestaurantTagPills({ restaurant, tags, className = "", size = "sm" }) {
  const list = Array.isArray(tags) ? tags : restaurantTags(restaurant)
  if (!list.length) return null
  const pad = size === "md" ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]"
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {list.map((tag) => (
        <span
          key={tag.key || tag.label}
          className={`inline-flex items-center rounded-full font-semibold uppercase tracking-wide text-white shadow-sm ${pad}`}
          style={{ backgroundColor: tag.color || "#E23744" }}
        >
          {tag.label}
        </span>
      ))}
    </div>
  )
}
