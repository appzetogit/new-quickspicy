import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { parseDayBound } from '../../../../utils/timezone.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Small helpers shared by the EOD, customer wallet and online payments
 * reports: India days, money in paise, and the zone filter.
 *
 * Days are "YYYY-MM-DD" strings in IST. IST has no daylight saving, so a fixed
 * +05:30 offset is exact.
 */

const DAY_MS = 86400000;
const IST_OFFSET_MS = 330 * 60000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const num = (value) => Number(value ?? 0) || 0;
/** Rupees (Decimal, string or number) to integer paise, so sums do not drift. */
export const toPaise = (value) => Math.round(num(value) * 100);
export const fromPaise = (paise) => Math.round(paise) / 100;

/** The India calendar day an instant falls on. */
export const istDayOf = (date = new Date()) =>
    new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const dayUtc = (day) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day, n) => new Date(dayUtc(day) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (fromDay, toDay) => Math.round((dayUtc(toDay) - dayUtc(fromDay)) / DAY_MS);

const isRealDay = (raw) => {
    if (!DAY_RE.test(raw)) return false;
    const ms = dayUtc(raw);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === raw;
};

/** A day from the query: a bare YYYY-MM-DD, or a timestamp read as its IST day. */
const readDay = (value, label) => {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') return '';
    if (DAY_RE.test(raw)) {
        if (!isRealDay(raw)) throw new ValidationError(`${label} is not a real date`);
        return raw;
    }
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) throw new ValidationError(`${label} must be a date (YYYY-MM-DD)`);
    return istDayOf(at);
};

/**
 * The from/to days of a report, both inclusive, as IST days and instants.
 *
 * fromDate/toDate (or from/to). With neither given: the last `defaultDays`
 * days ending today, or null (all time) when `defaultDays` is 0. One end alone
 * runs to today, or back `defaultDays` days from the end given.
 */
export function resolveDayWindow(query = {}, { defaultDays = 0, maxDays = null } = {}) {
    let fromDay = readDay(query.fromDate ?? query.from, 'From date');
    let toDay = readDay(query.toDate ?? query.to, 'To date');
    const today = istDayOf();

    if (!fromDay && !toDay) {
        if (!defaultDays) return null;
        toDay = today;
        fromDay = addDays(today, -(defaultDays - 1));
    } else if (!toDay) {
        toDay = fromDay > today ? fromDay : today;
    } else if (!fromDay) {
        fromDay = defaultDays ? addDays(toDay, -(defaultDays - 1)) : toDay;
    }

    if (fromDay > toDay) throw new ValidationError('From date must be on or before the to date');
    const days = daysBetween(fromDay, toDay) + 1;
    if (maxDays && days > maxDays) {
        throw new ValidationError(`Pick a range of at most ${maxDays} days`);
    }
    return {
        fromDay,
        toDay,
        days,
        gte: parseDayBound(fromDay, 'start'),
        lte: parseDayBound(toDay, 'end'),
    };
}

/** A Prisma createdAt filter from a window, or {} for all time. */
export const createdAtIn = (window) => (window ? { createdAt: { gte: window.gte, lte: window.lte } } : {});

/**
 * The zone a report is filtered to: an id, or a zone's name. Returns
 * undefined for none, null for a zone that does not exist (the report is then
 * empty rather than unfiltered).
 */
export async function resolveZoneFilter(query = {}) {
    const raw = String(query.zoneId ?? query.zone ?? '').trim();
    if (!raw || raw === 'all' || raw === 'All Zones') return undefined;
    if (isId(raw)) return raw;
    const zone = await prisma.foodZone.findFirst({
        where: { OR: [{ name: raw }, { zoneName: raw }] },
        select: { id: true },
    });
    return zone?.id ?? null;
}

export const pageOf = (query = {}, { defaultLimit = 100, maxLimit = 1000 } = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    return { page, limit, skip: (page - 1) * limit };
};
