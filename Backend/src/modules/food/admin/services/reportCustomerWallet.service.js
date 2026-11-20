import { prisma } from '../../../../config/prisma.js';
import { createdAtIn, fromPaise, pageOf, resolveDayWindow, toPaise } from './reportDays.js';

/**
 * Customer wallet utilisation: what went into customers' wallets (by where it
 * came from), what they spent from them, and per customer.
 *
 * Read from the wallet ledger (Transaction, entityType 'user'), the only
 * writer of wallet balances. Where a credit came from is its category, with
 * two kinds told apart by their description because they share
 * 'wallet_topup' with real top-ups -- the same rules as the Customer rewards
 * report (adminTools.service.js):
 *   top-up         wallet_topup, not cashback or bonus (paid online via Razorpay)
 *   top-up bonus   wallet_topup, description "Top-up bonus..."
 *   cashback       wallet_topup, description "Cashback..."
 *   referral       referral_reward
 *   refund         order_refund (order refunds, and wallet parts of unpaid orders returned)
 *   admin credit   adjustment
 *   other          any other credit category
 * Spent on orders is debits with category order_payment; anything else debited
 * is "other debits".
 */

export const CREDIT_SOURCES = [
    { key: 'topup', label: 'Wallet top-ups' },
    { key: 'topupBonus', label: 'Top-up bonus' },
    { key: 'cashback', label: 'Cashback' },
    { key: 'referral', label: 'Referral rewards' },
    { key: 'refund', label: 'Refunds' },
    { key: 'adminCredit', label: 'Added by admin' },
    { key: 'other', label: 'Other credits' },
];

const CATEGORY_SOURCE = {
    wallet_topup: 'topup',
    referral_reward: 'referral',
    order_refund: 'refund',
    adjustment: 'adminCredit',
};

const SORTS = {
    credited: (a, b) => b.credited - a.credited,
    spent: (a, b) => b.spentOnOrders - a.spentOnOrders,
    balance: (a, b) => b.currentBalance - a.currentBalance,
    recent: (a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt),
};

const emptyCustomer = (id) => ({
    customerId: id,
    credits: Object.fromEntries(CREDIT_SOURCES.map((s) => [s.key, 0])),
    credited: 0,
    spentOnOrders: 0,
    otherDebits: 0,
    debited: 0,
    transactions: 0,
    lastUsedAt: null,
});

/**
 * Fold ledger groups into per-customer totals (paise). `groups` are
 * groupBy(entityId, type, category) rows; `cashback` and `bonus` are
 * groupBy(entityId) rows of the wallet_topup credits that are not top-ups.
 * Pure, so it is tested without a database.
 */
export function foldWalletGroups(groups, cashback = [], bonus = []) {
    const byUser = new Map();
    const get = (id) => {
        if (!byUser.has(id)) byUser.set(id, emptyCustomer(id));
        return byUser.get(id);
    };

    for (const g of groups) {
        const row = get(g.entityId);
        const amount = toPaise(g._sum?.amount);
        row.transactions += g._count?._all || 0;
        const last = g._max?.createdAt;
        if (last && (!row.lastUsedAt || new Date(last) > new Date(row.lastUsedAt))) row.lastUsedAt = last;
        if (g.type === 'credit') {
            row.credits[CATEGORY_SOURCE[g.category] || 'other'] += amount;
            row.credited += amount;
        } else if (g.category === 'order_payment') {
            row.spentOnOrders += amount;
            row.debited += amount;
        } else {
            row.otherDebits += amount;
            row.debited += amount;
        }
    }
    // Cashback and the top-up bonus were counted as top-ups above; move them.
    for (const [list, key] of [[cashback, 'cashback'], [bonus, 'topupBonus']]) {
        for (const g of list) {
            const row = get(g.entityId);
            const amount = toPaise(g._sum?.amount);
            row.credits[key] += amount;
            row.credits.topup -= amount;
        }
    }
    return byUser;
}

export async function getCustomerWalletReport(query = {}) {
    const window = resolveDayWindow(query);
    const base = { entityType: 'user', status: 'completed', ...createdAtIn(window) };
    const topupCredit = { ...base, type: 'credit', category: 'wallet_topup' };

    const [groups, cashback, bonus, outstanding, withBalance] = await Promise.all([
        prisma.transaction.groupBy({
            by: ['entityId', 'type', 'category'],
            where: base,
            _sum: { amount: true },
            _count: { _all: true },
            _max: { createdAt: true },
        }),
        prisma.transaction.groupBy({
            by: ['entityId'],
            where: { ...topupCredit, description: { startsWith: 'Cashback' } },
            _sum: { amount: true },
        }),
        prisma.transaction.groupBy({
            by: ['entityId'],
            where: { ...topupCredit, description: { startsWith: 'Top-up bonus' } },
            _sum: { amount: true },
        }),
        // Today's balances, whatever the range: money customers still hold.
        prisma.wallet.aggregate({ where: { entityType: 'user' }, _sum: { balance: true } }),
        prisma.wallet.count({ where: { entityType: 'user', balance: { gt: 0 } } }),
    ]);

    const byUser = foldWalletGroups(groups, cashback, bonus);
    const ids = [...byUser.keys()];

    const [users, wallets] = ids.length
        ? await Promise.all([
            prisma.foodUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } }),
            prisma.wallet.findMany({
                where: { entityType: 'user', entityId: { in: ids } },
                select: { entityId: true, balance: true },
            }),
        ])
        : [[], []];
    const userById = new Map(users.map((u) => [u.id, u]));
    const balanceById = new Map(wallets.map((w) => [w.entityId, toPaise(w.balance)]));

    // Range totals, in paise.
    const sum = { credits: Object.fromEntries(CREDIT_SOURCES.map((s) => [s.key, 0])), credited: 0, spentOnOrders: 0, otherDebits: 0, debited: 0 };
    let spendingCustomers = 0;
    for (const row of byUser.values()) {
        for (const s of CREDIT_SOURCES) sum.credits[s.key] += row.credits[s.key];
        sum.credited += row.credited;
        sum.spentOnOrders += row.spentOnOrders;
        sum.otherDebits += row.otherDebits;
        sum.debited += row.debited;
        if (row.spentOnOrders > 0) spendingCustomers += 1;
    }

    let customers = [...byUser.values()].map((row) => {
        const user = userById.get(row.customerId);
        return {
            customerId: row.customerId,
            name: user?.name || '',
            phone: user?.phone || '',
            deleted: !user,
            credits: Object.fromEntries(CREDIT_SOURCES.map((s) => [s.key, fromPaise(row.credits[s.key])])),
            credited: fromPaise(row.credited),
            spentOnOrders: fromPaise(row.spentOnOrders),
            otherDebits: fromPaise(row.otherDebits),
            net: fromPaise(row.credited - row.debited),
            currentBalance: fromPaise(balanceById.get(row.customerId) || 0),
            transactions: row.transactions,
            lastUsedAt: row.lastUsedAt,
        };
    });

    const search = String(query.search || '').trim().toLowerCase();
    if (search) {
        customers = customers.filter((c) => c.name.toLowerCase().includes(search) || c.phone.includes(search));
    }
    customers.sort(SORTS[String(query.sort || '').trim()] || SORTS.spent);

    const { page, limit, skip } = pageOf(query, { defaultLimit: 100, maxLimit: 2000 });

    return {
        range: window ? { from: window.fromDay, to: window.toDay } : null,
        summary: {
            totalCredited: fromPaise(sum.credited),
            spentOnOrders: fromPaise(sum.spentOnOrders),
            otherDebits: fromPaise(sum.otherDebits),
            totalDebited: fromPaise(sum.debited),
            net: fromPaise(sum.credited - sum.debited),
            customersUsingWallet: byUser.size,
            customersSpentFromWallet: spendingCustomers,
            // Not limited to the range: balances as they are now.
            outstandingBalance: fromPaise(toPaise(outstanding._sum.balance)),
            customersWithBalance: withBalance,
        },
        creditsBySource: CREDIT_SOURCES.map((s) => ({ ...s, amount: fromPaise(sum.credits[s.key]) })),
        customers: customers.slice(skip, skip + limit),
        pagination: { page, limit, total: customers.length, pages: Math.ceil(customers.length / limit) || 1 },
    };
}
