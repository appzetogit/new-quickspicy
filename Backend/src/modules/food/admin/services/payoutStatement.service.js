import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { getRiderBalances, getRestaurantBalances, payoutEntity } from './adminBalanceSheet.service.js';
import { istWeekStart, istDateKey } from '../../shared/incentiveRules.js';

/**
 * Weekly payout statements for riders and restaurants.
 *
 * A statement is a snapshot of the admin balance sheet for one entity and one
 * Monday-to-Sunday IST week: the same unsettled, captured ledger rows, the same
 * sums. Its life:
 *
 *   draft     made by generateWeeklyStatements, refreshed each time it runs
 *   approved  figures frozen; regenerating no longer touches it
 *   paid      the week's transactions settled through payoutEntity, which
 *             records a Settlement. This records a payment made outside the
 *             system (bank / UPI); nothing here moves money.
 *   void      dropped by an admin; a later generate can make a fresh draft
 *
 * Riders and restaurants see approved and paid statements, never drafts.
 */

const DAY_MS = 24 * 3600000;
const num = (v) => Number(v ?? 0) || 0;
const money = (v) => Math.round(num(v) * 100) / 100;
const ENTITY_TYPES = ['rider', 'restaurant'];
const MAX_LINES = 500;

/**
 * The week starting on the IST Monday of `weekStart` (any date in the week),
 * or the last complete week when not given.
 */
export function weekBounds(weekStart) {
    let start;
    if (weekStart) {
        const at = new Date(weekStart);
        if (Number.isNaN(at.getTime())) throw new ValidationError('weekStart must be a date');
        // A bare "YYYY-MM-DD" parses as UTC midnight, 05:30 IST the same day,
        // so the IST week is the one the admin meant.
        start = istWeekStart(at);
    } else {
        start = new Date(istWeekStart(new Date()).getTime() - 7 * DAY_MS);
    }
    return { start, end: new Date(start.getTime() + 7 * DAY_MS - 1) };
}

const checkType = (entityType) => {
    if (!ENTITY_TYPES.includes(entityType)) throw new ValidationError('entityType must be "rider" or "restaurant"');
    return entityType;
};

/** Per-order lines for a statement, from the same rows the balance counts. */
async function statementLines(entityType, entityId, start, end) {
    const isRider = entityType === 'rider';
    const rows = await prisma.foodTransaction.findMany({
        where: {
            status: 'captured',
            createdAt: { gte: start, lte: end },
            ...(isRider
                ? { deliveryPartnerId: entityId, isRiderSettled: false }
                : { restaurantId: entityId, isRestaurantSettled: false }),
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_LINES,
        select: {
            orderId: true, createdAt: true, paymentMethod: true, amountDue: true,
            subtotal: true, commissionAmount: true, riderShare: true, restaurantShare: true,
            order: { select: { order_id: true } },
        },
    });
    return rows.map((r) => ({
        orderId: r.orderId,
        displayId: r.order?.order_id || r.orderId,
        date: r.createdAt,
        paymentMethod: r.paymentMethod,
        amount: money(isRider ? r.riderShare : r.restaurantShare),
        ...(isRider
            ? { cash: ['cash', 'razorpay_qr'].includes(r.paymentMethod) ? money(r.amountDue) : 0 }
            : { sales: money(r.subtotal), commission: money(r.commissionAmount) }),
    }));
}

const figuresFromRow = (entityType, row) =>
    entityType === 'rider'
        ? {
              orders: row.deliveries,
              grossSales: 0,
              commission: 0,
              earnings: row.earnings,
              incentives: row.bonus,
              cashCollected: row.cashCollected,
              cashDeposited: row.cashDeposited,
              cashInHand: row.cashInHand,
          }
        : {
              orders: row.orders,
              grossSales: row.grossSales,
              commission: row.commission,
              earnings: row.payable,
              incentives: 0,
              cashCollected: 0,
              cashDeposited: 0,
              cashInHand: 0,
          };

const netOf = (f, adjustments = 0) =>
    money(num(f.earnings) + num(f.incentives) - num(f.cashInHand) + num(adjustments));

/**
 * Make or refresh the drafts for a week.
 *
 * Approved, paid and void statements are left alone. A draft whose entity no
 * longer has anything outstanding that week (paid from the balance sheet in the
 * meantime) is removed, so the draft list stays a list of people to pay.
 */
export async function generateWeeklyStatements({ entityType = 'all', weekStart } = {}) {
    const { start, end } = weekBounds(weekStart);
    const types = entityType === 'all' || !entityType ? ENTITY_TYPES : [checkType(entityType)];
    const summary = { weekStart: start, weekEnd: end, created: 0, refreshed: 0, removed: 0, frozen: 0 };

    for (const type of types) {
        const { rows } = type === 'rider'
            ? await getRiderBalances({ from: start, to: end })
            : await getRestaurantBalances({ from: start, to: end });

        const existing = await prisma.foodPayoutStatement.findMany({
            where: { entityType: type, periodStart: start },
            select: { id: true, entityId: true, status: true, adjustments: true },
        });
        const byEntity = new Map(existing.map((e) => [e.entityId, e]));
        const seen = new Set();

        for (const row of rows) {
            seen.add(row.entityId);
            const current = byEntity.get(row.entityId);
            if (current && current.status !== 'draft' && current.status !== 'void') {
                summary.frozen += 1;
                continue;
            }
            const figures = figuresFromRow(type, row);
            const lines = await statementLines(type, row.entityId, start, end);
            const adjustments = current?.status === 'draft' ? num(current.adjustments) : 0;
            const data = { ...figures, adjustments, net: netOf(figures, adjustments), lines };

            if (current) {
                await prisma.foodPayoutStatement.update({
                    where: { id: current.id },
                    // A voided week brought back by a new generate starts over.
                    data: current.status === 'void'
                        ? { ...data, status: 'draft', adjustments: 0, adjustmentNote: '', net: netOf(figures), notes: '' }
                        : data,
                });
                summary.refreshed += 1;
            } else {
                try {
                    await prisma.foodPayoutStatement.create({
                        data: { entityType: type, entityId: row.entityId, periodStart: start, periodEnd: end, ...data },
                    });
                    summary.created += 1;
                } catch (error) {
                    // Another generate made it a moment ago.
                    if (error?.code !== 'P2002') throw error;
                }
            }
        }

        const stale = existing.filter((e) => e.status === 'draft' && !seen.has(e.entityId)).map((e) => e.id);
        if (stale.length) {
            const { count } = await prisma.foodPayoutStatement.deleteMany({ where: { id: { in: stale }, status: 'draft' } });
            summary.removed += count;
        }
    }
    return summary;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

async function partyNames(rows) {
    const riderIds = rows.filter((r) => r.entityType === 'rider').map((r) => r.entityId);
    const restaurantIds = rows.filter((r) => r.entityType === 'restaurant').map((r) => r.entityId);
    const [riders, restaurants] = await Promise.all([
        riderIds.length
            ? prisma.foodDeliveryPartner.findMany({ where: { id: { in: riderIds } }, select: { id: true, name: true, phone: true } })
            : [],
        restaurantIds.length
            ? prisma.foodRestaurant.findMany({ where: { id: { in: restaurantIds } }, select: { id: true, restaurantName: true, ownerPhone: true } })
            : [],
    ]);
    const map = new Map();
    riders.forEach((r) => map.set(`rider:${r.id}`, { name: r.name, phone: r.phone }));
    restaurants.forEach((r) => map.set(`restaurant:${r.id}`, { name: r.restaurantName, phone: r.ownerPhone }));
    return map;
}

export const serializeStatement = (row, party = null, { withLines = false } = {}) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    name: party?.name || '',
    phone: party?.phone || '',
    weekKey: istDateKey(row.periodStart),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    orders: row.orders,
    grossSales: money(row.grossSales),
    commission: money(row.commission),
    earnings: money(row.earnings),
    incentives: money(row.incentives),
    cashCollected: money(row.cashCollected),
    cashDeposited: money(row.cashDeposited),
    cashInHand: money(row.cashInHand),
    adjustments: money(row.adjustments),
    adjustmentNote: row.adjustmentNote || '',
    net: money(row.net),
    status: row.status,
    approvedAt: row.approvedAt,
    paidAt: row.paidAt,
    payoutRef: row.payoutRef || '',
    notes: row.notes || '',
    settlementId: row.settlementId || null,
    lineCount: Array.isArray(row.lines) ? row.lines.length : 0,
    ...(withLines ? { lines: Array.isArray(row.lines) ? row.lines : [] } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

export async function listStatements(query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const where = {
        ...(ENTITY_TYPES.includes(query.entityType) ? { entityType: query.entityType } : {}),
        ...(isId(query.entityId) ? { entityId: String(query.entityId) } : {}),
        ...(['draft', 'approved', 'paid', 'void'].includes(query.status) ? { status: query.status } : {}),
        ...(query.weekStart ? { periodStart: weekBounds(query.weekStart).start } : {}),
    };
    const [rows, total] = await Promise.all([
        prisma.foodPayoutStatement.findMany({
            where,
            orderBy: [{ periodStart: 'desc' }, { net: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.foodPayoutStatement.count({ where }),
    ]);
    const names = await partyNames(rows);
    return {
        statements: rows.map((r) => serializeStatement(r, names.get(`${r.entityType}:${r.entityId}`))),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
}

async function loadStatement(id) {
    if (!isId(id)) throw new NotFoundError('Statement not found');
    const row = await prisma.foodPayoutStatement.findUnique({ where: { id: String(id) } });
    if (!row) throw new NotFoundError('Statement not found');
    return row;
}

export async function getStatement(id) {
    const row = await loadStatement(id);
    const names = await partyNames([row]);
    return serializeStatement(row, names.get(`${row.entityType}:${row.entityId}`), { withLines: true });
}

// ─── Admin actions ───────────────────────────────────────────────────────────

/** Moves a statement between states only from the expected one. */
async function transition(id, from, data, message) {
    const { count } = await prisma.foodPayoutStatement.updateMany({
        where: { id: String(id), status: { in: from } },
        data,
    });
    if (!count) throw new ValidationError(message);
    return getStatement(id);
}

/** A signed correction on a draft, e.g. a damaged-goods deduction. */
export async function adjustStatement(id, body = {}) {
    const row = await loadStatement(id);
    if (row.status !== 'draft') throw new ValidationError('Only a draft statement can be adjusted');
    const amount = Number(body.adjustments ?? body.amount);
    if (!Number.isFinite(amount) || Math.abs(amount) > 1e7) throw new ValidationError('Adjustment must be an amount');
    const note = String(body.note ?? body.adjustmentNote ?? '').trim().slice(0, 300);
    if (amount !== 0 && !note) throw new ValidationError('Say what the adjustment is for');
    return transition(
        id,
        ['draft'],
        { adjustments: money(amount), adjustmentNote: note, net: netOf(row, amount) },
        'Only a draft statement can be adjusted',
    );
}

export async function approveStatement(id, adminId) {
    await loadStatement(id);
    return transition(
        id,
        ['draft'],
        { status: 'approved', approvedAt: new Date(), approvedBy: isId(adminId) ? String(adminId) : null },
        'Only a draft statement can be approved',
    );
}

export async function voidStatement(id, body = {}) {
    await loadStatement(id);
    const reason = String(body.reason || '').trim().slice(0, 300);
    return transition(id, ['draft', 'approved'], { status: 'void', notes: reason }, 'A paid statement cannot be voided');
}

/**
 * Record that an approved statement was paid outside the system.
 *
 * Claims the statement first (approved -> paid), so two admins cannot both
 * record it, then settles the week's ledger rows through payoutEntity. If that
 * fails for any reason other than "already settled from the balance sheet",
 * the statement goes back to approved.
 */
export async function markStatementPaid(id, body = {}, adminId = null) {
    const row = await loadStatement(id);
    if (row.status !== 'approved') throw new ValidationError('Approve the statement before marking it paid');
    const payoutRef = String(body.payoutRef || body.reference || '').trim().slice(0, 120);
    const notes = String(body.notes || '').trim().slice(0, 500);

    const { count } = await prisma.foodPayoutStatement.updateMany({
        where: { id: row.id, status: 'approved' },
        data: { status: 'paid', paidAt: new Date(), paidBy: isId(adminId) ? String(adminId) : null, payoutRef, notes },
    });
    if (!count) throw new ValidationError('This statement was just updated by someone else. Reload and try again.');

    let settlementId = null;
    try {
        const settled = await payoutEntity(row.entityType, row.entityId, {
            from: row.periodStart,
            to: row.periodEnd,
            reference: payoutRef,
            notes: `Weekly statement ${istDateKey(row.periodStart)}${notes ? `: ${notes}` : ''}`,
            adminId,
        });
        settlementId = settled.settlementId;
    } catch (error) {
        if (!/Nothing outstanding/.test(error?.message || '')) {
            await prisma.foodPayoutStatement.updateMany({
                where: { id: row.id, status: 'paid' },
                data: { status: 'approved', paidAt: null, paidBy: null, payoutRef: '', notes: row.notes },
            });
            throw error;
        }
        // Settled from the balance sheet already; the statement still records the payment.
    }
    if (settlementId) {
        await prisma.foodPayoutStatement.update({ where: { id: row.id }, data: { settlementId } });
    }

    void notifyPaid(row, payoutRef).catch((e) => logger.warn(`Payout statement notification failed: ${e?.message || e}`));
    return getStatement(row.id);
}

async function notifyPaid(row, payoutRef) {
    const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
    const week = istDateKey(row.periodStart);
    await notifyOwnerSafely(
        { ownerType: row.entityType === 'rider' ? 'DELIVERY_PARTNER' : 'RESTAURANT', ownerId: row.entityId },
        {
            title: 'Weekly payout sent',
            body: `Your payout of ₹${money(row.net)} for the week of ${week} has been sent${payoutRef ? ` (ref ${payoutRef})` : ''}.`,
            data: { type: 'payout_statement_paid', statementId: row.id, amount: String(money(row.net)) },
        },
    );
}

// ─── The rider's / restaurant's own ──────────────────────────────────────────

const VISIBLE = ['approved', 'paid'];

export async function listOwnStatements(entityType, entityId, query = {}) {
    checkType(entityType);
    if (!isId(entityId)) throw new ValidationError('Not found');
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(52, Math.max(1, Number(query.limit) || 12));
    const where = { entityType, entityId: String(entityId), status: { in: VISIBLE } };
    const [rows, total] = await Promise.all([
        prisma.foodPayoutStatement.findMany({ where, orderBy: { periodStart: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.foodPayoutStatement.count({ where }),
    ]);
    return {
        statements: rows.map((r) => serializeStatement(r)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
}

/** One of the caller's own statements; anyone else's is "not found". */
export async function getOwnStatement(entityType, entityId, id) {
    const row = await loadStatement(id);
    if (row.entityType !== entityType || row.entityId !== String(entityId) || !VISIBLE.includes(row.status)) {
        throw new NotFoundError('Statement not found');
    }
    const names = await partyNames([row]);
    return serializeStatement(row, names.get(`${row.entityType}:${row.entityId}`), { withLines: true });
}
