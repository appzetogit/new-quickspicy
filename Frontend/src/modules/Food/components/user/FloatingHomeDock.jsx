import { memo } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useCart } from "@food/context/CartContext";
import useActiveOrderTracking from "@food/hooks/useActiveOrderTracking";
import OrderTrackingRow from "./OrderTrackingRow";
import StickyCartCard from "./StickyCartCard";

const DOCK_BOTTOM_WITH_NAV = "calc(5.75rem + env(safe-area-inset-bottom, 0px))";
const DOCK_BOTTOM_NO_NAV = "calc(1.5rem + env(safe-area-inset-bottom, 0px))";

function FloatingHomeDockInner({
  hasBottomNav = true,
  showOrderTracking = true,
  linkTo = "/food/user/cart",
}) {
  const { carts = [] } = useCart();
  const { activeOrder, timeRemaining, dismissOrder } = useActiveOrderTracking();

  const showOrder = showOrderTracking && !!activeOrder;
  const showCart = carts.length > 0;

  if (!showOrder && !showCart) return null;

  const dockBottom = hasBottomNav ? DOCK_BOTTOM_WITH_NAV : DOCK_BOTTOM_NO_NAV;

  return (
    <LayoutGroup>
      <motion.div
        layout
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 48, opacity: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="fixed left-4 right-4 z-[55] md:left-auto md:right-6 md:max-w-md pointer-events-none"
        style={{ bottom: dockBottom }}
      >
        <div className="flex flex-col gap-2 pointer-events-auto">
          <AnimatePresence mode="popLayout">
            {showOrder && (
              <motion.div
                key="order-row"
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ type: "spring", damping: 24, stiffness: 320 }}
              >
                <OrderTrackingRow
                  order={activeOrder}
                  timeRemaining={timeRemaining}
                  onDismiss={dismissOrder}
                  compact
                />
              </motion.div>
            )}

            {showCart && (
              <motion.div
                key="cart-bar"
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ type: "spring", damping: 24, stiffness: 320 }}
              >
                {/* One card per restaurant cart (most recent first, the rest behind "Show all"). */}
                <StickyCartCard floating={false} linkTo={linkTo} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </LayoutGroup>
  );
}

const FloatingHomeDock = memo(FloatingHomeDockInner);
export default FloatingHomeDock;
