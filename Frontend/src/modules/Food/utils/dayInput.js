/**
 * "YYYY-MM-DD" for a date input or a day filter, as the day in India.
 *
 * toISOString() gives the UTC day. A day stored as midnight IST is 18:30 the
 * evening before in UTC, so edit forms showed (and saved back) the previous
 * day, and a local calendar date sent as a report filter started a day early.
 */
export const toDayInput = (value) => {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  // en-CA formats as YYYY-MM-DD.
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
}
