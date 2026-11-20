// src/context/cart-context.jsx
//
// Multiple carts: the customer keeps one cart per restaurant. All lines live in
// one flat list (`cart`, each line carries its restaurantId); a cart is the
// lines of one restaurant. One cart is "active" (the one the Cart page and the
// cart bar show): the last one changed, unless another was picked with
// selectCart(). Checkout is one restaurant per order, so clearCart() after an
// order empties only the active cart and the others stay.
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { buildCartLineId } from "@food/utils/foodVariants"
import { userAPI } from "@/services/api"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const CART_STORAGE_KEY = "cart"
const CART_META_STORAGE_KEY = "cart_meta"
const PRICING_SNAPSHOT_KEY = "food_cart_pricing_snapshot"
const isServerId = (value) => /^[a-f0-9]{24}$/i.test(String(value ?? ""))

// Default cart context value to prevent errors during initial render
const defaultCartContext = {
  _isProvider: false, // Flag to identify if this is from the actual provider
  cart: [],
  activeCart: [],
  activeRestaurantId: null,
  carts: [],
  items: [],
  itemCount: 0,
  total: 0,
  lastAddEvent: null,
  lastRemoveEvent: null,
  addToCart: () => {
    debugWarn('CartProvider not available - addToCart called');
  },
  removeFromCart: () => {
    debugWarn('CartProvider not available - removeFromCart called');
  },
  updateQuantity: () => {
    debugWarn('CartProvider not available - updateQuantity called');
  },
  getCartCount: () => 0,
  isInCart: () => false,
  getCartItem: () => null,
  getRestaurantCart: () => null,
  selectCart: () => {},
  removeCart: () => {},
  clearAllCarts: () => {},
  clearCart: () => {
    debugWarn('CartProvider not available - clearCart called');
  },
  cleanCartForRestaurant: () => {
    debugWarn('CartProvider not available - cleanCartForRestaurant called');
  },
  replaceCart: () => {
    debugWarn('CartProvider not available - replaceCart called');
  },
  confirmReplaceCart: () => {},
  cancelReplaceCart: () => {},
  cartReplacePrompt: null,
}

const CartContext = createContext(defaultCartContext)

const normalizeName = (name) => (name ? String(name).trim().toLowerCase() : "")

/** Which cart a line belongs to: its restaurant id, else (old data) its restaurant name. */
export const cartKeyOf = (item) => {
  const restaurantId = item?.restaurantId
  if (restaurantId) return String(restaurantId)
  const name = normalizeName(item?.restaurant)
  return name ? `name:${name}` : ""
}

const normalizeCartData = (rawCart) => {
  if (!Array.isArray(rawCart)) return []

  return rawCart
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const parsedQuantity = Number(item.quantity)
      const parsedPrice = Number(item.price)
      const normalizedRestaurantName =
        typeof item.restaurant === "string"
          ? item.restaurant
          : typeof item.restaurant?.name === "string"
            ? item.restaurant.name
            : typeof item.restaurantName === "string"
              ? item.restaurantName
              : ""

      const normalizedRestaurantId =
        item.restaurantId ||
        item.restaurant_id ||
        item.restaurant?._id ||
        item.restaurant?.restaurantId ||
        null

      const normalizedImage =
        item.image ||
        item.imageUrl ||
        item.product?.imageUrl ||
        item.product?.image ||
        ""

      const baseItemId =
        item.itemId ||
        item.productId ||
        item.foodId ||
        item.baseItemId ||
        item.menuItemId ||
        item.id ||
        item._id ||
        `cart-item-${index}`

      const variantId = item.variantId || item.variant?._id || item.variant?.id || ""
      const variantName =
        typeof item.variantName === "string"
          ? item.variantName
          : typeof item.variant?.name === "string"
            ? item.variant.name
            : ""
      const parsedVariantPrice = Number(
        item.variantPrice ?? item.variant?.price ?? item.price,
      )
      const lineItemId =
        item.lineItemId ||
        item.cartLineId ||
        buildCartLineId(baseItemId, variantId)

      const name = item.name || item.product?.name || "Item";
      const nameLower = name.toLowerCase();

      // Strict cache sanitation: If it was wrongly cached as Veg previously, override it
      let currentFoodType = item.foodType;
      if (nameLower.includes("chicken") || nameLower.includes("salmon") || nameLower.includes("tart")) {
        currentFoodType = "Non-Veg";
      }

      const finalFoodType = currentFoodType || (item.isVeg === true ? "Veg" : "Non-Veg");

      return {
        ...item,
        id: lineItemId,
        lineItemId,
        itemId: String(baseItemId),
        productId: String(baseItemId),
        variantId: variantId ? String(variantId) : "",
        variantName,
        variantPrice: Number.isFinite(parsedVariantPrice) ? parsedVariantPrice : 0,
        name: name,
        quantity:
          Number.isFinite(parsedQuantity) && parsedQuantity > 0
            ? Math.floor(parsedQuantity)
            : 1,
        price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
        otherPrice: Number(item.otherPrice) > 0 ? Number(item.otherPrice) : 0,
        foodType: finalFoodType,
        isVeg: finalFoodType === "Veg",
        restaurant: normalizedRestaurantName,
        restaurantId: normalizedRestaurantId,
        image: normalizedImage,
        imageUrl: normalizedImage,
      }
    })
}

const resolveCartEntryId = (items, itemId, variantId = "") => {
  const normalizedItemId = String(itemId || "")
  const safeItems = Array.isArray(items) ? items : []

  const directMatch = safeItems.find((item) => item.id === normalizedItemId)
  if (directMatch) return directMatch.id

  const preferredId = buildCartLineId(normalizedItemId, variantId)

  const exactMatch = safeItems.find((item) => item.id === preferredId)
  if (exactMatch) return exactMatch.id

  if (!variantId) {
    const legacyBaseMatch = safeItems.find(
      (item) =>
        String(item.itemId || item.productId || item.id || "") === normalizedItemId &&
        !String(item.variantId || "").trim(),
    )
    if (legacyBaseMatch) return legacyBaseMatch.id
  }

  return preferredId
}

const readMeta = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_META_STORAGE_KEY) || "null")
    if (parsed && typeof parsed === "object") {
      return {
        activeKey: typeof parsed.activeKey === "string" ? parsed.activeKey : null,
        touched: parsed.touched && typeof parsed.touched === "object" ? parsed.touched : {},
      }
    }
  } catch {
    // ignore bad JSON / blocked storage
  }
  return { activeKey: null, touched: {} }
}

const isAuthenticatedUser = () => {
  try {
    return (
      localStorage.getItem("user_authenticated") === "true" ||
      !!localStorage.getItem("user_accessToken")
    )
  } catch {
    return false
  }
}

/** What the server stores for a line; also the change-detection signature. */
const toServerLine = (item) => ({
  lineItemId: item.lineItemId || item.id,
  itemId: item.itemId,
  name: item.name,
  price: item.price,
  otherPrice: item.otherPrice,
  quantity: item.quantity,
  variantId: item.variantId || "",
  variantName: item.variantName || "",
  variantPrice: item.variantPrice,
  image: item.image || "",
  foodType: item.foodType || "",
  isVeg: item.isVeg === true,
  restaurantId: item.restaurantId,
  restaurant: item.restaurant || "",
})

export function CartProvider({ children }) {
  // Safe init (works with SSR and bad JSON)
  const [cart, setCart] = useState(() => {
    if (typeof window === "undefined") return []
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY)
      const parsed = saved ? JSON.parse(saved) : []
      return normalizeCartData(parsed)
    } catch {
      return []
    }
  })
  // Which cart is selected, and when each cart last changed.
  const [meta, setMeta] = useState(() =>
    typeof window === "undefined" ? { activeKey: null, touched: {} } : readMeta(),
  )
  // Track last add event for animation
  const [lastAddEvent, setLastAddEvent] = useState(null)
  // Track last remove event for animation
  const [lastRemoveEvent, setLastRemoveEvent] = useState(null)

  // ----- Carts, grouped by restaurant -----
  const safeCart = useMemo(() => normalizeCartData(cart), [cart])

  const cartGroups = useMemo(() => {
    const groups = new Map()
    safeCart.forEach((item, index) => {
      const key = cartKeyOf(item)
      if (!key) return
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          restaurantId: item.restaurantId ? String(item.restaurantId) : null,
          restaurantName: item.restaurant || "",
          restaurantSlug: item.restaurantSlug || null,
          image: item.restaurantImage || "",
          items: [],
          itemCount: 0,
          subtotal: 0,
          updatedAt: Number(meta.touched?.[key]) || 0,
          order: index,
        })
      }
      const group = groups.get(key)
      group.items.push(item)
      group.itemCount += item.quantity || 0
      group.subtotal += (Number(item.price) || 0) * (item.quantity || 0)
      if (!group.restaurantName && item.restaurant) group.restaurantName = item.restaurant
      if (!group.image) group.image = item.restaurantImage || item.image || ""
    })
    return groups
  }, [safeCart, meta.touched])

  // Newest first; carts never stamped keep the order their lines were added.
  const carts = useMemo(
    () =>
      [...cartGroups.values()].sort(
        (a, b) => b.updatedAt - a.updatedAt || b.order - a.order,
      ),
    [cartGroups],
  )

  const activeKey =
    meta.activeKey && cartGroups.has(meta.activeKey) ? meta.activeKey : carts[0]?.key || null
  const activeGroup = activeKey ? cartGroups.get(activeKey) : null
  const activeCart = useMemo(() => activeGroup?.items || [], [activeGroup])

  const findGroupKey = useCallback(
    (restaurantIdOrKey) => {
      if (!restaurantIdOrKey) return null
      const wanted = String(restaurantIdOrKey)
      if (cartGroups.has(wanted)) return wanted
      const byName = `name:${normalizeName(wanted)}`
      return cartGroups.has(byName) ? byName : null
    },
    [cartGroups],
  )

  /** Mark a cart as just changed (and make it the active one). */
  const touchCart = useCallback((key) => {
    if (!key) return
    setMeta((prev) => ({
      activeKey: key,
      touched: { ...(prev.touched || {}), [key]: Date.now() },
    }))
  }, [])

  // Persist to localStorage whenever cart changes
  useEffect(() => {
    try {
      // Only save if we have items or user is authenticated to avoid cluttering localStorage for every guest visitor
      if (cart.length > 0 || isAuthenticatedUser()) {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(normalizeCartData(cart)))
      }
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, [cart])

  useEffect(() => {
    try {
      // Drop stamps of carts that no longer exist.
      const touched = {}
      Object.keys(meta.touched || {}).forEach((key) => {
        if (cartGroups.has(key)) touched[key] = meta.touched[key]
      })
      localStorage.setItem(
        CART_META_STORAGE_KEY,
        JSON.stringify({ activeKey: meta.activeKey && cartGroups.has(meta.activeKey) ? meta.activeKey : null, touched }),
      )
    } catch {
      // ignore storage errors
    }
  }, [meta, cartGroups])

  // ----- Server sync: one server cart per restaurant -----
  // restaurantId -> signature last saved on the server.
  const syncedRef = useRef(new Map())
  const [hydrated, setHydrated] = useState(false)
  const cartSyncTimerRef = useRef(null)

  // On load, bring in carts saved from another device (or the app) that this
  // browser does not have. Local carts win where both have one.
  useEffect(() => {
    if (typeof window === "undefined" || !isAuthenticatedUser()) {
      setHydrated(true)
      return
    }
    let cancelled = false
    userAPI
      .listCarts()
      .then((response) => {
        if (cancelled) return
        const serverCarts = response?.data?.data?.carts || []
        if (!Array.isArray(serverCarts) || serverCarts.length === 0) return
        const serverLines = []
        const stamps = {}
        serverCarts.forEach((serverCart) => {
          const restaurantId = String(serverCart?.restaurantId || "")
          if (!isServerId(restaurantId)) return
          const lines = normalizeCartData(
            (serverCart.items || []).map((line) => ({
              ...line,
              restaurantId,
              restaurant: serverCart.restaurantName || serverCart.restaurant?.name || "",
              restaurantSlug: serverCart.restaurant?.slug || null,
              restaurantImage: serverCart.restaurant?.image || "",
            })),
          )
          if (!lines.length) return
          serverLines.push(...lines)
          stamps[restaurantId] = Date.parse(serverCart.updatedAt) || 0
          // What the server holds; a different local cart is saved over it.
          syncedRef.current.set(
            restaurantId,
            JSON.stringify({ items: lines.map(toServerLine), pricing: null }),
          )
        })
        if (!serverLines.length) return
        setCart((prev) => {
          const local = normalizeCartData(prev)
          const localKeys = new Set(local.map(cartKeyOf))
          const additions = serverLines.filter((line) => !localKeys.has(cartKeyOf(line)))
          return additions.length ? [...local, ...additions] : prev
        })
        // Local stamps win for carts this browser already had.
        setMeta((prev) => ({ ...prev, touched: { ...stamps, ...(prev.touched || {}) } }))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const scheduleCartSync = useCallback(() => {
    if (typeof window === "undefined" || !hydrated) return
    if (!isAuthenticatedUser()) return

    if (cartSyncTimerRef.current) {
      clearTimeout(cartSyncTimerRef.current)
    }

    cartSyncTimerRef.current = setTimeout(() => {
      let snapshot = null
      try {
        const rawPricing = sessionStorage.getItem(PRICING_SNAPSHOT_KEY)
        if (rawPricing) snapshot = JSON.parse(rawPricing)
      } catch {
        snapshot = null
      }

      const present = new Set()
      cartGroups.forEach((group) => {
        const restaurantId = group.restaurantId
        if (!isServerId(restaurantId)) return
        present.add(restaurantId)
        // The Cart page's quote belongs to the cart it was computed for.
        const pricing =
          snapshot && String(snapshot.restaurantId || "") === restaurantId ? snapshot : null
        const items = group.items.map(toServerLine)
        const signature = JSON.stringify({ items, pricing })
        if (syncedRef.current.get(restaurantId) === signature) return
        userAPI
          .saveRestaurantCart(restaurantId, { items, pricing })
          .then(() => syncedRef.current.set(restaurantId, signature))
          .catch(() => {})
      })

      // Carts removed here (ordered, removed, emptied) are removed there too.
      ;[...syncedRef.current.keys()].forEach((restaurantId) => {
        if (present.has(restaurantId)) return
        userAPI
          .deleteRestaurantCart(restaurantId)
          .then(() => syncedRef.current.delete(restaurantId))
          .catch(() => {})
      })
    }, 1200)
  }, [cartGroups, hydrated])

  // Sync carts to the server (authenticated users only)
  useEffect(() => {
    scheduleCartSync()

    const handlePricingUpdated = () => {
      scheduleCartSync()
    }

    window.addEventListener("food_cart_pricing_updated", handlePricingUpdated)

    return () => {
      window.removeEventListener("food_cart_pricing_updated", handlePricingUpdated)
      if (cartSyncTimerRef.current) {
        clearTimeout(cartSyncTimerRef.current)
      }
    }
  }, [scheduleCartSync])

  // ----- Changing carts -----
  const flashAddEvent = (item, sourcePosition) => {
    if (!sourcePosition) return
    setLastAddEvent({
      product: {
        id: item.id,
        name: item.name,
        imageUrl: item.image || item.imageUrl,
      },
      sourcePosition,
    })
    // Clear after animation completes
    setTimeout(() => setLastAddEvent(null), 1500)
  }

  const flashRemoveEvent = (item, sourcePosition, productInfo) => {
    if (!item || !sourcePosition || !productInfo) return
    setLastRemoveEvent({
      product: {
        id: productInfo.id || item.id,
        name: productInfo.name || item.name,
        imageUrl: productInfo.imageUrl || productInfo.image || item.image || item.imageUrl,
      },
      sourcePosition,
    })
    // Clear after animation completes
    setTimeout(() => setLastRemoveEvent(null), 1500)
  }

  /**
   * Add a dish. A dish from another restaurant goes into that restaurant's own
   * cart; nothing is replaced and nothing is asked. options.forceReplace
   * empties that restaurant's cart first (other carts stay).
   */
  const addToCart = (item, sourcePosition = null, options = {}) => {
    const { forceReplace = false, quantity: requestedQuantity = 1 } = options
    const parsedQuantity = Number(requestedQuantity)
    const addQuantity =
      Number.isFinite(parsedQuantity) && parsedQuantity > 0
        ? Math.floor(parsedQuantity)
        : 1

    if (!item?.restaurantId && !item?.restaurant) {
      return {
        ok: false,
        error: 'Item is missing restaurant information. Please refresh the page.',
        code: 'MISSING_RESTAURANT'
      }
    }

    const key = cartKeyOf(item)

    setCart((prev) => {
      const safePrev = normalizeCartData(prev)
      const kept = forceReplace ? safePrev.filter((i) => cartKeyOf(i) !== key) : safePrev

      const existing = kept.find((i) => i.id === item.id)
      if (existing) {
        return kept.map((i) =>
          i.id === item.id ? { ...i, quantity: i.quantity + addQuantity } : i
        )
      }
      return [...kept, { ...item, quantity: addQuantity }]
    })
    flashAddEvent(item, sourcePosition)
    touchCart(key)

    return { ok: true, restaurantId: item.restaurantId || null }
  }

  // Kept for callers built for the old "replace cart?" prompt, which is gone.
  const cancelReplaceCart = () => {}
  const confirmReplaceCart = () => {}

  const removeFromCart = (itemId, sourcePosition = null, productInfo = null) => {
    const resolvedItemId = resolveCartEntryId(safeCart, itemId)
    const itemToRemove = safeCart.find((i) => i.id === resolvedItemId)
    flashRemoveEvent(itemToRemove, sourcePosition, productInfo)
    setCart((prev) => normalizeCartData(prev).filter((i) => i.id !== resolvedItemId))
    if (itemToRemove) touchCart(cartKeyOf(itemToRemove))
  }

  const updateQuantity = (itemId, quantity, sourcePosition = null, productInfo = null) => {
    const resolvedItemId = resolveCartEntryId(safeCart, itemId)
    const existingItem = safeCart.find((i) => i.id === resolvedItemId)
    if (quantity <= 0) {
      removeFromCart(itemId, sourcePosition, productInfo)
      return
    }

    // When quantity decreases (but not to 0), also trigger removal animation
    if (existingItem && quantity < existingItem.quantity) {
      flashRemoveEvent(existingItem, sourcePosition, productInfo)
    }
    setCart((prev) =>
      normalizeCartData(prev).map((i) => (i.id === resolvedItemId ? { ...i, quantity } : i)),
    )
    if (existingItem) touchCart(cartKeyOf(existingItem))
  }

  /** Lines in every cart, or in one restaurant's cart. */
  const getCartCount = (restaurantId = null) => {
    if (restaurantId) {
      const key = findGroupKey(restaurantId)
      return key ? cartGroups.get(key).itemCount : 0
    }
    return safeCart.reduce((total, item) => total + (item.quantity || 0), 0)
  }

  const isInCart = (itemId, variantId = "") => {
    const resolvedItemId = resolveCartEntryId(safeCart, itemId, variantId)
    return safeCart.some((i) => i.id === resolvedItemId)
  }

  const getCartItem = (itemId, variantId = "") => {
    const resolvedItemId = resolveCartEntryId(safeCart, itemId, variantId)
    return safeCart.find((i) => i.id === resolvedItemId) || null
  }

  /** One restaurant's cart ({ key, restaurantId, restaurantName, items, itemCount, subtotal, updatedAt }) or null. */
  const getRestaurantCart = (restaurantId) => {
    const key = findGroupKey(restaurantId)
    return key ? cartGroups.get(key) : null
  }

  /** Show this restaurant's cart on the Cart page / cart bar (does not reorder the carts). */
  const selectCart = useCallback(
    (restaurantId) => {
      const key = findGroupKey(restaurantId)
      if (!key) return false
      setMeta((prev) => (prev.activeKey === key ? prev : { ...prev, activeKey: key }))
      return true
    },
    [findGroupKey],
  )

  /** Remove one restaurant's whole cart. */
  const removeCart = (restaurantId) => {
    const key = findGroupKey(restaurantId)
    if (!key) return
    setCart((prev) => normalizeCartData(prev).filter((i) => cartKeyOf(i) !== key))
    setMeta((prev) => {
      const touched = { ...(prev.touched || {}) }
      delete touched[key]
      return { activeKey: prev.activeKey === key ? null : prev.activeKey, touched }
    })
  }

  /**
   * Empty a cart: the given restaurant's, else the active one (what the Cart
   * page just ordered). Other restaurants' carts stay.
   */
  const clearCart = (restaurantId = null) => {
    const key = restaurantId ? findGroupKey(restaurantId) : activeKey
    if (!key) return
    removeCart(key)
  }

  const clearAllCarts = () => {
    setCart([])
    setMeta({ activeKey: null, touched: {} })
  }

  /**
   * Replace the carts of the restaurants these lines belong to (reorder, or
   * the Cart page refreshing prices) and make that cart active. Carts at other
   * restaurants are kept. An empty list empties the active cart.
   */
  const replaceCart = (items) => {
    const normalizedItems = normalizeCartData(items).filter((item) => {
      const quantity = Number(item?.quantity)
      return item?.id && (item?.restaurantId || item?.restaurant) && Number.isFinite(quantity) && quantity > 0
    })

    if (normalizedItems.length === 0) {
      clearCart()
      return { ok: true, count: 0 }
    }

    const keys = new Set(normalizedItems.map(cartKeyOf))
    setCart((prev) => [
      ...normalizeCartData(prev).filter((i) => !keys.has(cartKeyOf(i))),
      ...normalizedItems,
    ])
    touchCart(cartKeyOf(normalizedItems[0]))
    return { ok: true, count: normalizedItems.length }
  }

  // Old name: kept carts to one restaurant. Carts are per restaurant now, so
  // this only selects that restaurant's cart.
  const cleanCartForRestaurant = (restaurantId, restaurantName) => {
    if (!selectCart(restaurantId)) selectCart(restaurantName)
  }

  // Transform the active cart to match AddToCartAnimation expected structure
  const cartForAnimation = useMemo(() => {
    const items = activeCart.map(item => ({
      product: {
        id: item.id,
        name: item.name,
        imageUrl: item.image || item.imageUrl,
      },
      quantity: item.quantity || 1,
    }))

    const itemCount = activeCart.reduce((total, item) => total + (item.quantity || 0), 0)
    const total = activeCart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0)

    return {
      items,
      itemCount,
      total,
    }
  }, [activeCart])

  const value = useMemo(
    () => ({
      _isProvider: true, // Flag to identify this is from the actual provider
      // Every line of every cart (each carries restaurantId), as before.
      cart,
      // The selected restaurant's lines: what the Cart page checks out.
      activeCart,
      activeRestaurantId: activeGroup?.restaurantId || activeKey || null,
      // One entry per restaurant, most recently changed first.
      carts,
      // Animation / cart-bar structure, for the active cart.
      items: cartForAnimation.items,
      itemCount: cartForAnimation.itemCount,
      total: cartForAnimation.total,
      lastAddEvent,
      lastRemoveEvent,
      addToCart,
      removeFromCart,
      updateQuantity,
      getCartCount,
      isInCart,
      getCartItem,
      getRestaurantCart,
      selectCart,
      removeCart,
      clearCart,
      clearAllCarts,
      cleanCartForRestaurant,
      replaceCart,
      cartReplacePrompt: null,
      confirmReplaceCart,
      cancelReplaceCart,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, activeCart, activeGroup, activeKey, carts, cartForAnimation, lastAddEvent, lastRemoveEvent, selectCart]
  )

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  // Check if context is from the actual provider by checking the _isProvider flag
  if (!context || context._isProvider !== true) {
    // In development, log a warning but don't throw to prevent crashes
    if (process.env.NODE_ENV === 'development') {
      debugWarn('⚠️ useCart called outside CartProvider. Using default values.');
      debugWarn('💡 Make sure the component is rendered inside UserLayout which provides CartProvider.');
    }
    // Return default context instead of throwing
    return defaultCartContext
  }
  return context
}
