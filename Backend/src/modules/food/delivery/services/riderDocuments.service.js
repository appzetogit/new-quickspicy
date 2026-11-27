import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';

/**
 * Per-document verification for riders.
 *
 * The rider was approved or rejected as a whole; now each document has its own
 * verdict in FoodDeliveryPartner.documentReviews:
 *
 *   { [key]: { status, reason, expiresAt, reviewedAt, reviewedBy, url } }
 *
 * `url` is the file the admin looked at. When the rider uploads a new file the
 * URL no longer matches, so the document reads as pending again without every
 * upload path having to remember to reset it.
 *
 * Keys: the four built-in documents plus any admin-defined registration field
 * of type document (stored in customDocuments).
 */

export const BUILT_IN_DOCUMENTS = [
    { key: 'profilePhoto', label: 'Profile photo', numberField: null, folder: 'food/delivery/profile' },
    { key: 'aadharPhoto', label: 'Aadhaar card', numberField: 'aadharNumber', folder: 'food/delivery/aadhar' },
    { key: 'panPhoto', label: 'PAN card', numberField: 'panNumber', folder: 'food/delivery/pan' },
    { key: 'drivingLicensePhoto', label: 'Driving licence', numberField: 'drivingLicenseNumber', folder: 'food/delivery/license' },
];
/** Uploaded at sign-up, stored in customDocuments.vehicleRcPhoto. */
const VEHICLE_RC = { key: 'vehicleRcPhoto', label: 'Vehicle RC' };
const BUILT_IN = new Map(BUILT_IN_DOCUMENTS.map((d) => [d.key, d]));
const STATUSES = ['pending', 'approved', 'rejected'];

const RIDER_SELECT = {
    id: true, name: true, status: true, documentReviews: true, customDocuments: true,
    profilePhoto: true, aadharPhoto: true, panPhoto: true, drivingLicensePhoto: true,
    aadharNumber: true, panNumber: true, drivingLicenseNumber: true,
};

const customDocumentFields = () =>
    prisma.foodDriverRegistrationField.findMany({
        where: { type: 'document', isActive: true },
        select: { key: true, label: true, required: true },
        orderBy: [{ page: 'asc' }, { order: 'asc' }],
    });

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** The documents a rider has or should have, each with its verdict. */
function describe(rider, customFields, now = Date.now()) {
    const reviews = asObject(rider.documentReviews);
    const custom = asObject(rider.customDocuments);

    const entries = [
        ...BUILT_IN_DOCUMENTS.map((d) => ({
            key: d.key,
            label: d.label,
            custom: false,
            required: d.key !== 'profilePhoto',
            url: rider[d.key] || '',
            number: d.numberField ? rider[d.numberField] || '' : '',
        })),
        // The sign-up's vehicle RC, unless an admin-defined field already covers it.
        ...(customFields.some((f) => f.key === VEHICLE_RC.key) ? [] : [{
            ...VEHICLE_RC, custom: true, required: false, url: String(custom[VEHICLE_RC.key] || ''), number: '',
        }]),
        ...customFields.map((f) => ({
            key: f.key, label: f.label, custom: true, required: f.required, url: String(custom[f.key] || ''), number: '',
        })),
    ];

    return entries.map((doc) => {
        const review = asObject(reviews[doc.key]);
        const expiresAt = review.expiresAt ? new Date(review.expiresAt) : null;
        let status;
        if (!doc.url) status = 'missing';
        else if (!review.status || review.url !== doc.url) status = 'pending'; // never reviewed, or a new file since
        else status = review.status;
        const expired = status === 'approved' && expiresAt && expiresAt.getTime() < now;
        return {
            ...doc,
            status: expired ? 'expired' : status,
            reason: status === 'rejected' ? review.reason || '' : '',
            expiresAt,
            reviewedAt: review.url === doc.url ? review.reviewedAt || null : null,
            // The rider may upload a new file for these.
            canReupload: ['missing', 'rejected', 'expired'].includes(expired ? 'expired' : status),
        };
    });
}

function summarize(documents) {
    const required = documents.filter((d) => d.required || d.url);
    const count = (s) => documents.filter((d) => d.status === s).length;
    return {
        approved: count('approved'),
        pending: count('pending'),
        rejected: count('rejected'),
        expired: count('expired'),
        missing: documents.filter((d) => d.status === 'missing' && d.required).length,
        allVerified: required.length > 0 && required.every((d) => d.status === 'approved'),
    };
}

async function loadRider(riderId) {
    if (!isId(riderId)) throw new NotFoundError('Rider not found');
    const rider = await prisma.foodDeliveryPartner.findUnique({ where: { id: String(riderId) }, select: RIDER_SELECT });
    if (!rider) throw new NotFoundError('Rider not found');
    return rider;
}

export async function getRiderDocuments(riderId) {
    const [rider, customFields] = await Promise.all([loadRider(riderId), customDocumentFields()]);
    const documents = describe(rider, customFields);
    return { riderId: rider.id, name: rider.name, riderStatus: rider.status, documents, summary: summarize(documents) };
}

/**
 * The admin's verdict on one document.
 *
 * body: { status: approved|rejected|pending, reason (required to reject),
 *         expiresAt (optional date, e.g. licence validity; null clears it) }
 */
export async function reviewRiderDocument(riderId, key, body = {}, adminId = null) {
    const [rider, customFields] = await Promise.all([loadRider(riderId), customDocumentFields()]);
    const doc = describe(rider, customFields).find((d) => d.key === key);
    if (!doc) throw new ValidationError('Unknown document');
    if (!doc.url) throw new ValidationError(`${doc.label} has not been uploaded`);

    const status = String(body.status || '');
    if (!STATUSES.includes(status)) throw new ValidationError('status must be approved, rejected or pending');
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (status === 'rejected' && !reason) throw new ValidationError('Give a reason for rejecting the document');

    let expiresAt = null;
    if (body.expiresAt) {
        const at = new Date(body.expiresAt);
        if (Number.isNaN(at.getTime())) throw new ValidationError('expiresAt must be a date');
        expiresAt = at.toISOString();
    }

    const reviews = asObject(rider.documentReviews);
    reviews[key] = {
        status,
        reason: status === 'rejected' ? reason : '',
        expiresAt,
        reviewedAt: new Date().toISOString(),
        reviewedBy: isId(adminId) ? String(adminId) : null,
        url: doc.url,
    };
    await prisma.foodDeliveryPartner.update({ where: { id: rider.id }, data: { documentReviews: reviews } });

    if (status === 'rejected') {
        void notifyRider(rider.id, {
            title: 'Document needs attention',
            body: `Your ${doc.label} was not accepted: ${reason}. Please upload it again.`,
            data: { type: 'document_rejected', documentKey: key, reason },
        });
    }
    return getRiderDocuments(rider.id);
}

/** The rider's own documents and verdicts. */
export async function getOwnDocuments(riderId) {
    const result = await getRiderDocuments(riderId);
    // reviewedBy is admin-internal; the rest is the rider's own business.
    return { documents: result.documents, summary: result.summary };
}

/**
 * The rider uploads a replacement for a document that is missing, rejected or
 * expired. An approved or pending one cannot be swapped from the app.
 */
export async function reuploadOwnDocument(riderId, key, file, { number } = {}) {
    if (!file?.buffer) throw new ValidationError('Attach the document file');
    const [rider, customFields] = await Promise.all([loadRider(riderId), customDocumentFields()]);
    const doc = describe(rider, customFields).find((d) => d.key === key);
    if (!doc) throw new ValidationError('Unknown document');
    if (!doc.canReupload) {
        throw new ValidationError(
            doc.status === 'approved' ? `${doc.label} is already verified` : `${doc.label} is waiting for review`,
        );
    }

    const builtIn = BUILT_IN.get(key);
    const url = await uploadImageBuffer(file.buffer, builtIn ? builtIn.folder : `food/delivery/${key}`);
    const data = {};
    if (builtIn) {
        data[key] = url;
        const cleanNumber = typeof number === 'string' ? number.trim().slice(0, 40) : '';
        if (builtIn.numberField && cleanNumber) data[builtIn.numberField] = cleanNumber;
    } else {
        data.customDocuments = { ...asObject(rider.customDocuments), [key]: url };
    }
    await prisma.foodDeliveryPartner.update({ where: { id: rider.id }, data });
    // The new copy waits for an admin's review, so tell them it is there.
    void import('./delivery.service.js').then(({ notifyAdminsOfRiderKyc }) => notifyAdminsOfRiderKyc(rider, {
        title: 'Rider document submitted for review',
        body: `${rider.name || 'A delivery partner'} uploaded ${doc.label} for verification.`,
        subType: 'delivery_document',
    })).catch((e) => logger.warn(`Rider document admin notification failed: ${e?.message || e}`));
    return getOwnDocuments(rider.id);
}

async function notifyRider(riderId, message) {
    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely({ ownerType: 'DELIVERY_PARTNER', ownerId: riderId }, message);
    } catch (e) {
        logger.warn(`Rider document notification failed: ${e?.message || e}`);
    }
}
