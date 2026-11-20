import { Clock } from "lucide-react"

const timeText = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
}

/**
 * "Running late" banner on the tracking page, from order.delay
 * ({ reasonLabel, note, extraMinutes, newEta, autoNotice }) the server sends
 * once the rider, an admin or the late-order watchdog reports a delay.
 */
export default function OrderDelayBanner({ delay, hidden = false }) {
  if (!delay || hidden) return null
  const eta = timeText(delay.newEta)
  const reason = delay.reason && delay.reason !== "other" ? delay.reasonLabel : (delay.note || delay.reasonLabel)
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-4 flex gap-3 items-start" role="status">
      <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
        <Clock className="w-5 h-5 text-amber-700 dark:text-amber-300" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-amber-900 dark:text-amber-200">
          {delay.extraMinutes > 0 ? `Running about ${delay.extraMinutes} min late` : "Sorry, your order is running late"}
        </p>
        <p className="text-sm text-amber-800 dark:text-amber-300/90">
          {delay.reportedAt && reason ? `Reason: ${reason}. ` : ""}
          {eta ? `New arrival time ${eta}.` : "We are on it."}
        </p>
        {delay.note && delay.reason !== "other" ? (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 break-words">{delay.note}</p>
        ) : null}
      </div>
    </div>
  )
}
