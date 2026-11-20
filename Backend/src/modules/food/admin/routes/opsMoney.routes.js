import express from 'express';
import { requireAdminPermission } from '../../../../core/roles/adminPermission.middleware.js';
import { getOrderInvoice, renderInvoiceHtml } from '../../orders/services/invoice.service.js';
import { reportRunningLate } from '../../orders/services/orderDelay.service.js';
import {
    listChangeCredits,
    changeCreditDailySummary,
    approveChangeCredit,
    rejectChangeCredit,
} from '../../orders/services/changeCredit.service.js';
import {
    getCompanyCollectionSettings,
    saveCompanyCollectionSettings,
    listUpiCollections,
    reconcileUpiCollection,
} from '../../orders/services/companyCollection.service.js';

/**
 * Admin: order bill, running-late updates, change-to-wallet approvals and the
 * company UPI collection settings / reconciliation. Mounted inside
 * admin.routes.js (after its admin + section guards; /orders/* already falls
 * under order_management there), so each route here only adds its own section.
 */
const router = express.Router();

const handle = (message, run) => async (req, res, next) => {
    try {
        const data = await run(req);
        return res.status(200).json({ success: true, message, data });
    } catch (error) {
        return next(error);
    }
};

const adminId = (req) => req.user?.userId || null;

// ----- The order's bill (same as the customer's) -----
router.get('/orders/:orderId/invoice', handle('Invoice fetched', (req) =>
    getOrderInvoice({ orderId: req.params.orderId, asAdmin: true })));
router.get('/orders/:orderId/invoice.html', async (req, res, next) => {
    try {
        const invoice = await getOrderInvoice({ orderId: req.params.orderId, asAdmin: true });
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'private, no-store');
        return res.status(200).send(renderInvoiceHtml(invoice));
    } catch (error) {
        return next(error);
    }
});

// ----- Running late -----
router.post('/orders/:orderId/running-late', handle('Customer told the order is running late', (req) =>
    reportRunningLate({
        orderId: req.params.orderId,
        reason: req.body?.reason,
        extraMinutes: Number(req.body?.extraMinutes),
        note: req.body?.note,
        by: { role: 'ADMIN', id: adminId(req) },
    })));

// ----- Change to wallet -----
router.get('/change-credits', requireAdminPermission('transaction_management', 'view'),
    handle('Change requests fetched', (req) => listChangeCredits(req.query || {})));
router.get('/change-credits/summary', requireAdminPermission('transaction_management', 'view'),
    handle('Change summary fetched', (req) => changeCreditDailySummary({ date: req.query?.date })));
router.post('/change-credits/:id/approve', requireAdminPermission('transaction_management', 'edit'),
    handle('Change credited to the customer wallet', (req) => approveChangeCredit(req.params.id, adminId(req))));
router.post('/change-credits/:id/reject', requireAdminPermission('transaction_management', 'edit'),
    handle('Change request rejected', (req) => rejectChangeCredit(req.params.id, adminId(req), req.body?.reason)));

// ----- Company UPI collection -----
router.get('/company-collection-settings', requireAdminPermission('system_settings', 'view'),
    handle('Company collection settings fetched', () => getCompanyCollectionSettings()));
router.put('/company-collection-settings', requireAdminPermission('system_settings', 'edit'),
    handle('Company collection settings saved', (req) => saveCompanyCollectionSettings(req.body || {}, adminId(req))));
router.get('/upi-collections', requireAdminPermission('transaction_management', 'view'),
    handle('UPI collections fetched', (req) => listUpiCollections(req.query || {})));
router.post('/upi-collections/:orderId/reconcile', requireAdminPermission('transaction_management', 'edit'),
    handle('UPI collection updated', (req) => reconcileUpiCollection(req.params.orderId, adminId(req), req.body || {})));

export default router;
