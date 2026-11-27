import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';
import { normalizePlatform } from '../../../../utils/platform.js';

/**
 * A rider's phone as stored: 10 digits. "+91 98765 43210", "09876543210" and
 * "919876543210" are all the same rider -- the +91 spelling used to open a
 * second account. Null when it is not an Indian mobile number.
 */
export const normalizeRiderPhone = (raw) => {
    const text = String(raw ?? '').trim();
    if (!/^[+\d\s()-]+$/.test(text)) return null;
    let digits = text.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

const phoneSchema = z
    .string({ required_error: 'Phone is required' })
    .transform((v, ctx) => {
        const phone = normalizeRiderPhone(v);
        if (!phone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
        return phone;
    });

/** The 4-digit login code. */
export const isValidOtp = (v) => /^\d{4}$/.test(String(v ?? '').trim());

const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const aadharRegex = /^[0-9]{12}$/;
// India-wide DL support (normalized, no spaces/hyphens):
// 2 letters (state) + 8 to 16 alphanumeric characters
const drivingLicenseRegex = /^[A-Z]{2}[0-9A-Z]{8,16}$/;

// Same rules as the admin's Add Deliveryman form (adminDeliveryPartnerCreate.controller.js).
// Blank still clears a field.
const blankOr = (test, message, { upper = false } = {}) => z
    .string()
    .transform((v) => (upper ? v.trim().toUpperCase() : v.trim()))
    .refine((v) => v === '' || test(v), message)
    .optional();

/** Indian registration: MH12AB1234 (state + RTO + series + number) or BH series 22BH1234AB. */
export const normalizeVehicleNumber = (v) => String(v ?? '').replace(/[\s-]/g, '').toUpperCase();
const vehicleNumberRegex = /^(?:[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/;

const deliveryRegisterSchema = z.object({
    name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(100),
    phone: phoneSchema,
    // Proof the phone was verified (see assertRegistrationPhoneVerified):
    // the token verify-otp hands an unregistered number, or a fresh OTP.
    registrationToken: z.string().trim().optional(),
    otp: z.string().trim().optional(),
    email: z.string().email().optional().or(z.literal('')),
    countryCode: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    vehicleType: z.string().optional(),
    vehicleName: z.string().optional(),
    vehicleNumber: z.string().transform(normalizeVehicleNumber).optional(),
    drivingLicenseNumber: z
        .string()
        .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
        .refine((v) => v === '' || drivingLicenseRegex.test(v), 'Invalid driving license format')
        .optional(),
    // Bank step of the sign-up form (same rules as Bank Details).
    bankAccountHolderName: blankOr((v) => v.length <= 100 && /[A-Za-z]/.test(v), 'Enter the account holder name'),
    bankAccountNumber: blankOr((v) => /^\d{9,18}$/.test(v), 'Account number must be 9 to 18 digits'),
    bankIfscCode: blankOr((v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), 'Invalid IFSC code', { upper: true }),
    bankName: blankOr((v) => v.length <= 100 && /[A-Za-z]/.test(v), 'Enter the bank name'),
    upiId: blankOr((v) => /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v), 'Invalid UPI id'),
    ref: z.string().trim().max(64).optional().or(z.literal('')),
    panNumber: z
        .string()
        .regex(panRegex, 'Invalid PAN format')
        .optional()
        .or(z.literal('')),
    aadharNumber: z
        .string()
        .regex(aadharRegex, 'Invalid Aadhar format')
        .optional()
        .or(z.literal('')),
    fcmToken: z.string().optional().nullable(),
    platform: z.preprocess(
        (value) => normalizePlatform(value, { allowUndefined: true }),
        z.enum(['web', 'mobile']).optional().default('web')
    )
});

export const validateDeliveryRegisterDto = (body) => {
    const result = deliveryRegisterSchema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

/**
 * The rider app's own sign-up: the vehicle number must be a real Indian
 * registration, as the app checks. (The admin's Add Deliveryman keeps its
 * looser rule for older plates.)
 */
export const validateRiderSelfRegisterDto = (body) => {
    const dto = validateDeliveryRegisterDto(body);
    if (dto.vehicleNumber && !vehicleNumberRegex.test(dto.vehicleNumber)) {
        throw new ValidationError('Enter a valid vehicle number, e.g. MH12AB1234 or 22BH1234AB');
    }
    return dto;
};

const deliveryProfileUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    countryCode: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    vehicleType: z.string().optional(),
    vehicleName: z.string().optional(),
    vehicleNumber: z.string().optional(),
    drivingLicenseNumber: z
        .string()
        .regex(drivingLicenseRegex, 'Invalid driving license format')
        .optional()
        .or(z.literal('')),
    fcmToken: z.string().optional().nullable(),
    platform: z.preprocess(
        (value) => normalizePlatform(value, { allowUndefined: true }),
        z.enum(['web', 'mobile']).optional().default('web')
    )
});

export const validateDeliveryProfileUpdateDto = (body) => {
    const result = deliveryProfileUpdateSchema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

const bankDetailsSchema = z.object({
    accountHolderName: blankOr((v) => v.length <= 100 && /[A-Za-z]/.test(v), 'Enter the account holder name'),
    accountNumber: blankOr((v) => /^\d{9,18}$/.test(v), 'Account number must be 9 to 18 digits'),
    ifscCode: blankOr((v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), 'Invalid IFSC code', { upper: true }),
    bankName: blankOr((v) => v.length <= 100 && /[A-Za-z]/.test(v), 'Enter the bank name'),
    upiId: blankOr((v) => /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v), 'Invalid UPI id'),
    upiQrCode: z.string().optional().or(z.literal(''))
});

const bankDetailsUpdateSchema = z.object({
    documents: z.object({
        bankDetails: bankDetailsSchema.optional(),
        pan: z.object({ number: blankOr((v) => panRegex.test(v), 'Invalid PAN format', { upper: true }) }).optional()
    }).optional()
}).optional();

export const validateDeliveryBankDetailsDto = (body) => {
    // If we have flat keys from FormData (multer), reconstruct the nested object for Zod
    const processed = { ...body };
    if (!processed.documents) processed.documents = {};
    if (!processed.documents.bankDetails) {
        processed.documents.bankDetails = {
            accountHolderName: body['documents[bankDetails][accountHolderName]'],
            accountNumber: body['documents[bankDetails][accountNumber]'],
            ifscCode: body['documents[bankDetails][ifscCode]'],
            bankName: body['documents[bankDetails][bankName]'],
            upiId: body['documents[bankDetails][upiId]']
        };
    }
    if (!processed.documents.pan && body['documents[pan][number]']) {
        processed.documents.pan = { number: body['documents[pan][number]'] };
    }

    const result = bankDetailsUpdateSchema.safeParse(processed);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};
