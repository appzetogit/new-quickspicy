import { prisma } from '../../../../config/prisma.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Tells a restaurant or rider the admin's decision on their application:
 * an inbox row (so the app's Notifications screen shows it even when the push
 * never arrived -- e.g. no device token yet) plus the push itself.
 * Never throws: a failed notification must not undo the decision.
 */
export async function notifyApplicationDecision(target, payload, link = '') {
    try {
        await prisma.foodNotification.create({
            data: {
                ownerType: target.ownerType,
                ownerId: String(target.ownerId),
                title: payload.title,
                message: payload.body,
                link,
                category: 'account',
                metadata: payload.data || {},
            },
        });
    } catch (e) {
        logger.warn(`Application decision inbox save failed: ${e?.message || e}`);
    }
    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely(target, payload);
    } catch (e) {
        logger.warn(`Application decision push failed: ${e?.message || e}`);
    }
}
