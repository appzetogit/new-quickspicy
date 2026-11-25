import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { createPortal } from "react-dom"
import { ArrowLeft, Star, Clock, RotateCcw, Loader2, UtensilsCrossed, X, Plus, AlertCircle, ShoppingBag } from "lucide-react"
import { toast } from "sonner"
import { userAPI } from "@food/api"
import { useCart } from "@food/context/CartContext"
import { buildCartLineId } from "@food/utils/foodVariants"
import VariantSelector from "@food/components/user/VariantSelector"
import FoodTypeIcon from "@food/components/shared/FoodTypeIcon"

/**
 * Reorder screen: stores the customer ordered from (most recent first), each
 * with a horizontal row of dishes they bought there, at today's price and
 * availability (GET /food/user/reorder). Unavailable dishes stay visible,
 * disabled, with the reason. Adding goes through the normal cart (addToCart),
 * so repeat taps increase quantity and several dishes from one store stack.
 */

const RUPEE = "₹"
const ACCENT = "#E64100"

const readStoredPoint = () => {
  try {
    const raw = localStorage.getItem("userLocation")
    if (!raw) return {}
    const loc = JSON.parse(raw)
    const lat = Number(loc?.latitude ?? loc?.lat)
    const lng = Number(loc?.longitude ?? loc?.lng)
    return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : {}
  } catch {
    return {}
  }
}

const money = (value) => `${RUPEE}${Math.round(Number(value) || 0)}`

const blockedText = (item, store) => {
  if (item.unavailableMessage) return item.unavailableMessage
  if (item.blockedReason === "store_closed") return store.closedMessage || "Store is closed"
  if (item.blockedReason === "not_deliverable") return "Not delivering to your location"
  return "Not available"
}

function ItemCard({ item, store, inCartQty, onOpen, onQuickAdd }) {
  const disabled = !item.canAdd
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(item) }}
      className={`relative w-40 shrink-0 snap-start rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] p-2.5 text-left shadow-sm ${disabled ? "opacity-70" : ""}`}
    >
      <div className={`relative h-24 w-full overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800 ${disabled ? "grayscale" : ""}`}>
        {item.image ? (
          <img src={item.image} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600">
            <UtensilsCrossed className="h-8 w-8" />
          </div>
        )}
        {inCartQty > 0 && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-[#E64100] px-2 py-0.5 text-[10px] font-bold text-white">
            {inCartQty} in cart
          </span>
        )}
      </div>
      <div className="mt-2 flex items-start gap-1.5">
        <FoodTypeIcon type={item.foodType} isVeg={item.isVeg} size={12} className="mt-0.5" />
        <p className="line-clamp-2 text-[13px] font-semibold leading-tight text-gray-900 dark:text-white">{item.name}</p>
      </div>
      {item.lastVariant?.name && (
        <p className={`mt-1 truncate text-[11px] ${item.lastVariant.stillExists ? "text-gray-500 dark:text-gray-400" : "text-amber-600"}`}>
          {item.lastVariant.stillExists ? `Last: ${item.lastVariant.name}` : `${item.lastVariant.name} no longer offered`}
        </p>
      )}
      {item.description && (
        <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-400 dark:text-gray-500">{item.description}</p>
      )}
      <div className="mt-2 flex items-center justify-between gap-1">
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          {item.price == null ? "" : `${item.priceIsFrom ? "from " : ""}${money(item.price)}`}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); onQuickAdd(item, e) }}
          className={`flex items-center gap-0.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${disabled
            ? "cursor-not-allowed border-gray-300 text-gray-400"
            : "border-[#E64100] text-[#E64100] hover:bg-orange-50 dark:hover:bg-[#E64100]/10"}`}
        >
          ADD <Plus className="h-3 w-3" strokeWidth={3} />
        </button>
      </div>
      {disabled && (
        <p className="mt-1.5 text-[11px] font-medium text-red-500">{blockedText(item, store)}</p>
      )}
    </div>
  )
}

function StoreCard({ entry, getQty, onOpen, onQuickAdd }) {
  const store = entry.restaurant
  const storePath = `/food/user/restaurants/${store.slug || store.id}`
  return (
    <section className="rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 p-3 shadow-sm">
      <Link to={storePath} className="flex items-center gap-3">
        <div className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800 ${store.isOpen ? "" : "grayscale"}`}>
          {store.image ? (
            <img src={store.image} alt={store.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300"><UtensilsCrossed className="h-6 w-6" /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-gray-900 dark:text-white">{store.name}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            {store.rating > 0 && (
              <span className="flex items-center gap-0.5"><Star className="h-3 w-3 fill-green-600 text-green-600" />{Number(store.rating).toFixed(1)}</span>
            )}
            {store.deliveryTime && (
              <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{store.deliveryTime}</span>
            )}
            {store.isOpen ? (
              <span className="font-semibold text-green-600">{store.closingSoon ? "Closing soon" : "Open"}</span>
            ) : (
              <span className="font-semibold text-red-500">{store.closedMessage || "Closed"}</span>
            )}
          </div>
          {!store.isDeliverable && (
            <p className="mt-0.5 text-[11px] font-medium text-amber-600">Not delivering to your location</p>
          )}
        </div>
      </Link>
      <div className="-mx-3 mt-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
        {entry.items.map((item) => (
          <ItemCard
            key={item.foodId}
            item={item}
            store={store}
            inCartQty={getQty(item)}
            onOpen={(it) => onOpen(it, store)}
            onQuickAdd={(it, e) => onQuickAdd(it, store, e)}
          />
        ))}
      </div>
    </section>
  )
}

function ItemSheet({ sheet, onClose, onAdd, getVariantQty }) {
  const { item, store } = sheet
  const [variantId, setVariantId] = useState(
    item.lastVariant?.stillExists && !item.needsVariantChoice ? item.lastVariant.id : "",
  )
  const variant = item.variants?.find((v) => String(v.id) === String(variantId)) || null
  const price = item.hasVariants ? variant?.price : item.price
  const mustChoose = item.hasVariants && !variant
  const disabled = !item.canAdd

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 pb-6 dark:bg-[#1a1a1a]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <FoodTypeIcon type={item.foodType} isVeg={item.isVeg} size={14} className="mt-1" />
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{item.name}</h3>
              <p className="text-xs text-gray-500">{store.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {item.image && (
          <img src={item.image} alt={item.name} className={`mt-3 h-44 w-full rounded-2xl object-cover ${disabled ? "grayscale" : ""}`} />
        )}
        {item.description && <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{item.description}</p>}

        {disabled && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {blockedText(item, store)}
          </div>
        )}

        {item.hasVariants && !disabled && (
          <div className="mt-4">
            {item.needsVariantChoice && item.lastVariant?.name && (
              <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30">
                Your previous choice ({item.lastVariant.name}) is no longer available. Please choose an option.
              </p>
            )}
            <p className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">Choose an option</p>
            <VariantSelector
              variants={item.variants}
              selectedVariantId={variantId}
              onSelectVariant={setVariantId}
              getVariantQuantity={(id) => getVariantQty(item, id)}
            />
          </div>
        )}
        {!item.hasVariants && item.lastVariant?.name && !item.lastVariant.stillExists && (
          <p className="mt-3 text-xs text-amber-600">Last time: {item.lastVariant.name}. This option is no longer offered.</p>
        )}

        {item.lastAddons?.length > 0 && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Last time with: {item.lastAddons.map((a) => `${a.name}${a.stillAvailable ? "" : " (unavailable)"}`).join(", ")}.
            {item.hasAddons ? " Add-ons can be added from your cart." : ""}
          </p>
        )}

        <button
          type="button"
          disabled={disabled || mustChoose}
          onClick={(e) => onAdd(item, store, variant, e)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          style={disabled || mustChoose ? undefined : { backgroundColor: ACCENT }}
        >
          <ShoppingBag className="h-4 w-4" />
          {disabled ? "Unavailable" : mustChoose ? "Choose an option" : `Add item ${price != null ? `· ${money(price)}` : ""}`}
        </button>
      </div>
    </div>,
    document.body,
  )
}

export default function Reorder() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const onlyRestaurantId = searchParams.get("restaurantId") || ""
  const { addToCart, getCartItem, cart } = useCart()
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [sheet, setSheet] = useState(null)
  const loadedOnce = useRef(false)

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError("")
    try {
      const params = { ...readStoredPoint() }
      if (onlyRestaurantId) params.restaurantId = onlyRestaurantId
      const res = await userAPI.getReorder(params)
      const data = res?.data?.data || res?.data || {}
      setStores(Array.isArray(data.stores) ? data.stores : [])
      loadedOnce.current = true
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load your past orders")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [onlyRestaurantId])

  useEffect(() => { load() }, [load])

  // New delivered orders show up when the customer comes back to the tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && loadedOnce.current) load({ quiet: true })
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [load])

  const lineId = (item, variantId) => buildCartLineId(item.foodId, variantId || "")
  const qtyOf = useCallback((id) => {
    const line = getCartItem?.(id)
    return Number(line?.quantity) || 0
  }, [getCartItem, cart]) // eslint-disable-line react-hooks/exhaustive-deps

  const getQty = (item) => {
    if (!item.hasVariants) return qtyOf(lineId(item, ""))
    return (item.variants || []).reduce((sum, v) => sum + qtyOf(lineId(item, v.id)), 0)
  }

  const addItem = (item, store, variant, event) => {
    if (!item.canAdd) {
      toast.error(blockedText(item, store))
      return
    }
    if (item.hasVariants && !variant) {
      setSheet({ item, store })
      return
    }
    const variantId = variant?.id || ""
    const id = lineId(item, variantId)
    const price = variant ? variant.price : item.price
    const otherPrice = variant ? variant.otherPrice : item.otherPrice
    let sourcePosition = null
    const button = event?.currentTarget
    if (button?.getBoundingClientRect) {
      const rect = button.getBoundingClientRect()
      sourcePosition = {
        viewportX: rect.left + rect.width / 2,
        viewportY: rect.top + rect.height / 2,
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0,
        itemId: id,
      }
    }
    const result = addToCart({
      id,
      lineItemId: id,
      itemId: item.foodId,
      name: item.name,
      price,
      otherPrice: Number(otherPrice) > 0 ? Number(otherPrice) : 0,
      variantId,
      variantName: variant?.name || "",
      variantPrice: price,
      image: item.image,
      restaurant: store.name,
      restaurantId: store.id,
      description: item.description,
      foodType: item.foodType,
      isVeg: item.isVeg,
    }, sourcePosition, { quantity: 1 })
    if (result?.ok === false) {
      if (!result.needsConfirmation) toast.error(result.error || "Could not add this item")
      return
    }
    toast.success(`${item.name}${variant ? ` (${variant.name})` : ""} added`)
    setSheet(null)
  }

  const quickAdd = (item, store, event) => {
    // Sizes or add-ons: show the details first. Otherwise add straight away.
    if (item.hasVariants || item.hasAddons) {
      setSheet({ item, store })
      return
    }
    addItem(item, store, null, event)
  }

  const cartCount = useMemo(
    () => (Array.isArray(cart) ? cart.reduce((n, line) => n + (Number(line?.quantity) || 0), 0) : 0),
    [cart],
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-28 dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-[#141414]">
        <button type="button" onClick={() => navigate(-1)} className="rounded-full p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-gray-800 dark:text-gray-100" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Order again</h1>
          <p className="text-xs text-gray-500">Your past orders, at today's prices</p>
        </div>
        <button
          type="button"
          onClick={() => load({ quiet: true })}
          disabled={refreshing || loading}
          className="rounded-full p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          aria-label="Refresh"
        >
          <RotateCcw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {onlyRestaurantId && !loading && (
          <Link to="/food/user/reorder" className="inline-block text-xs font-semibold text-[#E64100]">
            Show all stores
          </Link>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-[#E64100]" /></div>
        ) : error ? (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-500">{error}</p>
            <button type="button" onClick={() => load()} className="mt-3 text-sm font-semibold text-[#E64100]">Try again</button>
          </div>
        ) : stores.length === 0 ? (
          <div className="py-16 text-center">
            <ShoppingBag className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              {onlyRestaurantId ? "Nothing to reorder from this store yet." : "Your delivered orders will show up here."}
            </p>
            <Link to="/food/user" className="mt-3 inline-block text-sm font-semibold text-[#E64100]">Browse restaurants</Link>
          </div>
        ) : (
          stores.map((entry) => (
            <StoreCard
              key={entry.restaurant.id}
              entry={entry}
              getQty={getQty}
              onOpen={(item, store) => setSheet({ item, store })}
              onQuickAdd={quickAdd}
            />
          ))
        )}
      </main>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <Link
            to="/food/user/cart"
            className="flex w-full max-w-md items-center justify-between rounded-2xl px-5 py-3.5 text-white shadow-lg"
            style={{ backgroundColor: ACCENT }}
          >
            <span className="text-sm font-semibold">{cartCount} item{cartCount > 1 ? "s" : ""} in cart</span>
            <span className="text-sm font-bold">View cart</span>
          </Link>
        </div>
      )}

      {sheet && (
        <ItemSheet
          key={`${sheet.store.id}:${sheet.item.foodId}`}
          sheet={sheet}
          onClose={() => setSheet(null)}
          onAdd={addItem}
          getVariantQty={(item, variantId) => qtyOf(lineId(item, variantId))}
        />
      )}
    </div>
  )
}
