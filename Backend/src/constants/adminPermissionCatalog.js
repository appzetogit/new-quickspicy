/**
 * Submenu-level permissions: the one catalogue the backend sanitiser, the
 * role editor (via GET /sub-admins/permission-catalog) and the API guard read.
 *
 * Every submenu is one leaf of the admin sidebar
 * (Frontend/src/modules/Food/utils/adminSidebarMenu.js). Its key is derived
 * from the leaf's path by submenuKeyFromPath -- "/admin/food/orders/pending"
 * is "orders.pending" -- so the panel can work out a page's key from its URL
 * without fetching anything, and a key only changes when the page's URL does.
 * adminPermissionCatalog.test.js fails when a sidebar leaf that belongs to a
 * permission section is missing here, so a new page is not silently ungated.
 *
 * Sections with a single sidebar entry (dashboard, point of sale, coupons, the
 * sub-admin list) have no submenus: the section row already is that page.
 * Sidebar pages that map to no permission section (theme, login setup, ...)
 * are super-admin only today and stay that way, so they are not listed.
 */

export const submenuKeyFromPath = (path = '') =>
    String(path || '')
        .split('?')[0]
        .replace(/^\/admin\/food\/?/, '')
        .split('/')
        .filter(Boolean)
        .join('.');

const entry = (path, label) => ({ key: submenuKeyFromPath(path), label, path });
const P = (rest) => `/admin/food/${rest}`;

export const ADMIN_SUBMENU_CATALOG = Object.freeze({
    food_management: [
        entry(P('food-approval'), 'Food Approval'),
        entry(P('foods'), 'Restaurant Foods List'),
        entry(P('addons'), 'Restaurant Addons List'),
        entry(P('categories'), 'Categories'),
    ],
    restaurant_management: [
        entry(P('cuisines'), 'Cuisines'),
        entry(P('restaurants'), 'Restaurants List'),
        entry(P('restaurants/joining-request'), 'New Joining Request'),
        entry(P('restaurants/unregistered'), 'Unregistered Restaurants'),
        entry(P('restaurants/reviews'), 'Restaurant Reviews'),
        entry(P('restaurants/complaints'), 'Restaurant Complaints'),
        entry(P('restaurants/fssai'), 'FSSAI Compliance'),
        entry(P('restaurants/settings'), 'Restaurant Settings'),
        entry(P('restaurants/billing'), 'Billing Mode'),
        entry(P('restaurants/commission'), 'Restaurant Commission'),
        entry(P('restaurants/bulk-import'), 'Bulk Import'),
        entry(P('restaurants/bulk-export'), 'Bulk Export'),
        entry(P('restaurants/subscription-settings'), 'Subscription Settings'),
        entry(P('restaurants/subscription-history'), 'Subscription Billing'),
    ],
    order_management: [
        entry(P('orders/all'), 'All Orders'),
        entry(P('orders/pending'), 'Pending Orders'),
        entry(P('orders/processing'), 'Processing Orders'),
        entry(P('orders/food-on-the-way'), 'Food On The Way'),
        entry(P('orders/delivered'), 'Delivered Orders'),
        entry(P('orders/canceled'), 'Cancelled Orders'),
        entry(P('orders/restaurant-cancelled'), 'Restaurant Cancelled'),
        entry(P('orders/payment-failed'), 'Payment Failed'),
        entry(P('orders/refunded'), 'Refunded Orders'),
        entry(P('orders/offline-payments'), 'Offline Payments'),
        entry(P('orders/user-carts'), 'User Carts'),
        entry(P('order-refunds'), 'Refunds'),
        entry(P('order-detect-delivery'), 'Order Detect Delivery'),
        entry(P('dispatch/assign'), 'Assign Rider'),
        entry(P('dispatch/settings'), 'Dispatch Settings'),
    ],
    referral_rewards: [
        entry(P('referral-settings'), 'Referral Settings'),
        entry(P('referrals'), 'Referrals'),
    ],
    customer_management: [
        entry(P('customers'), 'Customers'),
        entry(P('chattings'), 'Live Chat'),
        entry(P('support-tickets'), 'Support Tickets (User & Restaurant)'),
    ],
    delivery_management: [
        entry(P('delivery-withdrawal'), 'Delivery Withdrawal'),
        entry(P('tip-management'), 'Tip Management'),
        entry(P('surge-pricing'), 'Surge Pricing'),
        entry(P('delivery-boy-wallet'), 'Delivery boy Wallet'),
        entry(P('delivery-emergency-help'), 'Delivery Emergency Help'),
        entry(P('delivery-support-tickets'), 'Delivery Support Tickets'),
        entry(P('delivery-order-reassignment-requests'), 'Order Reassignment Requests'),
        entry(P('delivery-partners/join-request'), 'New Join Request'),
        entry(P('delivery-partners'), 'Deliveryman List'),
        entry(P('delivery-partners/add'), 'Add Deliveryman'),
        entry(P('delivery-partners/cohorts'), 'Rider Cohorts'),
        entry(P('delivery-partners/live-tracking'), 'Live Tracking'),
        entry(P('delivery-partners/duty-log'), 'Duty Log'),
        entry(P('delivery-partners/reviews'), 'Deliveryman Reviews'),
        entry(P('delivery-partners/bonus'), 'Bonus'),
        entry(P('delivery-partners/earning-addon'), 'Earning Addon'),
        entry(P('delivery-partners/earning-addon-history'), 'Earning Addon History'),
        entry(P('delivery-partners/earnings'), 'Delivery Earning'),
    ],
    support_management: [
        entry(P('contact-messages'), 'User Feedback'),
        entry(P('safety-emergency-reports'), 'Safety Emergency Reports'),
    ],
    report_management: [
        entry(P('transaction-report'), 'Transaction Report'),
        entry(P('order-report/eod'), 'EOD Cumulative Report'),
        entry(P('transaction-report/online-payments'), 'Online Payments'),
        entry(P('customer-report/wallet'), 'Customer Wallet Report'),
        entry(P('order-report/regular'), 'Order Report'),
        entry(P('tax-report'), 'Tax Report'),
        entry(P('popular-items-report'), 'Popular Items & Analytics'),
        entry(P('cancellation-report'), 'Cancellation & Refunds'),
        entry(P('inventory-report'), 'Inventory & Stock'),
        entry(P('order-report/campaign'), 'Campaign Order Report'),
        entry(P('order-report/promo-usage'), 'Promo & Discount Usage'),
        entry(P('order-report/delivery-performance'), 'Delivery Performance'),
        entry(P('restaurant-report'), 'Restaurant Report'),
        entry(P('customer-report/feedback-experience'), 'Feedback Experience'),
    ],
    transaction_management: [
        entry(P('balance-sheet'), 'Balance Sheet'),
        entry(P('restaurant-withdraws'), 'Restaurant Withdraws'),
        entry(P('bank-change-requests'), 'Payout Account Changes'),
        entry(P('change-to-wallet'), 'Change to Wallet & UPI'),
    ],
    banner_management: [
        entry(P('offer-banners'), 'Offer Banners'),
        entry(P('hero-banner-management'), 'Landing Page Management'),
        entry(P('promotional-banner'), 'Promotional Banners'),
    ],
    system_settings: [
        entry(P('price-management'), 'Price Management'),
        entry(P('zone-setup'), 'Zone Setup'),
        entry(P('cod-payments'), 'COD & User Payments'),
        entry(P('fee-settings'), 'Delivery & Platform Fee'),
        entry(P('broadcast-notification'), 'Broadcast Notification'),
        entry(P('business-setup'), 'Business Setup'),
        entry(P('order-pause'), 'Pause Orders'),
        entry(P('feature-settings'), 'Feature Settings'),
        entry(P('power-scanning'), 'Power Scanning'),
    ],
    pages_social_media: [
        entry(P('pages-social-media/react-registration'), 'Registration Page'),
        entry(P('pages-social-media/about'), 'About Us'),
        entry(P('pages-social-media/terms'), 'Terms & Conditions'),
        entry(P('pages-social-media/privacy'), 'Privacy Policy'),
        entry(P('pages-social-media/support'), 'Support'),
        entry(P('pages-social-media/refund'), 'Refund Policy'),
        entry(P('pages-social-media/shipping'), 'Shipping Policy'),
        entry(P('pages-social-media/cancellation'), 'Cancellation Policy'),
    ],
});

/** section -> Set of its submenu keys. */
export const ADMIN_SUBMENU_KEYS = Object.freeze(
    Object.fromEntries(
        Object.entries(ADMIN_SUBMENU_CATALOG).map(([section, items]) => [section, new Set(items.map((it) => it.key))])
    )
);

/**
 * Admin API paths (relative to /food/admin) that belong to exactly one
 * submenu. Only these are enforced at submenu level; every other admin API is
 * shared by several screens (GET /orders without a status, /delivery/partners,
 * /customers, /zones, /business-settings, /foods, ...) and stays enforced at
 * section level, because denying one submenu must not break its siblings.
 *
 * `methods` limits a rule to those HTTP methods (a GET shared with other
 * screens, writes only made from this one).
 */
const rule = (prefix, section, path, methods) => ({ prefix, section, key: submenuKeyFromPath(P(path)), methods });

export const ADMIN_SUBMENU_API_RULES = Object.freeze([
    // Reports: one endpoint per report screen.
    rule('/reports/transactions', 'report_management', 'transaction-report'),
    rule('/reports/online-payments', 'report_management', 'transaction-report/online-payments'),
    rule('/reports/eod', 'report_management', 'order-report/eod'),
    rule('/reports/customer-wallet', 'report_management', 'customer-report/wallet'),
    rule('/reports/tax', 'report_management', 'tax-report'),
    rule('/reports/popular-items', 'report_management', 'popular-items-report'),
    rule('/reports/cancellations', 'report_management', 'cancellation-report'),
    rule('/reports/inventory', 'report_management', 'inventory-report'),
    rule('/reports/coupon-orders', 'report_management', 'order-report/campaign'),
    rule('/reports/promo-usage', 'report_management', 'order-report/promo-usage'),
    rule('/reports/delivery-performance', 'report_management', 'order-report/delivery-performance'),
    rule('/reports/restaurants', 'report_management', 'restaurant-report'),
    rule('/feedback-experiences', 'report_management', 'customer-report/feedback-experience'),

    // Orders (the status-filtered list is resolved separately below).
    rule('/orders/user-carts', 'order_management', 'orders/user-carts'),
    rule('/order-refunds', 'order_management', 'order-refunds'),
    rule('/dispatch/settings', 'order_management', 'dispatch/settings'),
    rule('/dispatch/queue', 'order_management', 'dispatch/assign'),

    // Restaurants.
    rule('/cuisines', 'restaurant_management', 'cuisines', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/restaurants/complaints', 'restaurant_management', 'restaurants/complaints'),
    rule('/restaurants/reviews', 'restaurant_management', 'restaurants/reviews'),
    // GET is shared with Add Restaurant (prefill from an unregistered lead).
    rule('/restaurants/unregistered', 'restaurant_management', 'restaurants/unregistered', ['DELETE']),
    rule('/restaurants/pending', 'restaurant_management', 'restaurants/joining-request'),
    rule('/restaurants/fssai-compliance', 'restaurant_management', 'restaurants/fssai'),
    rule('/restaurants/bulk-import', 'restaurant_management', 'restaurants/bulk-import'),
    rule('/restaurant-settings', 'restaurant_management', 'restaurants/settings'),
    rule('/restaurant-commissions', 'restaurant_management', 'restaurants/commission'),
    rule('/commission-overview', 'restaurant_management', 'restaurants/billing'),
    rule('/restaurant-subscription-settings', 'restaurant_management', 'restaurants/subscription-settings', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/restaurant-subscriptions', 'restaurant_management', 'restaurants/subscription-history'),

    // Delivery.
    rule('/delivery/join-requests', 'delivery_management', 'delivery-partners/join-request'),
    // GET is shared with Add Deliveryman and the Deliveryman List (cohort pickers).
    rule('/delivery/cohorts', 'delivery_management', 'delivery-partners/cohorts', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/delivery/reviews', 'delivery_management', 'delivery-partners/reviews'),
    rule('/delivery/bonus', 'delivery_management', 'delivery-partners/bonus'),
    rule('/delivery/bonus-transactions', 'delivery_management', 'delivery-partners/bonus'),
    rule('/delivery/earning-addon-history', 'delivery_management', 'delivery-partners/earning-addon-history'),
    rule('/delivery/earning-addons', 'delivery_management', 'delivery-partners/earning-addon'),
    rule('/delivery/earnings', 'delivery_management', 'delivery-partners/earnings'),
    rule('/delivery/withdrawals', 'delivery_management', 'delivery-withdrawal'),
    rule('/delivery/support-tickets', 'delivery_management', 'delivery-support-tickets'),
    rule('/delivery/order-emergency-requests', 'delivery_management', 'delivery-order-reassignment-requests'),
    rule('/tip-settings', 'delivery_management', 'tip-management'),
    rule('/tips', 'delivery_management', 'tip-management'),
    rule('/surge-rules', 'delivery_management', 'surge-pricing'),

    // Customers, support, referrals, money, banners, settings.
    rule('/support-tickets', 'customer_management', 'support-tickets'),
    rule('/contact-messages', 'support_management', 'contact-messages'),
    rule('/safety-emergency-reports', 'support_management', 'safety-emergency-reports'),
    rule('/referral-settings', 'referral_rewards', 'referral-settings', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/referrals', 'referral_rewards', 'referrals'),
    rule('/bank-changes', 'transaction_management', 'bank-change-requests'),
    rule('/offer-banners', 'banner_management', 'offer-banners', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/price-rules', 'system_settings', 'price-management', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/zones', 'system_settings', 'zone-setup', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/cod-settings', 'system_settings', 'cod-payments', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/fee-settings', 'system_settings', 'fee-settings', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/notifications/broadcast', 'system_settings', 'broadcast-notification'),
    rule('/feature-settings', 'system_settings', 'feature-settings', ['POST', 'PUT', 'PATCH', 'DELETE']),
    rule('/power-scanning', 'system_settings', 'power-scanning', ['POST', 'PUT', 'PATCH', 'DELETE']),
]);

/** GET /orders?status=... -> the Orders submenu that lists that status. */
const ORDER_STATUS_SUBMENU = {
    pending: 'orders.pending',
    processing: 'orders.processing',
    'food-on-the-way': 'orders.food-on-the-way',
    delivered: 'orders.delivered',
    canceled: 'orders.canceled',
    cancelled: 'orders.canceled',
    'payment-failed': 'orders.payment-failed',
    refunded: 'orders.refunded',
    'offline-payments': 'orders.offline-payments',
};

const matchesPrefix = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The submenu an admin API request belongs to, or null when the API is shared
 * by several submenus (then only the section-level guard applies).
 */
export const resolveSubmenuFromRequest = (path = '', method = 'GET', query = {}) => {
    const p = String(path || '');
    const m = String(method || 'GET').toUpperCase();

    if (p === '/orders' && m === 'GET') {
        const status = String(query?.status || '').trim().toLowerCase();
        if (!status) return null; // All orders, order report, detect delivery, dashboard.
        const cancelledBy = String(query?.cancelledBy || '').trim().toLowerCase();
        const key = (status === 'cancelled' || status === 'canceled') && cancelledBy === 'restaurant'
            ? 'orders.restaurant-cancelled'
            : ORDER_STATUS_SUBMENU[status];
        return key ? { section: 'order_management', key } : null;
    }

    for (const r of ADMIN_SUBMENU_API_RULES) {
        if (!matchesPrefix(p, r.prefix)) continue;
        if (r.methods && !r.methods.includes(m)) return null;
        if (p.endsWith('/public')) return null;
        return { section: r.section, key: r.key };
    }
    return null;
};
