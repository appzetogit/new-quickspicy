import { prisma } from '../../../../config/prisma.js';
import { AuthError, ValidationError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';

const parseIsoDateOrNull = (value, label = 'Date') => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    // A bad date is an error, not null: null used to erase the saved one.
    // The round-trip catches 2023-02-30, which Date silently rolls into March.
    // The app echoes back the stored value ("2000-01-31T00:00:00.000Z"); the
    // date part is what counts.
    const raw = String(value).trim();
    const text = raw.slice(0, 10);
    const d = new Date(`${text}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(raw) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text
        || d > new Date() || d.getUTCFullYear() < 1900) {
        throw new ValidationError(`${label} must be a valid past date (YYYY-MM-DD)`);
    }
    return d;
};

const requireUser = async (userId) => {
    const user = await prisma.foodUser.findUnique({ where: { id: String(userId) } });
    if (!user) throw new AuthError('Profile not found');
    return user;
};

export const getCurrentUserProfile = async (userId) => ({ user: await requireUser(userId) });

export const updateCurrentUserProfile = async (userId, body) => {
    const user = await requireUser(userId);
    const data = {};

    if (body.phone !== undefined) {
        const nextPhone = String(body.phone || '').trim();
        const currentPhone = String(user.phone || '').trim();
        // OTP login is phone-based in this project; don't allow changing it from profile edit.
        if (nextPhone && nextPhone !== currentPhone) {
            throw new ValidationError('Phone number cannot be changed');
        }
    }

    if (body.name !== undefined) data.name = String(body.name || '').trim();

    if (body.email !== undefined) {
        const nextEmail = String(body.email || '').trim().toLowerCase();
        if (nextEmail) {
            const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!EMAIL_REGEX.test(nextEmail)) {
                throw new ValidationError('Invalid email format');
            }
            const domainParts = nextEmail.split('@')[1].split('.');
            for (let i = 0; i < domainParts.length - 1; i++) {
                if (domainParts[i] === domainParts[i + 1] && domainParts[i].length > 0) {
                    throw new ValidationError('Invalid email domain structure (e.g., .com.com)');
                }
            }
            if (nextEmail.includes('..')) {
                throw new ValidationError('Email cannot contain consecutive dots');
            }
        }
        data.email = nextEmail;
    }

    if (body.profileImage !== undefined) data.profileImage = String(body.profileImage || '').trim();
    if (body.preferredLanguage !== undefined) data.preferredLanguage = body.preferredLanguage;

    if (body.gender !== undefined) {
        // The Postgres enum names the hyphenated Mongo value `prefer_not_to_say`
        // and empty string `unset`; clients still send the original spellings.
        const raw = String(body.gender || '').trim();
        const GENDERS = { '': 'unset', male: 'male', female: 'female', other: 'other', 'prefer-not-to-say': 'prefer_not_to_say' };
        const mapped = GENDERS[raw] ?? GENDERS[raw.replace(/_/g, '-')];
        if (mapped === undefined) throw new ValidationError('Invalid gender');
        data.gender = mapped;
    }

    const dob = parseIsoDateOrNull(body.dateOfBirth, 'Date of birth');
    if (dob !== undefined) data.dateOfBirth = dob;
    const ann = parseIsoDateOrNull(body.anniversary, 'Anniversary');
    if (ann !== undefined) data.anniversary = ann;

    return { user: await prisma.foodUser.update({ where: { id: user.id }, data }) };
};

export const uploadCurrentUserProfileImage = async (userId, file) => {
    if (!file || !file.buffer) throw new ValidationError('File is required');
    const user = await requireUser(userId);

    const url = await uploadImageBuffer(file.buffer, 'food/users/profile');
    const updated = await prisma.foodUser.update({
        where: { id: user.id },
        data: { profileImage: String(url || '').trim() },
    });

    return { profileImage: updated.profileImage, user: updated };
};

/**
 * Delete a user and everything that cannot outlive them.
 *
 * The wallet ledger is DETACHED rather than deleted: those rows are the record of
 * money that actually moved, and they have to survive the account they refer to.
 */
export const deleteCurrentUserAccount = async (userId) => {
    const user = await requireUser(userId);

    await prisma.$transaction([
        prisma.transaction.updateMany({
            where: { entityType: 'user', entityId: user.id },
            data: { entityId: user.id },
        }),
        prisma.wallet.deleteMany({ where: { entityType: 'user', entityId: user.id } }),
        prisma.foodUser.delete({ where: { id: user.id } }),
    ]);

    return { success: true };
};
