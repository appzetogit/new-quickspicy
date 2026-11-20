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

export default function ServicePausedBanner({ status, title = "Orders are paused in your area", className = "" }) {
  if (!isServicePaused(status)) return null
  const resume = formatResumeAt(status.resumeAt)
  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 ${className}`}
    >
      <p className="text-sm font-semibold">{title}</p>
      {status.message ? <p className="text-sm mt-0.5">{status.message}</p> : null}
      {resume ? <p className="text-xs mt-1 text-amber-800">Expected to resume around {resume}.</p> : null}
    </div>
  )
}
