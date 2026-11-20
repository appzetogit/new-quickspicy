import { Prisma } from '@prisma/client';
import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { parseDayBound } from '../../../../utils/timezone.js';
import { zoneCustomerIds } from './adminCustomer.service.js';

/**
 * Admin referrals: per-zone referral setting overrides, and the referrers
 * report (customers and riders who referred someone).
 *
 * A "referral" is one referred account:
 *  - every FoodReferralLog row for the role (credited, rejected, or pending),
 *  - plus any account whose referredById names the referrer but has no log
 *    yet -- a rider who signed up with a code but has not completed a delivery.
 * "Qualified" = the log is credited (the reward was paid); the amount received
 * is the sum of credited rewardAmount.
 */

// ─── Zone overrides ─────────────────────────────────────────────────────────

const toNumOrNull = (v) => (v === null || v === undefined ? null : Number(v));

const serializeZoneSetting = (row, zoneById = new Map()) => ({
    id: row.id,
    zoneId: row.zoneId,
    zoneName: zoneById.get(row.zoneId)?.name || null,
    cityId: zoneById.get(row.zoneId)?.cityId || null,
    referralRewardUser: toNumOrNull(row.referralRewardUser),
    referralRewardDelivery: toNumOrNull(row.referralRewardDelivery),
    referralLimitUser: row.referralLimitUser ?? null,
    referralLimitDelivery: row.referralLimitDelivery ?? null,
    isActive: row.isActive !== false,
    updatedAt: row.updatedAt,
});

export async function listReferralZoneSettings() {
    const rows = await prisma.foodReferralZoneSetting.findMany({ orderBy: { createdAt: 'asc' } });
    const zones = rows.length
        ? await prisma.foodZone.findMany({
            where: { id: { in: rows.map((r) => r.zoneId) } },
            select: { id: true, name: true, zoneName: true, cityId: true },
        })
        : [];
    const zoneById = new Map(zones.map((z) => [z.id, { ...z, name: z.zoneName || z.name }]));
    return { zoneSettings: rows.map((r) => serializeZoneSetting(r, zoneById)) };
}

/**
 * One override field from the form: blank/null = "use global"; otherwise a
 * non-negative number (whole for limits).
 */
const overrideValue = (value, label, whole = false) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be 0 or more`);
    if (whole && !Number.isInteger(n)) throw new ValidationError(`${label} must be a whole number`);
    return n;
};

export const validateReferralZoneSettingDto = (body = {}) => {
    const out = {
        referralRewardUser: overrideValue(body.referralRewardUser, 'Customer reward'),
        referralRewardDelivery: overrideValue(body.referralRewardDelivery, 'Rider reward'),
        referralLimitUser: overrideValue(body.referralLimitUser, 'Customer limit', true),
        referralLimitDelivery: overrideValue(body.referralLimitDelivery, 'Rider limit', true),
    };
    if (body.isActive !== undefined) out.isActive = Boolean(body.isActive);
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
};

export async function upsertReferralZoneSetting(zoneId, body = {}) {
    if (!isId(zoneId)) throw new ValidationError('Choose a zone');
    const zone = await prisma.foodZone.findUnique({ where: { id: String(zoneId) }, select: { id: true } });
    if (!zone) throw new ValidationError('Zone not found');
    const data = validateReferralZoneSettingDto(body);
    const row = await prisma.foodReferralZoneSetting.upsert({
        where: { zoneId: String(zoneId) },
        create: { zoneId: String(zoneId), ...data },
        update: data,
    });
    return serializeZoneSetting(row);
}

export async function deleteReferralZoneSetting(zoneId) {
    if (!isId(zoneId)) throw new ValidationError('Invalid zone');
    const { count } = await prisma.foodReferralZoneSetting.deleteMany({ where: { zoneId: String(zoneId) } });
    return { deleted: count > 0 };
}

// ─── Referrers report ───────────────────────────────────────────────────────

const ROLES = {
    user: { role: 'USER', table: Prisma.raw('"food_users"') },
    delivery: { role: 'DELIVERY_PARTNER', table: Prisma.raw('"food_delivery_partners"') },
};

const roleOf = (value) => {
    const key = String(value || 'user').toLowerCase();
    if (key === 'user' || key === 'users' || key === 'customer') return 'user';
    if (key === 'delivery' || key === 'rider' || key === 'riders' || key === 'delivery_partner') return 'delivery';
    throw new ValidationError('type must be user or delivery');
};

/** Every referral edge for a role: logs, plus referred accounts with no log. */
const edgesSql = ({ role, table }) => Prisma.sql`
    SELECT l."referrerId", l."refereeId", l."createdAt",
           l."status"::text AS "status", l."rewardAmount" AS "reward", l."reason"
    FROM "food_referral_logs" l
    WHERE l."role"::text = ${role}
    UNION ALL
    SELECT r."referredById", r."id", r."createdAt", 'pending', 0, ''
    FROM ${table} r
    WHERE r."referredById" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "food_referral_logs" l2
        WHERE l2."refereeId" = r."id" AND l2."role"::text = ${role}
      )
`;

const dateWhere = (from, to) => {
    const parts = [];
    if (from) parts.push(Prisma.sql`e."createdAt" >= ${from}`);
    if (to) parts.push(Prisma.sql`e."createdAt" <= ${to}`);
    return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
};

const readRange = (query) => {
    const from = parseDayBound(query.from ?? query.startDate, 'start');
    const to = parseDayBound(query.to ?? query.endDate, 'end');
    if (from === null || to === null) throw new ValidationError('Invalid date');
    return { from: from || null, to: to || null };
};

/** Zone/city filter on the referrer: a rider's home zone; a customer's address/order zone. */
const zoneFilterSql = async (key, query) => {
    const zoneId = isId(query.zoneId) ? String(query.zoneId) : null;
    const cityId = !zoneId && isId(query.cityId) ? String(query.cityId) : null;
    if (!zoneId && !cityId) return { sql: null };
    if (key === 'delivery') {
        return {
            sql: zoneId
                ? Prisma.sql`p."zoneId" = ${zoneId}`
                : Prisma.sql`p."zoneId" IN (SELECT z."id" FROM "food_zones" z WHERE z."cityId" = ${cityId})`,
        };
    }
    const ids = await zoneCustomerIds({ zoneId, cityId });
    if (!ids || !ids.length) return { none: true };
    return { sql: Prisma.sql`p."id" = ANY(${ids})` };
};

const searchSql = (search) => {
    const s = String(search || '').trim().slice(0, 80);
    if (!s) return null;
    const like = `%${s}%`;
    return Prisma.sql`(p."name" ILIKE ${like} OR p."phone" ILIKE ${like} OR p."referralCode" ILIKE ${like} OR p."id" = ${s.toLowerCase()})`;
};

const mapReferrer = (r) => ({
    id: r.id,
    name: r.name || '',
    phone: r.phone || '',
    referralCode: r.referralCode || r.id,
    zoneId: r.zoneId || null,
    referredBy: r.referredById
        ? { id: r.referredById, name: r.referredByName || '', phone: r.referredByPhone || '' }
        : null,
    referrals: Number(r.referrals) || 0,
    qualifiedReferrals: Number(r.qualified) || 0,
    latestReferralAt: r.latestReferralAt || null,
    totalEarned: Math.round((Number(r.totalEarned) || 0) * 100) / 100,
});

/**
 * Referrers of one type, newest referral first.
 * Query: type=user|delivery, from, to (referral date), search, zoneId|cityId,
 * page, limit. limit up to 5000 for exports.
 */
export async function listReferrers(query = {}) {
    const key = roleOf(query.type ?? query.role);
    const cfg = ROLES[key];
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 5000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const { from, to } = readRange(query);

    const zone = await zoneFilterSql(key, query);
    if (zone.none) return { type: key, referrers: [], total: 0, page, limit };

    const where = [zone.sql, searchSql(query.search)].filter(Boolean);
    const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const zoneCol = key === 'delivery' ? Prisma.sql`p."zoneId"` : Prisma.sql`NULL::text`;

    const rows = await prisma.$queryRaw`
        WITH edges AS (${edgesSql(cfg)}),
        filtered AS (SELECT * FROM edges e ${dateWhere(from, to)})
        SELECT p."id", p."name", p."phone", p."referralCode", ${zoneCol} AS "zoneId",
               p."referredById", rb."name" AS "referredByName", rb."phone" AS "referredByPhone",
               COUNT(*)::int AS "referrals",
               MAX(e."createdAt") AS "latestReferralAt",
               COUNT(*) FILTER (WHERE e."status" = 'credited')::int AS "qualified",
               COALESCE(SUM(e."reward") FILTER (WHERE e."status" = 'credited'), 0)::float8 AS "totalEarned",
               COUNT(*) OVER()::int AS "total"
        FROM filtered e
        JOIN ${cfg.table} p ON p."id" = e."referrerId"
        LEFT JOIN ${cfg.table} rb ON rb."id" = p."referredById"
        ${whereSql}
        GROUP BY p."id", rb."id"
        ORDER BY MAX(e."createdAt") DESC, p."id"
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;

    return {
        type: key,
        referrers: rows.map(mapReferrer),
        total: Number(rows[0]?.total) || 0,
        page,
        limit,
    };
}

/** Everyone one referrer referred, with each referral's status and reward. */
export async function listReferees(referrerId, query = {}) {
    if (!isId(referrerId)) throw new ValidationError('Invalid referrer');
    const key = roleOf(query.type ?? query.role);
    const cfg = ROLES[key];
    const { from, to } = readRange(query);
    const extra = key === 'delivery'
        ? Prisma.sql`, p."status"::text AS "accountStatus", p."totalDeliveries"`
        : Prisma.sql`, NULL::text AS "accountStatus", NULL::int AS "totalDeliveries"`;

    const rows = await prisma.$queryRaw`
        WITH edges AS (${edgesSql(cfg)})
        SELECT e."refereeId", e."createdAt", e."status", e."reward"::float8 AS "reward", e."reason",
               p."name", p."phone", p."createdAt" AS "joinedAt" ${extra}
        FROM edges e
        LEFT JOIN ${cfg.table} p ON p."id" = e."refereeId"
        WHERE e."referrerId" = ${String(referrerId)}
          ${from ? Prisma.sql`AND e."createdAt" >= ${from}` : Prisma.empty}
          ${to ? Prisma.sql`AND e."createdAt" <= ${to}` : Prisma.empty}
        ORDER BY e."createdAt" DESC
        LIMIT 1000
    `;

    return {
        type: key,
        referrerId: String(referrerId),
        referees: rows.map((r) => ({
            id: r.refereeId,
            name: r.name || '',
            phone: r.phone || '',
            joinedAt: r.joinedAt || null,
            referredAt: r.createdAt,
            status: r.status,
            reason: r.reason || '',
            rewardAmount: Number(r.reward) || 0,
            earnedAmount: r.status === 'credited' ? Number(r.reward) || 0 : 0,
            accountStatus: r.accountStatus || null,
            deliveriesCompleted: r.totalDeliveries === null ? null : Number(r.totalDeliveries) || 0,
        })),
    };
}

const csvCell = (v) => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    // Leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The same report as CSV (all matching rows, up to 5000). */
export async function exportReferrersCsv(query = {}) {
    const { referrers, type } = await listReferrers({ ...query, page: 1, limit: 5000 });
    const header = ['Name', 'Phone', 'Referral code', 'Referred by', 'Referred by phone', 'Referrals',
        'Qualified referrals', 'Latest referral', 'Total earned'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of referrers) {
        lines.push([
            r.name, r.phone, r.referralCode, r.referredBy?.name || '', r.referredBy?.phone || '',
            r.referrals, r.qualifiedReferrals, r.latestReferralAt, r.totalEarned,
        ].map(csvCell).join(','));
    }
    return { csv: `${lines.join('\n')}\n`, type };
}
