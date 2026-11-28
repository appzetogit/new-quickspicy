import { prisma } from '../../../../config/prisma.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';

/**
 * Tells a restaurant or rider the admin's decision on their application:
 * an inbox row (so the app's Notifications screen shows it even when the push
 * never arrived -- e.g. no device token yet) plus the push itself.
 * Never throws: a failed notification must not undo the decision.
 */
export async function notifyApplicationDecision(target, payload, link = '', category = 'account') {
    try {
        await prisma.foodNotification.create({
            data: {
                ownerType: target.ownerType,
                ownerId: String(target.ownerId),
                title: payload.title,
                message: payload.body,
                link,
                category,
                metadata: payload.data || {},
            },
        });
    } catch (e) {
        logger.warn(`Application decision inbox save failed: ${e?.message || e}`);
    }
    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        // The row above is the inbox copy; the push path must not add another.
        await notifyOwnerSafely(target, { ...payload, saveToInbox: false });
    } catch (e) {
        logger.warn(`Application decision push failed: ${e?.message || e}`);
    }
}

/**
 * Tells every admin something is waiting for them: the FCM push plus
 * `admin_notification` on the admin socket room, so an open panel can refresh
 * its bell straight away. Never throws, never delays the caller.
 */
export function alertAdmins({ title, body, data = {} }) {
    void import('../../../../core/notifications/firebase.service.js')
        .then(({ notifyAdminsSafely }) => notifyAdminsSafely({ title, body, data }))
        .catch((e) => logger.warn(`Admin push failed: ${e?.message || e}`));
    try {
        getIO()?.to(rooms.admin()).emit('admin_notification', { title, body, message: body, ...data, createdAt: new Date().toISOString() });
    } catch (e) {
        logger.warn(`Admin socket emit failed: ${e?.message || e}`);
    }
}

const rupees = (value) => `\u20b9${Number(value || 0).toLocaleString('en-IN')}`;

/** The restaurant's or rider's withdrawal was approved or rejected: inbox row + push. */
export async function notifyWithdrawalDecision(target, withdrawal, status, reason = '') {
    if (!['approved', 'rejected'].includes(status)) return;
    const approved = status === 'approved';
    const amount = rupees(withdrawal?.amount);
    await notifyApplicationDecision(
        target,
        {
            title: approved ? 'Withdrawal approved' : 'Withdrawal rejected',
            body: approved
                ? `Your withdrawal request of ${amount} has been approved.`
                : `Your withdrawal request of ${amount} was rejected.${reason ? ` Reason: ${reason}` : ''}`,
            data: {
                type: approved ? 'withdrawal_approved' : 'withdrawal_rejected',
                withdrawalId: String(withdrawal?.id || ''),
                amount: String(Number(withdrawal?.amount) || 0),
                status,
                reason: approved ? '' : String(reason || ''),
            },
        },
        '',
        'wallet',
    );
}
