import { useEffect, useRef, useState } from "react"
import { Loader } from "@googlemaps/js-api-loader"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"

/**
 * Pick a restaurant's exact location by dropping a pin.
 *
 * Search alone often lands on the area's centre rather than the shop, and
 * delivery fees, reach and rider dispatch all measure from this point. Drag
 * the pin, or click the map, and the address fields are filled from the spot
 * (reverse geocoding) -- the admin can still edit them after.
 *
 * Props: latitude, longitude (current point, may be empty), onChange({ latitude,
 * longitude, formattedAddress, area, city, state, pincode }), height,
 * showMyLocation (a "Use my location" button that drops the pin where the
 * device is -- for an owner standing in the shop), hint (replaces the help line).
 *
 * Shared by the admin restaurant forms and restaurant self-onboarding.
 */

const INDIA = { lat: 20.5937, lng: 78.9629 }

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && v !== "" && v !== null ? n : null
}

/** The address parts a geocoder result carries, by type. */
const partsOf = (result) => {
  const find = (...types) =>
    result?.address_components?.find((c) => types.some((t) => c.types.includes(t)))?.long_name || ""
  return {
    formattedAddress: result?.formatted_address || "",
    area: find("sublocality_level_1", "sublocality", "neighborhood", "locality"),
    city: find("locality", "administrative_area_level_3", "administrative_area_level_2"),
    state: find("administrative_area_level_1"),
    pincode: find("postal_code"),
  }
}

/** Resolves with Google Maps once it is usable, or null after `ms`. */
const waitForMaps = (ms) =>
  new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (typeof window.google?.maps?.Map === "function") return resolve(window.google)
      if (Date.now() - started > ms) return resolve(null)
      setTimeout(tick, 200)
    }
    tick()
  })

let mapsPromise = null
/**
 * The app's page loads Google Maps itself. Starting the Loader on top of that
 * loaded it twice, and the Loader's promise then never settled: the map stayed
 * an empty grey box with no error. So wait for the copy already on its way, and
 * only load one when there is none. Never waits for ever.
 */
const loadMaps = async () => {
  if (typeof window.google?.maps?.Map === "function") return window.google
  if (!mapsPromise) {
    mapsPromise = (async () => {
      // The page's own loader starts just after this (a child's effect runs
      // first), so give it a moment before deciding nobody is loading Maps.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const onItsWay = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')
      if (!onItsWay) {
        const apiKey = await getGoogleMapsApiKey()
        if (!apiKey) throw new Error("Google Maps key is not set")
        new Loader({ apiKey, version: "weekly", libraries: ["places", "geometry"] }).load().catch(() => {})
      }
      const google = await waitForMaps(20000)
      if (!google) throw new Error("Google Maps did not load")
      return google
    })().catch((e) => {
      mapsPromise = null
      throw e
    })
  }
  return mapsPromise
}

export default function LocationPinMap({ latitude, longitude, onChange, height = 300, showMyLocation = false, hint }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const geocoderRef = useRef(null)
  const placeRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState("")

  const lat = num(latitude)
  const lng = num(longitude)

  // Build the map once.
  useEffect(() => {
    let cancelled = false
    loadMaps()
      .then((google) => {
        if (cancelled || !boxRef.current) return
        const start = lat !== null && lng !== null ? { lat, lng } : INDIA
        const map = new google.maps.Map(boxRef.current, {
          center: start,
          zoom: lat !== null ? 17 : 5,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        })
        const marker = new google.maps.Marker({ position: start, map, draggable: true, visible: lat !== null })
        geocoderRef.current = new google.maps.Geocoder()

        const place = (position) => {
          const p = { lat: position.lat(), lng: position.lng() }
          marker.setPosition(p)
          marker.setVisible(true)
          const base = { latitude: Number(p.lat.toFixed(6)), longitude: Number(p.lng.toFixed(6)) }
          onChangeRef.current?.(base)
          geocoderRef.current.geocode({ location: p }, (results, status) => {
            if (status === "OK" && results?.[0]) onChangeRef.current?.({ ...base, ...partsOf(results[0]) })
          })
        }
        marker.addListener("dragend", (e) => place(e.latLng))
        map.addListener("click", (e) => place(e.latLng))
        placeRef.current = (latNum, lngNum) => {
          const position = new google.maps.LatLng(latNum, lngNum)
          place(position)
          map.panTo(position)
          if (map.getZoom() < 15) map.setZoom(18)
        }

        mapRef.current = map
        markerRef.current = marker
        setReady(true)
      })
      .catch((e) => !cancelled && setError(e?.message || "Could not load the map"))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the point when it changes from outside (the search box).
  useEffect(() => {
    if (!ready || lat === null || lng === null) return
    const marker = markerRef.current
    const current = marker.getPosition()
    if (current && Math.abs(current.lat() - lat) < 1e-7 && Math.abs(current.lng() - lng) < 1e-7 && marker.getVisible()) return
    marker.setPosition({ lat, lng })
    marker.setVisible(true)
    mapRef.current.panTo({ lat, lng })
    if (mapRef.current.getZoom() < 15) mapRef.current.setZoom(17)
  }, [ready, lat, lng])

  const locateMe = () => {
    setLocateError("")
    if (!navigator?.geolocation) {
      setLocateError("This browser cannot share its location. Drag the pin instead.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const { latitude: la, longitude: lo } = pos.coords || {}
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return
        if (placeRef.current) placeRef.current(la, lo)
        else onChangeRef.current?.({ latitude: Number(la.toFixed(6)), longitude: Number(lo.toFixed(6)) })
      },
      (err) => {
        setLocating(false)
        setLocateError(
          err?.code === 1
            ? "Location permission was denied. Allow it in the browser, or drag the pin."
            : "Could not find your location. Drag the pin instead.",
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const myLocationButton = showMyLocation ? (
    <button
      type="button"
      onClick={locateMe}
      disabled={locating}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
    >
      <span aria-hidden="true">◎</span>
      {locating ? "Finding you..." : "Use my current location"}
    </button>
  ) : null

  if (error) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-red-600">Map unavailable: {error}. Use the search box instead.</p>
        {myLocationButton}
        {locateError && <p className="text-[11px] text-red-600">{locateError}</p>}
        {lat !== null && lng !== null && (
          <p className="text-[11px] text-gray-500">{`Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}.`}</p>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {myLocationButton && <div className="flex justify-end">{myLocationButton}</div>}
      <div ref={boxRef} style={{ height }} className="w-full rounded-md border border-gray-200 bg-gray-100" />
      {locateError && <p className="text-[11px] text-red-600">{locateError}</p>}
      <p className="text-[11px] text-gray-500">
        {hint || "Drag the pin (or click the map) to the restaurant's exact entrance."}
        {lat !== null && lng !== null ? ` Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}.` : ""}
      </p>
    </div>
  )
}
