import { sendError } from '../../utils/response.js';
import { prisma } from '../../config/prisma.js';
import { isId } from '../../utils/helpers.js';
import { hasAdminPermission, isSubmenuActionAllowed } from '../../constants/permissions.js';

const isSuperAdmin = (admin) =>
    !admin?.adminType || admin?.adminType === 'super_admin' || admin?.isSuperAdmin === true;

const hasAction = (permissions, section, action, submenuKey = null) =>
    hasAdminPermission(permissions, section, action, submenuKey);

const hydrateAdmin = async (req) => {
    if (req.adminAccess) return req.adminAccess;
    if (!isId(req.user?.userId)) return null;

    const admin = await prisma.foodAdmin.findUnique({
        where: { id: String(req.user.userId) },
        select: { adminType: true, permissions: true, isActive: true, isDeleted: true },
    });
    // Cached on the request so a route guarded by several permission checks
    // still costs one query.
    req.adminAccess = admin;
    return admin;
};

/**
 * `submenuKey` (optional) narrows the check to one submenu of the section: the
 * section must allow the action AND the submenu must not be explicitly
 * restricted below it (see sanitizeAdminPermissions).
 */
export const requireAdminPermission = (section, action = 'view', submenuKey = null) => async (req, res, next) => {
    try {
        if (!req.user?.userId || req.user?.role !== 'ADMIN') {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        if (!hasAction(admin.permissions, section, action, submenuKey)) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};

/**
 * Submenu restriction only: refuses when the role has an explicit entry for
 * this submenu that leaves the action out, and otherwise defers to whatever
 * section-level guard the route already has (including none, for the reads
 * every admin may make). It can only ever add a refusal, never grant access.
 */
export const requireAdminSubmenuAccess = (section, submenuKey, action = 'view') => async (req, res, next) => {
    try {
        if (!req.user?.userId || req.user?.role !== 'ADMIN') {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        if (!isSubmenuActionAllowed(admin.permissions, section, submenuKey, action)) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};

export const requireAnyAdminPermission = (rules = []) => async (req, res, next) => {
    try {
        if (!req.user?.userId || req.user?.role !== 'ADMIN') {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        const allowed = Array.isArray(rules) && rules.some((rule) => {
            const section = rule?.section;
            const action = rule?.action || 'view';
            if (!section) return false;
            return hasAction(admin.permissions, section, action);
        });

        if (!allowed) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};
