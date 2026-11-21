/**
 * Customer funnel events for the website (POST /food/events), feeding the
 * admin's Customer Funnel report: app_open -> restaurant_view -> add_to_cart
 * -> checkout_start -> payment_success.
 *
 * Fire and forget: events are queued and sent in batches a few seconds apart
 * (or when the tab is hidden), every step is wrapped so analytics can never
 * break or slow a screen, and nothing waits on the network.
 *
 * Session id: per browser tab (sessionStorage). Device id: per browser
 * (localStorage); its absence is what marks the first open.
 */

const SESSION_KEY = "qs_funnel_session"
const DEVICE_KEY = "qs_funnel_device"
const OPENED_KEY = "qs_funnel_opened"
const FLUSH_DELAY_MS = 3000
const MAX_BATCH = 50
const MAX_QUEUE = 200
const ALLOWED = new Set([
  "app_open", "restaurant_view", "menu_item_view", "add_to_cart",
  "checkout_start", "payment_success", "payment_failed",
])

const ID_RE = /^[a-f0-9]{24}$/i

let queue = []
let timer = null
let listening = false
let openedHere = false
const recent = new Map()

const randomId = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

const read = (storage, key) => {
  try { return storage?.getItem(key) || null } catch { return null }
}
const write = (storage, key, value) => {
  try { storage?.setItem(key, value) } catch { /* private mode */ }
}

let memorySession = null
const sessionId = () => {
  const stored = read(typeof sessionStorage !== "undefined" ? sessionStorage : null, SESSION_KEY)
  if (stored) return stored
  const id = memorySession || randomId()
  memorySession = id
  write(typeof sessionStorage !== "undefined" ? sessionStorage : null, SESSION_KEY, id)
  return id
}

/** { id, isNew }: isNew the first time this browser is seen. */
const deviceId = () => {
  const local = typeof localStorage !== "undefined" ? localStorage : null
  const stored = read(local, DEVICE_KEY)
  if (stored) return { id: stored, isNew: false }
  const id = randomId()
  write(local, DEVICE_KEY, id)
  return { id, isNew: true }
}

const apiBase = () => {
  try {
    const raw = import.meta.env?.VITE_API_BASE_URL
    return raw ? String(raw).replace(/\/$/, "") : "/api/v1"
  } catch {
    return "/api/v1"
  }
}

const userToken = () => {
  const local = typeof localStorage !== "undefined" ? localStorage : null
  return read(local, "user_accessToken") || read(local, "accessToken")
}

const zoneId = () => {
  const z = read(typeof localStorage !== "undefined" ? localStorage : null, "userZoneId")
  return z && ID_RE.test(z) ? z : undefined
}

const appVersion = () => {
  try {
    const v = import.meta.env?.VITE_APP_VERSION
    return v ? String(v).slice(0, 32) : "web"
  } catch {
    return "web"
  }
}

function send(events, { unloading = false } = {}) {
  try {
    if (!events.length || typeof fetch === "undefined") return
    const token = userToken()
    const body = JSON.stringify({
      sessionId: sessionId(),
      deviceId: deviceId().id,
      platform: "web",
      appVersion: appVersion(),
      events,
    })
    fetch(`${apiBase()}/food/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      // Lets the last batch go out while the tab closes.
      keepalive: unloading && body.length < 60000,
    }).catch(() => {})
  } catch {
    /* analytics never throws */
  }
}

export function flushFunnelEvents(options = {}) {
  try {
    if (timer) { clearTimeout(timer); timer = null }
    while (queue.length) send(queue.splice(0, MAX_BATCH), options)
  } catch { /* ignore */ }
}

const listen = () => {
  if (listening || typeof window === "undefined") return
  listening = true
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushFunnelEvents({ unloading: true })
    })
    window.addEventListener("pagehide", () => flushFunnelEvents({ unloading: true }))
    // Every successful checkout (cash, wallet, online) announces itself.
    window.addEventListener("order-placed", (e) => {
      const order = e?.detail?.order || {}
      const orderId = order._id || order.id || order.orderMongoId
      trackFunnel("payment_success", {
        orderId,
        restaurantId: order.restaurantId?._id || order.restaurantId,
        props: { method: order.paymentMethod || order.payment?.method },
      })
    })
  } catch { /* ignore */ }
}

/**
 * Queue one event. `fields`: restaurantId, orderId, zoneId, props (small,
 * flat). The same event for the same restaurant/order within 30s is skipped,
 * so re-renders do not inflate the counts.
 */
export function trackFunnel(event, fields = {}) {
  try {
    if (!ALLOWED.has(event)) return
    listen()
    const restaurantId = ID_RE.test(String(fields.restaurantId || "")) ? String(fields.restaurantId) : undefined
    const orderId = ID_RE.test(String(fields.orderId || "")) ? String(fields.orderId) : undefined
    if (event === "payment_success" && !orderId) return

    const dedupe = `${event}:${restaurantId || ""}:${orderId || ""}:${fields.props?.itemId || ""}`
    const now = Date.now()
    if (event !== "add_to_cart" && recent.has(dedupe) && now - recent.get(dedupe) < 30000) return
    recent.set(dedupe, now)
    if (recent.size > 200) recent.clear()

    const props = {}
    for (const [k, v] of Object.entries(fields.props || {})) {
      if (v === undefined) continue
      if (["string", "number", "boolean"].includes(typeof v) || v === null) props[k] = typeof v === "string" ? v.slice(0, 120) : v
    }

    queue.push({
      event,
      at: new Date(now).toISOString(),
      ...(restaurantId ? { restaurantId } : {}),
      ...(orderId ? { orderId } : {}),
      zoneId: ID_RE.test(String(fields.zoneId || "")) ? fields.zoneId : zoneId(),
      props,
    })
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)

    if (queue.length >= MAX_BATCH || event === "payment_success") {
      flushFunnelEvents()
    } else if (!timer) {
      timer = setTimeout(() => { timer = null; flushFunnelEvents() }, FLUSH_DELAY_MS)
    }
  } catch {
    /* analytics never throws */
  }
}

/** Once per browser tab session. isFirstOpen the first time this browser is seen. */
export function trackAppOpen() {
  try {
    listen()
    const session = typeof sessionStorage !== "undefined" ? sessionStorage : null
    if (openedHere || read(session, OPENED_KEY)) return
    openedHere = true
    const { isNew } = deviceId()
    sessionId()
    write(session, OPENED_KEY, "1")
    trackFunnel("app_open", {
      props: {
        isFirstOpen: isNew,
        path: typeof window !== "undefined" ? window.location.pathname.slice(0, 100) : undefined,
      },
    })
  } catch {
    /* ignore */
  }
}
