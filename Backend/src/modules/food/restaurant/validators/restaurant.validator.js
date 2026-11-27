import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';
import { toDeliveryRadiusKm } from '../../admin/services/adminRestaurantWrite.helpers.js';
import { parseDayBound, istDateKey } from '../../../../utils/timezone.js';

const phoneSchema = z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian phone number');

const emailSchema = z.string().email('Invalid email').optional().or(z.literal(''));
const requiredBooleanSchema = z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    }
    return value;
}, z.boolean({ required_error: 'Please select whether the restaurant is pure veg' }));

const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const PAN_REGEX = panRegex;
export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * An FSSAI expiry as stored: the end of that day in India. It must be today or
 * later by the India calendar, not the server's, so a licence is not refused
 * (or let through) for the five and a half hours the two disagree.
 * Blank returns null.
 */
export const toFssaiExpiry = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const date = parseDayBound(raw, 'end');
    if (!date) throw new ValidationError('FSSAI expiry date is invalid');
    if (istDateKey(date) < istDateKey()) throw new ValidationError('FSSAI expiry date must be today or a later date');
    return date;
};

/** Highest price a dish, variant or add-on may carry (the column holds far more). */
export const MAX_MENU_PRICE = 100000;

/**
 * A menu price: present, a real number, at most MAX_MENU_PRICE. Dishes must
 * cost something; an add-on may be free (0) but must say so. Blank and null
 * used to become 0, and 1e13 overflowed the column into a 500.
 */
export const toMenuPrice = (value, label = 'Price', { allowZero = false } = {}) => {
    const blank = value === undefined || value === null || String(value).trim() === '';
    const n = Number(value);
    if (blank || !Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) {
        throw new ValidationError(allowZero ? `${label} must be 0 or more` : `${label} must be greater than 0`);
    }
    if (n > MAX_MENU_PRICE) {
        throw new ValidationError(`${label} cannot be more than ₹${MAX_MENU_PRICE.toLocaleString('en-IN')}`);
    }
    return Math.round(n * 100) / 100;
};

/** A non-blank time must be a real one; blank stays allowed. */
export const assertValidTimeOrBlank = (value, label) => {
    if (String(value ?? '').trim() && !normalizeTimeValue(value)) {
        throw new ValidationError(`${label} is not a valid time. Use HH:MM between 00:00 and 23:59`);
    }
};

const normalizeTimeValue = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) {
        const h = Number(hhmm[1]);
        const m = Number(hhmm[2]);
        if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return '';
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampm) {
        let h = Number(ampm[1]);
        const m = Number(ampm[2]);
        const p = ampm[3].toUpperCase();
        if (!Number.isFinite(h) || !Number.isFinite(m) || h < 1 || h > 12 || m < 0 || m > 59) return '';
        if (p === 'AM') h = h === 12 ? 0 : h;
        if (p === 'PM') h = h === 12 ? 12 : h + 12;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    return '';
};

const timeToMinutes = (value) => {
    const normalized = normalizeTimeValue(value);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

/**
 * The pin a restaurant drops at sign-up. Required: without it the restaurant
 * has no distance to any customer, so it can never be listed or priced. Both
 * must be real coordinates, and 0,0 (an unset map) is refused.
 */
export const toOnboardingPin = (latitude, longitude) => {
    const blank = (v) => v === undefined || v === null || String(v).trim() === '';
    // No pin at all: accepted as before, so app builds that register without
    // coordinates keep working (the web form requires the pin itself). Half a
    // pin, 0,0 or an out-of-range point is still refused.
    if (blank(latitude) && blank(longitude)) return {};
    if (blank(latitude) || blank(longitude)) {
        throw new ValidationError("Please drop a pin on the map at the restaurant's location");
    }
    const lat = Number(String(latitude).trim());
    const lng = Number(String(longitude).trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new ValidationError('The map pin is not a valid location. Please drop it again');
    }
    if (lat === 0 && lng === 0) {
        throw new ValidationError("Please drop a pin on the map at the restaurant's location");
    }
    return { latitude: Math.round(lat * 1e7) / 1e7, longitude: Math.round(lng * 1e7) / 1e7 };
};

const restaurantRegisterSchema = z.object({
    restaurantName: z.string().min(1, 'Restaurant name is required'),
    ownerName: z.string().min(1, 'Owner name is required'),
    ownerEmail: emailSchema,
    ownerPhone: phoneSchema.optional(),
    primaryContactNumber: phoneSchema.optional(),
    pureVegRestaurant: requiredBooleanSchema,
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    area: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    landmark: z.string().optional(),
    formattedAddress: z.string().optional(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
    zoneId: z.string().optional(),
    cuisines: z
        .string()
        .optional()
        .transform((val) => (val ? val.split(',').map((c) => c.trim()).filter(Boolean) : [])),
    openingTime: z.string().optional(),
    closingTime: z.string().optional(),
    estimatedDeliveryTime: z.string().optional(),
    openDays: z
        .string()
        .optional()
        .transform((val) => (val ? val.split(',').map((d) => d.trim()).filter(Boolean) : [])),
    panNumber: z
        .string()
        .regex(panRegex, 'Invalid PAN format')
        .optional()
        .or(z.literal('')),
    nameOnPan: z.string().optional(),
    gstRegistered: z
        .string()
        .optional()
        .transform((val) => val === 'true' || val === '1'),
    gstNumber: z.string().optional(),
    gstLegalName: z.string().optional(),
    gstAddress: z.string().optional(),
    fssaiNumber: z.string().optional(),
    fssaiExpiry: z.string().optional(),
    accountNumber: z.string().optional(),
    ifscCode: z.string().optional(),
    accountHolderName: z.string().optional(),
    accountType: z.string().optional(),
    subscriptionPlan: z.string().optional(),
    subscriptionAmount: z
        .string()
        .optional()
        .transform((val) => {
            const n = Number(String(val || '').trim());
            return Number.isFinite(n) ? n : 0;
        }),
    subscriptionPaidAmount: z
        .string()
        .optional()
        .transform((val) => {
            const n = Number(String(val || '').trim());
            return Number.isFinite(n) ? n : 0;
        }),
    subscriptionDueAmount: z
        .string()
        .optional()
        .transform((val) => {
            const n = Number(String(val || '').trim());
            return Number.isFinite(n) ? n : 0;
        }),
    onboardingFeeAmount: z
        .string()
        .optional()
        .transform((val) => {
            const n = Number(String(val || '').trim());
            return Number.isFinite(n) ? n : 0;
        }),
    onboardingFeePaid: z
        .string()
        .optional()
        .transform((val) => {
            const normalized = String(val || '').trim().toLowerCase();
            return normalized === 'true' || normalized === '1';
        }),
    paymentType: z.string().optional(),
    razorpayOrderId: z.string().optional(),
    razorpayPaymentId: z.string().optional(),
    razorpaySignature: z.string().optional(),
    // Allow pre-uploaded image URLs for background upload flow
    profileImage: z.string().optional(),
    panImage: z.string().optional(),
    gstImage: z.string().optional(),
    fssaiImage: z.string().optional(),
    menuImages: z.string().optional(), // can be a stringified array
    coverImage: z.string().optional(),
    galleryImages: z.string().optional() // stringified array of pre-uploaded URLs
});

export const validateRestaurantRegisterDto = (body) => {
    const result = restaurantRegisterSchema.safeParse(body);
    if (!result.success) {
        const issue = result.error.errors[0];
        // Zod's default for a missing field is the bare word "Required", which
        // reached the restaurant as an error naming nothing at all. Say which
        // field when the message does not already.
        const field = issue.path?.join('.');
        const message = issue.message === 'Required' && field
            ? `${field} is required`
            : issue.message;
        throw new ValidationError(message);
    }

    const data = result.data;
    assertValidTimeOrBlank(data.openingTime, 'Opening time');
    assertValidTimeOrBlank(data.closingTime, 'Closing time');
    if (data.fssaiExpiry) toFssaiExpiry(data.fssaiExpiry);
    if (data.ifscCode && !IFSC_REGEX.test(data.ifscCode.trim().toUpperCase())) {
        throw new ValidationError('IFSC looks wrong. It is 11 characters, like SBIN0001234.');
    }
    if (data.accountNumber && !/^\d{9,18}$/.test(data.accountNumber.replace(/[\s-]/g, ''))) {
        throw new ValidationError('Account number must be 9 to 18 digits');
    }
    if (data.gstRegistered && data.gstNumber && !GSTIN_REGEX.test(data.gstNumber.trim().toUpperCase())) {
        throw new ValidationError('GSTIN must be 15 characters, e.g. 22ABCDE1234F1Z5');
    }
    for (const key of ['subscriptionAmount', 'subscriptionPaidAmount', 'subscriptionDueAmount', 'onboardingFeeAmount']) {
        if (data[key] < 0) throw new ValidationError(`${key} cannot be negative`);
    }
    const openingMinutes = timeToMinutes(data.openingTime);
    const closingMinutes = timeToMinutes(data.closingTime);
    if (openingMinutes !== null && closingMinutes !== null) {
        if (openingMinutes === closingMinutes) {
            throw new ValidationError('Opening time and closing time cannot be same');
        }
        // A closing time earlier than the opening time is the next day: 4 PM to
        // 2 AM is a late-night restaurant, not a mistake. The open-now check in
        // restaurantAvailability.helper.js already handles windows past midnight.
    }
    return {
        ...data,
        // Numbers from here on; FormData sends them as strings.
        ...toOnboardingPin(data.latitude, data.longitude),
        gstRegistered: data.gstRegistered ?? false,
        // Same rule as the admin create/edit paths: blank = platform default,
        // otherwise above 0 and at most MAX_DELIVERY_RADIUS_KM.
        deliveryRadiusKm: toDeliveryRadiusKm(body?.deliveryRadiusKm),
    };
};

