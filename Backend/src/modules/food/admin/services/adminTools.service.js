import { prisma } from '../../../../config/prisma.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { isId } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { dayRange } from '../../../../utils/timezone.js';
import { recordTransaction } from '../../../../core/payments/transaction.service.js';
import { readPlatformSetting } from './platformSettings.service.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../../restaurant/restaurant.mapper.js';

/**
 * Back ends for admin pages that used to be UI-only: the coupon and customer
 * rewards reports, crediting a customer's wallet, the wallet top-up
 * bonus, and the restaurant bulk import.
 */

const num = (v) => Number(v ?? 0) || 0;
const money = (v) => Math.round(num(v) * 100) / 100;
const page = (q) => {
    const limit = Math.max(1, Math.min(500, Number(q.limit) || 50));
    const p = Math.max(1, Number(q.page) || 1);
    return { limit, page: p, skip: (p - 1) * limit };
};
/** From / to as whole India days (dayRange), on the column given. */
const rangeOn = (column, q) => {
    const r = dayRange(q);
    return r ? { [column]: r } : {};
};

// ─── Coupon (campaign) order report ──────────────────────────────────────────

/** Orders that used a coupon: per code, and the orders themselves. */
export async function couponOrderReport(q = {}) {
    const { limit, page: p, skip } = page(q);
    const code = String(q.couponCode || '').trim();
    const where = {
        couponCode: code ? { equals: code, mode: 'insensitive' } : { not: null },
        status: { in: ['captured', 'pending'] },
        ...rangeOn('createdAt', q),
    };
    const [byCode, rows, total] = await Promise.all([
        prisma.foodTransaction.groupBy({
            by: ['couponCode'],
            where,
            _count: { _all: true },
            _sum: { discount: true, total: true, adminDiscountShare: true, restaurantDiscountShare: true },
        }),
        prisma.foodTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            select: {
                orderId: true, couponCode: true, discount: true, total: true, createdAt: true, paymentMethod: true,
                order: { select: { order_id: true, orderStatus: true } },
                restaurant: { select: { restaurantName: true } },
            },
        }),
        prisma.foodTransaction.count({ where }),
    ]);
    return {
        coupons: byCode
            .map((c) => ({
                couponCode: c.couponCode,
                orders: c._count._all,
                discount: money(c._sum.discount),
                adminShare: money(c._sum.adminDiscountShare),
                restaurantShare: money(c._sum.restaurantDiscountShare),
                orderTotal: money(c._sum.total),
            }))
            .sort((a, b) => b.orders - a.orders),
        orders: rows.map((r) => ({
            orderId: r.orderId,
            displayId: r.order?.order_id || r.orderId,
            couponCode: r.couponCode,
            restaurantName: r.restaurant?.restaurantName || '',
            discount: money(r.discount),
            total: money(r.total),
            status: r.order?.orderStatus || '',
            paymentMethod: r.paymentMethod,
            date: r.createdAt,
        })),
        pagination: { page: p, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
}

// ─── Customer rewards report ─────────────────────────────────────────────────

const REWARD_KINDS = {
    cashback: { category: 'wallet_topup', description: { startsWith: 'Cashback' } },
    referral: { category: 'referral_reward' },
    topupBonus: { category: 'wallet_topup', description: { startsWith: 'Top-up bonus' } },
    adminCredit: { category: 'adjustment', description: { startsWith: 'Added by admin' } },
};

/**
 * What customers were given: cashback, referral rewards, top-up bonuses and
 * admin credits, per customer. (There is no points system; this is the
 * rewards that exist.)
 */
export async function customerRewardsReport(q = {}) {
    const { limit, page: p, skip } = page(q);
    const base = { entityType: 'user', type: 'credit', ...rangeOn('createdAt', q) };
    const kinds = Object.entries(REWARD_KINDS);
    const perKind = await Promise.all(kinds.map(([, w]) => prisma.transaction.groupBy({
        by: ['entityId'], where: { ...base, ...w }, _sum: { amount: true }, _count: { _all: true },
    })));
    const byUser = new Map();
    kinds.forEach(([kind], i) => {
        for (const g of perKind[i]) {
            const row = byUser.get(g.entityId) || { userId: g.entityId, cashback: 0, referral: 0, topupBonus: 0, adminCredit: 0, count: 0 };
            row[kind] = money(row[kind] + num(g._sum.amount));
            row.count += g._count._all;
            byUser.set(g.entityId, row);
        }
    });
    let rows = [...byUser.values()].map((r) => ({ ...r, total: money(r.cashback + r.referral + r.topupBonus + r.adminCredit) }));
    const users = rows.length
        ? await prisma.foodUser.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, phone: true } })
        : [];
    const names = new Map(users.map((u) => [u.id, u]));
    rows = rows.map((r) => ({ ...r, name: names.get(r.userId)?.name || '', phone: names.get(r.userId)?.phone || '' }));
    const search = String(q.search || '').trim().toLowerCase();
    if (search) rows = rows.filter((r) => r.name.toLowerCase().includes(search) || r.phone.includes(search));
    rows.sort((a, b) => b.total - a.total);
    const totals = rows.reduce((t, r) => ({
        customers: t.customers + 1,
        cashback: money(t.cashback + r.cashback),
        referral: money(t.referral + r.referral),
        topupBonus: money(t.topupBonus + r.topupBonus),
        adminCredit: money(t.adminCredit + r.adminCredit),
        total: money(t.total + r.total),
    }), { customers: 0, cashback: 0, referral: 0, topupBonus: 0, adminCredit: 0, total: 0 });
    return { rows: rows.slice(skip, skip + limit), totals, pagination: { page: p, limit, total: rows.length, pages: Math.ceil(rows.length / limit) || 1 } };
}

// ─── Crediting a customer's wallet ───────────────────────────────────────────

const MAX_ADMIN_CREDIT = 50000;

/**
 * Add money to a customer's wallet (goodwill, a refund made by hand ...).
 * `requestId` makes a double-click or a retried request credit once.
 */
export async function creditCustomerWallet(customerId, body = {}, adminId = null) {
    if (!isId(customerId)) throw new NotFoundError('Customer not found');
    const user = await prisma.foodUser.findUnique({ where: { id: String(customerId) }, select: { id: true, name: true } });
    if (!user) throw new NotFoundError('Customer not found');
    const amount = money(body.amount);
    if (!(amount > 0)) throw new ValidationError('Enter an amount above 0');
    if (amount > MAX_ADMIN_CREDIT) throw new ValidationError(`At most ₹${MAX_ADMIN_CREDIT} at a time`);
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!reason) throw new ValidationError('Say why the money is being added');
    const requestId = String(body.requestId || '').trim().slice(0, 64);
    if (!requestId) throw new ValidationError('requestId is required');

    const { transaction, wallet } = await recordTransaction({
        entityType: 'user',
        entityId: user.id,
        type: 'credit',
        amount,
        category: 'adjustment',
        description: `Added by admin: ${reason}`,
        idempotencyKey: `admin_credit:${requestId}`,
        metadata: { source: 'admin_credit', adminId: isId(adminId) ? String(adminId) : null, reason },
    });
    return { transactionId: transaction.id, customerId: user.id, amount, balance: money(wallet?.balance) };
}

/** Recent admin wallet credits, newest first. */
export async function listCustomerWalletCredits(q = {}) {
    const { limit, page: p, skip } = page(q);
    const where = { entityType: 'user', type: 'credit', ...REWARD_KINDS.adminCredit, ...rangeOn('createdAt', q) };
    const [rows, total] = await Promise.all([
        prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        prisma.transaction.count({ where }),
    ]);
    const users = rows.length
        ? await prisma.foodUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.entityId))] } }, select: { id: true, name: true, phone: true } })
        : [];
    const names = new Map(users.map((u) => [u.id, u]));
    return {
        credits: rows.map((r) => ({
            id: r.id,
            customerId: r.entityId,
            name: names.get(r.entityId)?.name || '',
            phone: names.get(r.entityId)?.phone || '',
            amount: money(r.amount),
            reason: r.metadata?.reason || String(r.description || '').replace(/^Added by admin:\s*/, ''),
            date: r.createdAt,
        })),
        pagination: { page: p, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
}

// ─── Wallet top-up bonus ─────────────────────────────────────────────────────

/**
 * The bonus for a top-up under the admin's rules (platform setting
 * wallet_bonus: { enabled, rules: [{ title, minAmount, bonusType: flat|percentage,
 * value, maxBonus, startDate, endDate, isActive }] }). The best rule wins.
 */
export function computeTopupBonus(settings, amount, at = new Date()) {
    if (!settings?.enabled || !Array.isArray(settings.rules)) return { bonus: 0, rule: null };
    const now = new Date(at).getTime();
    let best = { bonus: 0, rule: null };
    for (const rule of settings.rules) {
        if (rule?.isActive === false) continue;
        if (amount < num(rule.minAmount)) continue;
        if (rule.startDate && new Date(rule.startDate).getTime() > now) continue;
        if (rule.endDate && new Date(`${String(rule.endDate).slice(0, 10)}T23:59:59.999+05:30`).getTime() < now) continue;
        let bonus = rule.bonusType === 'percentage' ? (amount * num(rule.value)) / 100 : num(rule.value);
        if (num(rule.maxBonus) > 0) bonus = Math.min(bonus, num(rule.maxBonus));
        bonus = money(Math.max(0, bonus));
        if (bonus > best.bonus) best = { bonus, rule };
    }
    return best;
}

/** Credits the bonus for a completed top-up, once per gateway order. Never throws. */
export async function applyTopupBonus(userId, topupAmount, gatewayOrderId) {
    try {
        const settings = await readPlatformSetting('wallet_bonus');
        const { bonus, rule } = computeTopupBonus(settings, num(topupAmount));
        if (!(bonus > 0)) return 0;
        await recordTransaction({
            entityType: 'user',
            entityId: userId,
            type: 'credit',
            amount: bonus,
            category: 'wallet_topup',
            description: `Top-up bonus${rule?.title ? `: ${String(rule.title).slice(0, 60)}` : ''}`,
            idempotencyKey: `wallet_bonus:${gatewayOrderId}`,
            metadata: { source: 'wallet_bonus', topupAmount: num(topupAmount), rule: rule?.title || '' },
        });
        return bonus;
    } catch (error) {
        // The top-up itself already succeeded; a bonus failure must not undo it.
        logger.error(`Top-up bonus failed for ${gatewayOrderId}: ${error?.message || error}`);
        return 0;
    }
}

// ─── Restaurant bulk import ──────────────────────────────────────────────────

const PHONE = /^[6-9]\d{9}$/;

/**
 * Create restaurants from rows (a CSV the page has parsed). Each comes in
 * pending, without documents: the owner logs in with OTP and completes
 * onboarding, and an admin approves as usual. Rows are independent; the
 * result says which were created and why the others were not.
 *
 * Row: { restaurantName, ownerName, ownerPhone, ownerEmail?, zone (name or id),
 *        city?, area?, address?, pincode?, latitude?, longitude?, cuisines? ("A|B") }
 */
export async function bulkImportRestaurants(rows = []) {
    if (!Array.isArray(rows) || !rows.length) throw new ValidationError('No rows to import');
    if (rows.length > 500) throw new ValidationError('At most 500 restaurants at a time');

    const zones = await prisma.foodZone.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const zoneFor = (value) => {
        const v = String(value || '').trim().toLowerCase();
        return zones.find((z) => z.id === String(value || '').trim() || z.name.toLowerCase() === v) || null;
    };

    const results = [];
    for (const [i, raw] of rows.entries()) {
        const line = i + 2; // header is line 1
        const r = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
        const fail = (reason) => results.push({ line, restaurantName: r.restaurantName || '', ok: false, reason });
        if (!r.restaurantName) { fail('restaurantName is missing'); continue; }
        if (!r.ownerName) { fail('ownerName is missing'); continue; }
        const phone = String(r.ownerPhone || '').replace(/\D/g, '').slice(-10);
        if (!PHONE.test(phone)) { fail('ownerPhone must be a 10-digit mobile number'); continue; }
        const zone = zoneFor(r.zone || r.zoneId);
        if (!zone) { fail(`Unknown zone "${r.zone || r.zoneId || ''}"`); continue; }
        const lat = r.latitude === undefined || r.latitude === '' ? null : Number(r.latitude);
        const lng = r.longitude === undefined || r.longitude === '' ? null : Number(r.longitude);
        if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) { fail('latitude / longitude must be numbers'); continue; }

        const derived = deriveRestaurantFields({ restaurantName: r.restaurantName, ownerPhone: phone });
        const location = lat !== null && lng !== null
            ? fromRestaurantLocation({
                latitude: lat, longitude: lng,
                formattedAddress: [r.address, r.area, r.city, r.pincode].filter(Boolean).join(', '),
                addressLine1: r.address || '', area: r.area || '', city: r.city || '', pincode: r.pincode || '',
            })
            : {};
        try {
            const created = await prisma.foodRestaurant.create({
                data: {
                    restaurantName: r.restaurantName,
                    ownerName: r.ownerName,
                    ownerPhone: phone,
                    primaryContactNumber: phone,
                    ...(r.ownerEmail ? { ownerEmail: String(r.ownerEmail).toLowerCase() } : {}),
                    ...derived,
                    ...location,
                    zoneId: zone.id,
                    cuisines: String(r.cuisines || '').split(/[|,]/).map((c) => c.trim()).filter(Boolean).slice(0, 3),
                    status: 'pending',
                },
                select: { id: true },
            });
            results.push({ line, restaurantName: r.restaurantName, ok: true, id: created.id });
        } catch (error) {
            if (error?.code === 'P2002') fail('A restaurant with this name and phone already exists');
            else { logger.warn(`Bulk import line ${line}: ${error?.message || error}`); fail('Could not be saved'); }
        }
    }
    return { created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
