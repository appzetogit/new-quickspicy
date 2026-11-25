import { useEffect, useState } from "react"
import { zoneAPI } from "@food/api"
import ServicePausedBanner, { formatResumeAt, isServicePaused } from "../../../../shared/components/ServicePausedBanner.jsx"

/**
 * Whether the admin has paused ordering in the customer's zone
 * (GET /food/public/service-status). Shared 30 s cache so Home and Cart do
 * not ask twice.
 */
const TTL_MS = 30 * 1000
const cache = new Map() // key -> { ts, data }
const inFlight = new Map()

const fetchStatus = (zoneId) => {
  const key = zoneId || "none"
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < TTL_MS) return Promise.resolve(hit.data)
  if (inFlight.has(key)) return inFlight.get(key)
  const p = zoneAPI
    .getServiceStatus(zoneId ? { zoneId } : {})
    .then((res) => {
      const data = res?.data?.data || null
      cache.set(key, { ts: Date.now(), data })
      return data
    })
    .catch(() => null)
    .finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

export function useServiceStatus(zoneId) {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let alive = true
    fetchStatus(zoneId || null).then((data) => alive && setStatus(data))
    // Re-check now and then: a pause can be lifted (or set) while the page is open.
    const t = setInterval(() => {
      fetchStatus(zoneId || null).then((data) => alive && setStatus(data))
    }, 60 * 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [zoneId])
  return { status, paused: isServicePaused(status) }
}

/**
 * Home: a popup once per session per message, then a banner that stays.
 */
export default function ServicePauseNotice({ zoneId, className = "" }) {
  const { status, paused } = useServiceStatus(zoneId)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!paused) {
      setOpen(false)
      return
    }
    const key = `servicePauseSeen:${status?.message || ""}:${status?.resumeAt || ""}`
    let seen = false
    try {
      seen = sessionStorage.getItem(key) === "1"
    } catch {
      seen = false
    }
    if (!seen) {
      setOpen(true)
      try {
        sessionStorage.setItem(key, "1")
      } catch {
        // Private mode: the popup may show again, which is fine.
      }
    }
  }, [paused, status?.message, status?.resumeAt])

  if (!paused) return null
  const resume = formatResumeAt(status.resumeAt)

  return (
    <>
      <div className={`px-4 pt-3 ${className}`}>
        <ServicePausedBanner status={status} title="We are not taking orders right now" />
      </div>
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-gray-900">
            <p className="text-lg font-bold text-gray-900 dark:text-white">Orders are paused</p>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {status.message || "We are not taking orders right now. Please try again a little later."}
            </p>
            {resume ? <p className="mt-2 text-xs text-gray-500">Expected to resume around {resume}.</p> : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 w-full rounded-full py-2.5 text-sm font-bold text-white"
              style={{ backgroundColor: "var(--module-theme-color, #E64100)" }}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
