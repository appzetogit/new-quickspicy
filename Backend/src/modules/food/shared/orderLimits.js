import { prisma } from '../../../config/prisma.js';
import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Two order limits the admin sets under Fee settings, for every zone alike:
 *
 *  - codMaxOrderValue: cash on delivery only for orders below this total.
 *    Not set means ₹2000; 0 means no limit.
 *  - maxItemQuantity: the most of one dish a customer can order (default 50).
 *
 * Stored on the default (all-zones) fee settings row. The app hides COD and
 * stops the + button; these checks are what actually holds.
 */
export const DEFAULT_COD_MAX_ORDER_VALUE = 2000;
export const DEFAULT_MAX_ITEM_QUANTITY = 50;

/** The limits in force, from the default fee settings row. */
export async function loadOrderLimits() {
    const row = await prisma.foodFeeSettings.findFirst({
        where: { zoneId: null, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { codMaxOrderValue: true, maxItemQuantity: true },
    });
    return resolveOrderLimits(row);
}

/** Stored values -> the limits in force. Exported for the tests. */
export function resolveOrderLimits(row) {
    const cod = row?.codMaxOrderValue === null || row?.codMaxOrderValue === undefined
        ? DEFAULT_COD_MAX_ORDER_VALUE
        : Number(row.codMaxOrderValue);
    const qty = Number(row?.maxItemQuantity);
    return {
        // 0 is "no limit".
        codMaxOrderValue: Number.isFinite(cod) && cod >= 0 ? cod : DEFAULT_COD_MAX_ORDER_VALUE,
        maxItemQuantity: Number.isInteger(qty) && qty >= 1 ? qty : DEFAULT_MAX_ITEM_QUANTITY,
    };
}

const rupees = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(2));

/** Refuses cash on delivery at or above the limit. */
export function assertCodAllowedForTotal(total, limits) {
    const limit = Number(limits?.codMaxOrderValue);
    if (!limit) return; // 0 = no limit
    if (Number(total) >= limit) {
        throw new ValidationError(`Cash on Delivery is available only for orders below ₹${rupees(limit)}`);
    }
}

/**
 * Refuses a cart with more of one dish than the limit. Lines for the same dish
 * and option are added up first, so splitting it over two lines (different
 * add-ons or notes) cannot get past the cap.
 */
export function assertItemQuantities(items, limits) {
    const max = Number(limits?.maxItemQuantity) || DEFAULT_MAX_ITEM_QUANTITY;
    const totals = new Map();
    (Array.isArray(items) ? items : []).forEach((item, index) => {
        const id = item?.itemId || item?.id;
        const key = id ? `${id}::${item?.variantId || ''}` : `line:${index}`;
        const sum = (totals.get(key) || 0) + (Number(item?.quantity) || 0);
        totals.set(key, sum);
        if (sum > max) {
            throw new ValidationError(`You can order at most ${max} of one item`);
        }
    });
}
