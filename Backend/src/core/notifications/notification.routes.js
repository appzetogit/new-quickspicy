import express from 'express';
import {
    getInboxController,
    markNotificationReadController,
    dismissNotificationController,
    dismissAllNotificationsController,
    markAllNotificationsReadController
} from './notification.controller.js';

const router = express.Router();

router.get('/inbox', getInboxController);
// Before '/:id/read', so 'inbox' is not taken for an id.
router.patch('/inbox/read-all', markAllNotificationsReadController);
router.patch('/:id/read', markNotificationReadController);
router.delete('/:id', dismissNotificationController);
router.delete('/inbox/all', dismissAllNotificationsController);

export default router;
