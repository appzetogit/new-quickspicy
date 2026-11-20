import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { istDayStart } from '../../shared/incentiveRules.js';

/**
 * Salaried rider incentive (client item 30).
 *
 * A rider is gig (paid per order, the default) or salaried
 * (FoodDeliveryPartner.payType). While the rule is on, a salaried rider earns
 * nothing per order for their first N delivered orders of the IST day -- their
 * salary covers those -- and from order N+1 on they earn the normal rider
 * earning for that order, as an incentive. Tips are the customer's money and
 * always stay with the rider. Gig riders are untouched; with the rule off,
 * salaried riders are paid per order like gig riders.
 *
 * Rider pay is not a wallet credit per order: every earnings screen, the
 * wallet, payout statements and the balance sheet read FoodOrder.riderEarning
 * or FoodTransaction.riderShare. So a covered order has both lowered by the
 * delivery pay (the difference moves to platform profit, and is kept in
 * FoodOrder.riderPayWaived), which keeps every report adding up. Each order is
 * classified once, on delivery, and stamped riderPayBasis + riderDaySeq.
 *
 * Settings: FoodPlatformSetting key 'salaried_incentive'
 *   { enabled, dailyThreshold, zones: { [zoneId]: { enabled, dailyThreshold } } }
 * A zone entry overrides the global values for riders whose HOME zone it is
 * (one threshold per rider per day, wherever the orders were).
 */

export const SETTING_KEY = 'salaried_incentive';
export const PAY_TYPES = ['gig', 'salaried'];
export const BASIS_COVERED = 'salaried_covered';
export const BASIS_INCENTIVE = 'salaried_incentive';

const DAY_MS = 86400000;
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

const cleanThreshold = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1000 || !Number.isInteger(n)) return null;
    return n;
};

/** Stored value -> a complete, safe settings object. */
export function normalizeSalariedSettings(value = {}) {
    const v = value && typeof value === 'object' ? value : {};
    const zones = {};
    for (const [zoneId, z] of Object.entries(v.zones && typeof v.zones === 'object' ? v.zones : {})) {
        if (!isId(zoneId) || !z || typeof z !== 'object') continue;
        zones[zoneId] = {
            enabled: z.enabled === undefined || z.enabled === null ? null : Boolean(z.enabled),
            dailyThreshold: z.dailyThreshold === null || z.dailyThreshold === undefined || z.dailyThreshold === ''
                ? null
                : cleanThreshold(z.dailyThreshold),
        };
    }
    return {
        enabled: Boolean(v.enabled),
        dailyThreshold: cleanThreshold(v.dailyThreshold) ?? 0,
        zones,
    };
}

/** The rule in force for a rider whose home zone is `zoneId` (null = global). */
export function resolveSalariedRule(settings, zoneId = null) {
    const s = normalizeSalariedSettings(settings);
    const z = zoneId ? s.zones[String(zoneId)] : null;
    const enabled = z && z.enabled !== null ? z.enabled : s.enabled;
    const dailyThreshold = z && z.dailyThreshold !== null ? z.dailyThreshold : s.dailyThreshold;
    return { enabled: Boolean(enabled) && dailyThreshold > 0, dailyThreshold, zoneOverride: Boolean(z) };
}

/** Pure: how the `seq`-th delivery of the day is paid under `threshold`. */
export function classifySalariedOrder(seq, threshold) {
    return seq <= threshold ? BASIS_COVERED : BASIS_INCENTIVE;
}

export async function getSalariedIncentiveSettings() {
    const row = await prisma.foodPlatformSetting.findUnique({ where: { key: SETTING_KEY } });
    return { ...normalizeSalariedSettings(row?.value), updatedAt: row?.updatedAt ?? null };
}

export async function saveSalariedIncentiveSettings(body = {}, adminId = null) {
    const threshold = cleanThreshold(body.dailyThreshold ?? 0);
    if (threshold === null) throw new ValidationError('Daily order threshold must be a whole number from 0 to 1000');
    const zones = {};
    for (const [zoneId, z] of Object.entries(body.zones && typeof body.zones === 'object' ? body.zones : {})) {
        if (!isId(zoneId)) throw new ValidationError('Choose a valid zone');
        const t = z?.dailyThreshold;
        if (t !== null && t !== undefined && t !== '' && cleanThreshold(t) === null) {
            throw new ValidationError('Zone threshold must be a whole number from 0 to 1000');
        }
        zones[zoneId] = z;
    }
    const value = normalizeSalariedSettings({ enabled: Boolean(body.enabled), dailyThreshold: threshold, zones });
    // An override with nothing set is the same as none.
    for (const [id, z] of Object.entries(value.zones)) {
        if (z.enabled === null && z.dailyThreshold === null) delete value.zones[id];
    }
    const updatedBy = isId(adminId) ? String(adminId) : null;
    const row = await prisma.foodPlatformSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value, updatedBy },
        update: { value, updatedBy },
    });
    return { ...normalizeSalariedSettings(row.value), updatedAt: row.updatedAt };
}

/**
 * Classifies one delivered order of a salaried rider and adjusts its pay.
 * Call after the order is marked delivered. Idempotent (an order already
 * classified is returned as is) and race-safe: a per-rider advisory lock
 * serialises two deliveries finishing at once, so they get seq k and k+1
 * rather than both counting as order N+1.
 *
 * @returns {Promise<null | { basis, seq, threshold, waived }>} null when the rule does not apply.
 */
export async function applySalariedPayRule(orderId, { client = prisma } = {}) {
    if (!isId(orderId)) return null;
    const order = await client.foodOrder.findUnique({
        where: { id: String(orderId) },
        select: {
            id: true, orderStatus: true, deliveredAt: true, dispatchDeliveryPartnerId: true,
            riderPayBasis: true, riderDaySeq: true, riderPayWaived: true,
        },
    });
    if (!order || order.orderStatus !== 'delivered' || !order.dispatchDeliveryPartnerId) return null;
    if (order.riderPayBasis) {
        return { basis: order.riderPayBasis, seq: order.riderDaySeq, waived: money(order.riderPayWaived), already: true };
    }

    const partnerId = String(order.dispatchDeliveryPartnerId);
    const partner = await client.foodDeliveryPartner.findUnique({
        where: { id: partnerId },
        select: { payType: true, zoneId: true },
    });
    if (!partner || partner.payType !== 'salaried') return null;

    const settings = await client.foodPlatformSetting.findUnique({ where: { key: SETTING_KEY } });
    const rule = resolveSalariedRule(settings?.value, partner.zoneId);
    if (!rule.enabled) return null;

    const deliveredAt = order.deliveredAt || new Date();
    const dayStart = istDayStart(deliveredAt);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    return client.$transaction(async (tx) => {
        // One rider at a time. Released when this transaction ends.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`salaried_pay:${partnerId}`}))`;

        // Re-read under the lock: a concurrent call may have classified it.
        const fresh = await tx.foodOrder.findUnique({
            where: { id: order.id },
            select: { riderPayBasis: true, riderDaySeq: true, riderPayWaived: true, riderEarning: true, tipAmount: true },
        });
        if (fresh.riderPayBasis) {
            return { basis: fresh.riderPayBasis, seq: fresh.riderDaySeq, waived: money(fresh.riderPayWaived), already: true };
        }

        const before = await tx.foodOrder.count({
            where: {
                dispatchDeliveryPartnerId: partnerId,
                orderStatus: 'delivered',
                riderPayBasis: { not: null },
                deliveredAt: { gte: dayStart, lt: dayEnd },
                id: { not: order.id },
            },
        });
        const seq = before + 1;
        const basis = classifySalariedOrder(seq, rule.dailyThreshold);

        // Delivery pay only; the tip always stays with the rider.
        const waived = basis === BASIS_COVERED
            ? Math.max(0, money(Number(fresh.riderEarning) - Number(fresh.tipAmount)))
            : 0;

        const { count } = await tx.foodOrder.updateMany({
            where: { id: order.id, riderPayBasis: null },
            data: {
                riderPayBasis: basis,
                riderDaySeq: seq,
                riderPayWaived: waived,
                ...(waived > 0
                    ? { riderEarning: { decrement: waived }, platformProfit: { increment: waived } }
                    : {}),
            },
        });
        if (!count) return null;

        if (waived > 0) {
            // The ledger copy the payout statements and balance sheet read.
            const txns = await tx.foodTransaction.findMany({ where: { orderId: order.id }, select: { id: true } });
            for (const t of txns) {
                await tx.foodTransaction.update({
                    where: { id: t.id },
                    data: {
                        riderShare: { decrement: waived },
                        platformNetProfit: { increment: waived },
                        history: {
                            create: {
                                kind: 'rider_pay_salaried',
                                amount: waived,
                                note: `Salaried rider: delivery ${seq} of ${rule.dailyThreshold} covered by salary`,
                            },
                        },
                    },
                });
            }
        }

        return { basis, seq, threshold: rule.dailyThreshold, waived };
    });
}

/** Never throws: delivery must complete even if this fails. */
export async function applySalariedPayRuleSafely(orderId) {
    try {
        return await applySalariedPayRule(orderId);
    } catch (err) {
        logger.error(`[SalariedPay] Could not apply salaried pay rule to order ${orderId}: ${err?.message || err}`);
        return null;
    }
}

/**
 * For the rider's earnings API: pay type and today's progress toward the
 * threshold.
 */
export async function getSalariedStatus(deliveryPartnerId, now = new Date()) {
    if (!isId(deliveryPartnerId)) return null;
    const partnerId = String(deliveryPartnerId);
    const partner = await prisma.foodDeliveryPartner.findUnique({
        where: { id: partnerId },
        select: { payType: true, zoneId: true },
    });
    if (!partner) return null;
    const payType = partner.payType || 'gig';
    if (payType !== 'salaried') return { payType, isSalaried: false };

    const settings = await prisma.foodPlatformSetting.findUnique({ where: { key: SETTING_KEY } });
    const rule = resolveSalariedRule(settings?.value, partner.zoneId);
    const dayStart = istDayStart(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const rows = await prisma.foodOrder.groupBy({
        by: ['riderPayBasis'],
        where: {
            dispatchDeliveryPartnerId: partnerId,
            orderStatus: 'delivered',
            riderPayBasis: { not: null },
            deliveredAt: { gte: dayStart, lt: dayEnd },
        },
        _count: { _all: true },
        _sum: { riderEarning: true, tipAmount: true },
    });
    const of = (basis) => rows.find((r) => r.riderPayBasis === basis);
    const covered = of(BASIS_COVERED)?._count?._all || 0;
    const incentive = of(BASIS_INCENTIVE);
    const incentiveOrders = incentive?._count?._all || 0;
    const todayOrders = covered + incentiveOrders;
    return {
        payType,
        isSalaried: true,
        incentiveEnabled: rule.enabled,
        dailyThreshold: rule.dailyThreshold,
        todayOrders,
        todayCoveredOrders: covered,
        todayIncentiveOrders: incentiveOrders,
        ordersUntilIncentive: rule.enabled ? Math.max(0, rule.dailyThreshold - todayOrders) : null,
        todayIncentiveEarning: money(Number(incentive?._sum?.riderEarning) - Number(incentive?._sum?.tipAmount)),
    };
}
