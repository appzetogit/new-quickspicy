import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';
import { validateDeliveryRegisterDto } from '../../delivery/validators/delivery.validator.js';
import { registerDeliveryPartner } from '../../delivery/services/delivery.service.js';
import { findDeliveryPartnerByPhone } from '../../../../core/auth/onboardingGate.js';
import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { resolveRiderZones } from '../services/adminRiderCohort.service.js';

/** Multipart sends booleans as strings. Missing means yes: approved at once. */
const wantsApproved = (value) => !['false', '0', 'no', 'off'].includes(String(value ?? 'true').trim().toLowerCase());

/**
 * Admin panel: Add Deliveryman.
 *
 * The same fields and checks as the rider app's sign-up, plus optional bank
 * details; the rider is approved at once and logs in with OTP on that phone.
 * This is how riders join when self sign-up is switched off.
 */
const adminExtras = z.object({
    phone: z
        .string({ required_error: 'Phone is required' })
        .transform((v) => String(v).replace(/\D/g, '').slice(-10))
        .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number'),
    city: z.string({ required_error: 'City is required' }).trim().min(1, 'City is required'),
    bankAccountHolderName: z.string().trim().max(100).optional().or(z.literal('')),
    bankAccountNumber: z
        .string()
        .trim()
        .regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits')
        .optional()
        .or(z.literal('')),
    bankIfscCode: z
        .string()
        .trim()
        .transform((v) => v.toUpperCase())
        .refine((v) => v === '' || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), 'Invalid IFSC code')
        .optional(),
    bankName: z.string().trim().max(100).optional().or(z.literal('')),
    upiId: z
        .string()
        .trim()
        .regex(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/, 'Invalid UPI id')
        .optional()
        .or(z.literal('')),
});

export async function createDeliveryPartnerByAdmin(req, res, next) {
    try {
        const body = req.body || {};
        const extras = adminExtras.safeParse(body);
        if (!extras.success) throw new ValidationError(extras.error.errors[0].message);

        // Upper-cased before the app's own format checks (PAN, DL).
        const normalized = {
            ...body,
            phone: extras.data.phone,
            city: extras.data.city,
            panNumber: body.panNumber ? String(body.panNumber).trim().toUpperCase() : body.panNumber,
            drivingLicenseNumber: body.drivingLicenseNumber
                ? String(body.drivingLicenseNumber).replace(/[\s-]/g, '').toUpperCase()
                : body.drivingLicenseNumber,
            countryCode: '+91',
            platform: 'web',
        };
        const validated = validateDeliveryRegisterDto(normalized);

        // Matched the way login matches (last 10 digits), so a rider stored
        // as +91... is still caught as a duplicate.
        const existing = await findDeliveryPartnerByPhone(validated.phone);
        if (existing && existing.status !== 'rejected') {
            throw new ValidationError('A delivery partner with this phone already exists');
        }

        // Home zone plus the other small zones of their main zone, checked
        // before the rider is created.
        const zones = await resolveRiderZones(body, {});
        const zoneId = zones.zoneId || null;
        const serviceZoneIds = zones.serviceZoneIds || [];
        // Gig (paid per order, the default) or salaried.
        const payType = String(body.payType || 'gig').trim().toLowerCase();
        if (!['gig', 'salaried'].includes(payType)) throw new ValidationError('Payment type must be gig or salaried');
        const approve = wantsApproved(body.approveNow);

        const filesByField = {};
        for (const f of Array.isArray(req.files) ? req.files : []) {
            (filesByField[f.fieldname] ||= []).push(f);
        }

        const partner = await registerDeliveryPartner(
            { ...validated, ...extras.data, ref: '' },
            filesByField,
            body,
            { createdByAdmin: true, adminId: req.user?.userId || null, approve, zoneId },
        );
        if (serviceZoneIds.length || payType !== 'gig') {
            await prisma.foodDeliveryPartner.update({
                where: { id: partner.id },
                data: { ...(serviceZoneIds.length ? { serviceZoneIds } : {}), ...(payType !== 'gig' ? { payType } : {}) },
            });
        }
        res.status(201).json({
            success: true,
            message: approve
                ? 'Delivery partner added. They can log in with OTP on their phone.'
                : 'Delivery partner added as pending. Approve them from Join requests.',
            data: { id: partner.id, name: partner.name, phone: partner.phone, status: partner.status, payType },
        });
    } catch (err) {
        next(err);
    }
}
