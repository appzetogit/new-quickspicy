import { getCurrentUser } from "@food/utils/auth";
import { adminSidebarMenu } from "@food/utils/adminSidebarMenu";

export const ADMIN_ACTIONS = ["view", "create", "edit", "delete", "export"];

export const ADMIN_PERMISSION_SECTIONS = [
  "dashboard",
  "point_of_sale",
  "food_management",
  "restaurant_management",
  "order_management",
  "promotions_management",
  "referral_rewards",
  "customer_management",
  "delivery_management",
  "support_management",
  "report_management",
  "transaction_management",
  "banner_management",
  "pages_social_media",
  // Kept in step with the backend list in src/constants/permissions.js. Both of
  // these are referenced by PATH_PREFIX_TO_SECTION below and by backend guards,
  // but were missing from every section list -- so they could never be granted
  // and their pages were invisible to every sub-admin.
  "system_settings",
  // sub_admin_management is deliberately absent: every one of its endpoints
  // is super-admin only, because a sub-admin who can edit sub-admins can
  // grant themselves everything else. Listing it here would put a checkbox in
  // the role editor that can never do anything.
];

/** Labels for the role editor; the raw keys are not what an admin should read. */
export const ADMIN_SECTION_LABELS = {
  dashboard: "Dashboard",
  point_of_sale: "Point of Sale",
  food_management: "Food Management",
  restaurant_management: "Restaurant Management",
  order_management: "Order Management",
  promotions_management: "Promotions",
  referral_rewards: "Referral & Rewards",
  customer_management: "Customer Management",
  delivery_management: "Delivery Management",
  support_management: "Support Management",
  report_management: "Reports",
  transaction_management: "Transactions",
  banner_management: "Banner Management",
  pages_social_media: "Pages & Social Media",
  system_settings: "System Settings",
  sub_admin_management: "Sub-Admin Management",
};

export const adminSectionLabel = (key) =>
  ADMIN_SECTION_LABELS[key] ||
  String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

const PATH_PREFIX_TO_SECTION = [
  // The screen reads /cod-settings, which the API guards with system_settings.
  // Mapping it anywhere else would show a sub-admin a link that 401s on open.
  { prefix: "/admin/food/cod-payments", section: "system_settings" },
  { prefix: "/admin/food/offer-banners", section: "banner_management" },
  { prefix: "/admin/food/tip-management", section: "delivery_management" },
  { prefix: "/admin/food/surge-pricing", section: "delivery_management" },
  { prefix: "/admin/food/point-of-sale", section: "point_of_sale" },
  // The API guards every /fee-settings call with system_settings; mapped to
  // delivery it showed sub-admins a page that failed on load.
  { prefix: "/admin/food/fee-settings", section: "system_settings" },
  { prefix: "/admin/food/delivery-cash-limit", section: "delivery_management" },
  { prefix: "/admin/food/cash-limit-settlement", section: "delivery_management" },
  { prefix: "/admin/food/delivery-withdrawal", section: "delivery_management" },
  { prefix: "/admin/food/delivery-boy-wallet", section: "delivery_management" },
  { prefix: "/admin/food/delivery-emergency-help", section: "delivery_management" },
  { prefix: "/admin/food/delivery-support-tickets", section: "delivery_management" },
  { prefix: "/admin/food/delivery-order-reassignment-requests", section: "delivery_management" },
  { prefix: "/admin/food/food-approval", section: "food_management" },
  { prefix: "/admin/food/foods", section: "food_management" },
  // Price rules change what every customer pays, so they are a system
  // setting rather than everyday food work. Same for zones below.
  { prefix: "/admin/food/price-management", section: "system_settings" },
  { prefix: "/admin/food/dispatch", section: "order_management" },
  { prefix: "/admin/food/addons", section: "food_management" },
  { prefix: "/admin/food/categories", section: "food_management" },
  { prefix: "/admin/food/zone-setup", section: "system_settings" },

  { prefix: "/admin/food/cuisines", section: "restaurant_management" },
  { prefix: "/admin/food/restaurants", section: "restaurant_management" },
  { prefix: "/admin/food/orders", section: "order_management" },
  { prefix: "/admin/food/order-detect-delivery", section: "order_management" },
  { prefix: "/admin/food/order-refunds", section: "order_management" },
  // The API guards payout account changes with transaction_management.
  { prefix: "/admin/food/bank-change-requests", section: "transaction_management" },
  { prefix: "/admin/food/change-to-wallet", section: "transaction_management" },
  { prefix: "/admin/food/coupons", section: "promotions_management" },
  { prefix: "/admin/food/referral-settings", section: "referral_rewards" },
  { prefix: "/admin/food/referrals", section: "referral_rewards" },
  { prefix: "/admin/food/customers", section: "customer_management" },
  { prefix: "/admin/food/support-tickets", section: "customer_management" },
  // Live chat rides on the same section as the rest of support. It is not
  // under /food/admin, so it needs saying explicitly.
  { prefix: "/admin/food/chattings", section: "customer_management" },
  { prefix: "/admin/food/delivery", section: "delivery_management" },
  { prefix: "/admin/food/delivery-partners", section: "delivery_management" },
  { prefix: "/admin/food/contact-messages", section: "support_management" },
  { prefix: "/admin/food/safety-emergency-reports", section: "support_management" },
  { prefix: "/admin/food/transaction-report", section: "report_management" },
  { prefix: "/admin/food/order-report", section: "report_management" },
  { prefix: "/admin/food/tax-report", section: "report_management" },
  { prefix: "/admin/food/popular-items-report", section: "report_management" },
  { prefix: "/admin/food/cancellation-report", section: "report_management" },
  { prefix: "/admin/food/inventory-report", section: "report_management" },
  { prefix: "/admin/food/restaurant-report", section: "report_management" },
  { prefix: "/admin/food/customer-report", section: "report_management" },
  { prefix: "/admin/food/restaurant-withdraws", section: "transaction_management" },
  { prefix: "/admin/food/balance-sheet", section: "transaction_management" },
  { prefix: "/admin/food/hero-banner-management", section: "banner_management" },
  { prefix: "/admin/food/promotional-banner", section: "banner_management" },
  { prefix: "/admin/food/feature-settings", section: "system_settings" },
  { prefix: "/admin/food/power-scanning", section: "system_settings" },
  { prefix: "/admin/food/business-setup", section: "system_settings" },
  { prefix: "/admin/food/order-pause", section: "system_settings" },
  { prefix: "/admin/food/broadcast-notification", section: "system_settings" },
  { prefix: "/admin/food/pages-social-media", section: "pages_social_media" },
  { prefix: "/admin/food/employees", section: "sub_admin_management" },
  { prefix: "/admin/food/employee-role", section: "sub_admin_management" },
];

const ALWAYS_ALLOWED_FOR_SUB_ADMIN = new Set([
  "/admin/food/profile",
  "/admin/food/settings",
]);

export function isSuperAdmin(adminUser) {
  const type = String(adminUser?.adminType || "").trim().toLowerCase();
  return type === "super_admin";
}

export function getAdminPermissions(adminUser) {
  return adminUser?.effectivePermissions || adminUser?.permissions || {};
}

/**
 * Submenu-level permissions. Every sidebar leaf is a submenu whose key is its
 * path below /admin/food with "/" as "." ("/admin/food/orders/pending" is
 * "orders.pending") -- the same rule as submenuKeyFromPath in the backend
 * catalogue (Backend/src/constants/adminPermissionCatalog.js), which lists the
 * keys the role editor offers and the API enforces.
 *
 * permissions.submenus[section][key] = [actions] is an explicit entry and
 * wins; a submenu without one inherits its section. The backend keeps every
 * section's actions a superset of its submenus', so a submenu can only narrow.
 */
export const submenuKeyFromPath = (path = "") =>
  String(path || "")
    .split("?")[0]
    .replace(/^\/admin\/food\/?/, "")
    .split("/")
    .filter(Boolean)
    .join(".");

/** Sidebar leaves in menu order. */
const SIDEBAR_LEAVES_IN_ORDER = (() => {
  const paths = [];
  const walk = (items) => {
    for (const item of items || []) {
      // The dashboard is "/admin/food", a prefix of every page.
      if (item?.path && item.path !== "/admin/food") paths.push(item.path);
      walk(item?.items);
      walk(item?.subItems);
    }
  };
  walk(adminSidebarMenu);
  return [...new Set(paths)];
})();

// Longest first, so /restaurants/reviews wins over /restaurants.
const SIDEBAR_LEAF_PATHS = [...SIDEBAR_LEAVES_IN_ORDER].sort((a, b) => b.length - a.length);

/** The sidebar submenu a page belongs to (its detail/add pages included), or null. */
export function resolvePermissionSubmenuByPath(pathname = "") {
  const clean = String(pathname || "").split("?")[0].replace(/\/+$/, "");
  const leaf = SIDEBAR_LEAF_PATHS.find((p) => clean === p || clean.startsWith(`${p}/`));
  if (!leaf) return null;
  const section = resolvePermissionSectionByPath(leaf);
  if (!section) return null;
  return { section, key: submenuKeyFromPath(leaf), path: leaf };
}

export function canAdminAccess(adminUser, section, action = "view", submenuKey = null) {
  if (!section) return true;
  if (isSuperAdmin(adminUser)) return true;
  const permissions = getAdminPermissions(adminUser);
  const actions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
  if (!actions.includes(action)) return false;
  if (!submenuKey) return true;
  const explicit = permissions?.submenus?.[section]?.[submenuKey];
  return Array.isArray(explicit) ? explicit.includes(action) : true;
}

/** Section and, where the page is a sidebar submenu, the submenu too. */
export function canAdminAccessPath(adminUser, pathname = "", action = "view") {
  const section = resolvePermissionSectionByPath(pathname);
  if (!section) return true;
  if (!canAdminAccess(adminUser, section, action)) return false;
  const submenu = resolvePermissionSubmenuByPath(pathname);
  if (!submenu) return true;
  return canAdminAccess(adminUser, submenu.section, action, submenu.key);
}

export function resolvePermissionSectionByPath(pathname = "") {
  if (pathname === "/admin/food" || pathname === "/admin/food/") return "dashboard";
  const match = PATH_PREFIX_TO_SECTION.find((item) => pathname.startsWith(item.prefix));
  return match?.section || null;
}

export function canAccessAdminPath(pathname, action = "view") {
  const adminUser = getCurrentUser("admin");
  const section = resolvePermissionSectionByPath(pathname);
  if (!section) {
    if (isSuperAdmin(adminUser)) return true;
    const normalized = String(pathname || "").replace(/\/+$/, "") || "/";
    return ALWAYS_ALLOWED_FOR_SUB_ADMIN.has(normalized);
  }
  return canAdminAccessPath(adminUser, pathname, action);
}

export function canCurrentAdminAction(action = "view", pathname = "") {
  const adminUser = getCurrentUser("admin");
  const currentPath =
    pathname || (typeof window !== "undefined" ? window.location.pathname : "");
  const section = resolvePermissionSectionByPath(currentPath);
  if (!section) {
    return isSuperAdmin(adminUser);
  }
  return canAdminAccessPath(adminUser, currentPath, action);
}

export function findFirstAllowedAdminPath(adminUser) {
  const sectionHomePath = {
    dashboard: "/admin/food",
    point_of_sale: "/admin/food/point-of-sale",
    food_management: "/admin/food/food-approval",
    restaurant_management: "/admin/food/restaurants",
    order_management: "/admin/food/orders/all",
    promotions_management: "/admin/food/coupons",
    referral_rewards: "/admin/food/referral-settings",
    customer_management: "/admin/food/customers",
    delivery_management: "/admin/food/delivery-partners",
    support_management: "/admin/food/contact-messages",
    report_management: "/admin/food/transaction-report",
    transaction_management: "/admin/food/restaurant-withdraws",
    banner_management: "/admin/food/hero-banner-management",
    pages_social_media: "/admin/food/pages-social-media/about",
    system_settings: "/admin/food/business-setup",
    sub_admin_management: "/admin/food/employees",
  };

  if (isSuperAdmin(adminUser)) {
    return "/admin/food";
  }

  for (const section of ADMIN_PERMISSION_SECTIONS) {
    if (canAdminAccess(adminUser, section, "view")) {
      const home = sectionHomePath[section];
      if (home && canAdminAccessPath(adminUser, home, "view")) return home;
      // The section's usual landing page may be a restricted submenu: take
      // the first of its sidebar pages this role can open instead.
      const fallback = SIDEBAR_LEAVES_IN_ORDER.find((p) => resolvePermissionSectionByPath(p) === section && canAdminAccessPath(adminUser, p, "view"));
      if (fallback) return fallback;
    }
  }

  return "/admin/food/profile";
}
