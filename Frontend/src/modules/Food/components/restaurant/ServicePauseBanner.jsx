import { useEffect, useState } from "react"

import { restaurantAPI } from "@food/api"
import ServicePausedBanner from "../../../../shared/components/ServicePausedBanner.jsx"

/**
 * The admin has paused ordering in this restaurant's zone (or everywhere):
 * GET /food/restaurant/current carries { serviceStatus: { servicePaused,
 * message, resumeAt } }. Re-checked every two minutes while the screen is open.
 */
export default function ServicePauseBanner({ className = "" }) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        if (!cancelled) setStatus(response?.data?.data?.serviceStatus || null)
      } catch {
        // The orders screen behind it still works.
      }
    }
    load()
    const t = setInterval(load, 2 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return (
    <ServicePausedBanner
      status={status}
      title="New orders are paused in your area by Quick Spicy"
      className={className}
    />
  )
}
