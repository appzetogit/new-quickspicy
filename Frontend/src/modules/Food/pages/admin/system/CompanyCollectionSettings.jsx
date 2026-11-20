import { useEffect, useState } from "react"
import { toast } from "sonner"
import { QrCode } from "lucide-react"
import { adminAPI } from "@food/api"

/**
 * Company UPI / bank account for collecting cash-on-delivery orders without a
 * payment gateway. When Razorpay is not set up, or "Use company UPI QR" is on,
 * the rider's "Show payment QR" shows a UPI QR for this account for the exact
 * amount; the rider confirms the payment and finance reconciles it
 * (Change to Wallet & UPI page). The account number is only ever shown masked.
 */
const EMPTY = {
  useCompanyUpiQr: false,
  upiId: "",
  payeeName: "",
  bank: { accountHolderName: "", accountNumber: "", ifsc: "", bankName: "" },
}

const MODE_TEXT = {
  company_upi: "Riders show the company UPI QR",
  razorpay: "Riders show a Razorpay payment QR",
  none: "No QR collection: add a UPI ID or Razorpay keys",
}

export default function CompanyCollectionSettings() {
  const [form, setForm] = useState(EMPTY)
  const [meta, setMeta] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const apply = (d) => {
    if (!d) return
    setForm({
      useCompanyUpiQr: d.useCompanyUpiQr === true,
      upiId: d.upiId || "",
      payeeName: d.payeeName || "",
      bank: { ...EMPTY.bank, ...(d.bank || {}) },
    })
    setMeta({ activeMode: d.activeMode, razorpayConfigured: d.razorpayConfigured, updatedAt: d.updatedAt })
  }

  useEffect(() => {
    adminAPI.getCompanyCollectionSettings()
      .then((res) => apply(res?.data?.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const setBank = (key, value) => setForm((f) => ({ ...f, bank: { ...f.bank, [key]: value } }))

  const save = async () => {
    setSaving(true)
    try {
      const res = await adminAPI.saveCompanyCollectionSettings(form)
      apply(res?.data?.data)
      toast.success("Saved")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save")
    } finally {
      setSaving(false)
    }
  }

  const input = "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">Company UPI collection (cash on delivery)</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Used for the rider's payment QR when Razorpay is not set up, or always when switched on below.
            Payments are confirmed by the rider and reconciled by finance.
          </p>
        </div>
        {!loading && (
          <span className={`text-xs rounded-full px-2.5 py-1 ${meta.activeMode === "company_upi" ? "bg-green-50 text-green-700" : meta.activeMode === "none" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
            {MODE_TEXT[meta.activeMode] || ""}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Loading...</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={form.useCompanyUpiQr} onChange={(e) => set("useCompanyUpiQr", e.target.checked)} />
            Use company UPI QR {meta.razorpayConfigured ? "(instead of Razorpay)" : ""}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-slate-600">Company UPI ID
              <input className={input} value={form.upiId} onChange={(e) => set("upiId", e.target.value)} placeholder="quickspicy@okaxis" />
            </label>
            <label className="text-xs text-slate-600">Payee name (shown in the UPI app)
              <input className={input} maxLength={50} value={form.payeeName} onChange={(e) => set("payeeName", e.target.value)} placeholder="Quick Spicy Enterprises" />
            </label>
            <label className="text-xs text-slate-600">Account holder name
              <input className={input} value={form.bank.accountHolderName} onChange={(e) => setBank("accountHolderName", e.target.value)} />
            </label>
            <label className="text-xs text-slate-600">Account number
              <input className={input} inputMode="numeric" value={form.bank.accountNumber} onChange={(e) => setBank("accountNumber", e.target.value)} placeholder="Leave as is to keep the saved one" />
            </label>
            <label className="text-xs text-slate-600">IFSC
              <input className={input} value={form.bank.ifsc} onChange={(e) => setBank("ifsc", e.target.value.toUpperCase())} placeholder="HDFC0001234" />
            </label>
            <label className="text-xs text-slate-600">Bank name
              <input className={input} value={form.bank.bankName} onChange={(e) => setBank("bankName", e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={save} disabled={saving} className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
