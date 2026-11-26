import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    ADMIN_PERMISSION_SECTIONS,
    hasAdminPermission,
    isSubmenuActionAllowed,
    isValidPermissionPayload,
    sanitizeAdminPermissions,
} from './permissions.js';
import {
    ADMIN_SUBMENU_API_RULES,
    ADMIN_SUBMENU_CATALOG,
    ADMIN_SUBMENU_KEYS,
    resolveSubmenuFromRequest,
    submenuKeyFromPath,
} from './adminPermissionCatalog.js';

/**
 * Submenu-level sub-admin permissions (client item 35). Pure: no database.
 */

const none = Object.fromEntries(ADMIN_PERMISSION_SECTIONS.map((s) => [s, []]));

test('a role saved before submenus existed sanitises to exactly what it was', () => {
    const legacy = { order_management: ['view', 'edit'], report_management: ['view'] };
    const out = sanitizeAdminPermissions(legacy);
    assert.deepEqual(out, { ...none, ...legacy });
    assert.equal('submenus' in out, false, 'no submenus key is invented');
    for (const key of ADMIN_SUBMENU_KEYS.order_management) {
        assert.equal(hasAdminPermission(out, 'order_management', 'view', key), true, `${key} inherits`);
        assert.equal(hasAdminPermission(out, 'order_management', 'delete', key), false, `${key} inherits`);
    }
});

test('an explicit submenu entry narrows its section; the rest inherit', () => {
    const out = sanitizeAdminPermissions({
        report_management: ['view', 'export'],
        submenus: { report_management: { 'order-report.eod': [] , 'tax-report': ['view'] } },
    });
    assert.deepEqual(out.report_management, ['view', 'export']);
    assert.deepEqual(out.submenus, { report_management: { 'order-report.eod': [], 'tax-report': ['view'] } });
    assert.equal(hasAdminPermission(out, 'report_management', 'view', 'order-report.eod'), false);
    assert.equal(hasAdminPermission(out, 'report_management', 'view', 'tax-report'), true);
    assert.equal(hasAdminPermission(out, 'report_management', 'export', 'tax-report'), false);
    assert.equal(hasAdminPermission(out, 'report_management', 'export', 'transaction-report'), true, 'inherits');
    assert.equal(hasAdminPermission(out, 'report_management', 'view'), true, 'section-level checks unchanged');
});

test('granting a submenu beyond its section lifts the section without widening any sibling', () => {
    const out = sanitizeAdminPermissions({
        order_management: [],
        submenus: { order_management: { 'orders.pending': ['view', 'edit'] } },
    });
    assert.deepEqual(out.order_management, ['view', 'edit'], 'section carries every action a submenu grants');
    assert.deepEqual(out.submenus.order_management['orders.pending'], ['view', 'edit']);
    for (const key of ADMIN_SUBMENU_KEYS.order_management) {
        if (key === 'orders.pending') continue;
        assert.deepEqual(out.submenus.order_management[key], [], `${key} pinned to the old section actions`);
        assert.equal(hasAdminPermission(out, 'order_management', 'view', key), false, key);
    }
    assert.equal(hasAdminPermission(out, 'order_management', 'view', 'orders.pending'), true);
});

test('sanitising is idempotent (login and /me re-sanitise what was stored)', () => {
    const once = sanitizeAdminPermissions({
        delivery_management: ['view'],
        submenus: { delivery_management: { 'delivery-partners.bonus': ['view', 'create'], 'tip-management': [] } },
    });
    assert.deepEqual(sanitizeAdminPermissions(once), once);
});

test('unknown sections, submenu keys and actions are stripped', () => {
    const out = sanitizeAdminPermissions({
        order_management: ['view', 'launch'],
        bogus: ['view'],
        submenus: {
            bogus: { x: ['view'] },
            sub_admin_management: { employees: ['view'] },
            order_management: { 'orders.nope': ['view'], 'orders.all': ['VIEW', 'fly'], 'orders.pending': null },
        },
    });
    assert.deepEqual(out.order_management, ['view']);
    assert.equal('bogus' in out, false);
    assert.deepEqual(out.submenus, { order_management: { 'orders.all': ['view'] } }, 'null means inherit');
});

test('the payload validator accepts submenus but refuses broken shapes', () => {
    assert.equal(isValidPermissionPayload({ order_management: ['view'], submenus: { order_management: { 'orders.all': ['view'] } } }), true);
    assert.equal(isValidPermissionPayload({ submenus: { order_management: { 'orders.all': null } } }), true);
    assert.equal(isValidPermissionPayload({ submenus: [] }), false);
    assert.equal(isValidPermissionPayload({ submenus: { order_management: ['view'] } }), false);
    assert.equal(isValidPermissionPayload({ submenus: { order_management: { 'orders.all': 'view' } } }), false);
    assert.equal(isValidPermissionPayload({ submenus: { order_management: { 'orders.all': ['launch'] } } }), false);
    assert.equal(isValidPermissionPayload({ nonsense: ['view'] }), false, 'top level stays strict');
});

test('isSubmenuActionAllowed only ever refuses on an explicit entry', () => {
    const perms = { order_management: [], submenus: { order_management: { 'orders.user-carts': [] } } };
    assert.equal(isSubmenuActionAllowed(perms, 'order_management', 'orders.user-carts', 'view'), false);
    assert.equal(isSubmenuActionAllowed(perms, 'order_management', 'orders.pending', 'view'), true);
    assert.equal(isSubmenuActionAllowed({}, 'order_management', 'orders.pending', 'view'), true);
});

test('submenu keys are path-derived and unique', () => {
    assert.equal(submenuKeyFromPath('/admin/food/orders/pending'), 'orders.pending');
    assert.equal(submenuKeyFromPath('/admin/food/order-report/eod?x=1'), 'order-report.eod');
    const all = Object.values(ADMIN_SUBMENU_CATALOG).flat().map((it) => it.key);
    assert.equal(new Set(all).size, all.length);
    for (const [section, items] of Object.entries(ADMIN_SUBMENU_CATALOG)) {
        assert.ok(ADMIN_PERMISSION_SECTIONS.includes(section), section);
        for (const it of items) assert.equal(it.key, submenuKeyFromPath(it.path));
    }
});

test('every API rule points at a catalogued submenu of its section', () => {
    for (const r of ADMIN_SUBMENU_API_RULES) {
        assert.ok(ADMIN_SUBMENU_KEYS[r.section]?.has(r.key), `${r.prefix} -> ${r.section}/${r.key}`);
    }
});

test('API paths resolve to submenus only where one screen owns them', () => {
    const at = (p, m = 'GET', q = {}) => resolveSubmenuFromRequest(p, m, q)?.key ?? null;
    assert.equal(at('/reports/eod'), 'order-report.eod');
    assert.equal(at('/reports/tax/abc'), 'tax-report');
    assert.equal(at('/reports/taxes'), null, 'prefix matches whole segments only');
    assert.equal(at('/orders', 'GET', { status: 'pending' }), 'orders.pending');
    assert.equal(at('/orders', 'GET', { status: 'cancelled', cancelledBy: 'restaurant' }), 'orders.restaurant-cancelled');
    assert.equal(at('/orders', 'GET', { status: 'canceled' }), 'orders.canceled');
    assert.equal(at('/orders', 'GET', {}), null, 'all orders is shared with reports and the dashboard');
    assert.equal(at('/orders/abc/accept', 'PATCH'), null, 'order actions are shared by every orders list');
    assert.equal(at('/orders/user-carts'), 'orders.user-carts');
    assert.equal(at('/delivery/cohorts'), null, 'retired cohort list');
    assert.equal(at('/delivery/cohorts', 'POST'), 'delivery-partners');
    assert.equal(at('/delivery/partners'), null);
    assert.equal(at('/delivery/earning-addon-history'), 'delivery-partners.earning-addon-history');
    assert.equal(at('/delivery/earning-addons/1', 'PATCH'), 'delivery-partners.earning-addon');
    assert.equal(at('/fee-settings/public'), null);
    assert.equal(at('/zones'), null);
    assert.equal(at('/zones/1', 'PATCH'), 'zone-setup');
});

/**
 * The catalogue is hand-kept next to the sidebar; this keeps them in step.
 * Skipped when the Frontend is not checked out next to the Backend.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const utilsDir = path.resolve(here, '../../../Frontend/src/modules/Food/utils');
const haveFrontend = fs.existsSync(path.join(utilsDir, 'adminSidebarMenu.js'));

test('the catalogue matches the admin sidebar', { skip: !haveFrontend && 'Frontend not present' }, async () => {
    const { adminSidebarMenu } = await import(pathToFileURL(path.join(utilsDir, 'adminSidebarMenu.js')).href);
    const rbac = fs.readFileSync(path.join(utilsDir, 'adminRbac.js'), 'utf8');
    const prefixes = [...rbac.matchAll(/\{ prefix: "([^"]+)", section: "([^"]+)" \}/g)].map((m) => ({ prefix: m[1], section: m[2] }));
    assert.ok(prefixes.length > 20, 'read the frontend path -> section map');
    const sectionOf = (p) => (p === '/admin/food' ? 'dashboard' : prefixes.find((x) => p.startsWith(x.prefix))?.section || null);

    const leaves = [];
    const walk = (items) => {
        for (const it of items || []) {
            if (it.path) leaves.push(it.path);
            walk(it.items);
            walk(it.subItems);
        }
    };
    walk(adminSidebarMenu);

    const bySection = {};
    for (const p of leaves) {
        const s = sectionOf(p);
        if (s) (bySection[s] ||= []).push(submenuKeyFromPath(p));
    }

    for (const [section, keys] of Object.entries(bySection)) {
        if (!ADMIN_SUBMENU_CATALOG[section]) {
            assert.ok(keys.length <= 1, `${section} has ${keys.length} sidebar pages but no submenus catalogued`);
            continue;
        }
        for (const key of keys) {
            assert.ok(ADMIN_SUBMENU_KEYS[section].has(key), `sidebar page ${key} (${section}) missing from the catalogue`);
        }
    }
    for (const [section, items] of Object.entries(ADMIN_SUBMENU_CATALOG)) {
        for (const it of items) {
            assert.ok(leaves.includes(it.path), `catalogued ${it.key} is not in the sidebar`);
            assert.equal(sectionOf(it.path), section, `${it.key} belongs to ${sectionOf(it.path)} on the frontend`);
        }
    }
});
