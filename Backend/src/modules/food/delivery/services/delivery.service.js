import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { getDeliveryCashLimitSettings } from '../../admin/services/admin.service.js';
import { upsertFirebaseDeviceToken } from '../../../../core/notifications/firebase.service.js';
import { logger } from '../../../../utils/logger.js';
import { collectDynamicRegistration } from './driverRegistrationField.service.js';
import { saveRiderActiveOrdersPosition } from './riderPosition.service.js';
import { toFix } from './riderFix.js';
import { TERMINAL_ORDER_STATUSES } from '../../orders/services/order.helpers.js';
import { offerPeriod, offerTargets, grantKey, targetMet, riderTargeted, normalizeRecurrence } from '../../shared/incentiveRules.js';
import { onlineMinutesInWindow, riderOfferZones } from '../../admin/services/adminEarningAddon.service.js';
import { expandZoneFamilies } from '../../shared/zoneHierarchy.js';
import { getSalariedStatus } from './salariedIncentive.service.js';
import { getRiderCashInHand } from './deliveryFinance.service.js';
import jwt from 'jsonwebtoken';
import { config } from '../../../../config/env.js';
import { verifyOtp } from '../../../../core/otp/otp.service.js';
import { findDeliveryPartnerByPhone } from '../../../../core/auth/onboardingGate.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { normalizeRiderPhone, vehicleNumberRegex } from '../validators/delivery.validator.js';

const num = (v) => Number(v) || 0;

const savePartnerFcmToken = async (partnerId, fcmToken, platform) => {
    if (!fcmToken || !partnerId) return;
    try {
        await upsertFirebaseDeviceToken({
            ownerType: 'DELIVERY_PARTNER',
            ownerId: String(partnerId),
            token: fcmToken,
            platform,
        });
    } catch (err) {
        logger.warn({ err, partnerId: String(partnerId) }, 'Failed to save delivery partner FCM token');
    }
};

/**
 * Proof that a sign-up's phone was verified by OTP, like a login.
 *
 * POST /register was public: anyone could create a rider on any number.
 * verify-otp answers an unknown number with `registrationToken` (signed here,
 * 30 min, bound to the phone); the form sends it back. A fresh `otp` for the
 * phone is accepted as well.
 */
const REGISTRATION_PURPOSE = 'rider_register';
const registrationSecret = () => `${config.jwtAccessSecret}:${REGISTRATION_PURPOSE}`;

export const signRiderRegistrationToken = (phone) => {
    const normalized = normalizeRiderPhone(phone);
    if (!normalized) return null;
    return jwt.sign({ purpose: REGISTRATION_PURPOSE, phone: normalized }, registrationSecret(), { expiresIn: '30m' });
};

export const assertRegistrationPhoneVerified = async ({ phone, registrationToken, otp, rawPhone }) => {
    if (registrationToken) {
        try {
            const claims = jwt.verify(registrationToken, registrationSecret());
            if (claims?.purpose === REGISTRATION_PURPOSE && claims.phone === phone) return;
        } catch {
            // Falls through to the error below.
        }
        throw new ValidationError('Your phone verification has expired. Please verify your number with OTP again.');
    }
    if (otp) {
        if (!/^\d{4}$/.test(String(otp))) throw new ValidationError('OTP must be 4 digits');
        // The OTP row is keyed by the phone exactly as the app requested it.
        const result = await verifyOtp(String(rawPhone || phone).trim(), String(otp));
        if (result.valid) return;
        throw new ValidationError(result.reason || 'Invalid OTP');
    }
    throw new ValidationError('Verify your phone number with OTP before registering.');
};

/**
 * Tells the admins a rider is waiting for approval: the FCM push every admin
 * gets, plus `admin_notification` on the admin socket room so an open panel
 * can refresh its bell straight away. Never throws.
 */
export const notifyAdminsOfRiderKyc = (partner, { title, body, subType }) => {
    const data = { type: 'new_registration', subType, id: String(partner.id), partnerId: String(partner.id), link: '/admin/food/delivery-partners/join-request' };
    void import('../../../../core/notifications/firebase.service.js')
        .then(({ notifyAdminsSafely }) => notifyAdminsSafely({ title, body, data }))
        .catch((e) => logger.warn(`Rider KYC admin push failed: ${e?.message || e}`));
    try {
        getIO()?.to(rooms.admin()).emit('admin_notification', { title, body, message: body, ...data, createdAt: new Date().toISOString() });
    } catch (e) {
        logger.warn(`Rider KYC admin socket emit failed: ${e?.message || e}`);
    }
};

const requirePartner = async (userId) => {
    const partner = await prisma.foodDeliveryPartner.findUnique({ where: { id: String(userId) } });
    if (!partner) throw new ValidationError('Delivery partner not found');
    return partner;
};

/**
 * Creates a delivery partner -- from the rider app's sign-up (pending, for an
 * admin to approve) or from the admin panel's Add Deliveryman (`createdByAdmin`:
 * approved straight away, with optional bank details). One function, so both
 * paths get the same duplicate checks, vehicle rules and document uploads.
 */
export const registerDeliveryPartner = async (payload, files, rawBody = {}, opts = {}) => {
    const createdByAdmin = Boolean(opts.createdByAdmin);
    const {
        name, phone, email, countryCode, address, city, state,
        vehicleType, vehicleName, vehicleNumber, drivingLicenseNumber, panNumber, aadharNumber,
        fcmToken, platform,
    } = payload;
    const refRaw = typeof payload?.ref === 'string' ? String(payload.ref).trim() : '';

    // The rider's own sign-up must prove the phone is theirs; an admin adding
    // a rider does not.
    if (!createdByAdmin) {
        await assertRegistrationPhoneVerified({
            phone,
            registrationToken: payload.registrationToken,
            otp: payload.otp,
            rawPhone: rawBody?.phone,
        });
    }

    // By the last 10 digits: "+919876543210" and "9876543210" are one rider.
    const existing = await findDeliveryPartnerByPhone(phone);
    if (existing) {
        if (existing.status !== 'rejected') {
            throw new ValidationError('Delivery partner with this phone already exists');
        }
        // Rejected: clear the old record so they can start fresh on the same phone.
        await prisma.foodDeliveryPartner.deleteMany({ where: { id: existing.id } });
    }

    if (vehicleNumber && String(vehicleNumber).trim()) {
        const vNum = String(vehicleNumber).trim().toUpperCase();

        const activeVehicle = await prisma.foodDeliveryPartner.findFirst({
            where: { vehicleNumber: vNum, status: { not: 'rejected' } },
        });
        if (activeVehicle) {
            throw new ValidationError('Vehicle number already registered with another partner');
        }

        // Clear rejected records holding this vehicle, so the unique constraint allows it.
        await prisma.foodDeliveryPartner.deleteMany({
            where: { vehicleNumber: vNum, status: 'rejected' },
        });
    }

    const uploadTasks = [];
    const photoField = (field, folder) => {
        if (!files?.[field]?.[0]) return;
        uploadTasks.push(
            uploadImageBuffer(files[field][0].buffer, folder).then((url) => [field, url]),
        );
    };
    photoField('profilePhoto', 'food/delivery/profile');
    photoField('aadharPhoto', 'food/delivery/aadhar');
    photoField('panPhoto', 'food/delivery/pan');
    photoField('drivingLicensePhoto', 'food/delivery/license');

    const images = Object.fromEntries(await Promise.all(uploadTasks));

    // ── Admin-defined dynamic fields + documents ──
    const fileKeys = new Set(Object.keys(files || {}));
    const { customFields, documentKeys } = await collectDynamicRegistration(rawBody || {}, fileKeys);

    // Upload admin-defined document files (skipping keys already handled above).
    const KNOWN_DOC_FIELDS = new Set([
        'profilePhoto', 'aadharPhoto', 'panPhoto', 'drivingLicensePhoto', 'upiQrCode',
    ]);
    const customDocuments = {};
    const dynamicDocTasks = [];
    for (const key of documentKeys) {
        if (KNOWN_DOC_FIELDS.has(key)) continue;
        const file = files?.[key]?.[0];
        if (!file) continue;
        dynamicDocTasks.push(uploadImageBuffer(file.buffer, `food/delivery/${key}`).then((url) => [key, url]));
    }
    // Vehicle RC: kept with the custom documents (no column), where the
    // admin's document review lists it (riderDocuments.service.js).
    if (files?.vehicleRcPhoto?.[0] && !documentKeys.includes?.('vehicleRcPhoto')) {
        dynamicDocTasks.push(uploadImageBuffer(files.vehicleRcPhoto[0].buffer, 'food/delivery/rc').then((url) => ['vehicleRcPhoto', url]));
    }
    for (const [k, v] of await Promise.all(dynamicDocTasks)) customDocuments[k] = v;

    let normalizedEmail;
    if (email && String(email).trim()) {
        normalizedEmail = String(email).trim().toLowerCase();
        const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,10}$/;
        if (!emailRegex.test(normalizedEmail) || normalizedEmail.includes('..')) {
            throw new ValidationError('Invalid email format');
        }
        const domain = normalizedEmail.split('@')[1];
        const segments = domain ? domain.split('.') : [];
        if (segments.length >= 2 && segments[segments.length - 1] === segments[segments.length - 2]) {
            throw new ValidationError('Invalid email domain (repeated segments)');
        }
    }

    // referredBy is resolved before the insert. Mongo created the row and then
    // patched it in a second save; one write is simpler and cannot half-apply.
    let referredById = null;
    if (refRaw && isId(refRaw)) {
        const referrer = await prisma.foodDeliveryPartner.findUnique({
            where: { id: refRaw },
            select: { id: true },
        });
        if (referrer) referredById = referrer.id;
    }

    let partner = await prisma.foodDeliveryPartner.create({
        data: {
            name,
            phone,
            email: normalizedEmail,
            ...(countryCode ? { countryCode } : {}),
            address,
            city,
            state,
            vehicleType,
            vehicleName,
            vehicleNumber: vehicleNumber ? String(vehicleNumber).trim().toUpperCase() : null,
            drivingLicenseNumber,
            panNumber,
            aadharNumber,
            // An admin may add a rider as pending (checkbox) to review later.
            status: createdByAdmin && opts.approve !== false ? 'approved' : 'pending',
            ...(createdByAdmin && opts.approve !== false ? { approvedAt: new Date() } : {}),
            ...(createdByAdmin && opts.zoneId ? { zoneId: String(opts.zoneId) } : {}),
            // Bank details from the sign-up form too (validated by the DTO).
            ...bankFieldsOf(payload),
            referredById,
            ...images,
            ...(Object.keys(customFields).length ? { customFields } : {}),
            ...(Object.keys(customDocuments).length ? { customDocuments } : {}),
        },
    });

    // The referral code defaults to the partner's own id, which only exists after
    // the insert.
    if (!partner.referralCode) {
        partner = await prisma.foodDeliveryPartner.update({
            where: { id: partner.id },
            data: { referralCode: partner.id },
        });
    }

    // Save FCM through the shared upsert, so this token cannot live on another account.
    if (fcmToken) await savePartnerFcmToken(partner.id, fcmToken, platform);

    // An admin adding a rider doesn't need telling about it.
    if (createdByAdmin) return partner;

    notifyAdminsOfRiderKyc(partner, {
        title: 'New Delivery Partner Registration 🚲',
        body: `A new delivery partner "${partner.name}" (${partner.phone}) has signed up and is pending approval.`,
        subType: 'delivery_partner',
    });

    return partner;
};

/** Bank / UPI details an admin may fill in when adding a rider. */
function bankFieldsOf(payload = {}) {
    const out = {};
    const put = (key, value) => {
        const v = String(value ?? '').trim();
        if (v) out[key] = v;
    };
    put('bankAccountHolderName', payload.bankAccountHolderName);
    put('bankAccountNumber', payload.bankAccountNumber);
    put('bankIfscCode', String(payload.bankIfscCode ?? '').toUpperCase());
    put('bankName', payload.bankName);
    put('upiId', payload.upiId);
    return out;
}

const RIDER_VEHICLE_TYPES = ['bike', 'scooter', 'electric', 'bicycle'];

/** The rider's own vehicle edit: a known type, and a real Indian plate. */
function cleanVehicleType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (type && !RIDER_VEHICLE_TYPES.includes(type)) throw new ValidationError('Choose bike, scooter, electric or bicycle');
    return type || null;
}

/** Shared vehicle-number guard for the profile-update paths. */
async function claimVehicleNumber(vNum, selfId) {
    if (!vNum) return;
    if (!vehicleNumberRegex.test(vNum)) {
        throw new ValidationError('Enter a valid vehicle number, e.g. MH12AB1234 or 22BH1234AB');
    }
    const activeVehicle = await prisma.foodDeliveryPartner.findFirst({
        where: { vehicleNumber: vNum, id: { not: String(selfId) }, status: { not: 'rejected' } },
    });
    if (activeVehicle) {
        throw new ValidationError('Vehicle number already registered with another partner');
    }
    // Clear rejected records holding this vehicle, so the unique constraint allows it.
    await prisma.foodDeliveryPartner.deleteMany({ where: { vehicleNumber: vNum, status: 'rejected' } });
}

export const updateDeliveryPartnerProfile = async (userId, payload, files) => {
    const partner = await requirePartner(userId);

    const {
        name, countryCode, address, city, state,
        vehicleType, vehicleName, vehicleNumber, drivingLicenseNumber,
        fcmToken, platform,
    } = payload;

    const data = {};
    if (name) data.name = name;
    if (countryCode !== undefined) data.countryCode = countryCode;
    if (address !== undefined) data.address = address;
    if (city !== undefined) data.city = city;
    if (state !== undefined) data.state = state;
    if (vehicleType !== undefined) data.vehicleType = cleanVehicleType(vehicleType);
    if (vehicleName !== undefined) data.vehicleName = vehicleName;

    if (
        vehicleNumber !== undefined &&
        String(vehicleNumber).trim().toUpperCase() !== String(partner.vehicleNumber || '').trim().toUpperCase()
    ) {
        const vNum = String(vehicleNumber).replace(/[\s-]/g, '').toUpperCase();
        await claimVehicleNumber(vNum, partner.id);
        data.vehicleNumber = vNum || null;
    }
    if (drivingLicenseNumber !== undefined) data.drivingLicenseNumber = drivingLicenseNumber;

    if (files?.profilePhoto?.[0]) {
        data.profilePhoto = await uploadImageBuffer(files.profilePhoto[0].buffer, 'food/delivery/profile');
    }

    const updated = await prisma.foodDeliveryPartner.update({ where: { id: partner.id }, data });

    if (fcmToken) await savePartnerFcmToken(partner.id, fcmToken, platform);

    return { partner: updated, requiresReapproval: false };
};

export const updateDeliveryPartnerDetails = async (userId, payload) => {
    const partner = await requirePartner(userId);
    const data = {};

    const vehicle = payload?.vehicle;
    if (vehicle && typeof vehicle === 'object') {
        if (
            vehicle.number !== undefined &&
            String(vehicle.number || '').trim().toUpperCase() !== String(partner.vehicleNumber || '').trim().toUpperCase()
        ) {
            const vNum = String(vehicle.number || '').replace(/[\s-]/g, '').toUpperCase();
            await claimVehicleNumber(vNum, partner.id);
            data.vehicleNumber = vNum || null;
        }
        if (vehicle.type !== undefined) data.vehicleType = cleanVehicleType(vehicle.type);
        if (vehicle.brand !== undefined) data.vehicleName = String(vehicle.brand || '').trim();
        if (vehicle.model !== undefined) data.vehicleName = String(vehicle.model || '').trim();
    }

    if (payload?.profilePhoto !== undefined) {
        data.profilePhoto = payload.profilePhoto ? String(payload.profilePhoto).trim() : '';
    }

    return prisma.foodDeliveryPartner.update({ where: { id: partner.id }, data });
};

export const updateDeliveryPartnerProfilePhotoBase64 = async (userId, payload, files) => {
    const partner = await requirePartner(userId);

    // Multipart (`profilePhoto` file) or JSON `base64`, plain or as a data URL.
    const file = files?.profilePhoto?.[0];
    const base64 = typeof payload?.base64 === 'string' ? payload.base64.replace(/^data:[^,]*,/, '') : '';
    if (!file && !base64) throw new ValidationError('base64 is required');

    const buffer = file ? file.buffer : Buffer.from(base64, 'base64');
    if (!buffer || !buffer.length) throw new ValidationError('Invalid base64 image');
    if (buffer.length > 8 * 1024 * 1024) throw new ValidationError('Image too large (max 8MB)');

    const profilePhoto = await uploadImageBuffer(buffer, 'food/delivery/profile');
    return prisma.foodDeliveryPartner.update({ where: { id: partner.id }, data: { profilePhoto } });
};

export const updateDeliveryPartnerBankDetails = async (userId, payload, files) => {
    const partner = await requirePartner(userId);
    const data = {};

    // Handle both nested JSON and flat FormData from multer.
    let bankDetails = payload?.documents?.bankDetails;
    let panDetails = payload?.documents?.pan;

    // Multer flattens FormData keys like 'documents[bankDetails][accountNumber]'.
    if (!bankDetails && payload) {
        const b = {};
        const flat = {
            accountHolderName: 'documents[bankDetails][accountHolderName]',
            accountNumber: 'documents[bankDetails][accountNumber]',
            ifscCode: 'documents[bankDetails][ifscCode]',
            bankName: 'documents[bankDetails][bankName]',
            upiId: 'documents[bankDetails][upiId]',
        };
        for (const [key, formKey] of Object.entries(flat)) {
            if (payload[formKey] !== undefined) b[key] = payload[formKey];
        }
        if (Object.keys(b).length > 0) bankDetails = b;
    }

    if (!panDetails && payload?.['documents[pan][number]'] !== undefined) {
        panDetails = { number: payload['documents[pan][number]'] };
    }

    if (bankDetails) {
        const b = bankDetails;
        const trim = (v) => (v ? String(v).trim() : '');
        if (b.accountHolderName !== undefined) data.bankAccountHolderName = trim(b.accountHolderName);
        if (b.accountNumber !== undefined) data.bankAccountNumber = trim(b.accountNumber);
        if (b.ifscCode !== undefined) data.bankIfscCode = trim(b.ifscCode).toUpperCase();
        if (b.bankName !== undefined) data.bankName = trim(b.bankName);
        if (b.upiId !== undefined) data.upiId = trim(b.upiId);
    }

    if (panDetails?.number !== undefined) {
        data.panNumber = panDetails.number ? String(panDetails.number).trim().toUpperCase() : '';
    }

    if (files?.upiQrCode?.[0]) {
        data.upiQrCode = await uploadImageBuffer(files.upiQrCode[0].buffer, 'food/delivery/upi');
    }

    return prisma.foodDeliveryPartner.update({ where: { id: partner.id }, data });
};

function generateTicketId() {
    const n = Date.now().toString(36).slice(-6).toUpperCase();
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TKT-${n}${r}`;
}

export const listSupportTicketsByPartner = async (deliveryPartnerId) =>
    prisma.deliverySupportTicket.findMany({
        where: { deliveryPartnerId: String(deliveryPartnerId) },
        orderBy: { createdAt: 'desc' },
    });

export const createSupportTicket = async (deliveryPartnerId, payload) => {
    const { subject, description, category = 'other', priority = 'medium' } = payload;
    if (!subject || !description || subject.trim().length < 3) {
        throw new ValidationError('Subject is required (min 3 characters)');
    }
    if (description.trim().length < 10) {
        throw new ValidationError('Description must be at least 10 characters');
    }

    const data = {
        deliveryPartnerId: String(deliveryPartnerId),
        subject: subject.trim(),
        description: description.trim(),
        category: ['payment', 'account', 'technical', 'order', 'other'].includes(category) ? category : 'other',
        priority: ['low', 'medium', 'high', 'urgent'].includes(priority) ? priority : 'medium',
        status: 'open',
    };

    // ticketId is unique, so a collision just retries. The old check-then-insert
    // loop raced with itself anyway.
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await prisma.deliverySupportTicket.create({
                data: { ...data, ticketId: generateTicketId() },
            });
        } catch (err) {
            if (err?.code === 'P2002') continue;
            throw err;
        }
    }
    throw new ValidationError('Could not allocate a ticket id. Please try again.');
};

export const getSupportTicketByIdAndPartner = async (ticketId, deliveryPartnerId) => {
    if (!isId(ticketId)) return null;
    return prisma.deliverySupportTicket.findFirst({
        where: { id: String(ticketId), deliveryPartnerId: String(deliveryPartnerId) },
    });
};

/**
 * Close any shift left open for this rider.
 *
 * Normally there is exactly one, but a rider whose app was killed mid-shift
 * leaves a row with no wentOfflineAt, and the next go-online would otherwise
 * open a second. durationMinutes is written here so duty-hour reporting is a
 * sum over a column rather than a scan computing timestamp differences.
 *
 * `bySystem` marks shifts nobody actually ended, so those hours can be told
 * apart from real ones instead of quietly inflating a rider's total.
 */
const closeOpenSessions = async (tx, partnerId, { bySystem = false, lat = null, lng = null } = {}) => {
    const open = await tx.foodDeliveryPartnerSession.findMany({
        where: { deliveryPartnerId: partnerId, wentOfflineAt: null },
        select: { id: true, wentOnlineAt: true },
    });
    if (open.length === 0) return 0;

    const now = new Date();
    await Promise.all(
        open.map((session) =>
            tx.foodDeliveryPartnerSession.update({
                where: { id: session.id },
                data: {
                    wentOfflineAt: now,
                    offlineLat: lat,
                    offlineLng: lng,
                    durationMinutes: Math.max(
                        0,
                        Math.round((now.getTime() - new Date(session.wentOnlineAt).getTime()) / 60000),
                    ),
                    closedBySystem: bySystem,
                },
            }),
        ),
    );
    return open.length;
};

export const updateDeliveryAvailability = async (userId, payload) => {
    const partner = await requirePartner(userId);

    // Accept both field spellings clients send: status/availabilityStatus,
    // lat/lng or latitude/longitude, and numeric strings.
    const rawStatus = payload?.status ?? payload?.availabilityStatus;
    const fix = toFix(payload?.latitude ?? payload?.lat, payload?.longitude ?? payload?.lng);
    const lat = fix?.lat;
    const lng = fix?.lng;

    // No status = a location heartbeat: availability stays as it is. It used
    // to default to offline, so a ping without one took a rider on a trip
    // offline and out of dispatch.
    let validStatus = partner.availabilityStatus === 'online' ? 'online' : 'offline';
    if (rawStatus === 'online' || rawStatus === true || rawStatus === 'true') validStatus = 'online';
    else if (rawStatus === 'offline' || rawStatus === false || rawStatus === 'false') validStatus = 'offline';

    // Going offline must not strand a customer's food: a rider on a trip
    // finishes it first. Only an explicit "offline" is refused -- the heartbeat
    // still goes through.
    const wantsOffline = rawStatus === 'offline' || rawStatus === false || rawStatus === 'false';
    if (wantsOffline && partner.availabilityStatus === 'online') {
        const onTrip = await prisma.foodOrder.findFirst({
            where: {
                dispatchDeliveryPartnerId: partner.id,
                dispatchStatus: 'accepted',
                orderStatus: { notIn: TERMINAL_ORDER_STATUSES },
            },
            select: { id: true },
        });
        if (onTrip) throw new ValidationError('Finish your current delivery before going offline');
    }

    const data = { availabilityStatus: validStatus };
    const hasFix = Boolean(fix);
    if (hasFix) {
        // Only the plain coordinates are written; the lastLocation geography column
        // is derived by the partner_location_sync trigger.
        data.lastLat = lat;
        data.lastLng = lng;
        data.lastLocationAt = new Date();
    }

    // This endpoint doubles as the location heartbeat and is called every few
    // seconds while a rider is online, so shift rows are written only on a real
    // transition -- otherwise the log would be one row per ping.
    const wasOnline = partner.availabilityStatus === 'online';
    const isOnline = validStatus === 'online';

    // The heartbeat's position also goes on the orders the rider is carrying.
    if (hasFix) {
        void saveRiderActiveOrdersPosition({ riderId: partner.id, lat, lng, at: data.lastLocationAt })
            .catch(() => {});
    }

    const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.foodDeliveryPartner.update({ where: { id: partner.id }, data });

        if (!wasOnline && isOnline) {
            // Defensive: if a previous shift was never closed (app killed, phone
            // died) close it before opening the next, so a rider never has two
            // open sessions and duty hours cannot double-count.
            await closeOpenSessions(tx, partner.id, { bySystem: true });
            await tx.foodDeliveryPartnerSession.create({
                data: {
                    deliveryPartnerId: partner.id,
                    wentOnlineAt: new Date(),
                    onlineLat: hasFix ? lat : null,
                    onlineLng: hasFix ? lng : null,
                },
            });
        } else if (wasOnline && !isOnline) {
            await closeOpenSessions(tx, partner.id, {
                bySystem: false,
                lat: hasFix ? lat : null,
                lng: hasFix ? lng : null,
            });
        }

        return row;
    });

    return { availabilityStatus: updated.availabilityStatus };
};

// ----- Delivery partner wallet (Pocket / requests page) -----
export const getDeliveryPartnerWallet = async (deliveryPartnerId) => {
    if (!isId(deliveryPartnerId)) throw new ValidationError('Delivery partner not found');
    const partnerId = String(deliveryPartnerId);

    const partner = await prisma.foodDeliveryPartner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new ValidationError('Delivery partner not found');

    const cashLimitSettings = await getDeliveryCashLimitSettings();
    const totalCashLimit = num(cashLimitSettings.deliveryCashLimit);
    const deliveryWithdrawalLimit = num(cashLimitSettings.deliveryWithdrawalLimit) || 100;

    const [earningsAgg, cash, bonusAgg, paymentTxList, bonusTxList] = await Promise.all([
        prisma.foodOrder.aggregate({
            where: { dispatchDeliveryPartnerId: partnerId, orderStatus: 'delivered' },
            _sum: { riderEarning: true, tipAmount: true },
        }),
        // COD cash collected and not yet deposited: the same figure as the
        // wallet (getDeliveryPartnerWalletEnhanced), change kept included.
        getRiderCashInHand(partnerId),
        prisma.deliveryBonusTransaction.aggregate({
            where: { deliveryPartnerId: partnerId },
            _sum: { amount: true },
        }),
        prisma.foodOrder.findMany({
            where: { dispatchDeliveryPartnerId: partnerId, orderStatus: 'delivered' },
            orderBy: [{ deliveredAt: 'desc' }, { createdAt: 'desc' }],
            select: {
                id: true, orderId: true, riderEarning: true, tipAmount: true, paymentMethod: true,
                orderStatus: true, deliveredAt: true, createdAt: true,
                riderPayBasis: true, riderDaySeq: true, riderPayWaived: true,
            },
            take: 2000,
        }),
        prisma.deliveryBonusTransaction.findMany({
            where: { deliveryPartnerId: partnerId },
            orderBy: { createdAt: 'desc' },
            take: 1000,
        }),
    ]);

    const totalEarned = num(earningsAgg?._sum?.riderEarning);
    const totalTipsEarned = num(earningsAgg?._sum?.tipAmount);
    const cashInHand = num(cash?.cashInHand);
    const totalBonus = num(bonusAgg?._sum?.amount);

    const paymentTransactions = (paymentTxList || []).map((o) => {
        const date = o.deliveredAt || o.createdAt || new Date();
        const tip = num(o.tipAmount);
        return {
            _id: o.id,
            type: 'payment',
            amount: num(o.riderEarning),
            /// The same amount, split: what the delivery paid and what the
            /// customer added. A rider who was tipped should be able to see it
            /// on the order it came from, not only in a monthly total.
            deliveryAmount: Math.round((num(o.riderEarning) - tip) * 100) / 100,
            tipAmount: tip,
            status: 'Completed',
            date,
            createdAt: date,
            orderId: o.orderId || o.id,
            paymentMethod: o.paymentMethod || '',
            metadata: { orderId: o.orderId || o.id },
            /// Salaried riders: 'salaried_covered' (salary covers it) or
            /// 'salaried_incentive' (past the daily threshold); null for gig.
            category: o.riderPayBasis || 'delivery_earning',
            riderPayBasis: o.riderPayBasis || null,
            daySeq: o.riderDaySeq ?? null,
            description: salariedPayLabel(o) || (tip > 0
                ? `${o.paymentMethod === 'cash' ? 'COD' : 'Online'} delivery earning (includes \u20b9${tip} tip)`
                : (o.paymentMethod === 'cash' ? 'COD delivery earning' : 'Online delivery earning')),
        };
    });

    // The weekly-earnings screen expects bonus rows typed as `earning_addon`.
    const bonusTransactions = (bonusTxList || []).map((t) => ({
        _id: t.id,
        type: 'earning_addon',
        amount: num(t.amount),
        status: 'Completed',
        date: t.createdAt,
        createdAt: t.createdAt,
        metadata: { reference: t.reference || '' },
        description: t.reference ? `Bonus - ${t.reference}` : 'Bonus',
    }));

    const totalBalance = totalEarned + totalBonus;

    return {
        totalBalance,
        pocketBalance: totalBalance,
        cashInHand,
        changeKeptForCustomers: num(cash?.changeKeptForCustomers),
        totalWithdrawn: 0,
        totalEarned,
        totalCashLimit,
        availableCashLimit: Math.max(0, totalCashLimit - cashInHand),
        deliveryWithdrawalLimit,
        transactions: [...paymentTransactions, ...bonusTransactions].sort(
            (a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime(),
        ),
        joiningBonusClaimed: false,
        joiningBonusAmount: 0,
    };
};

// ----- Date helpers -----

/** `?date=` as a Date (today when absent); a 400, not a 500, when it is not a date. */
const parseQueryDate = (raw) => {
    if (raw === undefined || raw === null || raw === '') return new Date();
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new ValidationError('Invalid date. Use YYYY-MM-DD.');
    return d;
};

const toStartOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};

const toEndOfDay = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
};

const getWeekRange = (anchorDate) => {
    const d = new Date(anchorDate);
    const start = toStartOfDay(d);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday, as payouts
    const end = toEndOfDay(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
};

const getMonthRange = (anchorDate) => {
    const d = new Date(anchorDate);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

const computeRange = (period, date) => {
    const p = String(period || 'daily').toLowerCase();
    const anchor = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    if (p === 'weekly' || p === 'week') return getWeekRange(anchor);
    if (p === 'monthly' || p === 'month') return getMonthRange(anchor);
    return { start: toStartOfDay(anchor), end: toEndOfDay(anchor) };
};

/**
 * A trip belongs to the day it was delivered; one never delivered (pending,
 * cancelled) to the day it was placed -- the same date the trip card shows.
 * updatedAt was in here too, so an old trip rated or touched today turned up
 * in today's history.
 */
const withinRange = (start, end) => [
    { orderStatus: 'delivered', deliveredAt: { gte: start, lte: end } },
    { orderStatus: { not: 'delivered' }, createdAt: { gte: start, lte: end } },
];

const TRIP_ORDER_BY = [{ deliveredAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];

// ----- Earnings summary -----
/** Wallet/earnings line for a salaried rider's order, or null for gig orders. */
export const salariedPayLabel = (o) => {
    const tip = num(o?.tipAmount);
    const seq = o?.riderDaySeq ? ` (delivery ${o.riderDaySeq} of the day)` : '';
    if (o?.riderPayBasis === 'salaried_covered') {
        return `Covered by salary${seq}${tip > 0 ? `, ₹${tip} tip` : ''}`;
    }
    if (o?.riderPayBasis === 'salaried_incentive') {
        return `Salaried incentive${seq}${tip > 0 ? ` (includes ₹${tip} tip)` : ''}`;
    }
    return null;
};

export const getDeliveryPartnerEarnings = async (deliveryPartnerId, query = {}) => {
    if (!isId(deliveryPartnerId)) throw new ValidationError('Delivery partner not found');
    const partnerId = String(deliveryPartnerId);

    const period = String(query.period || 'week').toLowerCase();
    const date = parseQueryDate(query.date);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);

    let range = null;
    if (period === 'today') range = { start: toStartOfDay(date), end: toEndOfDay(date) };
    else if (period === 'month') range = getMonthRange(date);
    else if (period === 'all') range = null;
    else range = getWeekRange(date); // week, and anything unrecognised

    const where = {
        dispatchDeliveryPartnerId: partnerId,
        orderStatus: 'delivered',
        ...(range ? { deliveredAt: { gte: range.start, lte: range.end } } : {}),
    };

    // Shifts that overlap the window at all, so a shift spanning midnight is
    // still counted rather than dropped for starting outside it.
    const sessionWhere = {
        deliveryPartnerId: partnerId,
        ...(range
            ? {
                  wentOnlineAt: { lte: range.end },
                  OR: [{ wentOfflineAt: null }, { wentOfflineAt: { gte: range.start } }],
              }
            : {}),
    };

    const [totalOrders, agg, sessions, bonusAgg, salariedAgg, salaried] = await Promise.all([
        prisma.foodOrder.count({ where }),
        prisma.foodOrder.aggregate({ where, _sum: { riderEarning: true, tipAmount: true } }),
        prisma.foodDeliveryPartnerSession.findMany({
            where: sessionWhere,
            select: { wentOnlineAt: true, wentOfflineAt: true },
        }),
        // Incentives and bonuses credited in the window (earning addons write
        // a bonus row when credited).
        prisma.deliveryBonusTransaction.aggregate({
            where: {
                deliveryPartnerId: partnerId,
                ...(range ? { createdAt: { gte: range.start, lte: range.end } } : {}),
            },
            _sum: { amount: true },
        }),
        // Salaried riders: what the orders past the daily threshold paid.
        prisma.foodOrder.aggregate({
            where: { ...where, riderPayBasis: 'salaried_incentive' },
            _sum: { riderEarning: true, tipAmount: true },
            _count: { _all: true },
        }),
        getSalariedStatus(partnerId),
    ]);

    const totalEarnings = num(agg?._sum?.riderEarning);
    const incentive = Math.round(num(bonusAgg?._sum?.amount) * 100) / 100;
    // riderEarning already contains the tip, so the delivery part is what is
    // left after taking it out. Adding them would count every tip twice.
    const totalTips = num(agg?._sum?.tipAmount);
    const deliveryEarning = Math.round((totalEarnings - totalTips) * 100) / 100;

    // Reported as 0 before the duty log existed, because nothing recorded when
    // a rider went on or off shift. Clipped to the window so only the part of
    // a shift inside the period is counted, and an open shift is measured up to
    // now rather than treated as zero-length.
    const now = new Date();
    const clipStart = range ? range.start.getTime() : -Infinity;
    const clipEnd = range ? range.end.getTime() : Infinity;
    const onlineMs = sessions.reduce((sum, session) => {
        const from = Math.max(new Date(session.wentOnlineAt).getTime(), clipStart);
        const to = Math.min(
            (session.wentOfflineAt ? new Date(session.wentOfflineAt) : now).getTime(),
            clipEnd,
        );
        return sum + Math.max(0, to - from);
    }, 0);
    const onlineMinutesTotal = Math.round(onlineMs / 60000);

    return {
        summary: {
            totalEarnings,
            totalOrders,
            totalHours: Math.floor(onlineMinutesTotal / 60),
            totalMinutes: onlineMinutesTotal % 60,
            /// Whole minutes on shift, for callers that would rather not
            /// recombine hours and minutes.
            totalOnlineMinutes: onlineMinutesTotal,
            /// Delivery pay only. Tips used to be folded in here, which made a
            /// generous week look like better delivery rates; the parts now add
            /// up to totalEarnings instead of overlapping it.
            orderEarning: deliveryEarning,
            tips: totalTips,
            /// Incentives / bonuses credited in the period. Not part of
            /// totalEarnings (order pay + tips); grandTotal adds them.
            incentive,
            otherEarnings: 0,
            grandTotal: Math.round((totalEarnings + incentive) * 100) / 100,
            /// Salaried riders: delivery pay from orders past the daily
            /// threshold in this period. Already inside orderEarning.
            salariedIncentive: Math.round(
                (num(salariedAgg?._sum?.riderEarning) - num(salariedAgg?._sum?.tipAmount)) * 100,
            ) / 100,
            salariedIncentiveOrders: salariedAgg?._count?._all || 0,
        },
        /// 'gig' | 'salaried'
        payType: salaried?.payType || 'gig',
        /// Salaried riders: today's progress toward the daily threshold. Null for gig.
        salaried: salaried?.isSalaried ? salaried : null,
        period,
        date: date.toISOString(),
        pagination: { page, limit, total: totalOrders },
    };
};

const normalizeStatusFilter = (status) => {
    const s = String(status || '').trim();
    if (!s || s.toUpperCase() === 'ALL TRIPS') return null;
    return s;
};

const toTripDto = (order) => {
    const createdAt = order?.createdAt || null;
    const deliveredAt = order?.deliveredAt || null;
    const dateForUi = deliveredAt || createdAt || order?.updatedAt || null;

    // Pre-formatted for older app builds that render this string directly.
    //
    // 'en-IN' selects the FORMAT and says nothing about the timezone: with no
    // timeZone option Node uses the system zone, and this server runs UTC, so
    // riders saw every trip 5h30m early. The zone is explicit.
    //
    // Deprecated: clients should format `date` (a real ISO-8601 timestamp) in the
    // device's own timezone.
    const time = dateForUi
        ? new Date(dateForUi).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: process.env.DISPLAY_TIME_ZONE || 'Asia/Kolkata',
          })
        : '';

    const orderStatus = String(order?.orderStatus || '').toLowerCase();
    const isDelivered =
        orderStatus === 'delivered' || String(order?.deliveryPhase || '').toLowerCase() === 'delivered';
    const isCancelled =
        orderStatus.startsWith('cancelled') ||
        String(order?.deliveryStatus || '').toLowerCase().includes('cancel');

    const status = isDelivered ? 'Completed' : isCancelled ? 'Cancelled' : 'Pending';

    const restaurantName = order?.restaurant?.restaurantName || '';
    const paymentMethod = order?.paymentMethod || '';
    const pricingTotal = num(order?.total);

    const earningAmount = num(order?.riderEarning);
    const codAmount = paymentMethod === 'cash' ? num(order?.paymentAmountDue) : 0;
    const codCollectedAmount = paymentMethod === 'cash' && order?.paymentStatus === 'paid' ? codAmount : 0;

    return {
        id: order?.id,
        _id: order?.id,
        orderId: order?.orderId || order?.id,
        status,
        restaurantName,
        restaurant: restaurantName,
        customerName: order?.customerName || order?.user?.name || '',
        items: order?.items || [],
        orderItems: order?.items || [],
        paymentMethod,
        totalAmount: pricingTotal,
        orderTotal: pricingTotal,
        codAmount,
        codCollectedAmount,
        deliveryEarning: earningAmount,
        earningAmount,
        amount: earningAmount, // legacy fallback
        // The same earning, split: what the trip paid and what the customer
        // tipped. The rider app already labels a trip "incl. ₹N tip", but trip
        // history never sent the tip, so the label could not appear.
        tipAmount: num(order?.tipAmount),
        deliveryAmount: Math.round((earningAmount - num(order?.tipAmount)) * 100) / 100,
        riderPayBasis: order?.riderPayBasis || null,
        payLabel: salariedPayLabel(order),
        createdAt: order?.createdAt,
        deliveredAt,
        completedAt: deliveredAt,
        date: dateForUi,
        time,
    };
};

export const getDeliveryPartnerTripHistory = async (deliveryPartnerId, query = {}) => {
    if (!isId(deliveryPartnerId)) throw new ValidationError('Delivery partner not found');
    const partnerId = String(deliveryPartnerId);

    const period = query.period || 'daily';
    const date = parseQueryDate(query.date);
    const statusFilter = normalizeStatusFilter(query.status);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);

    // period=all: every trip, no date window.
    const allTime = String(period).toLowerCase() === 'all';
    const { start, end } = allTime ? {} : computeRange(period, date);

    const where = {
        dispatchDeliveryPartnerId: partnerId,
        AND: allTime ? [] : [{ OR: withinRange(start, end) }],
    };
    // Customer name or order id.
    const search = String(query.search || '').trim();
    if (search) {
        const contains = { contains: search, mode: 'insensitive' };
        where.AND.push({
            OR: [{ customerName: contains }, { order_id: contains }, { user: { name: contains } }],
        });
    }

    // orderStatus is an enum, so it can only be matched against its values:
    // `startsWith: 'cancelled'` is a string filter Prisma rejects, and it made
    // the rider app's Cancelled and Pending tabs fail with a raw query error.
    const CANCELLED = ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];
    const sf = String(statusFilter || '').toLowerCase();
    if (sf === 'completed') {
        where.orderStatus = 'delivered';
    } else if (sf === 'cancelled') {
        where.orderStatus = { in: CANCELLED };
    } else if (sf === 'pending') {
        // Pending = neither delivered nor cancelled.
        where.orderStatus = { notIn: ['delivered', ...CANCELLED] };
    }

    const orders = await prisma.foodOrder.findMany({
        where,
        include: {
            items: true,
            restaurant: { select: { id: true, restaurantName: true } },
            user: { select: { name: true } },
        },
        orderBy: TRIP_ORDER_BY,
        take: limit,
    });

    return {
        period,
        date: (date || new Date()).toISOString(),
        range: allTime ? null : { start: start.toISOString(), end: end.toISOString() },
        trips: (orders || []).map(toTripDto),
    };
};

export const getDeliveryPocketDetails = async (deliveryPartnerId, query = {}) => {
    if (!isId(deliveryPartnerId)) throw new ValidationError('Delivery partner not found');
    const partnerId = String(deliveryPartnerId);

    const date = parseQueryDate(query.date);
    const { start, end } = getWeekRange(date);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 2000);

    const [orders, bonusTxList] = await Promise.all([
        prisma.foodOrder.findMany({
            where: {
                dispatchDeliveryPartnerId: partnerId,
                orderStatus: 'delivered',
                OR: withinRange(start, end),
            },
            include: { items: true, restaurant: { select: { id: true, restaurantName: true } } },
            orderBy: TRIP_ORDER_BY,
            take: limit,
        }),
        prisma.deliveryBonusTransaction.findMany({
            where: { deliveryPartnerId: partnerId, createdAt: { gte: start, lte: end } },
            orderBy: { createdAt: 'desc' },
            take: limit,
        }),
    ]);

    const trips = (orders || []).map(toTripDto);

    const paymentTransactions = (orders || []).map((o) => ({
        _id: o.id,
        type: 'payment',
        amount: num(o.riderEarning),
        status: 'Completed',
        date: o.deliveredAt || o.createdAt,
        createdAt: o.deliveredAt || o.createdAt,
        orderId: o.orderId || o.id,
        metadata: { orderId: o.orderId || o.id },
        category: o.riderPayBasis || 'delivery_earning',
        riderPayBasis: o.riderPayBasis || null,
        description: salariedPayLabel(o) || (o.restaurant?.restaurantName
            ? `Order earning - ${o.restaurant.restaurantName}`
            : 'Order earning'),
    }));

    const bonusTransactions = (bonusTxList || []).map((t) => ({
        _id: t.id,
        type: 'bonus',
        amount: num(t.amount),
        status: 'Completed',
        date: t.createdAt,
        createdAt: t.createdAt,
        metadata: { reference: t.reference || '' },
        description: t.reference ? `Bonus - ${t.reference}` : 'Bonus',
    }));

    const totalEarning = paymentTransactions.reduce((sum, t) => sum + num(t.amount), 0);
    const totalBonus = bonusTransactions.reduce((sum, t) => sum + num(t.amount), 0);

    return {
        week: { start: start.toISOString(), end: end.toISOString() },
        summary: { totalEarning, totalBonus, grandTotal: totalEarning + totalBonus },
        trips,
        transactions: { payment: paymentTransactions, bonus: bonusTransactions },
    };
};

/**
 * The incentives this rider can earn right now, with their progress.
 *
 * Uses the same rules as the completion sweep (shared/incentiveRules.js): only
 * offers aimed at the rider's zones / cohort, progress counted over the current
 * run (the whole offer, or today / this week for a recurring one), orders only
 * from the offer's zones when it has any, and one row per slab when tiered.
 */
export const getActiveEarningAddonsForPartner = async (deliveryPartnerId) => {
    if (!isId(deliveryPartnerId)) throw new ValidationError('Delivery partner not found');
    const partnerId = String(deliveryPartnerId);
    const now = new Date();

    const [addons, rider] = await Promise.all([
        prisma.foodEarningAddon.findMany({
            where: { status: 'active', startDate: { lte: now }, endDate: { gte: now } },
            orderBy: [{ endDate: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.foodDeliveryPartner.findUnique({
            where: { id: partnerId },
            select: { id: true, zoneId: true, cohortId: true, serviceZoneIds: true },
        }),
    ]);
    if (!rider) throw new ValidationError('Delivery partner not found');
    const riderZones = await riderOfferZones(rider);

    const liveAddons = (addons || []).filter((addon) => {
        if (!addon || !riderTargeted(addon, rider, riderZones)) return false;
        const maxRedemptions = Number(addon.maxRedemptions);
        if (!Number.isFinite(maxRedemptions) || maxRedemptions <= 0) return true;
        return Number(addon.currentRedemptions || 0) < maxRedemptions;
    });

    // Where this rider stands on each target once reached: recorded and
    // waiting for an admin, paid, or turned down.
    const claims = liveAddons.length
        ? await prisma.foodEarningAddonHistory.findMany({
              where: { deliveryPartnerId: partnerId, offerId: { in: liveAddons.map((a) => a.id) } },
              orderBy: { createdAt: 'desc' },
              select: { offerId: true, periodKey: true, status: true, creditedAt: true, cancelReason: true },
          })
        : [];
    const claimFor = (offerId, key) => claims.find((c) => c.offerId === offerId && (c.periodKey || '') === key) || null;
    const claimStatus = (claim) => {
        if (!claim) return null;
        if (claim.status === 'credited') return 'credited';
        if (claim.status === 'cancelled') return 'rejected';
        return 'pending_approval';
    };

    const offers = await Promise.all(
        liveAddons.map(async (addon) => {
            const period = offerPeriod(addon, now);
            const startDate = addon.startDate ? new Date(addon.startDate) : null;
            const endDate = addon.endDate ? new Date(addon.endDate) : null;

            const where = {
                dispatchDeliveryPartnerId: partnerId,
                orderStatus: 'delivered',
                deliveredAt: { gte: period.start, lte: period.end },
                ...(addon.zoneIds?.length ? { zoneId: { in: await expandZoneFamilies(addon.zoneIds) } } : {}),
            };

            const [currentOrders, earningsAgg, currentOnlineMinutes] = await Promise.all([
                prisma.foodOrder.count({ where }),
                prisma.foodOrder.aggregate({ where, _sum: { riderEarning: true } }),
                // Only for hours-based offers; an orders-based one does not
                // need the duty log and should not pay for the query.
                addon.criteria === 'online_hours'
                    ? onlineMinutesInWindow(partnerId, period.start, period.end)
                    : 0,
            ]);

            const targets = offerTargets(addon).map((t) => {
                const key = grantKey(period.key, t.tier);
                const claim = claimFor(addon.id, key);
                return {
                    tier: t.tier,
                    targetOrders: t.requiredOrders,
                    targetOnlineMinutes: t.requiredOnlineMinutes,
                    amount: t.earningAmount,
                    reached: targetMet(addon, t, { orders: currentOrders, onlineMinutes: currentOnlineMinutes }),
                    // in_progress | pending_approval | credited | rejected
                    status: claimStatus(claim) || 'in_progress',
                    creditedAt: claim?.creditedAt || null,
                    rejectedReason: claim?.status === 'cancelled' ? claim.cancelReason || '' : '',
                };
            });
            // The headline target: the first slab not yet earned, else the last.
            const headline = targets.find((t) => t.status === 'in_progress') || targets[targets.length - 1];

            return {
                id: addon.id,
                title: addon.title || 'Earnings Guarantee',
                description: addon.description || '',
                targetAmount: headline.amount,
                criteria: addon.criteria || 'orders',
                targetOrders: headline.targetOrders,
                currentOrders: num(currentOrders),
                targetOnlineMinutes: headline.targetOnlineMinutes,
                currentOnlineMinutes,
                currentEarnings: num(earningsAgg?._sum?.riderEarning),
                startDate,
                endDate,
                validTill: endDate ? endDate.toISOString() : null,
                // The run progress is counted over: the whole offer, or the
                // current IST day / Monday-to-Sunday week.
                recurrence: normalizeRecurrence(addon.recurrence),
                periodStart: period.start,
                periodEnd: period.end,
                autoCredit: Boolean(addon.autoCredit),
                // One entry per slab (a single entry when not tiered).
                targets,
                isLive: true,
                // in_progress | pending_approval | credited | rejected
                status: headline.status,
                creditedAt: headline.creditedAt,
                rejectedReason: headline.rejectedReason,
            };
        }),
    );

    return { activeOffer: offers[0] || null, offers };
};

/**
 * Delete a delivery partner and everything that cannot outlive them.
 *
 * Seven tables reference a partner with ON DELETE RESTRICT, so the delete has to
 * name all of them. Mongo left every one of these orphaned — bonus rows,
 * withdrawals and cash deposits pointing at a partner that no longer existed,
 * which quietly skewed finance reports.
 *
 * The wallet LEDGER is deliberately not touched: `transactions.entityId` is a
 * plain column with no foreign key, so those rows survive. They are the record
 * of money that actually moved, and reconciliation still needs them after the
 * account is gone. Orders and the per-order split keep their history too — those
 * FKs are ON DELETE SET NULL, so a delivered order stays delivered.
 */
export const deleteDeliveryPartnerAccount = async (partnerId) => {
    const id = String(partnerId);
    const partner = await prisma.foodDeliveryPartner.findUnique({ where: { id } });
    if (!partner) throw new ValidationError('Delivery partner not found');

    const byPartner = { where: { deliveryPartnerId: id } };

    await prisma.$transaction([
        prisma.deliveryBonusTransaction.deleteMany(byPartner),
        prisma.foodDeliveryCashDeposit.deleteMany(byPartner),
        prisma.foodDeliveryWithdrawal.deleteMany(byPartner),
        prisma.foodEarningAddonHistory.deleteMany(byPartner),
        prisma.deliveryOrderEmergencyRequest.deleteMany(byPartner),
        prisma.deliverySupportTicket.deleteMany(byPartner),
        prisma.orderDispatchOffer.deleteMany({ where: { partnerId: id } }),
        prisma.wallet.deleteMany({ where: { entityType: 'deliveryBoy', entityId: id } }),
        prisma.foodDeliveryPartner.delete({ where: { id } }),
    ]);

    return { success: true };
};
