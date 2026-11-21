import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ArrowLeft, Star, Clock, Search, Loader2, MapPin, Store } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { searchAPI } from "@/services/api"
import { useDeliveryLocation } from "@food/context/DeliveryLocationContext"
import { useLocationSelector } from "@food/components/user/UserLayout"

/**
 * "Biryani — See all restaurants": restaurants that currently serve at least
 * one available dish matching ?q=, in reach of the delivery location
 * (GET /food/search/restaurants). Tapping a restaurant opens its menu.
 */

const getMediaUrl = (url) => {
  if (!url || typeof url !== "string") return null
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) return url
  const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1"
  const origin = apiBase.split("/api/v1")[0]
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`
}

const SORTS = [
  { key: "", label: "Relevance" },
  { key: "rating", label: "Rating" },
  { key: "distance", label: "Distance" },
  { key: "deliveryTime", label: "Delivery time" },
]
const PAGE_SIZE = 20

const formatPrice = (value) => `₹${Math.round(Number(value) || 0)}`

export default function DishRestaurants() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { openLocationSelector } = useLocationSelector()
  const q = String(searchParams.get("q") || "").trim()
  const exact = searchParams.get("exact") === "true"
  const sortBy = searchParams.get("sort") || ""
  const vegOnly = searchParams.get("veg") === "true"

  const { effectiveLocation, loading: locationLoading } = useDeliveryLocation()
  const lat = Number(effectiveLocation?.latitude)
  const lng = Number(effectiveLocation?.longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)

  const [restaurants, setRestaurants] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [requiresLocation, setRequiresLocation] = useState(false)
  // A restaurant tap navigates once, however many times it is tapped.
  const navigatingRef = useRef(false)

  const params = (pageNumber) => ({
    q,
    page: pageNumber,
    limit: PAGE_SIZE,
    ...(hasCoords ? { lat, lng } : {}),
    ...(exact ? { exact: "true" } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(vegOnly ? { isVeg: "true" } : {}),
  })

  useEffect(() => {
    // An empty query never lists anything.
    if (!q) {
      setRestaurants([])
      setTotal(0)
      return
    }
    if (!hasCoords && locationLoading) return
    const controller = new AbortController()
    setLoading(true)
    setError("")
    searchAPI
      .dishRestaurants(params(1), { signal: controller.signal })
      .then((res) => {
        const data = res?.data?.data || {}
        setRequiresLocation(Boolean(data.requiresLocation))
        setRestaurants(Array.isArray(data.restaurants) ? data.restaurants : [])
        setTotal(Number(data.total) || 0)
        setPage(1)
        setLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "CanceledError") return
        setRestaurants([])
        setTotal(0)
        setError("Could not load restaurants. Please try again.")
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, exact, sortBy, vegOnly, hasCoords, lat, lng, locationLoading])

  const loadMore = async () => {
    if (loadingMore || restaurants.length >= total) return
    setLoadingMore(true)
    try {
      const res = await searchAPI.dishRestaurants(params(page + 1))
      const data = res?.data?.data || {}
      const more = Array.isArray(data.restaurants) ? data.restaurants : []
      setRestaurants((prev) => {
        const seen = new Set(prev.map((r) => r.id))
        return [...prev, ...more.filter((r) => !seen.has(r.id))]
      })
      setPage((p) => p + 1)
    } catch {
      // Keep what is shown; the button stays for another try.
    } finally {
      setLoadingMore(false)
    }
  }

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const openRestaurant = (r) => {
    if (navigatingRef.current) return
    const key = r?.slug || r?.id || r?._id
    if (!key) return
    navigatingRef.current = true
    const dish = r.matchedDishId ? `?dish=${encodeURIComponent(r.matchedDishId)}` : ""
    navigate(`/user/restaurants/${encodeURIComponent(key)}${dish}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950">
      <div className="sticky top-0 z-50 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-slate-900 dark:text-white truncate">{q ? `Restaurants serving "${q}"` : "Restaurants"}</h1>
            {q && !loading && !requiresLocation && (
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                {total} {total === 1 ? "restaurant" : "restaurants"} near you
              </p>
            )}
          </div>
        </div>
        {q && (
          <div className="max-w-3xl mx-auto mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SORTS.map((s) => (
              <button
                key={s.key || "relevance"}
                type="button"
                onClick={() => setParam("sort", s.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${sortBy === s.key ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-900/20" : "border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300"}`}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setParam("veg", vegOnly ? "" : "true")}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${vegOnly ? "border-green-600 bg-green-50 text-green-700 dark:bg-green-900/20" : "border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300"}`}
            >
              Veg only
            </button>
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto p-4">
        {!q && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="w-10 h-10 text-slate-300 mb-3" />
            <p className="font-semibold text-slate-700 dark:text-zinc-300">Search for a dish to see restaurants serving it</p>
            <Button variant="outline" onClick={() => navigate("/user/search")} className="mt-6 rounded-xl border-brand-500 text-brand-500 hover:bg-brand-50">
              Go to search
            </Button>
          </div>
        )}

        {q && loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand-500 animate-spin mb-3" />
            <p className="text-slate-400 text-sm">Finding restaurants...</p>
          </div>
        )}

        {q && !loading && requiresLocation && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MapPin className="w-10 h-10 text-slate-300 mb-3" />
            <p className="font-semibold text-slate-700 dark:text-zinc-300">Set your delivery location</p>
            <p className="text-sm text-slate-500 mt-1">We show restaurants that deliver to you.</p>
            <Button className="mt-4 bg-brand-500 hover:bg-brand-600 text-white" onClick={openLocationSelector}>
              Set location
            </Button>
          </div>
        )}

        {q && !loading && !requiresLocation && error && (
          <p className="py-10 text-center text-sm text-slate-500">{error}</p>
        )}

        {q && !loading && !requiresLocation && !error && restaurants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-slate-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-4">
              <Search className="w-8 h-8 text-slate-300" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">No restaurants serving "{q}" near you</h2>
            <p className="text-slate-500 text-sm max-w-xs">Try another dish, or check back when more restaurants are open.</p>
          </div>
        )}

        {q && !loading && restaurants.length > 0 && (
          <div className="grid gap-4">
            {restaurants.map((r) => {
              const image = getMediaUrl(r.profileImage || r.matchedDishImage || (Array.isArray(r.coverImages) && r.coverImages[0]))
              return (
                <button
                  type="button"
                  key={r.id || r._id}
                  onClick={() => openRestaurant(r)}
                  className={`text-left flex gap-4 p-3 bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-100 dark:border-zinc-800 hover:shadow-md transition-shadow group ${r.isOpenNow === false ? "opacity-70" : ""}`}
                >
                  <div className="w-24 h-24 rounded-xl overflow-hidden bg-slate-100 dark:bg-zinc-800 flex-shrink-0 relative flex items-center justify-center">
                    {image ? (
                      <img src={image} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                    ) : (
                      <Store className="w-6 h-6 text-slate-300" />
                    )}
                    {r.pureVegRestaurant && (
                      <div className="absolute top-1 left-1 w-4 h-4 border border-green-600 p-[1px] bg-white rounded-sm">
                        <div className="w-full h-full bg-green-600 rounded-full" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <h3 className="font-bold text-slate-900 dark:text-white line-clamp-1">{r.restaurantName}</h3>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400 mt-1 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-brand-500 fill-brand-500" />
                        <span className="font-semibold text-slate-700 dark:text-white">{Number(r.rating) > 0 ? Number(r.rating).toFixed(1) : "New"}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {r.estimatedDeliveryTime || "30-40 mins"}
                      </span>
                      {Number.isFinite(Number(r.distanceKm)) && r.distanceKm !== null && (
                        <>
                          <span>•</span>
                          <span>{Number(r.distanceKm).toFixed(1)} km</span>
                        </>
                      )}
                      {r.isOpenNow === false && <span className="font-semibold text-slate-600 dark:text-zinc-300">• Closed now</span>}
                    </div>
                    {Array.isArray(r.matchedDishes) && r.matchedDishes.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {r.matchedDishes.map((d) => (
                          <p key={d.id} className="text-xs text-slate-600 dark:text-zinc-300 line-clamp-1">
                            <span className="font-medium">{d.name}</span>
                            <span className="text-slate-400"> · {formatPrice(d.price)}</span>
                          </p>
                        ))}
                        {r.matchedDishCount > r.matchedDishes.length && (
                          <p className="text-[11px] font-semibold text-brand-600">
                            +{r.matchedDishCount - r.matchedDishes.length} more matching
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
            {restaurants.length < total && (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="rounded-xl border-brand-500 text-brand-500 hover:bg-brand-50">
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : "Show more"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
