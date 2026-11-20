import { useEffect, useMemo, useRef, useState } from "react"
import { Loader } from "@googlemaps/js-api-loader"
import { Bike, Loader2, MapPin } from "lucide-react"
import { adminAPI } from "@/services/api"
import { subscribeDeliveryLocation } from "@food/realtimeTracking"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"

/**
 * Order map for the admin order dialog: restaurant, customer and, while a rider
 * is on the order, the rider's live position.
 *
 * Live position comes from the same sources as Delivery Live Tracking:
 *  - Firebase RTDB `delivery_boys/<riderId>` (written by the rider apps), and
 *  - the rider's last DB ping (deliveryPartner.lastLat/lastLng, or the order's
 *    lastRiderLocation), re-read from GET /admin/orders/:id every 15 s so the
 *    map still moves when Firebase is not configured.
 * Whichever is newer wins. Once the order is finished (or has no app rider),
 * only the two route endpoints are shown.
 */

/** Rider is heading to the restaurant or the customer: the live window. */
const LIVE_STATUSES = ["confirmed", "preparing", "ready_for_pickup", "reached_pickup", "picked_up", "reached_drop"]
const TO_DROP_STATUSES = ["picked_up", "reached_drop"]
const POLL_MS = 15000

const num = (value) => {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const point = (lat, lng) => {
  const a = num(lat)
  const b = num(lng)
  return a !== null && b !== null && !(a === 0 && b === 0) ? { lat: a, lng: b } : null
}
const fromGeo = (geo) => {
  const c = geo?.coordinates
  return Array.isArray(c) && c.length === 2 ? point(c[1], c[0]) : null
}
const toTime = (value) => {
  if (value === null || value === undefined || value === "") return 0
  const n = Number(value)
  if (Number.isFinite(n)) return n
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Rider id, restaurant, customer and the DB rider position from an order. */
export function readOrderMapPoints(order) {
  const o = order || {}
  const restaurant = o.restaurantId && typeof o.restaurantId === "object" ? o.restaurantId : o.restaurant || {}
  const partner = o.dispatch?.deliveryPartnerId
  const partnerObj = partner && typeof partner === "object" ? partner : null
  const riderId = partnerObj ? partnerObj.id || partnerObj._id || null : partner || null

  const dbFromPartner = partnerObj ? point(partnerObj.lastLat, partnerObj.lastLng) : null
  const dbFromOrder = fromGeo(o.lastRiderLocation)
  const dbRider = dbFromPartner
    ? { ...dbFromPartner, timestamp: toTime(partnerObj.lastLocationAt) }
    : dbFromOrder
      ? { ...dbFromOrder, timestamp: 0 }
      : null

  return {
    status: String(o.orderStatus || o.status || "").toLowerCase(),
    riderId: riderId ? String(riderId) : null,
    riderName: partnerObj?.name || o.deliveryPartnerName || "Rider",
    restaurant: point(restaurant.latitude ?? restaurant.lat, restaurant.longitude ?? restaurant.lng),
    restaurantName: restaurant.restaurantName || restaurant.name || "Restaurant",
    customer: fromGeo(o.deliveryAddress?.location) || fromGeo(o.address?.location),
    dbRider,
  }
}

const formatAgo = (ts) => {
  if (!ts) return ""
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return new Date(ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

export default function OrderLiveTrackingMap({ order, orderId }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const googleRef = useRef(null)
  const markersRef = useRef({})
  const lineRef = useRef(null)
  const fittedRef = useRef(false)

  const [mapError, setMapError] = useState("")
  const [mapLoading, setMapLoading] = useState(true)
  const [polled, setPolled] = useState(null)
  const [liveLocation, setLiveLocation] = useState(null)
  const [liveError, setLiveError] = useState("")

  const base = useMemo(() => readOrderMapPoints(polled || order), [polled, order])
  const isLive = Boolean(base.riderId) && LIVE_STATUSES.includes(base.status)
  const toDrop = TO_DROP_STATUSES.includes(base.status)

  // Firebase live feed for the assigned rider.
  useEffect(() => {
    setLiveLocation(null)
    setLiveError("")
    if (!isLive || !base.riderId) return undefined
    const unsubscribe = subscribeDeliveryLocation(
      base.riderId,
      (payload) => {
        const src = payload?.location && typeof payload.location === "object" ? payload.location : payload
        const p = point(src?.lat ?? src?.latitude, src?.lng ?? src?.longitude)
        if (!p) return
        setLiveLocation({ ...p, timestamp: toTime(src?.timestamp ?? src?.last_updated ?? src?.lastUpdate) })
      },
      (error) => setLiveError(error?.message || "Live feed unavailable"),
    )
    return () => {
      if (typeof unsubscribe === "function") unsubscribe()
    }
  }, [isLive, base.riderId])

  // DB fallback: re-read the order (rider's last ping, and status changes).
  useEffect(() => {
    if (!isLive || !orderId) return undefined
    let active = true
    const tick = () =>
      adminAPI
        .getOrderById(orderId)
        .then((res) => {
          const next = res?.data?.data?.order || res?.data?.data || null
          if (active && next) setPolled(next)
        })
        .catch(() => {})
    const timer = setInterval(tick, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [isLive, orderId])

  const rider = useMemo(() => {
    if (!isLive) return null
    const db = base.dbRider
    if (!liveLocation) return db
    if (!db) return liveLocation
    return (db.timestamp || 0) > (liveLocation.timestamp || 0) ? db : liveLocation
  }, [isLive, base.dbRider, liveLocation])

  // Load Google Maps once (same loader and key as Delivery Live Tracking).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let apiKey = ""
        try {
          apiKey = await getGoogleMapsApiKey()
        } catch {
          apiKey = ""
        }
        if (!apiKey && !window.google?.maps) {
          setMapError("Google Maps API key not found.")
          return
        }
        const google = window.google?.maps
          ? window.google
          : await new Loader({ apiKey, version: "weekly", libraries: ["places"] }).load()
        if (cancelled || !containerRef.current) return
        googleRef.current = google
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: 20.5937, lng: 78.9629 },
          zoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
        })
        setMapLoading(false)
      } catch {
        if (!cancelled) setMapError("Failed to load Google Maps.")
      } finally {
        if (!cancelled) setMapLoading(false)
      }
    })()
    return () => {
      cancelled = true
      Object.values(markersRef.current).forEach((m) => m?.setMap(null))
      markersRef.current = {}
      lineRef.current?.setMap(null)
      lineRef.current = null
    }
  }, [])

  // Draw / move markers.
  useEffect(() => {
    const google = googleRef.current
    const map = mapRef.current
    if (!google || !map) return

    const place = (key, position, opts) => {
      let marker = markersRef.current[key]
      if (!position) {
        if (marker) marker.setMap(null)
        delete markersRef.current[key]
        return
      }
      if (!marker) {
        marker = new google.maps.Marker({ map, ...opts })
        markersRef.current[key] = marker
      }
      marker.setPosition(position)
      if (opts.title) marker.setTitle(opts.title)
    }
    const pin = (color) => ({
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
      scale: 8,
    })

    place("restaurant", base.restaurant, {
      title: base.restaurantName,
      icon: pin("#f97316"),
      label: { text: "R", color: "#ffffff", fontWeight: "700", fontSize: "10px" },
      zIndex: 5,
    })
    place("customer", base.customer, {
      title: "Customer",
      icon: pin("#16a34a"),
      label: { text: "C", color: "#ffffff", fontWeight: "700", fontSize: "10px" },
      zIndex: 5,
    })
    place("rider", rider, {
      title: base.riderName,
      icon: { ...pin("#2563eb"), scale: 10 },
      zIndex: 10,
    })

    // Rider to where they are heading; else the restaurant-to-customer route.
    const target = toDrop ? base.customer : base.restaurant
    const path = rider && target ? [rider, target] : !rider && base.restaurant && base.customer ? [base.restaurant, base.customer] : null
    if (path) {
      if (!lineRef.current) {
        lineRef.current = new google.maps.Polyline({
          map,
          strokeOpacity: 0,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#334155", scale: 3 }, offset: "0", repeat: "12px" }],
        })
      }
      lineRef.current.setPath(path)
    } else if (lineRef.current) {
      lineRef.current.setMap(null)
      lineRef.current = null
    }

    // Fit everything once; afterwards only the rider marker moves.
    if (!fittedRef.current) {
      const pts = [base.restaurant, base.customer, rider].filter(Boolean)
      if (pts.length > 1) {
        const bounds = new google.maps.LatLngBounds()
        pts.forEach((p) => bounds.extend(p))
        map.fitBounds(bounds, 48)
        fittedRef.current = true
      } else if (pts.length === 1) {
        map.setCenter(pts[0])
        map.setZoom(14)
        fittedRef.current = true
      }
    }
  }, [mapLoading, base, rider, toDrop])

  if (!base.restaurant && !base.customer && !rider) return null

  return (
    <div className="border-t border-slate-200 pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          {isLive ? "Live Tracking" : "Route"}
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Restaurant</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-600" /> Customer</span>
          {isLive && <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Rider</span>}
        </div>
      </div>
      <div className="relative h-72 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
        <div ref={containerRef} className="h-full w-full" />
        {(mapLoading || mapError) && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-sm text-slate-600">
            {mapError ? mapError : <Loader2 className="h-6 w-6 animate-spin text-slate-400" />}
          </div>
        )}
      </div>
      {isLive && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <Bike className="h-3.5 w-3.5" />
          {rider
            ? `${base.riderName} · ${toDrop ? "heading to customer" : "heading to restaurant"}${rider.timestamp ? ` · updated ${formatAgo(rider.timestamp)}` : ""}`
            : `Waiting for ${base.riderName}'s location…`}
          {liveError && !liveLocation ? " (live feed off; using last saved position)" : ""}
        </p>
      )}
    </div>
  )
}
