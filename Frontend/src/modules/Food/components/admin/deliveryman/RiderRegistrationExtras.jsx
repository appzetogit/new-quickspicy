// The registration details the rider detail dialogs had no section for:
// payout UPI, admin-defined registration fields and documents, referral, zone.
// Shared by the rider list and the join-request review.

const humanize = (key) =>
  String(key)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())

const Field = ({ label, children }) => (
  <div>
    <label className="text-xs font-semibold text-slate-500 uppercase">{label}</label>
    <div className="text-sm text-slate-900 mt-1 break-words">{children}</div>
  </div>
)

export const DocThumb = ({ url, label }) => (
  <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-1">
    <img
      src={url}
      alt={label}
      className="h-24 w-36 rounded-lg border border-slate-200 object-cover"
      onError={(e) => { e.currentTarget.style.display = "none" }}
    />
  </a>
)

export default function RiderRegistrationExtras({ details }) {
  if (!details) return null
  const customFields = Object.entries(details.customFields || {}).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
  )
  const customDocs = details.documents?.custom || []
  const hasPayout = details.upiId || details.upiQrCode
  const hasOther = details.zoneName || details.referralCode || details.countryCode

  if (!customFields.length && !customDocs.length && !hasPayout && !hasOther) return null

  return (
    <div className="pb-6 border-b border-slate-200 space-y-4">
      <h3 className="text-sm font-bold text-slate-900">Other Registration Details</h3>
      <div className="grid grid-cols-2 gap-4">
        {details.countryCode && <Field label="Country Code">{details.countryCode}</Field>}
        {details.zoneName && <Field label="Zone">{details.zoneName}</Field>}
        {details.referralCode && <Field label="Referral Code">{details.referralCode}</Field>}
        {details.upiId && <Field label="UPI ID">{details.upiId}</Field>}
        {details.upiQrCode && (
          <Field label="UPI QR Code"><DocThumb url={details.upiQrCode} label="UPI QR code" /></Field>
        )}
        {customFields.map(([key, value]) => (
          <Field key={key} label={humanize(key)}>
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </Field>
        ))}
        {customDocs.map((doc) => (
          <Field key={doc.key} label={humanize(doc.key)}>
            <DocThumb url={doc.document} label={humanize(doc.key)} />
          </Field>
        ))}
      </div>
    </div>
  )
}
