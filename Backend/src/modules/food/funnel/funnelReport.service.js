import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { currentAdminScope } from '../../../core/roles/adminScope.context.js';
import { addDays, resolveDayWindow, resolveZoneFilter } from '../admin/services/reportDays.js';
import { zoneScopeSql } from '../admin/services/reportFilters.helpers.js';
import { FUNNEL_STAGES, PLATFORMS, RETENTION_DAYS } from './funnel.constants.js';

/**
 * Customer Funnel report (Report Management).
 *
 * Counted in sessions: a session reaches a stage when it sent that event at
 * least once in the range. Per stage:
 *  - sessions / users: distinct sessions, and distinct signed-in customers
 *    among them (a session's customer is whoever it was signed in as);
 *  - inOrder: sessions that also reached every earlier stage;
 *  - fromPrevious / fromFirst: sessions as a % of the stage before / of the
 *    first stage; dropOff = 100 - fromPrevious.
 * Installs are app_open events flagged isFirstOpen.
 *
 * New vs returning: a signed-in session is "new" when the customer's account
 * was created inside the range, "returning" when before; "guest" never signed
 * in.
 *
 * Zone: a session belongs to a zone when any of its events in the range
 * carries that zone (app_open usually has none). A city-limited admin sees the
 * sessions of their zones only. Days are India days.
 */

const STAGE_KEYS = FUNNEL_STAGES.map((s) => s.key);
const SEGMENTS = [
    { key: 'new', label: 'New customers (signed up in range)' },
    { key: 'returning', label: 'Returning customers' },
    { key: 'guest', label: 'Not signed in' },
];

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const int = (value) => Number(value) || 0;

/**
 * Stage rows from per-stage counts: { app_open: { sessions, users, inOrder }, ... }.
 * Exported for tests.
 */
export function buildStages(counts = {}) {
    const first = int(counts[STAGE_KEYS[0]]?.sessions);
    let previous = null;
    return FUNNEL_STAGES.map((stage, index) => {
        const c = counts[stage.key] || {};
        const sessions = int(c.sessions);
        const fromPrevious = index === 0 ? null : pct(sessions, previous);
        const row = {
            key: stage.key,
            label: stage.label,
            sessions,
            users: int(c.users),
            inOrder: int(c.inOrder ?? c.sessions),
            fromPrevious,
            fromFirst: index === 0 ? (first > 0 ? 100 : null) : pct(sessions, first),
            dropOff: fromPrevious === null ? null : Math.round((100 - fromPrevious) * 10) / 10,
            dropped: index === 0 ? 0 : Math.max(0, previous - sessions),
        };
        previous = sessions;
        return row;
    });
}

/** Every day of the window, each stage 0 where nothing came in. Exported for tests. */
export function fillDaily(rows, fromDay, toDay) {
    const byDay = new Map();
    for (const r of rows) {
        const day = byDay.get(r.day) || {};
        day[r.event] = int(r.sessions);
        byDay.set(r.day, day);
    }
    const out = [];
    for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
        const found = byDay.get(day) || {};
        out.push({ day, ...Object.fromEntries(STAGE_KEYS.map((k) => [k, found[k] || 0])) });
    }
    return out;
}

const stageFlagsSql = Prisma.raw(
    STAGE_KEYS.map((key, i) => `bool_or(e."event" = '${key}') AS s${i}`).join(',\n'),
);
const countsSql = (alias = 's') => Prisma.raw(
    STAGE_KEYS.map((_k, i) => {
        const strict = STAGE_KEYS.slice(0, i + 1).map((_x, j) => `${alias}.s${j}`).join(' AND ');
        return [
            `count(*) FILTER (WHERE ${alias}.s${i})::int AS sessions_${i}`,
            `count(DISTINCT ${alias}.uid) FILTER (WHERE ${alias}.s${i})::int AS users_${i}`,
            `count(*) FILTER (WHERE ${strict})::int AS strict_${i}`,
        ].join(', ');
    }).join(',\n'),
);

const countsFromRow = (row = {}) => Object.fromEntries(STAGE_KEYS.map((key, i) => [key, {
    sessions: row[`sessions_${i}`],
    users: row[`users_${i}`],
    inOrder: row[`strict_${i}`],
}]));

const emptyReport = (range, filters, notes) => ({
    range,
    filters,
    stages: buildStages({}),
    totals: { sessions: 0, users: 0, installs: 0, paymentFailed: 0, menuItemViews: 0 },
    segments: SEGMENTS.map((s) => ({ ...s, stages: buildStages({}) })),
    platforms: [],
    daily: range ? fillDaily([], range.from, range.to) : [],
    notes,
});

export async function getFunnelReport(query = {}) {
    // With no dates: everything still kept (the retention period).
    const window = resolveDayWindow(query, { defaultDays: RETENTION_DAYS, maxDays: 366 });
    const range = { from: window.fromDay, to: window.toDay, days: window.days };
    const zoneId = await resolveZoneFilter(query);
    const platformRaw = String(query.platform || '').trim().toLowerCase();
    const platform = PLATFORMS.includes(platformRaw) ? platformRaw : null;
    const filters = { zoneId: zoneId || null, platform };
    const notes = [
        'Counted in sessions: one app launch or browser visit. A session reaches a stage when it sent that event at least once.',
        `Events are kept ${RETENTION_DAYS} days. Payment successful is also recorded by the server when an order is paid (cash and wallet orders when placed).`,
    ];

    if (zoneId === null) return emptyReport(range, filters, notes);

    const scope = currentAdminScope();
    const zoneSessions = zoneId || scope
        ? Prisma.sql`AND e."sessionId" IN (
            SELECT z."sessionId" FROM "food_funnel_events" z
            WHERE z."createdAt" >= ${window.gte} AND z."createdAt" <= ${window.lte}
              AND z."zoneId" IS NOT NULL ${zoneScopeSql(zoneId, 'z')}
        )`
        : Prisma.empty;
    const where = Prisma.sql`
        e."createdAt" >= ${window.gte} AND e."createdAt" <= ${window.lte}
        ${platform ? Prisma.sql`AND e."platform" = ${platform}` : Prisma.empty}
        ${zoneSessions}
    `;

    const [segmentRows, dailyRows, platformRows] = await Promise.all([
        prisma.$queryRaw`
            WITH s AS (
                SELECT e."sessionId",
                       ${stageFlagsSql},
                       bool_or(e."event" = 'app_open' AND e."props"->>'isFirstOpen' = 'true') AS installed,
                       bool_or(e."event" = 'payment_failed') AS failed,
                       bool_or(e."event" = 'menu_item_view') AS item_view,
                       max(e."userId") AS uid
                FROM "food_funnel_events" e
                WHERE ${where}
                GROUP BY e."sessionId"
            )
            SELECT CASE
                       WHEN s.uid IS NULL OR u."id" IS NULL THEN 'guest'
                       WHEN u."createdAt" >= ${window.gte} THEN 'new'
                       ELSE 'returning'
                   END AS segment,
                   count(*)::int AS total_sessions,
                   count(DISTINCT s.uid)::int AS total_users,
                   count(*) FILTER (WHERE s.installed)::int AS installs,
                   count(*) FILTER (WHERE s.failed)::int AS failed,
                   count(*) FILTER (WHERE s.item_view)::int AS item_views,
                   ${countsSql('s')}
            FROM s
            LEFT JOIN "food_users" u ON u."id" = s.uid
            GROUP BY 1
        `,
        prisma.$queryRaw`
            SELECT to_char((e."createdAt" + interval '330 minutes')::date, 'YYYY-MM-DD') AS day,
                   e."event" AS event,
                   count(DISTINCT e."sessionId")::int AS sessions
            FROM "food_funnel_events" e
            WHERE ${where} AND e."event" IN (${Prisma.join(STAGE_KEYS)})
            GROUP BY 1, 2
        `,
        prisma.$queryRaw`
            WITH s AS (
                SELECT e."sessionId", max(e."platform") AS platform,
                       ${stageFlagsSql},
                       max(e."userId") AS uid
                FROM "food_funnel_events" e
                WHERE ${where}
                GROUP BY e."sessionId"
            )
            SELECT s.platform, count(*)::int AS total_sessions, ${countsSql('s')}
            FROM s
            GROUP BY s.platform
            ORDER BY total_sessions DESC
        `,
    ]);

    // The overall funnel is the segments added up: every session is in one.
    const sum = {};
    const totals = { sessions: 0, users: 0, installs: 0, paymentFailed: 0, menuItemViews: 0 };
    for (const row of segmentRows) {
        for (const [key, value] of Object.entries(row)) {
            if (key !== 'segment') sum[key] = (sum[key] || 0) + int(value);
        }
        totals.sessions += int(row.total_sessions);
        totals.users += int(row.total_users);
        totals.installs += int(row.installs);
        totals.paymentFailed += int(row.failed);
        totals.menuItemViews += int(row.item_views);
    }
    const bySegment = new Map(segmentRows.map((r) => [r.segment, r]));

    return {
        range,
        filters,
        stages: buildStages(countsFromRow(sum)),
        totals,
        segments: SEGMENTS.map((s) => {
            const row = bySegment.get(s.key);
            return {
                ...s,
                sessions: int(row?.total_sessions),
                users: int(row?.total_users),
                stages: buildStages(countsFromRow(row)),
            };
        }),
        platforms: platformRows.map((row) => ({
            platform: row.platform,
            sessions: int(row.total_sessions),
            stages: buildStages(countsFromRow(row)),
        })),
        daily: fillDaily(dailyRows, range.from, range.to),
        notes,
    };
}
