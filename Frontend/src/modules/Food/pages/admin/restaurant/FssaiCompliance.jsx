import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, BadgeCheck, Loader2, RefreshCw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

/**
 * FSSAI compliance: restaurants whose food licence has expired or runs out
 * within 30 days, and the switch that stops ordering from expired ones.
 *
 * Owners and admins are notified once 30 days ahead and again on expiry by the
 * hourly job; this page is the list to chase.
 */

const errText = (e, fallback) => e?.response?.data?.message || e?.message || fallback
const dateLabel = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A")

function Table({ rows, kind }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-500 px-4 py-6">{kind === "expired" ? "No expired licences." : "No licences expiring soon."}</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-left">
          <tr>
            <th className="px-4 py-2 font-medium">Restaurant</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium">FSSAI No.</th>
            <th className="px-4 py-2 font-medium">{kind === "expired" ? "Expired on" : "Expires on"}</th>
            {kind === "expiring" ? <th className="px-4 py-2 font-medium">Days left</th> : null}
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-4 py-2 font-medium text-slate-800">{r.restaurantName}</td>
              <td className="px-4 py-2 text-slate-600">
                {r.ownerName || "N/A"}
                {r.ownerPhone ? <span className="block text-xs text-slate-400">{r.ownerPhone}</span> : null}
              </td>
              <td className="px-4 py-2 text-slate-600">{r.fssaiNumber || "N/A"}</td>
              <td className={`px-4 py-2 ${kind === "expired" ? "text-red-600" : "text-amber-700"}`}>{dateLabel(r.fssaiExpiry)}</td>
              {kind === "expiring" ? <td className="px-4 py-2 text-slate-600">{r.daysLeft}</td> : null}
              <td className="px-4 py-2 text-right">
                <Link to={`/admin/food/restaurants/edit/${r.restaurantId}`} className="text-blue-600 hover:underline text-xs">
                  Edit licence
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function FssaiCompliance() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState({ expired: [], expiring: [], settings: { blockExpired: false } })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getFssaiCompliance()
      const d = res?.data?.data || {}
      setData({
        expired: Array.isArray(d.expired) ? d.expired : [],
        expiring: Array.isArray(d.expiring) ? d.expiring : [],
        settings: d.settings || { blockExpired: false },
      })
    } catch (e) {
      toast.error(errText(e, "Could not load FSSAI compliance"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleBlock = async () => {
    const next = !data.settings.blockExpired
    const msg = next
      ? `Stop ordering from restaurants whose FSSAI licence has expired? ${data.expired.length} restaurant(s) are expired now; they will be hidden from the app and checkout will be refused.`
      : "Allow ordering again from restaurants with an expired FSSAI licence?"
    if (!window.confirm(msg)) return
    try {
      setSaving(true)
      const res = await adminAPI.updateFssaiCompliance({ blockExpired: next })
      setData((prev) => ({ ...prev, settings: res?.data?.data || { blockExpired: next } }))
      toast.success(next ? "Expired-licence restaurants can no longer take orders" : "Expired-licence block turned off")
    } catch (e) {
      toast.error(errText(e, "Could not save"))
    } finally {
      setSaving(false)
    }
  }

  const blocking = Boolean(data.settings?.blockExpired)

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-slate-600" />
            <h1 className="text-2xl font-bold text-slate-900">FSSAI Compliance</h1>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
        <p className="text-sm text-slate-600">
          Owners and admins are notified 30 days before a licence expires and again when it does.
        </p>

        <div className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${blocking ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
          <div>
            <p className={`font-semibold ${blocking ? "text-red-800" : "text-slate-800"}`}>
              {blocking ? "Ordering is stopped for expired licences" : "Expired licences can still take orders"}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              When on, a restaurant is hidden from the customer app from the day after its FSSAI expiry date, its page shows it
              as offline, and checkout is refused with a message. Updating the expiry date lifts it.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleBlock}
            disabled={saving || loading}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 ${blocking ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : blocking ? "Allow ordering" : "Stop ordering when expired"}
          </button>
        </div>

        {loading ? (
          <div className="p-6 flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <h2 className="font-semibold text-slate-800">Expired ({data.expired.length})</h2>
              </div>
              <Table rows={data.expired} kind="expired" />
            </div>
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 text-amber-500" />
                <h2 className="font-semibold text-slate-800">Expiring in the next 30 days ({data.expiring.length})</h2>
              </div>
              <Table rows={data.expiring} kind="expiring" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
