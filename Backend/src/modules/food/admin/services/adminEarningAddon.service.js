import { dayRange } from '../../../../utils/timezone.js';
import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { recordTransaction } from '../../../../core/payments/transaction.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    normalizeRecurrence, offerPeriod, offerTargets, grantKey, targetMet, riderTargeted, cleanTiers,
} from '../../shared/incentiveRules.js';

/**
 * Rider incentives ("earning addons"), extracted from admin.service.js.
 *
 * Two money bugs shaped this file.
 *
 * Crediting an incentive read the row, checked it was still pending, set it to
 * credited, saved, and only then topped up the wallet — three separate writes.
 * Two admins crediting at once both read `pending` and both paid.
 *
 * And the completion sweep looked for an existing grant before inserting one,
 * so two runs both found nothing and both granted. That is now a partial unique
 * index (earning_addon_one_grant_per_partner in constraints.sql, per offer,
 * rider and periodKey); the lookup stays as the fast path, the index is what
 * makes it true.
 *
 * An offer can target zones and cohorts, repeat daily or weekly, pay in
 * order-count slabs, and credit itself; the rules are in shared/incentiveRules.js.
 */

const num = (value) => Number(value) || 0;

const serializeAddon = (addon, now = Date.now()) => {
    const start = addon.startDate ? new Date(addon.startDate).getTime() : 0;
    const end = addon.endDate ? new Date(addon.endDate).getTime() : 0;

    return {
        ...addon,
        earningAmount: num(addon.earningAmount),
        zoneIds: addon.zoneIds || [],
        cohortIds: addon.cohortIds || [],
        recurrence: normalizeRecurrence(addon.recurrence),
        autoCredit: Boolean(addon.autoCredit),
        tiers: Array.isArray(addon.tiers) ? addon.tiers : [],
        isValid: Boolean(addon.status === 'active' && start && end && now >= start && now <= end),
        // 'expired' is a display state derived from the dates, not a stored one.
        status: end && now > end ? 'expired' : addon.status || 'inactive',
    };
};

export async function getEarningAddons() {
    const list = await prisma.foodEarningAddon.findMany({ orderBy: { createdAt: 'desc' } });
    const now = Date.now();
    return { earningAddons: list.map((addon) => serializeAddon(addon, now)) };
}

/** A list of ids that must all exist in `model`; undefined when not sent. */
async function checkIds(value, model, label) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (!Array.isArray(value)) throw new ValidationError(`${label} must be a list`);
    const ids = [...new Set(value.map((v) => String(v ?? '').trim()).filter(Boolean))];
    const unknown = `Unknown ${label === 'zoneIds' ? 'zone' : 'cohort'}`;
    if (ids.some((v) => !isId(v))) throw new ValidationError(unknown);
    if (ids.length && (await prisma[model].count({ where: { id: { in: ids } } })) !== ids.length) {
        throw new ValidationError(unknown);
    }
    return ids;
}

/**
 * The fields an admin can set. Targeting, recurrence, auto-credit and slabs
 * are only written when sent, so an older admin screen that does not know
 * about them leaves them as they are.
 */
const addonFields = async (body = {}) => {
    let tiers;
    try {
        tiers = cleanTiers(body.tiers);
    } catch (message) {
        throw new ValidationError(String(message));
    }
    if (tiers?.length && body.criteria === 'online_hours') {
        throw new ValidationError('Order slabs only apply to order-count incentives');
    }
    if (body.recurrence !== undefined && !['none', 'daily', 'weekly'].includes(String(body.recurrence))) {
        throw new ValidationError('recurrence must be none, daily or weekly');
    }
    return {
        title: body.title,
        ...(body.description !== undefined ? { description: String(body.description ?? '') } : {}),
        criteria: body.criteria === 'online_hours' ? 'online_hours' : 'orders',
        requiredOrders: Number(body.requiredOrders) || 0,
        requiredOnlineMinutes: Number(body.requiredOnlineMinutes) || 0,
        earningAmount: Number(body.earningAmount) || 0,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        maxRedemptions: body.maxRedemptions ?? null,
        zoneIds: await checkIds(body.zoneIds, 'foodZone', 'zoneIds'),
        cohortIds: await checkIds(body.cohortIds, 'foodRiderCohort', 'cohortIds'),
        recurrence: body.recurrence === undefined ? undefined : normalizeRecurrence(body.recurrence),
        autoCredit: body.autoCredit === undefined ? undefined : body.autoCredit === true,
        tiers,
    };
};

export async function createEarningAddon(body = {}) {
    const created = await prisma.foodEarningAddon.create({
        data: { ...(await addonFields(body)), status: 'active' },
    });
    return serializeAddon(created);
}

export async function updateEarningAddon(id, body = {}) {
    if (!isId(id)) return null;

    const { count } = await prisma.foodEarningAddon.updateMany({
        where: { id: String(id) },
        data: await addonFields(body),
    });
    if (!count) return null;

    return serializeAddon(await prisma.foodEarningAddon.findUnique({ where: { id: String(id) } }));
}

export async function deleteEarningAddon(id) {
    if (!isId(id)) return null;
    const { count } = await prisma.foodEarningAddon.deleteMany({ where: { id: String(id) } });
    return count ? { id: String(id) } : null;
}

export async function toggleEarningAddonStatus(id, status) {
    if (!isId(id)) return null;

    const { count } = await prisma.foodEarningAddon.updateMany({
        where: { id: String(id) },
        data: { status },
    });
    if (!count) return null;

    return serializeAddon(await prisma.foodEarningAddon.findUnique({ where: { id: String(id) } }));
}

// ─── Grant history ───────────────────────────────────────────────────────────

const HISTORY_INCLUDE = {
    deliveryPartner: { select: { id: true, name: true, phone: true, email: true } },
    offer: { select: { id: true, title: true, criteria: true, requiredOrders: true, requiredOnlineMinutes: true, earningAmount: true } },
};

const serializeHistory = (h, index = 0, offset = 0) => ({
    _id: h.id,
    id: h.id,
    sl: offset + index + 1,
    deliveryPartnerId: h.deliveryPartnerId,
    deliveryId: h.deliveryPartnerId ? `DP-${h.deliveryPartnerId.slice(-8).toUpperCase()}` : null,
    deliveryman: h.deliveryPartner?.name || '',
    deliveryPhone: h.deliveryPartner?.phone || 'N/A',
    offerTitle: h.offer?.title || '',
    criteria: h.offer?.criteria || 'orders',
    ordersCompleted: h.ordersCompleted ?? 0,
    ordersRequired: h.ordersRequired ?? h.offer?.requiredOrders ?? 0,
    onlineMinutesCompleted: h.onlineMinutesCompleted ?? 0,
    onlineMinutesRequired: h.onlineMinutesRequired ?? h.offer?.requiredOnlineMinutes ?? 0,
    earningAmount: num(h.earningAmount ?? h.offer?.earningAmount),
    totalEarning: num(h.totalEarning ?? h.earningAmount),
    status: h.status || 'pending',
    // Which run (day / week) and slab of the offer this grant is for.
    periodKey: h.periodKey || '',
    periodStart: h.periodStart || null,
    periodEnd: h.periodEnd || null,
    tier: h.tier || 0,
    date: h.completedAt || h.createdAt,
    completedAt: h.completedAt || h.createdAt,
});

export async function getEarningAddonHistory(query = {}) {
    const limit = Math.max(1, Math.min(1000, Number(query.limit) || 100));
    const page = Math.max(1, Number(query.page) || 1);
    const skip = (page - 1) * limit;

    const where = {};
    // From/to, as whole India days; the list had no date filter.
    const range = dayRange(query);
    if (range) where.completedAt = range;
    const search = typeof query.search === 'string' ? query.search.trim() : '';

    if (search) {
        // The searchable names live on the partner and the offer, so the filter
        // reaches through the relations rather than pre-resolving id lists.
        const contains = { contains: search, mode: 'insensitive' };
        where.OR = [
            { deliveryPartner: { OR: [{ name: contains }, { phone: contains }, { email: contains }] } },
            { offer: { title: contains } },
        ];
    }

    const [list, total] = await Promise.all([
        prisma.foodEarningAddonHistory.findMany({
            where,
            orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
            skip,
            take: limit,
            include: HISTORY_INCLUDE,
        }),
        prisma.foodEarningAddonHistory.count({ where }),
    ]);

    return {
        history: list.map((h, i) => serializeHistory(h, i, skip)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
}

export async function creditEarningAddonHistory(historyId, notes) {
    if (!isId(historyId)) return null;

    const existing = await prisma.foodEarningAddonHistory.findUnique({
        where: { id: String(historyId) },
        include: HISTORY_INCLUDE,
    });
    if (!existing) return null;
    // Already decided: report it rather than paying again.
    if (existing.status !== 'pending') return serializeHistory(existing);

    const amount = num(existing.earningAmount);

    const credited = await prisma.$transaction(async (tx) => {
        // Claim it. Only the caller that moves it out of pending pays.
        const { count } = await tx.foodEarningAddonHistory.updateMany({
            where: { id: String(historyId), status: 'pending' },
            data: {
                status: 'credited',
                creditedAt: new Date(),
                creditedNotes: typeof notes === 'string' ? notes.trim() : '',
            },
        });
        if (!count) return false;

        if (amount > 0) {
            // The credit and its ledger entry share this transaction, so a
            // rider paid an earning addon gets a row in their transaction
            // history explaining why the balance moved. recordTransaction
            // creates the wallet row itself if the partner doesn't have one yet.
            await recordTransaction(
                {
                    entityType: 'deliveryBoy',
                    entityId: existing.deliveryPartnerId,
                    type: 'credit',
                    amount,
                    description: `Earning Addon: ${existing.offer?.title || 'Offer Reward'}`,
                    category: 'delivery_earning',
                    idempotencyKey: `earning_addon:${existing.id}`,
                    metadata: { earningAddonHistoryId: existing.id },
                },
                { client: tx },
            );

            // The bonus-feed row shares the transaction too. It used to be a
            // fire-and-forget create in its own try/catch, so a failure left
            // the rider's balance moving with nothing explaining it.
            await tx.deliveryBonusTransaction.create({
                data: {
                    deliveryPartnerId: existing.deliveryPartnerId,
                    transactionId: `ADDON-${existing.id.slice(-8).toUpperCase()}`,
                    amount,
                    reference: `Earning Addon: ${existing.offer?.title || 'Offer Reward'}`,
                },
            });
        }

        return true;
    });

    const fresh = await prisma.foodEarningAddonHistory.findUnique({
        where: { id: String(historyId) },
        include: HISTORY_INCLUDE,
    });

    if (credited) {
        // Outside the transaction: a push failure must not undo the payment.
        try {
            const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnerSafely(
                { ownerType: 'DELIVERY_PARTNER', ownerId: existing.deliveryPartnerId },
                {
                    title: 'Incentive Credited',
                    body: `Your incentive for "${existing.offer?.title || 'Earning Addon'}" has been approved and moved to your pocket.`,
                    data: {
                        type: 'incentive_credited',
                        historyId: existing.id,
                        amount: String(amount),
                    },
                },
            );
        } catch (e) {
            logger.error('Failed to send incentive credited notification:', e);
        }
    }

    return serializeHistory(fresh);
}

export async function cancelEarningAddonHistory(historyId, reason) {
    if (!isId(historyId)) return null;

    const existing = await prisma.foodEarningAddonHistory.findUnique({
        where: { id: String(historyId) },
        include: HISTORY_INCLUDE,
    });
    if (!existing) return null;
    if (existing.status !== 'pending') return serializeHistory(existing);

    const cancelReason = typeof reason === 'string' ? reason.trim() : '';

    const { count } = await prisma.foodEarningAddonHistory.updateMany({
        where: { id: String(historyId), status: 'pending' },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason },
    });

    if (count) {
        try {
            const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnerSafely(
                { ownerType: 'DELIVERY_PARTNER', ownerId: existing.deliveryPartnerId },
                {
                    title: 'Incentive Update',
                    body: `Your incentive request for "${existing.offer?.title || 'Earning Addon'}" was not approved. Reason: ${cancelReason || 'Ineligible'}`,
                    data: { type: 'incentive_rejected', historyId: existing.id, reason: cancelReason },
                },
            );
        } catch (e) {
            logger.error('Failed to send incentive rejection notification:', e);
        }
    }

    const fresh = await prisma.foodEarningAddonHistory.findUnique({
        where: { id: String(historyId) },
        include: HISTORY_INCLUDE,
    });
    return serializeHistory(fresh);
}

/**
 * Minutes a rider spent online inside a window.
 *
 * Shifts are clipped to the window rather than counted whole, so one that
 * started before it or is still running only contributes the part that falls
 * inside -- otherwise an offer could be earned with time worked before it
 * began. A shift with no end is measured up to now, since the rider is on it.
 *
 * Shifts the reaper closed are included: the rider was online, the app just
 * never said when they stopped. They are flagged in the duty log so an admin
 * can see which hours those were before crediting.
 */
export async function onlineMinutesInWindow(partnerId, from, to) {
    const sessions = await prisma.foodDeliveryPartnerSession.findMany({
        where: {
            deliveryPartnerId: partnerId,
            wentOnlineAt: { lte: to },
            OR: [{ wentOfflineAt: null }, { wentOfflineAt: { gte: from } }],
        },
        select: { wentOnlineAt: true, wentOfflineAt: true },
    });

    const now = Date.now();
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();

    const ms = sessions.reduce((sum, session) => {
        const openedAt = Math.max(new Date(session.wentOnlineAt).getTime(), start);
        const closedAt = Math.min(
            session.wentOfflineAt ? new Date(session.wentOfflineAt).getTime() : now,
            end,
        );
        return sum + Math.max(0, closedAt - openedAt);
    }, 0);

    return Math.round(ms / 60000);
}

/** Zones of each active cohort among the given riders, by cohort id. */
export async function cohortZonesFor(riders) {
    const cohortIds = [...new Set(riders.map((r) => r.cohortId).filter(Boolean))];
    if (!cohortIds.length) return new Map();
    const cohorts = await prisma.foodRiderCohort.findMany({
        where: { id: { in: cohortIds }, isActive: true },
        select: { id: true, zoneIds: true },
    });
    return new Map(cohorts.map((c) => [c.id, c.zoneIds || []]));
}

/**
 * Grant any incentive a rider has now qualified for.
 *
 * @param {string} deliveryPartnerId  a rider id, or 'all' to sweep everyone
 *
 * `afterDelivery` is the automatic check run when a rider completes a delivery.
 * It leaves alone any target an admin already rejected for that rider in this
 * period; otherwise the rider's very next delivery would put the rejected claim
 * straight back in the approval queue. The admin's own sweep can still re-grant it.
 *
 * Per offer and rider: skip riders the offer is not for (zones / cohorts), work
 * out the current run (the whole offer, or today / this week for a recurring
 * one), count delivered orders (only in the offer's zones, if it has any) or
 * online minutes in that run, and grant every target (or slab) newly reached.
 * Grants on an autoCredit offer are credited straight away.
 */
export async function checkEarningAddonCompletions(deliveryPartnerId, _force = false, { afterDelivery = false, now = new Date() } = {}) {
    const activeOffers = await prisma.foodEarningAddon.findMany({
        where: { status: 'active', startDate: { lte: now }, endDate: { gte: now } },
    });
    if (!activeOffers.length) return { completionsFound: 0, autoCredited: 0 };

    let where = null;
    if (deliveryPartnerId === 'all') where = { status: 'approved' };
    else if (isId(deliveryPartnerId)) where = { id: String(deliveryPartnerId) };
    if (!where) return { completionsFound: 0, autoCredited: 0 };

    const riders = await prisma.foodDeliveryPartner.findMany({
        where,
        select: { id: true, zoneId: true, cohortId: true },
    });
    if (!riders.length) return { completionsFound: 0, autoCredited: 0 };
    const cohortZones = await cohortZonesFor(riders);

    let completionsFound = 0;
    const toAutoCredit = [];

    for (const rider of riders) {
        const partnerId = rider.id;
        for (const offer of activeOffers) {
            if (!riderTargeted(offer, rider, cohortZones.get(rider.cohortId) || [])) continue;
            const period = offerPeriod(offer, now);
            if (!period) continue;

            const targets = offerTargets(offer).map((t) => ({ ...t, key: grantKey(period.key, t.tier) }));
            // Fast path. The unique index is what actually prevents a double
            // grant when two sweeps overlap.
            const existing = await prisma.foodEarningAddonHistory.findMany({
                where: {
                    deliveryPartnerId: partnerId,
                    offerId: offer.id,
                    periodKey: { in: targets.map((t) => t.key) },
                    status: { in: afterDelivery ? ['pending', 'credited', 'cancelled'] : ['pending', 'credited'] },
                },
                select: { periodKey: true },
            });
            const taken = new Set(existing.map((e) => e.periodKey));
            const open = targets.filter((t) => !taken.has(t.key));
            if (!open.length) continue;

            // Counted by when the order was delivered, the same way the rider's
            // app shows progress. By createdAt, an order placed before the offer
            // and delivered during it showed as progress but never counted.
            const orderCount = await prisma.foodOrder.count({
                where: {
                    dispatchDeliveryPartnerId: partnerId,
                    orderStatus: 'delivered',
                    deliveredAt: { gte: period.start, lte: period.end },
                    ...(offer.zoneIds?.length ? { zoneId: { in: offer.zoneIds } } : {}),
                },
            });
            const onlineMinutes =
                offer.criteria === 'online_hours'
                    ? await onlineMinutesInWindow(partnerId, period.start, period.end)
                    : 0;

            for (const target of open) {
                if (!targetMet(offer, target, { orders: orderCount, onlineMinutes })) continue;
                try {
                    const grant = await prisma.$transaction(async (tx) => {
                        // maxRedemptions was stored and never checked, so a capped
                        // offer could be granted without limit. The cap is part of
                        // the increment, so the count cannot overshoot it.
                        if (offer.maxRedemptions != null) {
                            const { count } = await tx.foodEarningAddon.updateMany({
                                where: { id: offer.id, currentRedemptions: { lt: offer.maxRedemptions } },
                                data: { currentRedemptions: { increment: 1 } },
                            });
                            if (!count) return null; // Fully redeemed.
                        } else {
                            await tx.foodEarningAddon.update({
                                where: { id: offer.id },
                                data: { currentRedemptions: { increment: 1 } },
                            });
                        }

                        return tx.foodEarningAddonHistory.create({
                            data: {
                                offerId: offer.id,
                                deliveryPartnerId: partnerId,
                                ordersCompleted: orderCount,
                                ordersRequired: target.requiredOrders,
                                onlineMinutesCompleted: onlineMinutes,
                                onlineMinutesRequired: target.requiredOnlineMinutes || 0,
                                earningAmount: target.earningAmount,
                                totalEarning: target.earningAmount,
                                status: 'pending',
                                completedAt: now,
                                periodKey: target.key,
                                periodStart: period.start,
                                periodEnd: period.end,
                                tier: target.tier,
                            },
                            select: { id: true },
                        });
                    });
                    if (grant) {
                        completionsFound += 1;
                        if (offer.autoCredit) toAutoCredit.push(grant.id);
                    }
                } catch (error) {
                    // A concurrent sweep got there first; the unique index caught it.
                    if (error?.code !== 'P2002') throw error;
                }
            }
        }
    }

    // After the grants are committed. creditEarningAddonHistory claims the row
    // out of pending itself, so an auto-credit racing an admin's pays once.
    let autoCredited = 0;
    for (const historyId of toAutoCredit) {
        try {
            const result = await creditEarningAddonHistory(historyId, 'Auto-credited: target met');
            if (result?.status === 'credited') autoCredited += 1;
        } catch (error) {
            // Left pending for an admin rather than lost.
            logger.error(`Auto-credit of incentive ${historyId} failed: ${error?.message || error}`);
        }
    }

    return { completionsFound, autoCredited };
}
