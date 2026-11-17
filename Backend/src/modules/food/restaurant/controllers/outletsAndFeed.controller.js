import { sendResponse } from '../../../../utils/response.js';
import { getOtherOutlets } from '../services/outlets.service.js';
import { getVideoFeed } from '../services/videoFeed.service.js';

export const getOtherOutletsController = async (req, res, next) => {
    try {
        const data = await getOtherOutlets(req.params.id, req.query || {});
        if (!data) return res.status(404).json({ success: false, message: 'Restaurant not found' });
        return sendResponse(res, 200, 'Outlets fetched successfully', data);
    } catch (error) {
        return next(error);
    }
};

/** Signed-in customers get it personalised; everyone else gets the same feed. */
export const getVideoFeedController = async (req, res, next) => {
    try {
        const userId = req.user?.role === 'USER' ? req.user.userId : null;
        return sendResponse(res, 200, 'Video feed fetched successfully', await getVideoFeed(req.query || {}, userId));
    } catch (error) {
        return next(error);
    }
};
