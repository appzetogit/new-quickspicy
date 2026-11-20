/**
 * The "running late" part of an order, as the apps read it (`order.delay`).
 * Pure, with no imports, so the order mapper can use it without a cycle.
 */

export const DELAY_REASONS = {
    traffic: { label: 'Heavy traffic', text: 'heavy traffic' },
    rain: { label: 'Rain', text: 'rain' },
    restaurant_delay: { label: 'Restaurant delay', text: 'a delay at the restaurant' },
    other: { label: 'Other', text: '' },
};

const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * null when the order was never reported late; otherwise
 * { reason, reasonLabel, note, extraMinutes, newEta, promisedAt, reportedAt,
 *   reportedBy, autoNotice, autoNoticeAt }.
 * `newEta` is the latest arrival time the customer has been told.
 */
export function buildDelayView(row) {
    if (!row || (!row.delayReportedAt && !row.delayAutoNoticeAt)) return null;
    const reason = row.delayReason || null;
    const etas = [row.delayedUntil, row.estimatedDeliveryAt].filter(Boolean).map((d) => new Date(d).getTime());
    return {
        reason,
        reasonLabel: reason ? (DELAY_REASONS[reason]?.label || reason) : 'Running late',
        note: row.delayNote || null,
        extraMinutes: Number(row.delayExtraMinutes) || 0,
        newEta: etas.length ? new Date(Math.max(...etas)).toISOString() : null,
        promisedAt: iso(row.promisedDeliveryAt),
        reportedAt: iso(row.delayReportedAt),
        reportedBy: row.delayReportedBy || null,
        autoNotice: Boolean(row.delayAutoNoticeAt),
        autoNoticeAt: iso(row.delayAutoNoticeAt),
    };
}
