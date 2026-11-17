import * as bannerService from '../services/homePromotionBanner.service.js';
import { adminBannerZoneWhere, viewedZoneIds } from '../../../../core/roles/adminScope.service.js';

export const listHomePromotionBannersController = async (req, res, next) => {
    try {
        // Only the city or zone picked in the panel's header (and the
        // all-zones banners): this route is outside the admin router.
        const banners = await bannerService.listHomePromotionBanners(
            adminBannerZoneWhere(await viewedZoneIds(req)),
        );
        res.status(200).json({ success: true, banners });
    } catch (error) {
        next(error);
    }
};

export const createHomePromotionBannerController = async (req, res, next) => {
    try {
        // "file": the image, GIF or video. "poster": an optional still for a video.
        const file = req.files?.file?.[0] || req.file;
        const poster = req.files?.poster?.[0] || null;
        const meta = req.body;
        const banner = await bannerService.createHomePromotionBanner(file, meta, { poster });
        res.status(201).json({ success: true, banner });
    } catch (error) {
        next(error);
    }
};

export const updateHomePromotionBannerController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const banner = await bannerService.updateHomePromotionBanner(id, data);
        res.status(200).json({ success: true, banner });
    } catch (error) {
        next(error);
    }
};

export const deleteHomePromotionBannerController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await bannerService.deleteHomePromotionBanner(id);
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
};

export const toggleHomePromotionBannerStatusController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        const banner = await bannerService.toggleHomePromotionBannerStatus(id, isActive);
        res.status(200).json({ success: true, banner });
    } catch (error) {
        next(error);
    }
};

export const updateHomePromotionBannerOrderController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { sortOrder } = req.body;
        const banner = await bannerService.updateHomePromotionBannerOrder(id, sortOrder);
        res.status(200).json({ success: true, banner });
    } catch (error) {
        next(error);
    }
};
