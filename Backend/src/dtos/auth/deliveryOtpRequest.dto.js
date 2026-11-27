import { z } from 'zod';
import { ValidationError } from '../../core/auth/errors.js';
import { normalizeRiderPhone, isValidOtp } from '../../modules/food/delivery/validators/delivery.validator.js';

const schema = z.object({
    // One spelling per rider: +91 / 0 / plain all normalise to 10 digits.
    phone: z.string().transform((v, ctx) => {
        const phone = normalizeRiderPhone(v);
        if (!phone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
        return phone;
    })
});

export const validateDeliveryOtpRequestDto = (body) => {
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};
