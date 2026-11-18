import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Download, Loader2, Receipt } from "lucide-react"
import { adminAPI } from "@food/api"
import { toDayInput } from "@food/utils/dayInput"

/**
 * Expenses recorded by hand on the balance sheet (rent, salaries, marketing
 * ...). They are added and edited there; this page reports them over a period.
 */
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthStart = () => { const d = new Date(); d.setDate(1); return toDayInput(d) }

const csv = (rows) =>
  [["Date", "Category", "Amount", "Note"], ...rows.map((r) => [toDayInput(r.occurredAt), r.category, r.amount, r.note])]
    .map((line) => line.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n")

export default function ExpenseReport() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(toDayInput(new Date()))
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    adminAPI
      .getLedgerEntries({ type: "expense", from: from || undefined, to: to || undefined, limit: 1000 })
      .then((res) => { if (!cancelled) setRows(res?.data?.data?.entries || []) })
      .catch((e) => { if (!cancelled) { setRows([]); setError(e?.response?.data?.message || "Could not load expenses") } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter((r) => `${r.category} ${r.note}`.toLowerCase().includes(q)) : rows
  }, [rows, search])
  const total = shown.reduce((s, r) => s + Number(r.amount || 0), 0)
  const byCategory = useMemo(() => {
    const m = new Map()
    shown.forEach((r) => m.set(r.category || "Uncategorised", (m.get(r.category || "Uncategorised") || 0) + Number(r.amount || 0)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [shown])

  const exportCsv = () => {
    const blob = new Blob([csv(shown)], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `expenses-${from || "all"}-to-${to || "today"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Receipt className="w-6 h-6 text-orange-600" /> Expense Report</h1>
            <p className="text-sm text-slate-500 mt-1">
              Expenses recorded on the <Link to="/admin/food/balance-sheet" className="text-orange-600 font-medium hover:underline">balance sheet</Link>. Add or edit them there.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs text-slate-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <input placeholder="Search category or note" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="button" onClick={exportCsv} disabled={!shown.length} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Download className="w-4 h-4" /> CSV</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Total expenses</p><p className="text-2xl font-bold text-slate-900">{rupees(total)}</p></div>
          <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Entries</p><p className="text-2xl font-bold text-slate-900">{shown.length}</p></div>
          <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Biggest category</p><p className="text-lg font-bold text-slate-900">{byCategory[0] ? `${byCategory[0][0]} · ${rupees(byCategory[0][1])}` : "—"}</p></div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>
          ) : error ? (
            <p className="p-6 text-sm text-red-600">{error}</p>
          ) : !shown.length ? (
            <p className="p-10 text-center text-sm text-slate-500">No expenses in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Category</th><th className="px-4 py-3 text-left">Note</th><th className="px-4 py-3 text-right">Amount</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(r.occurredAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                    <td className="px-4 py-3">{r.category || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.note || "—"}{r.attachmentUrl && <a href={r.attachmentUrl} target="_blank" rel="noreferrer" className="ml-2 text-orange-600 hover:underline">receipt</a>}</td>
                    <td className="px-4 py-3 text-right font-semibold">{rupees(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
