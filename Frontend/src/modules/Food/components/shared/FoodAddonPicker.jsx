import { useEffect, useState } from "react"
import { adminAPI, restaurantAPI } from "@food/api"

/**
 * "Add-ons" multi-select on the Add/Edit Food forms (admin and restaurant).
 *
 * FoodAddon.foodIds stays the only record of which dish an add-on is on; this
 * just picks add-ons for one dish and the parent saves them with
 * saveFoodAddons() (PUT /foods/:id/addons) after the dish itself is saved.
 *
 * - Editing a dish: options come from GET /foods/:id/addons (with `selected`).
 * - A new dish: the restaurant's approved add-ons from the add-on list.
 * Whole-menu add-ons (no dishes picked) already apply to every dish, so they
 * show ticked and locked. An add-on whose only dish is this one cannot be
 * unticked here (it would become whole-menu); that is edited from Add-ons.
 */

const apiFor = (scope) => (scope === "restaurant" ? restaurantAPI : adminAPI)

const normalizeListAddon = (a) => {
  const content = a?.published || a?.draft || a || {}
  const foodIds = Array.isArray(a?.foodIds) ? a.foodIds.map(String) : []
  return {
    id: String(a?.id || a?._id || ""),
    name: String(content.name || a?.name || "").trim(),
    price: Number(content.price ?? a?.price) || 0,
    foodType: content.foodType === "non-veg" ? "non-veg" : "veg",
    approvalStatus: a?.approvalStatus,
    isAvailable: a?.isAvailable !== false,
    appliesToWholeMenu: foodIds.length === 0,
    selected: foodIds.length === 0,
    onlyThisFood: false,
    mappable: a?.approvalStatus === "approved" || Boolean(a?.published),
  }
}

export async function saveFoodAddons(scope, foodId, addonIds) {
  if (!foodId) return null
  return apiFor(scope).setFoodAddons(foodId, addonIds)
}

export default function FoodAddonPicker({ scope = "admin", foodId, restaurantId, value, onChange, disabled = false }) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!foodId && scope === "admin" && !restaurantId) {
        setOptions([])
        onChange?.([], { initial: true })
        return
      }
      setLoading(true)
      setError("")
      try {
        let list = []
        let selectedIds = []
        if (foodId) {
          const res = await apiFor(scope).getFoodAddons(foodId)
          const data = res?.data?.data || {}
          list = Array.isArray(data.addons) ? data.addons : []
          selectedIds = Array.isArray(data.addonIds) ? data.addonIds.map(String) : []
        } else {
          const res =
            scope === "restaurant"
              ? await restaurantAPI.getAddons({ limit: 100 })
              : await adminAPI.getRestaurantAddons({ restaurantId, limit: 200, page: 1 })
          const raw = res?.data?.data?.addons || res?.data?.addons || []
          list = (Array.isArray(raw) ? raw : []).map(normalizeListAddon).filter((a) => a.id && a.mappable)
        }
        if (cancelled) return
        setOptions(list)
        onChange?.(selectedIds, { initial: true })
      } catch (err) {
        if (!cancelled) {
          setOptions([])
          setError(err?.response?.data?.message || "Could not load add-ons")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // onChange is the parent's setter; reloading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, foodId, restaurantId])

  const selected = new Set((Array.isArray(value) ? value : []).map(String))

  const toggle = (option) => {
    if (disabled || option.appliesToWholeMenu) return
    const next = new Set(selected)
    if (next.has(option.id)) {
      if (option.onlyThisFood) return
      next.delete(option.id)
    } else {
      next.add(option.id)
    }
    onChange?.([...next], { initial: false })
  }

  if (!foodId && scope === "admin" && !restaurantId) {
    return <p className="text-xs text-slate-500">Select a restaurant to choose its add-ons.</p>
  }
  if (loading) return <p className="text-xs text-slate-500">Loading add-ons…</p>
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!options.length) {
    return <p className="text-xs text-slate-500">This restaurant has no approved add-ons yet.</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const checked = option.appliesToWholeMenu || selected.has(option.id)
        const locked = option.appliesToWholeMenu || (checked && option.onlyThisFood)
        const hint = option.appliesToWholeMenu
          ? "Applies to every item on the menu. Change it from Add-ons."
          : checked && option.onlyThisFood
            ? "This is the add-on's only item. Edit or delete it from Add-ons."
            : ""
        return (
          <label
            key={option.id}
            title={hint || undefined}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
              checked ? "border-orange-400 bg-orange-50 text-orange-800" : "border-slate-200 bg-white text-slate-700"
            } ${locked || disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-orange-500"
              checked={checked}
              disabled={locked || disabled}
              onChange={() => toggle(option)}
            />
            <span className="font-medium">{option.name || "Add-on"}</span>
            <span className="text-xs text-slate-500">₹{Number(option.price || 0)}</span>
            {option.appliesToWholeMenu && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">All items</span>
            )}
            {option.isAvailable === false && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Off</span>
            )}
          </label>
        )
      })}
    </div>
  )
}
