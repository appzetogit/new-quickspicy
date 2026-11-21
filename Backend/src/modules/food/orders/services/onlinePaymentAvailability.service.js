import { prisma } from '../../../../config/prisma.js';
import { isCodAvailable } from './codAvailability.service.js';

/**
 * Whether a customer may pay online (Razorpay checkout) for an order.
 *
 * The sibling of codAvailability: a zone can turn online payment off on its
 * own, for instance where the gateway keeps failing or settlements are being
 * disputed. There is no platform-wide switch, so a zone that says nothing
 * (null) takes online payments, as every zone did before this existed.
 *
 * What counts as "online": the Razorpay checkout created for a new order,
 * including the online part of a wallet + online split. What does not:
 *  - wallet-only orders (no gateway involved);
 *  - the rider's collection QR on a cash order (collect/qr, or razorpay_qr chosen
 *    at checkout) — that is cash on delivery collected digitally, not checkout;
 *  - wallet top-ups — a customer has no zone, so there is nothing to scope by;
 *  - verifying or reconciling a payment that was already started — only new
 *    orders are refused, never money already on its way.
 */

/** What the customer is told when online payment is off here. */
export const ONLINE_PAYMENT_OFF_MESSAGE =
    'Online payment is not available in this area right now. Please choose cash on delivery.';

/** What the customer is told when neither online nor cash can be used here. */
export const NO_PAYMENT_METHOD_MESSAGE =
    'No payment method is available for this order in this area right now. Please try again later or contact support.';

/**
 * Decide from a zone already in hand. Pure, so the rule is tested on its own.
 *
 * @param {{onlinePaymentEnabled?: boolean|null}|null} zone
 * @returns {{allowed: boolean, reason: string}}
 */
export const decideOnlinePayment = (zone) => {
    // Null, not false: a zone that has never been configured is not a zone that
    // has been switched off.
    if (zone && zone.onlinePaymentEnabled === false) {
        return { allowed: false, reason: 'zone-off' };
    }
    return { allowed: true, reason: 'ok' };
};

/** What the customer is told. Never the internal reason. */
export const onlinePaymentMessage = (reason) => (reason === 'ok' ? '' : ONLINE_PAYMENT_OFF_MESSAGE);

/**
 * Whether the customer is left with no way to pay at all.
 *
 * The wallet only counts when it covers the whole order: a part-paying wallet
 * still needs cash or online for the rest.
 */
export const decideNoPaymentMethod = ({ codAllowed, onlineAllowed, walletCoversAll = false }) =>
    !codAllowed && !onlineAllowed && !walletCoversAll;

/**
 * What a zone's online setting means in practice, for the admin screen.
 *
 * `bothOff` is the warning case: online is off and COD is off even for a
 * returning customer, so the only way to pay here is a wallet that covers the
 * whole order. Allowed (an admin may mean it, briefly), but shown loudly.
 *
 * @param {{onlinePaymentEnabled?: boolean|null}|null} zone
 * @param {{returningCustomer?: {allowed: boolean}}} effectiveCodResult from effectiveCod()
 */
export const effectiveOnlinePayment = (zone, effectiveCodResult) => {
    const online = decideOnlinePayment(zone);
    const codForAnyone = Boolean(effectiveCodResult?.returningCustomer?.allowed);
    return { ...online, bothOff: !online.allowed && !codForAnyone };
};

/**
 * The full check, for the order path and the checkout preview alike.
 *
 * Not cached: one read per order, and a stale answer would keep taking online
 * payments after an admin switched them off.
 */
export async function isOnlinePaymentAvailable({ zoneId }) {
    const zone = zoneId
        ? await prisma.foodZone.findUnique({
              where: { id: String(zoneId) },
              select: { onlinePaymentEnabled: true },
          })
        : null;
    const decision = decideOnlinePayment(zone);
    return { ...decision, message: onlinePaymentMessage(decision.reason) };
}

/**
 * Both answers checkout needs, in the shape /calculate returns them.
 *
 * @param {{userId?: string, zoneId?: string|null, walletCoversAll?: boolean}} input
 */
export async function resolvePaymentAvailability({ userId, zoneId, walletCoversAll = false }) {
    const [cod, online] = await Promise.all([
        isCodAvailable({ userId, zoneId }),
        isOnlinePaymentAvailable({ zoneId }),
    ]);
    const noPaymentMethod = decideNoPaymentMethod({
        codAllowed: cod.allowed,
        onlineAllowed: online.allowed,
        walletCoversAll,
    });
    return {
        codAvailable: cod.allowed,
        codMessage: cod.message || '',
        onlinePaymentAvailable: online.allowed,
        onlinePaymentMessage: online.message || '',
        noPaymentMethodAvailable: noPaymentMethod,
        noPaymentMethodMessage: noPaymentMethod ? NO_PAYMENT_METHOD_MESSAGE : '',
    };
}
