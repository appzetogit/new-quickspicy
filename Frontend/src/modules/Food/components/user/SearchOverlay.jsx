import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { X, Search, Clock, Loader2, Mic, ChevronRight, Store, MapPin } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { searchAPI } from "@/services/api"
import { useDeliveryLocation } from "@food/context/DeliveryLocationContext"

const SEARCH_HISTORY_KEY = "user_recent_searches_v1"
// Matches SUGGEST_MIN_CHARS on the backend (/food/search/suggest).
const SUGGEST_MIN_CHARS = 3
const SUGGEST_DEBOUNCE_MS = 300

const EMPTY_SUGGESTIONS = { seeAll: null, varieties: [], restaurants: [], categories: [], noResults: false }

/** Veg / Egg / Non-Veg marker; "Mixed" shows none. */
function FoodTypeDot({ type }) {
  if (type !== "Veg" && type !== "Non-Veg" && type !== "Egg") return null
  const color = type === "Veg" ? "border-green-600 bg-green-600" : type === "Egg" ? "border-yellow-500 bg-yellow-500" : "border-red-600 bg-red-600"
  return (
    <span className={`inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm border bg-white ${color.split(" ")[0]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${color.split(" ")[1]}`} />
    </span>
  )
}

export default function SearchOverlay({ isOpen, onClose, searchValue, onSearchChange, isListening, startVoiceSearch }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const { effectiveLocation } = useDeliveryLocation()
  const lat = Number(effectiveLocation?.latitude)
  const lng = Number(effectiveLocation?.longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)

  const [recentSuggestions, setRecentSuggestions] = useState([])
  const [suggestions, setSuggestions] = useState(EMPTY_SUGGESTIONS)
  const [loading, setLoading] = useState(false)
  const [requiresLocation, setRequiresLocation] = useState(false)
  // One navigation per open: a second tap while the first is leaving is ignored,
  // so neither the route nor the recent-search list is written twice.
  const navigatingRef = useRef(false)

  const trimmed = String(searchValue || "").trim()
  const canSuggest = trimmed.length >= SUGGEST_MIN_CHARS

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
    if (isOpen) navigatingRef.current = false
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    try {
      const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      setRecentSuggestions(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()).slice(0, 8) : [])
    } catch {
      setRecentSuggestions([])
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape)
      document.body.style.overflow = "hidden"
    }

    return () => {
      document.removeEventListener("keydown", handleEscape)
      document.body.style.overflow = "unset"
    }
  }, [isOpen, onClose])

  // Suggestions while typing (debounced). Nothing is saved to recent searches here.
  useEffect(() => {
    if (!isOpen || !canSuggest) {
      setSuggestions(EMPTY_SUGGESTIONS)
      setLoading(false)
      setRequiresLocation(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await searchAPI.suggest(
          { q: trimmed, ...(hasCoords ? { lat, lng } : {}) },
          { signal: controller.signal },
        )
        const data = res?.data?.data || {}
        setRequiresLocation(Boolean(data.requiresLocation))
        setSuggestions({
          seeAll: data.seeAll || null,
          varieties: Array.isArray(data.varieties) ? data.varieties : [],
          restaurants: Array.isArray(data.restaurants) ? data.restaurants : [],
          categories: Array.isArray(data.categories) ? data.categories : [],
          noResults: Boolean(data.noResults),
        })
        setLoading(false)
      } catch (err) {
        if (controller.signal.aborted || err?.name === "CanceledError") return
        setSuggestions(EMPTY_SUGGESTIONS)
        setLoading(false)
      }
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [isOpen, canSuggest, trimmed, hasCoords, lat, lng])

  const saveRecentSearch = (term) => {
    const value = String(term || "").trim()
    if (!value) return

    setRecentSuggestions((prev) => {
      const next = [value, ...prev.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 8)
      try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next))
      } catch {
        // Storage full or blocked: the search still runs.
      }
      return next
    })
  }

  /** Saves the term once and navigates once, however many times it is tapped. */
  const go = (path, term) => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    if (term) saveRecentSearch(term)
    navigate(path)
    onClose()
    onSearchChange("")
  }

  const handleSuggestionClick = (suggestion) => {
    onSearchChange(suggestion)
    inputRef.current?.focus()
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (!trimmed) return
    go(`/user/search?q=${encodeURIComponent(trimmed)}`, trimmed)
  }

  const openSeeAll = () => {
    const q = suggestions.seeAll?.query || trimmed
    if (!q) return
    go(`/user/search/restaurants?q=${encodeURIComponent(q)}`, q)
  }

  const openVariety = (variety) => {
    const name = variety?.nameEn || variety?.name
    if (!name) return
    go(`/user/search?q=${encodeURIComponent(name)}`, name)
  }

  const openRestaurant = (restaurant) => {
    const key = restaurant?.slug || restaurant?.id
    if (!key) return
    go(`/user/restaurants/${encodeURIComponent(key)}`, trimmed)
  }

  const openCategory = (category) => {
    const name = category?.nameEn || category?.name
    if (!name) return
    go(`/user/search?q=${encodeURIComponent(name)}`, name)
  }

  if (!isOpen) return null

  const { seeAll, varieties, restaurants, categories, noResults } = suggestions
  const showSuggestions = canSuggest && !loading && !requiresLocation

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-white dark:bg-[#0a0a0a]"
      style={{
        animation: 'fadeIn 0.3s ease-out'
      }}
    >
      {/* Header with Search Bar */}
      <div className="flex-shrink-0 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground dark:text-gray-400 z-10" />
              <Input
                ref={inputRef}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search for food, restaurants..."
                enterKeyHint="search"
                className="pl-12 pr-12 h-12 w-full bg-white dark:bg-[#1a1a1a] border-gray-100 dark:border-gray-800 focus:border-[#E64100] dark:focus:border-[#E64100] rounded-full text-lg dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={startVoiceSearch}
                className={`absolute right-4 top-1/2 transform -translate-y-1/2 p-1.5 rounded-full transition-all ${isListening ? 'bg-[#E64100] text-white animate-pulse' : 'text-gray-400 hover:text-[#E64100] hover:bg-[#E64100]/5'}`}
              >
                <Mic className="h-5 w-5" />
              </button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            </Button>
          </form>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 scrollbar-hide bg-white dark:bg-[#0a0a0a]">
        {/* Recent searches: shown until the customer has typed enough to suggest */}
        {!canSuggest && (
          <div className="mb-6" style={{ animation: 'slideDown 0.3s ease-out 0.1s both' }}>
            {recentSuggestions.length > 0 ? (
              <>
                <h3 className="text-sm sm:text-base font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary-orange" />
                  Recent Searches
                </h3>
                <div className="flex gap-2 sm:gap-3 flex-wrap">
                  {recentSuggestions.slice(0, 8).map((suggestion, index) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 border border-brand-200 dark:border-brand-800 text-gray-700 dark:text-gray-300 hover:text-primary-orange transition-all duration-200 text-xs sm:text-sm font-medium shadow-sm"
                      style={{ animation: `scaleIn 0.3s ease-out ${0.1 + index * 0.02}s both` }}
                    >
                      <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-primary-orange flex-shrink-0" />
                      <span>{suggestion}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
              {trimmed
                ? `Type at least ${SUGGEST_MIN_CHARS} letters to see suggestions`
                : "Search for a dish like Biryani, or a restaurant"}
            </p>
          </div>
        )}

        {canSuggest && loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin text-primary-orange" />
            Finding suggestions...
          </div>
        )}

        {canSuggest && !loading && requiresLocation && (
          <div className="text-center py-12">
            <MapPin className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-700 dark:text-gray-300 font-semibold">Set your delivery location</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Suggestions show what can be delivered to you.</p>
          </div>
        )}

        {showSuggestions && (
          <div className="space-y-6" style={{ animation: 'fadeIn 0.2s ease-out both' }}>
            {/* 1. "Biryani — See all restaurants" */}
            {seeAll && (
              <button
                type="button"
                onClick={openSeeAll}
                className="w-full flex items-center gap-3 rounded-2xl border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/20 px-4 py-3 text-left hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-orange text-white">
                  <Search className="h-5 w-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-gray-900 dark:text-white truncate">
                    {seeAll.query} <span className="font-semibold text-primary-orange">— See all restaurants</span>
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {seeAll.restaurantCount} {seeAll.restaurantCount === 1 ? "restaurant serves" : "restaurants serve"} this near you
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 text-primary-orange flex-shrink-0" />
              </button>
            )}

            {/* 2. Varieties: Veg Biryani, Chicken Biryani, ... */}
            {varieties.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">Dishes</h3>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {varieties.map((v) => (
                    <li key={v.nameEn || v.name}>
                      <button
                        type="button"
                        onClick={() => openVariety(v)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                      >
                        {v.image ? (
                          <img src={v.image} alt="" loading="lazy" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover bg-gray-100" />
                        ) : (
                          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                            <Search className="h-4 w-4 text-gray-400" />
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <FoodTypeDot type={v.foodType} />
                            <span className="font-medium text-gray-900 dark:text-white truncate">{v.name}</span>
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {v.restaurantCount} {v.restaurantCount === 1 ? "restaurant" : "restaurants"}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Restaurants matched by name */}
            {restaurants.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">Restaurants</h3>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {restaurants.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => openRestaurant(r)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                      >
                        {r.image ? (
                          <img src={r.image} alt="" loading="lazy" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover bg-gray-100" />
                        ) : (
                          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                            <Store className="h-4 w-4 text-gray-400" />
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-gray-900 dark:text-white truncate">{r.name}</span>
                          {Number.isFinite(Number(r.distanceKm)) && r.distanceKm !== null && (
                            <span className="block text-xs text-gray-500 dark:text-gray-400">{Number(r.distanceKm).toFixed(1)} km</span>
                          )}
                        </span>
                        <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Categories */}
            {categories.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">Categories</h3>
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => openCategory(c)}
                      className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:border-brand-300 hover:text-primary-orange transition-colors"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {noResults && (
              <div className="text-center py-12 sm:py-16">
                <Search className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg font-semibold">
                  No results for "{trimmed}" in your area
                </p>
                <p className="text-sm sm:text-base text-gray-500 dark:text-gray-500 mt-2">
                  Try a different dish or restaurant name
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Speak Now Overlay */}
      {isListening && (
        <div className="absolute inset-0 z-[10000] flex flex-col items-center justify-center bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-md">
          <div className="relative flex items-center justify-center">
            {/* Animated Ripples */}
            <div className="absolute w-40 h-40 bg-[#E64100]/20 rounded-full animate-ping" />
            <div className="absolute w-32 h-32 bg-[#E64100]/30 rounded-full animate-pulse" />

            {/* Mic Icon Container */}
            <div className="relative bg-gradient-to-tr from-[#E64100] to-[#F47835] p-8 rounded-full text-white shadow-[0_0_40px_rgba(230,65,0,0.4)] border-4 border-white dark:border-gray-800">
              <Mic className="h-12 w-12" />
            </div>

            {/* Sound Wave Bars */}
            <div className="absolute -bottom-16 flex items-end gap-1.5 h-12">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div
                  key={i}
                  className="w-1.5 bg-[#E64100] rounded-full animate-voice-bar"
                  style={{
                    animationDelay: `${i * 0.1}s`,
                    height: `${20 + Math.random() * 80}%`
                  }}
                />
              ))}
            </div>
          </div>

          <div className="mt-24 text-center">
            <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Speak Now</h2>
            <p className="mt-3 text-gray-500 dark:text-gray-400 font-medium">I'm listening for dishes or restaurants...</p>
          </div>

          <Button
            variant="ghost"
            onClick={onClose}
            className="mt-16 text-gray-400 hover:text-[#E64100] hover:bg-[#E64100]/5 rounded-full px-8"
          >
            Cancel
          </Button>
        </div>
      )}

      <style>{`
          @keyframes voice-bar {
            0%, 100% { height: 20%; }
            50% { height: 100%; }
          }
          .animate-voice-bar {
            animation: voice-bar 0.6s ease-in-out infinite;
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideDown {
            from {
              opacity: 0;
              transform: translateY(-20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes scaleIn {
            from {
              opacity: 0;
              transform: scale(0.9);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>
    </div>
  )
}
