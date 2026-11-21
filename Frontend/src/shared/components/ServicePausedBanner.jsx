/**
 * The admin "Pause orders" notice, as a banner: used by the customer web, the
 * restaurant panel and the rider web. `status` is the API's
 * { paused | servicePaused, message, resumeAt }; nothing renders when it is
 * not paused.
 */

export const formatResumeAt = (value) => {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

export const isServicePaused = (status) => Boolean(status && (status.servicePaused || status.paused))

/**
 * Riders serve their home zone plus their cohort's zones. `partial` is true
 * when only some of those zones are paused; `zones` has the per-zone detail
 * ({ zoneId, name, home, paused, message, resumeAt }).
 */
export const isPartlyPaused = (status) =>
  Boolean(status?.partial && Array.isArray(status.zones) && status.zones.some((z) => z?.paused))

const zoneNames = (zones) => zones.map((z) => z.name || "Unnamed zone").join(", ")

export default function ServicePausedBanner({ status, title = "Orders are paused in your area", className = "", showPartial = false }) {
  const partial = showPartial && isPartlyPaused(status)
  if (!isServicePaused(status)) {
    if (!partial) return null
    // Home zone open, some cohort zones paused.
    const paused = status.zones.filter((z) => z?.paused)
    const open = status.zones.filter((z) => !z?.paused)
    const first = paused[0] || {}
    const partResume = formatResumeAt(first.resumeAt)
    return (
      <div
        role="status"
        className={`rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 ${className}`}
      >
        <p className="text-sm font-semibold">Orders are paused in some of your zones: {zoneNames(paused)}</p>
        {open.length ? <p className="text-sm mt-0.5">You still get orders from {zoneNames(open)}.</p> : null}
        {first.message ? <p className="text-sm mt-0.5">{first.message}</p> : null}
        {partResume ? <p className="text-xs mt-1 text-amber-800">Expected to resume around {partResume}.</p> : null}
      </div>
    )
  }
  const resume = formatResumeAt(status.resumeAt)
  const stillOpen = partial ? status.zones.filter((z) => !z?.paused) : []
  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 ${className}`}
    >
      <p className="text-sm font-semibold">{title}</p>
      {status.message ? <p className="text-sm mt-0.5">{status.message}</p> : null}
      {stillOpen.length ? <p className="text-sm mt-0.5">Orders still come from {zoneNames(stillOpen)}.</p> : null}
      {resume ? <p className="text-xs mt-1 text-amber-800">Expected to resume around {resume}.</p> : null}
    </div>
  )
}
