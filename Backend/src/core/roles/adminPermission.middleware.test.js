import test from 'node:test';
import assert from 'node:assert/strict';

import { requireAdminPermission, requireAdminSubmenuAccess } from './adminPermission.middleware.js';
import { sanitizeAdminPermissions } from '../../constants/permissions.js';

/**
 * The guards read req.adminAccess when it is already set (the admin router
 * sets it once per request), so these run without a database row.
 */
const run = async (guard, admin) => {
    const req = { user: { userId: 'x', role: 'ADMIN' }, adminAccess: { isActive: true, isDeleted: false, ...admin } };
    let status = null;
    let passed = false;
    const res = {
        status(code) { status = code; return this; },
        json() { return this; },
        send() { return this; },
    };
    await guard(req, res, () => { passed = true; });
    return passed ? 'next' : status;
};

const subAdmin = (permissions) => ({ adminType: 'sub_admin', permissions: sanitizeAdminPermissions(permissions) });

test('a legacy section-only role keeps exactly its access', async () => {
    const admin = subAdmin({ report_management: ['view'] });
    assert.equal(await run(requireAdminPermission('report_management', 'view'), admin), 'next');
    assert.equal(await run(requireAdminSubmenuAccess('report_management', 'order-report.eod', 'view'), admin), 'next');
    assert.equal(await run(requireAdminPermission('report_management', 'export'), admin), 403);
    assert.equal(await run(requireAdminPermission('order_management', 'view'), admin), 403);
});

test('an explicitly restricted submenu is refused; siblings are not', async () => {
    const admin = subAdmin({ report_management: ['view'], submenus: { report_management: { 'order-report.eod': [] } } });
    assert.equal(await run(requireAdminSubmenuAccess('report_management', 'order-report.eod', 'view'), admin), 403);
    assert.equal(await run(requireAdminSubmenuAccess('report_management', 'tax-report', 'view'), admin), 'next');
    assert.equal(await run(requireAdminPermission('report_management', 'view', 'order-report.eod'), admin), 403);
    assert.equal(await run(requireAdminPermission('report_management', 'view'), admin), 'next', 'shared APIs stay section-level');
});

test('the submenu guard never grants what the section guard refuses', async () => {
    const admin = subAdmin({});
    assert.equal(await run(requireAdminSubmenuAccess('report_management', 'tax-report', 'view'), admin), 'next', 'defers to the section guard');
    assert.equal(await run(requireAdminPermission('report_management', 'view', 'tax-report'), admin), 403);
});

test('super admin is unaffected by submenu entries', async () => {
    const admin = { adminType: 'super_admin', permissions: { submenus: { report_management: { 'order-report.eod': [] } } } };
    assert.equal(await run(requireAdminSubmenuAccess('report_management', 'order-report.eod', 'view'), admin), 'next');
});
