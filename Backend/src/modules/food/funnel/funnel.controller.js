import { ingestEvents } from './funnelEvents.service.js';
import { getFunnelReport } from './funnelReport.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * POST /api/v1/food/events -- public, rate limited, token optional.
 *
 * Answers 202 with what was kept. A body that is not a batch gets 400; a
 * database hiccup is logged and still answered 202 with nothing accepted, so
 * an app never retries in a loop or shows an error for analytics.
 */
export const ingestFunnelEventsController = async (req, res) => {
    try {
        const result = await ingestEvents(req.body, { user: req.user || null });
        if (!result) {
            return res.status(400).json({ success: false, message: 'Send { events: [...] } with up to 50 events' });
        }
        return res.status(202).json({ success: true, message: 'Events received', data: result });
    } catch (err) {
        logger.warn(`Funnel events not stored: ${err?.message || err}`);
        return res.status(202).json({ success: true, message: 'Events received', data: { received: 0, accepted: 0, dropped: 0 } });
    }
};

/** GET /api/v1/food/admin/reports/funnel (report_management). */
export const funnelReportController = async (req, res, next) => {
    try {
        const data = await getFunnelReport(req.query || {});
        return res.status(200).json({ success: true, message: 'Funnel report fetched', data });
    } catch (error) {
        return next(error);
    }
};
