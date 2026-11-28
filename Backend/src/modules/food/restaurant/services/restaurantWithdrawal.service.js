import { prisma } from '../../../../config/prisma.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { getRestaurantFinance } from './restaurantFinance.service.js';
import { alertAdmins } from '../../admin/services/decisionNotify.js';
import { restaurantDisplayId } from '../../../../utils/helpers.js';

/**
 * A restaurant asking to be paid out. Admin acts on these in
 * adminWithdrawal.service.js.
 */

// Decimal columns reach JSON as strings otherwise.
const serialize = (w) => ({ ...w, amount: Number(w.amount) });

const rupees = (value) => `₹${Number(value).toLocaleString('en-IN')}`;

export async function createWithdrawalRequest(restaurantId, { amount, bankDetails } = {}) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new ValidationError('Invalid withdrawal amount');

    // The balance is derived from order aggregates (pending withdrawals count
    // against it), not a stored column, so two requests sent at once could both
    // pass the check. A per-restaurant lock held until the insert commits makes
    // the second one see the first.
    const withdrawal = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restaurant_withdrawal:${restaurantId}`}))`;
        const finance = await getRestaurantFinance(restaurantId);

        const lockedAmount = Math.max(0, Number(finance?.subscription?.lockedAmount || 0));
        const lockedMonths = String(finance?.subscription?.lockedMonths || '');
        const netAvailable = Math.max(
            0,
            Number(finance?.wallet?.netAvailable ?? finance?.currentCycle?.netAvailable ?? 0),
        );

        if (value > netAvailable) {
            if (lockedAmount > 0) {
                throw new ValidationError(
                    `Withdrawal restricted. ${rupees(lockedAmount)} is locked against subscription dues`
                    + `${lockedMonths ? ` for ${lockedMonths}` : ''}.`
                    + ` Available to withdraw: ${rupees(netAvailable)}`,
                );
            }
            throw new ValidationError(`Insufficient balance. Available to withdraw: ${rupees(netAvailable)}`);
        }

        return tx.foodRestaurantWithdrawal.create({
            data: { restaurantId, amount: value, bankDetails: bankDetails ?? undefined, status: 'pending' },
        });
    }, { timeout: 15000 });

    void prisma.foodRestaurant.findUnique({ where: { id: String(restaurantId) }, select: { restaurantName: true } })
        .then((r) => alertAdmins({
            title: 'New restaurant withdrawal request',
            body: `${r?.restaurantName || 'A restaurant'} (${restaurantDisplayId(restaurantId)}) requested ${rupees(value)}.`,
            data: {
                type: 'withdrawal_request', subType: 'restaurant', withdrawalId: withdrawal.id,
                restaurantId: String(restaurantId), amount: String(value), link: '/admin/food/restaurant-withdraws',
            },
        }))
        .catch(() => {});

    return serialize(withdrawal);
}

export async function listMyWithdrawals(restaurantId) {
    const rows = await prisma.foodRestaurantWithdrawal.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
    });
    return rows.map(serialize);
}
