import { prisma } from '../../../../config/prisma.js';
import { notifyOwnerSafely, notifyAdminsSafely } from '../../../../core/notifications/firebase.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const toDateLabel = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
};

const startOfToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const nextDay = (date) => new Date(date.getTime() + DAY_MS);

const buildAdminSummary = (restaurant) => {
    const expiryDate = restaurant.fssaiExpiry ? new Date(restaurant.fssaiExpiry) : null;
    const expiryLabel = toDateLabel(expiryDate);
    const restaurantName = restaurant.restaurantName || 'Restaurant';
    return {
        id: `fssai-expired-${restaurant.id}`,
        restaurantId: restaurant.id,
        restaurantName,
        ownerName: restaurant.ownerName || '',
        ownerPhone: restaurant.ownerPhone || '',
        fssaiNumber: restaurant.fssaiNumber || '',
        fssaiExpiry: expiryDate ? expiryDate.toISOString() : null,
        expiryLabel,
        title: 'FSSAI License Expired',
        message: `${restaurantName} FSSAI expired on ${expiryLabel}. Owner: ${restaurant.ownerName || 'N/A'}.`,
        createdAt: expiryDate
            ? expiryDate.toISOString()
            : restaurant.updatedAt || restaurant.createdAt || new Date().toISOString(),
        path: '/admin/food/restaurants'
    };
};

export const listExpiredFssaiRestaurants = async () => {
    // Anything dated before tomorrow has expired: a licence that runs out today
    // is not valid tomorrow, and the column carries no time of day.
    const restaurants = await prisma.foodRestaurant.findMany({
        where: { status: 'approved', fssaiExpiry: { lt: nextDay(startOfToday()) } },
        select: {
            id: true,
            restaurantName: true,
            ownerName: true,
            ownerPhone: true,
            fssaiNumber: true,
            fssaiExpiry: true,
            createdAt: true,
            updatedAt: true,
        },
        orderBy: [{ fssaiExpiry: 'desc' }, { updatedAt: 'desc' }],
    });

    return restaurants.filter((r) => r.fssaiExpiry).map(buildAdminSummary);
};

export const syncExpiredFssaiNotifications = async () => {
    const restaurants = await listExpiredFssaiRestaurants();
    if (!restaurants.length) return { totalExpired: 0, createdCount: 0 };

    // One read for the whole batch. The old code asked per restaurant, so a
    // hundred expired licences meant a hundred round trips before any work.
    const alreadySent = await prisma.foodNotification.findMany({
        where: {
            ownerType: 'RESTAURANT',
            source: 'FSSAI_EXPIRY',
            ownerId: { in: restaurants.map((r) => r.restaurantId) },
        },
        select: { ownerId: true, metadata: true },
    });

    // Keyed by expiry too: a renewed-then-expired-again licence is a new alert,
    // but the same expiry date must never be announced twice.
    // The 30-day warnings share the source; they must not count as the expiry alert.
    const seen = new Set(
        alreadySent
            .filter((n) => n.metadata?.kind !== 'expiring')
            .map((n) => `${n.ownerId}|${n.metadata?.expiryDate || ''}`)
    );

    let createdCount = 0;

    for (const summary of restaurants) {
        const { restaurantId, fssaiExpiry: expiryIso } = summary;
        if (!restaurantId || !expiryIso) continue;
        if (seen.has(`${restaurantId}|${expiryIso}`)) continue;

        const message = `${summary.restaurantName} FSSAI license expired on ${summary.expiryLabel}.`
            + ` Owner: ${summary.ownerName || 'Restaurant owner'}.`
            + ` FSSAI No: ${summary.fssaiNumber || 'N/A'}.`;

        // ponytail: check-then-insert. Safe because this runs from a single
        // scheduled job; a unique index on (ownerId, source, expiry) is the fix
        // if it ever runs concurrently.
        await prisma.foodNotification.create({
            data: {
                ownerType: 'RESTAURANT',
                ownerId: restaurantId,
                title: 'FSSAI License Expired',
                message,
                link: '/restaurant/fssai',
                category: 'compliance',
                source: 'FSSAI_EXPIRY',
                metadata: {
                    restaurantId,
                    restaurantName: summary.restaurantName,
                    ownerName: summary.ownerName,
                    ownerPhone: summary.ownerPhone,
                    fssaiNumber: summary.fssaiNumber,
                    expiryDate: expiryIso,
                },
            },
        });
        seen.add(`${restaurantId}|${expiryIso}`);

        const data = {
            restaurantId,
            expiryDate: expiryIso,
            fssaiNumber: summary.fssaiNumber || '',
        };

        await notifyOwnerSafely(
            { ownerType: 'RESTAURANT', ownerId: restaurantId },
            { title: 'FSSAI License Expired', body: message, data: { type: 'fssai_expired', ...data } }
        );

        await notifyAdminsSafely({
            title: 'Restaurant FSSAI Expired',
            body: summary.message,
            data: { type: 'restaurant_fssai_expired', ...data },
        });

        createdCount += 1;
    }

    return { totalExpired: restaurants.length, createdCount };
};

// ─── Pre-expiry warning and ordering block ──────────────────────────────────

export const FSSAI_WARNING_DAYS = 30;
export const FSSAI_SETTINGS_KEY = 'fssai_compliance';
export const FSSAI_BLOCK_MESSAGE =
    'This restaurant is not taking orders right now: its FSSAI food licence has expired.';

const summaryFields = {
    id: true,
    restaurantName: true,
    ownerName: true,
    ownerPhone: true,
    fssaiNumber: true,
    fssaiExpiry: true,
    zoneId: true,
    isAcceptingOrders: true,
    createdAt: true,
    updatedAt: true,
};

/** Approved restaurants whose licence runs out within `days` days (not yet expired). */
export const listExpiringFssaiRestaurants = async (days = FSSAI_WARNING_DAYS) => {
    const from = nextDay(startOfToday());
    const to = new Date(from.getTime() + Math.max(1, Number(days) || FSSAI_WARNING_DAYS) * DAY_MS);
    const rows = await prisma.foodRestaurant.findMany({
        where: { status: 'approved', fssaiExpiry: { gte: from, lt: to } },
        select: summaryFields,
        orderBy: { fssaiExpiry: 'asc' },
    });
    const today = startOfToday().getTime();
    return rows.map((r) => ({
        ...buildAdminSummary(r),
        id: `fssai-expiring-${r.id}`,
        title: 'FSSAI License Expiring',
        message: `${r.restaurantName || 'Restaurant'} FSSAI expires on ${toDateLabel(r.fssaiExpiry)}.`,
        daysLeft: Math.max(0, Math.round((new Date(r.fssaiExpiry).getTime() - today) / DAY_MS)),
        zoneId: r.zoneId,
        isAcceptingOrders: r.isAcceptingOrders,
    }));
};

/**
 * One warning per licence (restaurant + expiry date), to the owner and the
 * admins, once it is within 30 days of running out. Run by the same hourly
 * job as the expiry alert.
 */
export const syncExpiringFssaiWarnings = async (days = FSSAI_WARNING_DAYS) => {
    const expiring = await listExpiringFssaiRestaurants(days);
    if (!expiring.length) return { totalExpiring: 0, createdCount: 0 };

    const alreadySent = await prisma.foodNotification.findMany({
        where: {
            ownerType: 'RESTAURANT',
            source: 'FSSAI_EXPIRY',
            ownerId: { in: expiring.map((r) => r.restaurantId) },
        },
        select: { ownerId: true, metadata: true },
    });
    const seen = new Set(
        alreadySent
            .filter((n) => n.metadata?.kind === 'expiring')
            .map((n) => `${n.ownerId}|${n.metadata?.expiryDate || ''}`)
    );

    let createdCount = 0;
    for (const s of expiring) {
        const key = `${s.restaurantId}|${s.fssaiExpiry}`;
        if (!s.fssaiExpiry || seen.has(key)) continue;

        const message = `Your FSSAI licence (${s.fssaiNumber || 'N/A'}) expires on ${s.expiryLabel}`
            + ` (${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left). Renew it and upload the new licence`
            + ' to keep taking orders.';
        await prisma.foodNotification.create({
            data: {
                ownerType: 'RESTAURANT',
                ownerId: s.restaurantId,
                title: 'FSSAI License Expiring Soon',
                message,
                link: '/restaurant/fssai',
                category: 'compliance',
                source: 'FSSAI_EXPIRY',
                metadata: {
                    kind: 'expiring',
                    restaurantId: s.restaurantId,
                    restaurantName: s.restaurantName,
                    fssaiNumber: s.fssaiNumber,
                    expiryDate: s.fssaiExpiry,
                    daysLeft: s.daysLeft,
                },
            },
        });
        seen.add(key);

        const data = { restaurantId: s.restaurantId, expiryDate: s.fssaiExpiry, fssaiNumber: s.fssaiNumber || '' };
        await notifyOwnerSafely(
            { ownerType: 'RESTAURANT', ownerId: s.restaurantId },
            { title: 'FSSAI License Expiring Soon', body: message, data: { type: 'fssai_expiring', ...data } }
        );
        await notifyAdminsSafely({
            title: 'Restaurant FSSAI Expiring',
            body: `${s.restaurantName} FSSAI expires on ${s.expiryLabel} (${s.daysLeft} days left).`,
            data: { type: 'restaurant_fssai_expiring', ...data },
        });
        createdCount += 1;
    }
    return { totalExpiring: expiring.length, createdCount };
};

// The block switch, kept in food_platform_settings ({ blockExpired }).
// Off until an admin turns it on from the FSSAI Compliance page. Cached for a
// minute: the listing and pricing read it on every request.
let settingsCache = { at: 0, value: null };
const SETTINGS_TTL_MS = 60 * 1000;

export const getFssaiComplianceSettings = async ({ fresh = false } = {}) => {
    if (!fresh && settingsCache.value && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
    const row = await prisma.foodPlatformSetting.findUnique({ where: { key: FSSAI_SETTINGS_KEY } }).catch(() => null);
    const value = { blockExpired: row?.value?.blockExpired === true, warningDays: FSSAI_WARNING_DAYS };
    settingsCache = { at: Date.now(), value };
    return value;
};

export const updateFssaiComplianceSettings = async ({ blockExpired } = {}) => {
    const on = blockExpired === true || blockExpired === 'true';
    await prisma.foodPlatformSetting.upsert({
        where: { key: FSSAI_SETTINGS_KEY },
        create: { key: FSSAI_SETTINGS_KEY, value: { blockExpired: on } },
        update: { value: { blockExpired: on } },
    });
    settingsCache = { at: 0, value: null };
    return getFssaiComplianceSettings({ fresh: true });
};

/**
 * Expired for ordering: the licence is valid through its expiry date, so the
 * block starts the day after. (The admin alert fires on the expiry day itself.)
 */
export const isFssaiExpiredForOrdering = (fssaiExpiry, now = new Date()) => {
    if (!fssaiExpiry) return false;
    const d = new Date(fssaiExpiry);
    if (Number.isNaN(d.getTime())) return false;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return d.getTime() < today.getTime();
};

/** A Prisma where-fragment that hides expired-licence restaurants, or null when the block is off. */
export const fssaiListingFilter = async () => {
    const { blockExpired } = await getFssaiComplianceSettings();
    if (!blockExpired) return null;
    return { OR: [{ fssaiExpiry: null }, { fssaiExpiry: { gte: startOfToday() } }] };
};

/** { blocked, reason } for one restaurant, by id or by a row carrying fssaiExpiry. */
export const getFssaiOrderingBlock = async (restaurantOrId) => {
    const { blockExpired } = await getFssaiComplianceSettings();
    if (!blockExpired) return { blocked: false, reason: '' };
    let expiry = restaurantOrId && typeof restaurantOrId === 'object' ? restaurantOrId.fssaiExpiry : undefined;
    if (expiry === undefined) {
        const id = typeof restaurantOrId === 'object' ? (restaurantOrId?.id || restaurantOrId?._id) : restaurantOrId;
        if (!id) return { blocked: false, reason: '' };
        // The public menu is also opened by slug.
        const row = /^[a-f0-9]{24}$/i.test(String(id))
            ? await prisma.foodRestaurant.findUnique({ where: { id: String(id) }, select: { fssaiExpiry: true } })
            : await prisma.foodRestaurant.findFirst({ where: { nameSlug: String(id).toLowerCase(), status: 'approved' }, select: { fssaiExpiry: true } });
        expiry = row?.fssaiExpiry;
    }
    const blocked = isFssaiExpiredForOrdering(expiry);
    return { blocked, reason: blocked ? FSSAI_BLOCK_MESSAGE : '' };
};

/** Pricing / place-order guard, next to the admin pause check. */
export const assertFssaiValidForOrdering = async (restaurant) => {
    const { blocked, reason } = await getFssaiOrderingBlock(restaurant);
    if (blocked) throw new ValidationError(reason);
};
