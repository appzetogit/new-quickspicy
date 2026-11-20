import { prisma } from '../../../../config/prisma.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { isId } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { isRazorpayConfigured } from '../helpers/razorpay.helper.js';
import * as foodTransactionService from './foodTransaction.service.js';
import { buildOrderIdentityFilter, enqueueOrderEvent } from './order.helpers.js';

/**
 * Collecting a cash-on-delivery order by UPI straight into the company's own
 * account, with no payment gateway in between.
 *
 * Settings (admin, "Company UPI collection" on the 3rd-party page), stored as
 * one food_platform_settings row:
 *   useCompanyUpiQr  always use the company UPI QR, even when Razorpay is set up
 *   upiId, payeeName the UPI handle the customer pays and the name it shows
 *   bank             account holder, number, IFSC and bank name, for finance
 *                    (shown to admins masked; never logged in full)
 *
 * When Razorpay is not configured, or useCompanyUpiQr is on, the rider's
 * "Show payment QR" returns a upi://pay link for the exact amount instead of a
 * Razorpay payment link. Nothing tells us that such a payment arrived, so the
 * order waits for the rider to say "Customer paid by UPI" (optionally with the
 * UPI reference), and finance reconciles it against the bank statement
 * (food_upi_collections, status rider_confirmed -> reconciled | mismatch).
 */

export const SETTINGS_KEY = 'company_collection';
const MASK = '••••';

const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{6,18}$/;

const str = (v, max = 100) => String(v ?? '').trim().slice(0, max);

/** "XXXX1234": enough for an admin to recognise the account. */
export const maskAccount = (n) => {
    const s = String(n || '');
    return s ? `${MASK}${s.slice(-4)}` : '';
};

async function readRaw() {
    const row = await prisma.foodPlatformSetting.findUnique({ where: { key: SETTINGS_KEY } }).catch(() => null);
    return { value: (row?.value && typeof row.value === 'object') ? row.value : {}, updatedAt: row?.updatedAt ?? null };
}

/** For the admin page and the server. The account number is always masked. */
export async function getCompanyCollectionSettings() {
    const { value, updatedAt } = await readRaw();
    const bank = value.bank || {};
    return {
        useCompanyUpiQr: value.useCompanyUpiQr === true,
        upiId: value.upiId || '',
        payeeName: value.payeeName || '',
        bank: {
            accountHolderName: bank.accountHolderName || '',
            accountNumber: maskAccount(bank.accountNumber),
            ifsc: bank.ifsc || '',
            bankName: bank.bankName || '',
        },
        razorpayConfigured: isRazorpayConfigured(),
        // What the rider's "Show payment QR" will do right now.
        activeMode: chooseMode(value),
        updatedAt,
    };
}

function chooseMode(value) {
    const hasUpi = Boolean(value?.upiId);
    if (hasUpi && (value.useCompanyUpiQr === true || !isRazorpayConfigured())) return 'company_upi';
    return isRazorpayConfigured() ? 'razorpay' : 'none';
}

export async function saveCompanyCollectionSettings(input = {}, adminId = null) {
    const { value: stored } = await readRaw();
    const upiId = str(input.upiId, 256);
    if (upiId && !UPI_RE.test(upiId)) throw new ValidationError('Enter a valid UPI ID, like quickspicy@okaxis');
    const payeeName = str(input.payeeName, 50);
    if (upiId && !payeeName) throw new ValidationError('Payee name is required with a UPI ID');

    const b = input.bank || {};
    const ifsc = str(b.ifsc, 11).toUpperCase();
    if (ifsc && !IFSC_RE.test(ifsc)) throw new ValidationError('Enter a valid IFSC code');
    let accountNumber = str(b.accountNumber, 30).replace(/\s+/g, '');
    // The page shows the number masked; sending the mask back keeps the stored one.
    // An empty field also keeps it; clearAccountNumber: true removes it.
    if (b.clearAccountNumber === true) {
        accountNumber = '';
    } else if (!accountNumber || accountNumber.startsWith(MASK)) {
        accountNumber = stored.bank?.accountNumber || '';
    } else if (!ACCOUNT_RE.test(accountNumber)) {
        throw new ValidationError('Account number must be 6 to 18 digits');
    }

    const value = {
        useCompanyUpiQr: input.useCompanyUpiQr === true,
        upiId,
        payeeName,
        bank: {
            accountHolderName: str(b.accountHolderName, 100),
            accountNumber,
            ifsc,
            bankName: str(b.bankName, 100),
        },
    };
    if (value.useCompanyUpiQr && !upiId) throw new ValidationError('Add the company UPI ID before switching the UPI QR on');

    await prisma.foodPlatformSetting.upsert({
        where: { key: SETTINGS_KEY },
        create: { key: SETTINGS_KEY, value, updatedBy: isId(adminId) ? String(adminId) : null },
        update: { value, updatedBy: isId(adminId) ? String(adminId) : null },
    });
    logger.info(`Company collection settings saved by ${adminId || 'unknown'} (UPI ${upiId || '-'}, account ${maskAccount(accountNumber) || '-'})`);
    return getCompanyCollectionSettings();
}

/** The company UPI settings when the collect QR should use them, else null. */
export async function companyUpiForCollection() {
    const { value } = await readRaw();
    return chooseMode(value) === 'company_upi' ? { upiId: value.upiId, payeeName: value.payeeName || 'Quick Spicy' } : null;
}

/**
 * upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=Order <id>&tr=<orderId>
 * The NPCI deep link every UPI app reads from a QR. `am` fixes the amount.
 */
export function buildUpiUri({ upiId, payeeName, amount, orderDisplayId, orderId }) {
    const params = [
        ['pa', upiId],
        ['pn', payeeName],
        ['am', Number(amount).toFixed(2)],
        ['cu', 'INR'],
        ['tn', `Order ${orderDisplayId || orderId}`],
        ['tr', String(orderId)],
    ];
    return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`;
}

/** The QR snapshot stored on the order/transaction for a company-UPI collection. */
export function companyUpiQr({ upiId, payeeName, amount, orderDisplayId, orderId }) {
    return {
        provider: 'company_upi',
        upiUri: buildUpiUri({ upiId, payeeName, amount, orderDisplayId, orderId }),
        upiId,
        payeeName,
        amount: Number(amount),
        status: 'awaiting_confirmation',
        needsReconciliation: true,
        createdAt: new Date().toISOString(),
    };
}

export async function recordUpiCollectionStarted({ orderId, deliveryPartnerId, amount, upiId }) {
    await prisma.foodUpiCollection.upsert({
        where: { orderId },
        create: { orderId, deliveryPartnerId: deliveryPartnerId || null, amount, upiId, status: 'awaiting_payment' },
        update: {
            deliveryPartnerId: deliveryPartnerId || null, amount, upiId, status: 'awaiting_payment',
            utr: null, confirmedAt: null, reconciledAt: null, reconciledById: null, reconcileNote: null,
        },
    });
}

/**
 * The rider: "Customer paid by UPI". Marks the order paid (so delivery can be
 * completed) and leaves it flagged for finance to reconcile.
 */
export async function confirmCompanyUpiPayment(orderId, deliveryPartnerId, { utr = '' } = {}) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');
    const row = await prisma.foodOrder.findFirst({
        where: identity,
        select: { id: true, order_id: true, dispatchDeliveryPartnerId: true, paymentMethod: true, paymentStatus: true, qr: true },
    });
    if (!row) throw new NotFoundError('Order not found');
    if (String(row.dispatchDeliveryPartnerId || '') !== String(deliveryPartnerId)) throw new ForbiddenError('Not your order');
    if (row.qr?.provider !== 'company_upi') throw new ValidationError('This order is not being collected by company UPI');
    if (row.paymentStatus === 'paid') return { alreadyPaid: true, orderId: row.id };

    const ref = str(utr, 40).replace(/[^A-Za-z0-9]/g, '');
    const at = new Date();
    const qr = { ...row.qr, status: 'paid', riderConfirmedAt: at.toISOString(), ...(ref ? { utr: ref } : {}), needsReconciliation: true };

    await prisma.$transaction([
        prisma.foodOrder.update({ where: { id: row.id }, data: { paymentStatus: 'paid', qr } }),
        prisma.foodTransaction.updateMany({ where: { orderId: row.id }, data: { paymentStatusLabel: 'paid', qr } }),
        prisma.foodUpiCollection.updateMany({
            where: { orderId: row.id },
            data: { status: 'rider_confirmed', confirmedAt: at, utr: ref || null, deliveryPartnerId: String(deliveryPartnerId) },
        }),
    ]);

    await foodTransactionService.updateTransactionStatus(row.id, 'cod_company_upi_confirmed', {
        recordedByRole: 'DELIVERY_PARTNER',
        recordedById: deliveryPartnerId,
        note: `Rider confirmed UPI payment to company account${ref ? ` (ref ${ref})` : ''}; awaiting reconciliation`,
    }).catch((e) => logger.warn(`UPI confirm ledger note failed for ${row.id}: ${e?.message || e}`));

    enqueueOrderEvent('company_upi_confirmed', { orderMongoId: row.id, orderId: row.order_id || null, deliveryPartnerId });
    return { orderId: row.id, paymentStatus: 'paid', needsReconciliation: true, utr: ref || null };
}

/** Admin: the company-UPI collections, newest first. */
export async function listUpiCollections({ status, page = 1, limit = 50 } = {}) {
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const allowed = ['awaiting_payment', 'rider_confirmed', 'reconciled', 'mismatch', 'abandoned'];
    const where = allowed.includes(status) ? { status } : {};
    const [rows, total, counts] = await Promise.all([
        prisma.foodUpiCollection.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
        prisma.foodUpiCollection.count({ where }),
        prisma.foodUpiCollection.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }),
    ]);
    const orderIds = rows.map((r) => r.orderId);
    const riderIds = [...new Set(rows.map((r) => r.deliveryPartnerId).filter(Boolean))];
    const [orders, riders] = await Promise.all([
        orderIds.length ? prisma.foodOrder.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, order_id: true, total: true, customerName: true, customerPhone: true, orderStatus: true, createdAt: true },
        }) : [],
        riderIds.length ? prisma.foodDeliveryPartner.findMany({ where: { id: { in: riderIds } }, select: { id: true, name: true, phone: true } }) : [],
    ]);
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const riderById = new Map(riders.map((r) => [r.id, r]));
    return {
        items: rows.map((r) => {
            const o = orderById.get(r.orderId);
            const rider = riderById.get(r.deliveryPartnerId);
            return {
                id: r.id,
                orderId: r.orderId,
                orderDisplayId: o?.order_id || r.orderId,
                orderTotal: Number(o?.total ?? 0),
                orderStatus: o?.orderStatus || null,
                customerName: o?.customerName || '',
                customerPhone: o?.customerPhone || '',
                rider: rider ? { id: rider.id, name: rider.name, phone: rider.phone } : null,
                amount: Number(r.amount),
                upiId: r.upiId,
                status: r.status,
                utr: r.utr,
                confirmedAt: r.confirmedAt,
                reconciledAt: r.reconciledAt,
                reconcileNote: r.reconcileNote,
                createdAt: r.createdAt,
            };
        }),
        summary: Object.fromEntries(counts.map((c) => [c.status, { count: c._count._all, amount: Number(c._sum.amount ?? 0) }])),
        pagination: { page: Math.floor(skip / take) + 1, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
}

/** Admin: matched against the bank statement (or not). */
export async function reconcileUpiCollection(orderId, adminId, { outcome = 'reconciled', note = '' } = {}) {
    if (!['reconciled', 'mismatch'].includes(outcome)) throw new ValidationError('outcome must be reconciled or mismatch');
    const text = str(note, 300);
    if (outcome === 'mismatch' && !text) throw new ValidationError('Say what does not match');
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');
    const order = await prisma.foodOrder.findFirst({ where: identity, select: { id: true, qr: true } });
    if (!order) throw new NotFoundError('Order not found');
    const row = await prisma.foodUpiCollection.findUnique({ where: { orderId: order.id } });
    if (!row) throw new NotFoundError('No company UPI collection for this order');
    if (!['rider_confirmed', 'mismatch', 'reconciled'].includes(row.status)) {
        throw new ValidationError('The rider has not confirmed this payment yet');
    }
    const at = new Date();
    const qr = order.qr && typeof order.qr === 'object'
        ? { ...order.qr, needsReconciliation: outcome !== 'reconciled', reconciliation: outcome, reconciledAt: at.toISOString() }
        : order.qr;
    await prisma.$transaction([
        prisma.foodUpiCollection.update({
            where: { orderId: order.id },
            data: { status: outcome, reconciledAt: at, reconciledById: isId(adminId) ? String(adminId) : null, reconcileNote: text || null },
        }),
        prisma.foodOrder.update({ where: { id: order.id }, data: { qr } }),
        prisma.foodTransaction.updateMany({ where: { orderId: order.id }, data: { qr } }),
    ]);
    return { orderId: order.id, status: outcome };
}
