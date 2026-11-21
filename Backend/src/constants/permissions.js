import { ADMIN_SUBMENU_CATALOG, ADMIN_SUBMENU_KEYS } from './adminPermissionCatalog.js';

export { ADMIN_SUBMENU_CATALOG };

export const ADMIN_ACTIONS = ['view', 'create', 'edit', 'delete', 'export'];

export const ADMIN_PERMISSION_SECTIONS = [
    'dashboard',
    'point_of_sale',
    'food_management',
    'restaurant_management',
    'order_management',
    'promotions_management',
    'referral_rewards',
    'customer_management',
    'delivery_management',
    'support_management',
    'report_management',
    'transaction_management',
    'banner_management',
    'pages_social_media',
    // Both of these were already used by guards -- resolveSectionFromRequest
    // returns them and requireAdminPermission('sub_admin_management') gates
    // /sub-admins -- but neither was listed here. sanitizeAdminPermissions
    // drops every key it does not recognise, so they could never be granted and
    // those pages 403'd for every sub-admin no matter what the role editor was
    // set to.
    'system_settings',
];

/**
 * Sub-admin management is deliberately NOT grantable.
 *
 * Every one of its controllers calls ensureSuperAdmin, because a sub-admin who
 * can edit sub-admins can grant themselves every other permission -- the
 * section is a privilege-escalation path, not an ordinary one. It stays in the
 * route guard below so the intent is written down, but listing it above would
 * put a checkbox in the role editor that can never do anything, which is the
 * problem this list was fixed to stop having.
 */
export const SUPER_ADMIN_ONLY_SECTIONS = ['sub_admin_management'];

export const ADMIN_FULL_PERMISSIONS = Object.freeze(
    Object.fromEntries(
        ADMIN_PERMISSION_SECTIONS.map((section) => [section, [...ADMIN_ACTIONS]])
    )
);

const actionPriority = new Set(ADMIN_ACTIONS);
const sectionPriority = new Set(ADMIN_PERMISSION_SECTIONS);

const cleanActions = (list) =>
    [...new Set((Array.isArray(list) ? list : []).map((it) => String(it).trim().toLowerCase()))]
        .filter((it) => actionPriority.has(it));

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Stored shape (FoodAdmin.permissions, a Json column):
 *
 *   {
 *     order_management: ['view', 'edit'],        // section level, as before
 *     ...every section...,
 *     submenus: {                                 // optional, only when used
 *       order_management: { 'orders.pending': ['view'], 'orders.all': [] },
 *     },
 *   }
 *
 * A submenu with an explicit entry gets exactly those actions; one without an
 * entry inherits its section. A role saved before submenus existed has no
 * `submenus` key and keeps exactly the access it had.
 *
 * Invariant kept here: a section's actions always include every action any of
 * its submenus grants. A role that grants "Pending orders: view" while the
 * section row is unticked is stored as section ['view'] plus an explicit
 * entry -- the old section actions -- for every sibling that was inheriting,
 * so no sibling gains anything. That keeps every existing section-level guard
 * (requireAdminPermission, the sidebar, axios pre-checks) correct without
 * knowing about submenus: a submenu can only ever narrow its section.
 */
export const sanitizeAdminPermissions = (raw = {}) => {
    const normalized = {};

    for (const section of ADMIN_PERMISSION_SECTIONS) {
        normalized[section] = cleanActions(raw?.[section]);
    }

    const rawSubmenus = isPlainObject(raw?.submenus) ? raw.submenus : {};
    const submenus = {};
    for (const [section, keys] of Object.entries(ADMIN_SUBMENU_KEYS)) {
        if (!sectionPriority.has(section)) continue;
        const rawSection = isPlainObject(rawSubmenus[section]) ? rawSubmenus[section] : {};
        const explicit = {};
        for (const key of keys) {
            // Only an array is an override; null/undefined/anything else means "inherit".
            if (Array.isArray(rawSection[key])) explicit[key] = cleanActions(rawSection[key]);
        }
        if (!Object.keys(explicit).length) continue;

        const sectionActions = normalized[section];
        const granted = new Set(Object.values(explicit).flat());
        const missing = ADMIN_ACTIONS.filter((a) => granted.has(a) && !sectionActions.includes(a));
        if (missing.length) {
            for (const key of keys) {
                if (!explicit[key]) explicit[key] = [...sectionActions];
            }
            normalized[section] = [...sectionActions, ...missing];
        }
        // Catalogue order, so the stored JSON is stable.
        submenus[section] = Object.fromEntries([...keys].filter((k) => explicit[k]).map((k) => [k, explicit[k]]));
    }
    if (Object.keys(submenus).length) normalized.submenus = submenus;

    return normalized;
};

/**
 * Effective access. With a submenu key: the section must allow the action and
 * the submenu must not be explicitly narrowed below it. Super admin is handled
 * by the callers.
 */
export const hasAdminPermission = (permissions, section, action = 'view', submenuKey = null) => {
    const sectionActions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
    if (!sectionActions.includes(action)) return false;
    if (!submenuKey) return true;
    return isSubmenuActionAllowed(permissions, section, submenuKey, action);
};

/** False only when the submenu has an explicit entry that leaves the action out. */
export const isSubmenuActionAllowed = (permissions, section, submenuKey, action = 'view') => {
    const explicit = permissions?.submenus?.[section]?.[submenuKey];
    return Array.isArray(explicit) ? explicit.includes(action) : true;
};

export const isValidPermissionPayload = (payload = {}) => {
    if (!isPlainObject(payload)) return false;

    for (const [section, actions] of Object.entries(payload)) {
        if (section === 'submenus') {
            // Unknown sections/submenu keys are stripped by the sanitiser (a stale
            // role screen after a sidebar change must still save); only a broken
            // shape or an unknown action is refused.
            if (!isPlainObject(actions)) return false;
            for (const entries of Object.values(actions)) {
                if (!isPlainObject(entries)) return false;
                for (const list of Object.values(entries)) {
                    if (list === null) continue;
                    if (!Array.isArray(list)) return false;
                    if (list.some((action) => !actionPriority.has(String(action).trim().toLowerCase()))) return false;
                }
            }
            continue;
        }
        if (!sectionPriority.has(section)) return false;
        if (!Array.isArray(actions)) return false;
        if (actions.some((action) => !actionPriority.has(String(action).trim().toLowerCase()))) return false;
    }

    return true;
};
