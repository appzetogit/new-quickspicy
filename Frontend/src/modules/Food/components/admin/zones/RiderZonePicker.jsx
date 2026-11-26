import { useMemo } from "react"

/**
 * Where a rider works: one main zone, and the small zones inside it they serve.
 *
 * Orders from a restaurant in a small zone only go to riders given that small
 * zone (never widened), so a main zone with small zones needs at least one
 * ticked. A main zone with no small zones is itself the rider's zone.
 *
 * value / onChange: { zoneId, serviceZoneIds } -- the server's shape. zoneId is
 * the home zone (the first small zone ticked, or the main zone itself).
 */
const idOf = (z) => String(z?._id || z?.id || "")

export function splitZones(zones = []) {
  const mains = zones.filter((z) => !z.parentZoneId)
  const smallOf = new Map()
  for (const z of zones) {
    if (!z.parentZoneId) continue
    const key = String(z.parentZoneId)
    if (!smallOf.has(key)) smallOf.set(key, [])
    smallOf.get(key).push(z)
  }
  for (const list of smallOf.values()) list.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { mains, smallOf }
}

/** The main zone a saved rider is in, from their zones. */
export function mainZoneOfRider(zones = [], value = {}) {
  const byId = new Map(zones.map((z) => [idOf(z), z]))
  const first = byId.get(String(value.zoneId || "")) || byId.get(String((value.serviceZoneIds || [])[0] || ""))
  if (!first) return ""
  return first.parentZoneId ? String(first.parentZoneId) : idOf(first)
}

export default function RiderZonePicker({ zones = [], mainZoneId, onMainZoneChange, value, onChange, inputClass, error }) {
  const { mains, smallOf } = useMemo(() => splitZones(zones), [zones])
  const smalls = mainZoneId ? smallOf.get(String(mainZoneId)) || [] : []
  const ticked = [value?.zoneId, ...(value?.serviceZoneIds || [])].filter(Boolean).map(String)

  const pickMain = (id) => {
    onMainZoneChange(id)
    // A main zone without small zones is the rider's zone; otherwise they
    // tick small zones next.
    const hasSmall = (smallOf.get(String(id)) || []).length > 0
    onChange({ zoneId: id && !hasSmall ? id : "", serviceZoneIds: [] })
  }

  const toggle = (id) => {
    const next = ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]
    // Keep the list order, so the home zone is the first ticked on screen.
    const ordered = smalls.map(idOf).filter((x) => next.includes(x))
    onChange({ zoneId: ordered[0] || "", serviceZoneIds: ordered.slice(1) })
  }

  return (
    <div className="space-y-2">
      <select className={inputClass} value={mainZoneId || ""} onChange={(e) => pickMain(e.target.value)}>
        <option value="">Choose a main zone…</option>
        {mains.map((z) => (
          <option key={idOf(z)} value={idOf(z)}>
            {z.name || z.zoneName}
            {(smallOf.get(idOf(z)) || []).length ? ` (${(smallOf.get(idOf(z)) || []).length} small zones)` : ""}
          </option>
        ))}
      </select>
      {smalls.length > 0 ? (
        <div className="rounded-lg border border-slate-200 p-2">
          <p className="mb-1 text-xs text-slate-500">
            Small zones this rider serves. They only get orders from restaurants in these. The top one ticked is their home zone.
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {smalls.map((z) => (
              <label key={idOf(z)} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={ticked.includes(idOf(z))} onChange={() => toggle(idOf(z))} />
                {z.name || z.zoneName}
                {ticked[0] === idOf(z) ? <span className="text-xs text-emerald-700">(home)</span> : null}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}
