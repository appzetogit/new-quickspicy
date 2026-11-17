import { parseDayBound } from '../../../../utils/timezone.js';
import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { saveImageFile, saveVideoFile, deleteStoredFile } from '../../../../services/storage.service.js';
import { makeBannerService } from './bannerService.factory.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    bannerZoneWhere,
    resolveBannerLink,
    resolveBannerZoneId,
    withoutOfflineRestaurants,
    withRestaurantLinkStatus,
} from './bannerRestaurant.service.js';

const BANNER_FOLDER = 'food/home-promotion-banners';
const banners = makeBannerService(prisma.homePromotionBanner, BANNER_FOLDER);

/** '' and undefined both mean "no bound"; a bare day is the whole day in India time. */
const toDate = (value, edge) => {
    const date = parseDayBound(value, edge);
    if (date === null) throw new Error('Dates must be valid, or left blank');
    return date ?? null;
};

const byOrder = [{ sortOrder: 'asc' }, { createdAt: 'desc' }];

/** Admin list, with each banner's restaurant and whether its restaurant link is broken. */
/** Admin list; [where] narrows it to the city or zone being viewed. */
export const listHomePromotionBanners = async (where = {}) =>
    withRestaurantLinkStatus(await prisma.homePromotionBanner.findMany({ where, orderBy: byOrder }));

/** Where a home promotion banner shows: the home screen, or the order tracking page (paid ads). */
export const BANNER_PLACEMENTS = ['home', 'tracking'];
const toPlacement = (value, fallback = 'home') => {
    const placement = String(value ?? '').trim().toLowerCase();
    if (!placement) return fallback;
    if (!BANNER_PLACEMENTS.includes(placement)) throw new ValidationError('Show on must be Home or Order tracking page');
    return placement;
};

/**
 * What the app shows: live banners for the customer's zone and placement,
 * minus those for a restaurant switched off.
 *
 * @param {string|{zoneId?: string, lat?: number, lng?: number, placement?: string}} query
 *   the zone (or the customer's lat/lng to find it) and where the banners go;
 *   a bare string is a zoneId, as older callers pass it.
 */
export const getPublicHomePromotionBanners = async (query = {}) => {
    const { zoneId, lat, lng, placement } = typeof query === 'object' && query !== null ? query : { zoneId: query };
    const now = new Date();
    const zone = await resolveBannerZoneId({ zoneId, lat, lng });
    const list = await prisma.homePromotionBanner.findMany({
        where: {
            isActive: true,
            // No placement is the home screen, which is all older apps ask for.
            placement: BANNER_PLACEMENTS.includes(String(placement || '').toLowerCase())
                ? String(placement).toLowerCase()
                : 'home',
            // An open-ended window is the common case: most banners set neither
            // date and must still show. The Mongo filter also had to match
            // startDate: "" — a string sitting in a date field. The column is
            // typed now, so that case cannot exist.
            AND: [
                { OR: [{ startDate: null }, { startDate: { lte: now } }] },
                { OR: [{ endDate: null }, { endDate: { gte: now } }] },
                // Every-zone banners, plus the customer's zone's own: a zone-2
                // banner never shows in zone 1.
                bannerZoneWhere(zone),
            ],
        },
        orderBy: byOrder,
    });
    return withoutOfflineRestaurants(list);
};

/**
 * The kind of banner a file makes. Videos are stored as they are (MP4 / WebM,
 * no transcoding here); images and GIFs go through the image pipeline, which
 * keeps a GIF's animation (as animated WebP when that is smaller).
 */
const mediaTypeOf = (file) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    if (mime.startsWith('video/')) return 'video';
    if (mime === 'image/gif') return 'gif';
    return 'image';
};

/**
 * @param file    the image, GIF or video
 * @param meta    title, ctaLink / restaurantId, placement, zoneId, dates, sortOrder
 * @param poster  optional still for a video banner, shown before it plays and
 *                by apps that cannot play video
 */
export const createHomePromotionBanner = async (file, meta = {}, { poster = null } = {}) => {
    if (!file) return null;
    // Before the upload, so a bad restaurant link is a clear 400 and no
    // orphaned file is left behind.
    const link = await resolveBannerLink({ ctaLink: meta.ctaLink, restaurantId: meta.restaurantId });
    const placement = toPlacement(meta.placement);
    const mediaType = mediaTypeOf(file);
    if (poster && mediaType !== 'video') throw new ValidationError('A poster is only for video banners');

    const saved = [];
    try {
        let picture;
        let video = null;
        if (mediaType === 'video') {
            video = await saveVideoFile(file, BANNER_FOLDER);
            saved.push(video.path);
            picture = poster ? await saveImageFile(poster, BANNER_FOLDER) : video;
            if (poster) saved.push(picture.path);
        } else {
            picture = await saveImageFile(file, BANNER_FOLDER);
            saved.push(picture.path);
        }

        return await prisma.homePromotionBanner.create({
            data: {
                imageUrl: picture.url,
                publicId: picture.path,
                mediaType,
                videoUrl: video?.url ?? null,
                videoPath: video?.path ?? null,
                title: meta.title,
                ctaLink: link.ctaLink ?? meta.ctaLink,
                restaurantId: link.restaurantId ?? null,
                placement,
                zoneId: isId(meta.zoneId) ? String(meta.zoneId) : null,
                startDate: toDate(meta.startDate, 'start'),
                endDate: toDate(meta.endDate, 'end'),
                sortOrder: Number(meta.sortOrder) || 0,
                isActive: true,
            },
        });
    } catch (error) {
        // Nothing half-made left on disk.
        await Promise.all(saved.map((p) => deleteStoredFile(p).catch(() => {})));
        // A wrong format or a file too big is the admin's to fix: keep it a 400.
        if (error instanceof ValidationError) throw error;
        throw new Error(`Banner creation failed: ${error.message}`);
    }
};

export const updateHomePromotionBanner = async (id, data = {}) => {
    const {
        startDate, endDate, zoneId, ctaLink, restaurantId, placement,
        // The media is set by the upload, never by a PATCH body.
        imageUrl: _i, publicId: _p, mediaType: _m, videoUrl: _v, videoPath: _vp,
        ...rest
    } = data;
    const updates = { ...rest, ...(await resolveBannerLink({ ctaLink, restaurantId })) };
    if (placement !== undefined) updates.placement = toPlacement(placement);

    // Only touch a field the caller actually sent — a PATCH that changes the
    // title must not clear the schedule.
    if (startDate !== undefined) updates.startDate = toDate(startDate, 'start');
    if (endDate !== undefined) updates.endDate = toDate(endDate, 'end');
    if (zoneId !== undefined) updates.zoneId = isId(zoneId) ? String(zoneId) : null;

    return prisma.homePromotionBanner
        .update({ where: { id }, data: updates })
        .catch((error) => {
            if (error?.code === 'P2025') return null;
            throw error;
        });
};

/** Also removes a video banner's video; the factory only knows the picture. */
export const deleteHomePromotionBanner = async (id) => {
    const doc = await prisma.homePromotionBanner.findUnique({ where: { id: String(id) }, select: { videoPath: true, publicId: true } });
    const result = await banners.remove(id);
    if (result?.deleted && doc?.videoPath && doc.videoPath !== doc.publicId) {
        await deleteStoredFile(doc.videoPath).catch(() => {});
    }
    return result;
};
export const toggleHomePromotionBannerStatus = banners.setActive;
export const updateHomePromotionBannerOrder = banners.setOrder;
