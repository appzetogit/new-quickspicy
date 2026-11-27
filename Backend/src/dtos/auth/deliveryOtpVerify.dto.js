import { z } from 'zod';
import { ValidationError } from '../../core/auth/errors.js';
import { normalizeRiderPhone, isValidOtp } from '../../modules/food/delivery/validators/delivery.validator.js';
import { normalizePlatform } from '../../utils/platform.js';

const schema = z.object({
    // One spelling per rider: +91 / 0 / plain all normalise to 10 digits.
    phone: z.string().transform((v, ctx) => {
        const phone = normalizeRiderPhone(v);
        if (!phone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
        return phone;
    }),
    otp: z.string().refine(isValidOtp, 'OTP must be 4 digits').transform((v) => v.trim()),
    fcmToken: z.string().optional().nullable(),
    platform: z.preprocess(
        (value) => normalizePlatform(value, { allowUndefined: true }),
        z.enum(['web', 'mobile']).optional().default('web')
    )
});

export const validateDeliveryOtpVerifyDto = (body) => {
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};
