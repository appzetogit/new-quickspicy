import { Prisma } from '@prisma/client';
import { currentAdminScope } from '../../../../core/roles/adminScope.context.js';
import { isId } from '../../../../utils/helpers.js';
import { dayRange } from '../../../../utils/timezone.js';

/**
 * Filters shared by the popular-items, cancellation and inventory reports.
 *
 * Dates are whole India days (dayRange), so "to 25 Nov" includes all of the
 * 25th. Prisma queries are narrowed to the admin's cities by the scope
 * extension; raw SQL is not, so it adds zoneScopeSql() itself.
 */

export const num = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const reportFilters = (query = {}) => {
    const zoneRaw = query.zoneId ?? query.zone;
    const restaurantRaw = query.restaurantId ?? query.restaurant;
    return {
        createdAt: dayRange(query),
        zoneId: isId(zoneRaw) ? String(zoneRaw) : null,
        restaurantId: isId(restaurantRaw) ? String(restaurantRaw) : null,
    };
};

/** `AND o."zoneId" ...` for the picked zone and the admin's city scope. */
export const zoneScopeSql = (zoneId, alias = 'o') => {
    const column = Prisma.raw(`${alias}."zoneId"`);
    const parts = [];
    if (zoneId) parts.push(Prisma.sql`AND ${column} = ${zoneId}`);
    const scope = currentAdminScope();
    if (scope) {
        parts.push(scope.zoneIds?.length
            ? Prisma.sql`AND ${column} IN (${Prisma.join(scope.zoneIds)})`
            : Prisma.sql`AND FALSE`);
    }
    return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
};

/** `AND o."createdAt" ...` for a dayRange() result. */
export const createdAtSql = (createdAt, alias = 'o') => {
    const column = Prisma.raw(`${alias}."createdAt"`);
    return Prisma.sql`
        ${createdAt?.gte ? Prisma.sql`AND ${column} >= ${createdAt.gte}` : Prisma.empty}
        ${createdAt?.lte ? Prisma.sql`AND ${column} <= ${createdAt.lte}` : Prisma.empty}
    `;
};
