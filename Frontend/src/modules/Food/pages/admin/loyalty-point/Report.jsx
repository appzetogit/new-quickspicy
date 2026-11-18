import { useEffect, useState } from "react"
import { Download, Gift, Loader2 } from "lucide-react"
import { adminAPI } from "@food/api"
import { toDayInput } from "@food/utils/dayInput"

/**
 * What customers have been given, per customer: cashback on orders, referral
 * rewards, wallet top-up bonuses and money added by an admin. (Quick Spicy
 * rewards customers in wallet money, not points.)
 */
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function LoyaltyPointReport() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], totals: {}, pagination: { pages: 1 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => { setPage(1) }, [from, to, search])
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      setError("")
      adminAPI
        .getCustomerRewardsReport({ from: from || undefined, to: to || undefined, search: search.trim() || undefined, page, limit: 50 })
        .then((res) => { if (!cancelled) setData(res?.data?.data || { rows: [], totals: {}, pagination: { pages: 1 } }) })
        .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Could not load the report") })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [from, to, search, page])

  const t = data.totals || {}
  const exportCsv = () => {
    const lines = [["Customer", "Phone", "Cashback", "Referral", "Top-up bonus", "Admin credit", "Total"],
      ...data.rows.map((r) => [r.name, r.phone, r.cashback, r.referral, r.topupBonus, r.adminCredit, r.total])]
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }))
    a.download = `customer-rewards-${from || "all"}-to-${to || toDayInput(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const card = (label, value) => (
    <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-bold text-slate-900">{value}</p></div>
  )

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Gift className="w-6 h-6 text-orange-600" /> Customer Rewards Report</h1>
            <p className="text-sm text-slate-500 mt-1">Cashback, referral rewards, top-up bonuses and admin credits, paid into customers' wallets.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs text-slate-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <input placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="button" onClick={exportCsv} disabled={!data.rows.length} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Download className="w-4 h-4" /> CSV</button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {card("Customers rewarded", t.customers || 0)}
          {card("Cashback", rupees(t.cashback))}
          {card("Referral", rupees(t.referral))}
          {card("Top-up bonus", rupees(t.topupBonus))}
          {card("Admin credit", rupees(t.adminCredit))}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>
          ) : error ? (
            <p className="p-6 text-sm text-red-600">{error}</p>
          ) : !data.rows.length ? (
            <p className="p-10 text-center text-sm text-slate-500">No rewards paid{from || to || search ? " for this filter" : " yet"}.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Customer</th><th className="px-4 py-3 text-right">Cashback</th><th className="px-4 py-3 text-right">Referral</th><th className="px-4 py-3 text-right">Top-up bonus</th><th className="px-4 py-3 text-right">Admin credit</th><th className="px-4 py-3 text-right">Total</th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.userId} className="border-t border-slate-100">
                  <td className="px-4 py-3"><p className="font-medium text-slate-900">{r.name || "Customer"}</p><p className="text-xs text-slate-500">{r.phone}</p></td>
                  <td className="px-4 py-3 text-right">{rupees(r.cashback)}</td><td className="px-4 py-3 text-right">{rupees(r.referral)}</td><td className="px-4 py-3 text-right">{rupees(r.topupBonus)}</td><td className="px-4 py-3 text-right">{rupees(r.adminCredit)}</td><td className="px-4 py-3 text-right font-semibold">{rupees(r.total)}</td>
                </tr>))}
              </tbody>
            </table>
          )}
        </div>
        {data.pagination?.pages > 1 && (
          <div className="flex justify-end gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">Previous</button>
            <span className="px-2 py-1.5 text-sm text-slate-600">Page {page} of {data.pagination.pages}</span>
            <button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
