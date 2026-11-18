import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Download, Loader2, Wallet } from "lucide-react"
import { adminAPI } from "@food/api"
import { toDayInput } from "@food/utils/dayInput"

/**
 * Money paid out to restaurants or riders: every settlement recorded from the
 * balance sheet or a weekly payout statement, with who, how much, the period it
 * covered and the payment reference.
 */
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—")

export default function DisbursementReport({ entityType = "restaurant" }) {
  const isRider = entityType === "rider"
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ settlements: [], pagination: { total: 0 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const limit = 50

  useEffect(() => { setPage(1) }, [from, to])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    adminAPI
      .getBalanceSheetHistory({ entityType, page, limit, from: from || undefined, to: to || undefined })
      .then((res) => { if (!cancelled) setData(res?.data?.data || { settlements: [], pagination: { total: 0 } }) })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Could not load disbursements") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entityType, page, from, to])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = data.settlements || []
    return q ? list.filter((r) => `${r.name} ${r.phone} ${r.payoutRef}`.toLowerCase().includes(q)) : list
  }, [data, search])
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
  const pages = Math.max(1, Math.ceil((data.pagination?.total || 0) / limit))

  const exportCsv = () => {
    const lines = [["Paid on", isRider ? "Rider" : "Restaurant", "Phone", "Period from", "Period to", "Amount", "Reference", "Orders settled", "Notes"],
      ...rows.map((r) => [toDayInput(r.processedAt || r.createdAt), r.name, r.phone, toDayInput(r.periodStart), toDayInput(r.periodEnd), r.amount, r.payoutRef, r.transactionsSettled ?? "", r.notes])]
    const body = lines.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }))
    a.download = `${isRider ? "rider" : "restaurant"}-disbursements.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Wallet className="w-6 h-6 text-orange-600" /> {isRider ? "Delivery Man" : "Restaurant"} Disbursement Report</h1>
            <p className="text-sm text-slate-500 mt-1">
              Payouts recorded from the <Link to="/admin/food/balance-sheet" className="text-orange-600 font-medium hover:underline">balance sheet</Link> and weekly payout statements.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">Paid from<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs text-slate-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <input placeholder="Search name, phone or reference" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="button" onClick={exportCsv} disabled={!rows.length} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Download className="w-4 h-4" /> CSV</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Paid out (shown)</p><p className="text-2xl font-bold text-slate-900">{rupees(total)}</p></div>
          <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Payouts</p><p className="text-2xl font-bold text-slate-900">{data.pagination?.total || 0}</p></div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>
          ) : error ? (
            <p className="p-6 text-sm text-red-600">{error}</p>
          ) : !rows.length ? (
            <p className="p-10 text-center text-sm text-slate-500">No payouts recorded{from || to ? " in this period" : " yet"}.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-4 py-3 text-left">Paid on</th><th className="px-4 py-3 text-left">{isRider ? "Rider" : "Restaurant"}</th><th className="px-4 py-3 text-left">Period</th><th className="px-4 py-3 text-left">Reference</th><th className="px-4 py-3 text-right">Orders</th><th className="px-4 py-3 text-right">Amount</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 whitespace-nowrap">{day(r.processedAt || r.createdAt)}</td>
                    <td className="px-4 py-3"><p className="font-medium text-slate-900">{r.name || r.entityId}</p><p className="text-xs text-slate-500">{r.phone}</p></td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{day(r.periodStart)} – {day(r.periodEnd)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.payoutRef || "—"}{r.notes && <p className="text-xs text-slate-400">{r.notes}</p>}</td>
                    <td className="px-4 py-3 text-right">{r.transactionsSettled ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold">{rupees(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {pages > 1 && (
          <div className="flex justify-end gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">Previous</button>
            <span className="px-2 py-1.5 text-sm text-slate-600">Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
