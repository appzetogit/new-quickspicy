import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { X, ChevronRight, ChevronDown, ChevronUp, ShoppingBag } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useCart } from "@food/context/CartContext"

/**
 * Floating carts: one card per restaurant cart. Only the most recently
 * updated cart shows by default; the others sit behind "Show all (N)". Each
 * card has the restaurant name, item count, View Menu, View Cart and a remove
 * button (asks first, then removes that whole cart).
 *
 * floating = true pins it above the bottom navigation on its own; pass false
 * to place it inside another fixed container (FloatingHomeDock does).
 */
const slugify = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, "-")

function FloatingCartRow({ entry, onViewCart, onRemove }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const name = entry.restaurantName || "Restaurant"
  const menuTarget = entry.restaurantSlug || entry.restaurantId || slugify(name)
  const count = entry.itemCount || 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ type: "spring", damping: 24, stiffness: 320 }}
      className="bg-white dark:bg-[#141414] dark:text-white rounded-2xl shadow-[0_8px_18px_rgba(0,0,0,0.16)] border border-gray-200 dark:border-gray-800 overflow-hidden"
    >
      {confirming ? (
        <div className="flex items-center gap-2 px-3 py-3">
          <p className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200">
            Remove your <span className="font-semibold">{name}</span> cart?
          </p>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={() => onRemove(entry)}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700"
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-2.5">
          {entry.image ? (
            <img
              src={entry.image}
              alt=""
              className="w-11 h-11 rounded-lg object-cover shrink-0 bg-gray-100 dark:bg-gray-800"
              onError={(event) => { event.currentTarget.style.visibility = "hidden" }}
            />
          ) : (
            <div className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center bg-orange-50 dark:bg-gray-800">
              <ShoppingBag className="h-5 w-5 text-[var(--module-theme-color,#EB590E)]" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{name}</p>
            <button
              type="button"
              onClick={() => navigate(`/food/user/restaurants/${encodeURIComponent(menuTarget)}`)}
              className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-gray-600 dark:text-gray-400 hover:underline"
            >
              View Menu
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onViewCart(entry)}
            className="shrink-0 rounded-xl px-3.5 py-2 text-white text-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(var(--module-theme-rgb,235, 89, 14),0.94), rgba(var(--module-theme-rgb,235, 89, 14),0.78))",
            }}
            aria-label={`View cart for ${name}`}
          >
            <span className="block text-[11px] leading-tight opacity-90">View Cart</span>
            <span className="block text-xs font-bold leading-tight">
              {count} {count === 1 ? "item" : "items"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label={`Remove ${name} cart`}
          >
            <X className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
      )}
    </motion.div>
  )
}

export default function StickyCartCard({ floating = true, linkTo = "/food/user/cart", className = "" }) {
  const navigate = useNavigate()
  const { carts = [], selectCart, removeCart } = useCart()
  const [showAll, setShowAll] = useState(false)

  if (!carts.length) return null

  const visible = showAll ? carts : carts.slice(0, 1)

  const handleViewCart = (entry) => {
    const id = entry.restaurantId || entry.key
    selectCart?.(id)
    navigate(entry.restaurantId ? `${linkTo}?restaurant=${encodeURIComponent(entry.restaurantId)}` : linkTo)
  }

  const handleRemove = (entry) => {
    removeCart?.(entry.restaurantId || entry.key)
    if (carts.length <= 2) setShowAll(false)
  }

  const list = (
    <div className={`flex flex-col gap-2 pointer-events-auto ${className}`}>
      <div className={`flex flex-col gap-2 ${showAll ? "max-h-[50vh] overflow-y-auto" : ""}`}>
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((entry) => (
            <FloatingCartRow
              key={entry.key}
              entry={entry}
              onViewCart={handleViewCart}
              onRemove={handleRemove}
            />
          ))}
        </AnimatePresence>
      </div>
      {carts.length > 1 && (
        <button
          type="button"
          onClick={() => setShowAll((open) => !open)}
          className="self-center inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold bg-white/95 dark:bg-[#141414] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-800 shadow"
          aria-expanded={showAll}
        >
          {showAll ? (
            <>Show less <ChevronUp className="h-3.5 w-3.5" /></>
          ) : (
            <>Show all ({carts.length}) <ChevronDown className="h-3.5 w-3.5" /></>
          )}
        </button>
      )}
    </div>
  )

  if (!floating) return list

  return (
    <div className="fixed bottom-[70px] md:bottom-6 left-0 right-0 md:left-auto md:right-6 z-50 px-4 md:px-0 pointer-events-none md:w-[400px]">
      {list}
    </div>
  )
}
