import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import {
    createHomePromotionBanner, deleteHomePromotionBanner, updateHomePromotionBanner,
} from './homePromotionBanner.service.js';

/**
 * Promotion banners as an animated GIF or a video. Videos are stored as they
 * are; a GIF goes through the image pipeline and keeps its animation.
 */
const made = [];

// A 1x1 GIF.
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
// Not a playable video, but the server does not decode videos: it checks the
// type and size and stores the bytes as they are.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);

test.after(async () => {
    await prisma.homePromotionBanner.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
});

test('a video banner stores the video and uses it as its picture when there is no poster', async () => {
    const banner = await createHomePromotionBanner(
        { buffer: MP4, mimetype: 'video/mp4', originalname: 'promo.mp4' },
        { title: 'Video promo' },
    );
    made.push(banner.id);
    assert.equal(banner.mediaType, 'video');
    assert.match(banner.videoUrl, /\.mp4$/);
    assert.equal(banner.imageUrl, banner.videoUrl);

    // A PATCH body cannot rewrite the media.
    const patched = await updateHomePromotionBanner(banner.id, { title: 'Renamed', mediaType: 'image', videoUrl: 'x' });
    assert.equal(patched.title, 'Renamed');
    assert.equal(patched.mediaType, 'video');
    assert.equal(patched.videoUrl, banner.videoUrl);

    const removed = await deleteHomePromotionBanner(banner.id);
    assert.equal(removed.deleted, true);
});

test('a video banner can have a still poster', async () => {
    const banner = await createHomePromotionBanner(
        { buffer: MP4, mimetype: 'video/webm', originalname: 'promo.webm' },
        { title: 'With poster' },
        { poster: { buffer: GIF, mimetype: 'image/gif', originalname: 'p.gif' } },
    );
    made.push(banner.id);
    assert.equal(banner.mediaType, 'video');
    assert.match(banner.videoUrl, /\.webm$/);
    assert.notEqual(banner.imageUrl, banner.videoUrl);
});

test('a GIF banner is a gif, and an unplayable video format is a 400, not a 500', async () => {
    const gif = await createHomePromotionBanner({ buffer: GIF, mimetype: 'image/gif', originalname: 'a.gif' }, { title: 'GIF' });
    made.push(gif.id);
    assert.equal(gif.mediaType, 'gif');
    assert.equal(gif.videoUrl, null);

    await assert.rejects(
        () => createHomePromotionBanner({ buffer: MP4, mimetype: 'video/quicktime', originalname: 'a.mov' }, {}),
        (error) => error.name === 'ValidationError' && /MP4 and WebM/.test(error.message),
    );
    await assert.rejects(
        () => createHomePromotionBanner({ buffer: GIF, mimetype: 'image/gif' }, {}, { poster: { buffer: GIF, mimetype: 'image/gif' } }),
        /only for video banners/,
    );
});
