import { z } from 'zod';
import { ValidationError } from '../../core/auth/errors.js';

const schema = z.object({
    // A 10-digit Indian mobile number. The app sends it bare, the web with
    // its 91 country code; both become the bare 10 digits.
    phone: z
        .string()
        .transform((v) => v.replace(/[\s-]/g, ''))
        .refine((v) => /^(?:\+?91)?[6-9]\d{9}$/.test(v), 'Please enter a valid 10-digit mobile number')
        .transform((v) => v.slice(-10))
});

export const validateRestaurantOtpRequestDto = (body) => {
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};
