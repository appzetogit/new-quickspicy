import { useCallback, useEffect, useState } from "react"
import { Download, Loader2, Search, Users, X, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

/**
 * Who referred whom. Two tabs (customers, delivery partners); each row is a
 * referrer with their referral count, qualified (reward paid) count, latest
 * referral date and the total they earned. Clicking a row lists the people
 * they referred. Date range filters by referral date.
 */
const TABS = [
  { key: "user", label: "Customers" },
  { key: "delivery", label: "Delivery partners" },
]
const PAGE_SIZE = 25

const fmtDate = (v) => {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
}
const rupees = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

const STATUS_STYLE = {
  credited: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
}

const REASONS = {
  limit_reached: "Referrer hit the limit",
  limit_disabled: "Limit set to 0",
  reward_disabled: "Reward set to 0",
  referrer_not_approved: "Referrer not approved",
  referrer_not_found: "Referrer not found",
}

export default function Referrals() {
  const [tab, setTab] = useState("user")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [zoneId, setZoneId] = useState("")
  const [zones, setZones] = useState([])
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState(null)
  const [referees, setReferees] = useState([])
  const [refLoading, setRefLoading] = useState(false)

  useEffect(() => {
    adminAPI.getZones({ page: 1, limit: 1000 })
      .then((res) => setZones(res?.data?.data?.zones || []))
      .catch(() => setZones([]))
  }, [])

  // Search waits for typing to pause.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const params = useCallback(() => ({
    type: tab,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(search ? { search } : {}),
    ...(zoneId ? { zoneId } : {}),
  }), [tab, from, to, search, zoneId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    adminAPI.getReferrers({ ...params(), page, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return
        const d = res?.data?.data || {}
        setRows(d.referrers || [])
        setTotal(Number(d.total) || 0)
      })
      .catch((e) => {
        if (cancelled) return
        setRows([])
        setTotal(0)
        setError(e?.response?.data?.message || "Failed to load referrals")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [params, page])

  const openReferrer = async (row) => {
    setSelected(row)
    setReferees([])
    setRefLoading(true)
    try {
      const res = await adminAPI.getReferrerReferees(row.id, {
        type: tab,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      })
      setReferees(res?.data?.data?.referees || [])
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load referred people")
    } finally {
      setRefLoading(false)
    }
  }

  const exportCsv = async () => {
    try {
      setExporting(true)
      const res = await adminAPI.exportReferrersCsv(params())
      const blob = res?.data instanceof Blob ? res.data : new Blob([res?.data ?? ""], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `referrals-${tab}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error("Export failed")
    } finally {
      setExporting(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const switchTab = (key) => { setTab(key); setPage(1); setSelected(null) }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Referrals</h1>
              <p className="text-sm text-slate-600">
                Everyone who referred someone. Qualified = the referral earned its reward.
              </p>
            </div>
          </div>
          <Button onClick={exportCsv} disabled={exporting} className="bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-2">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export CSV
          </Button>
        </div>

        <div className="flex gap-2 mt-5 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === t.key ? "border-orange-600 text-orange-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Name, phone or code"
              className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <select
            value={zoneId}
            onChange={(e) => { setZoneId(e.target.value); setPage(1) }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All zones</option>
            {zones.map((z) => {
              const id = String(z?._id || z?.id || "")
              return <option key={id} value={id}>{[z?.zoneName || z?.name, z?.city].filter(Boolean).join(" · ")}</option>
            })}
          </select>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" aria-label="From" />
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" aria-label="To" />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {tab === "user"
            ? "Zone filter: customers with a saved address or an order in the zone."
            : "Zone filter: the delivery partner's home zone."}
          {" "}Dates filter by when the referral was made.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {error && <div className="p-4 text-sm text-red-600">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold text-slate-600">
                <th className="px-4 py-3">Referrer</th>
                <th className="px-4 py-3">Referred by</th>
                <th className="px-4 py-3 text-right">Referrals</th>
                <th className="px-4 py-3 text-right">Qualified</th>
                <th className="px-4 py-3">Latest referral</th>
                <th className="px-4 py-3 text-right">Total received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600 inline" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-500">No referrals found</td></tr>
              ) : rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => openReferrer(r)}
                  className={`cursor-pointer hover:bg-orange-50 ${selected?.id === r.id ? "bg-orange-50" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{r.name || "Unnamed"}</div>
                    <div className="text-xs text-slate-500">{r.phone} · {r.referralCode}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.referredBy ? (
                      <>
                        <div className="text-slate-800">{r.referredBy.name || "Unnamed"}</div>
                        <div className="text-xs text-slate-500">{r.referredBy.phone}</div>
                      </>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{r.referrals}</td>
                  <td className="px-4 py-3 text-right">{r.qualifiedReferrals}</td>
                  <td className="px-4 py-3">{fmtDate(r.latestReferralAt)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{rupees(r.totalEarned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
          <span className="text-slate-500">{total} referrer{total === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded border border-slate-200 disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded border border-slate-200 disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Referred by {selected.name || "Unnamed"}</h2>
                <p className="text-sm text-slate-500">
                  {selected.referrals} referral{selected.referrals === 1 ? "" : "s"} · {selected.qualifiedReferrals} qualified · {rupees(selected.totalEarned)} received
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="p-1.5 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-xs font-semibold text-slate-600">
                    <th className="px-4 py-2">Person</th>
                    <th className="px-4 py-2">Referred on</th>
                    <th className="px-4 py-2">Status</th>
                    {tab === "delivery" && <th className="px-4 py-2">Account / deliveries</th>}
                    <th className="px-4 py-2 text-right">Reward</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {refLoading ? (
                    <tr><td colSpan={5} className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-orange-600 inline" /></td></tr>
                  ) : referees.length === 0 ? (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-500">Nobody in this range</td></tr>
                  ) : referees.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{p.name || "Unnamed"}</div>
                        <div className="text-xs text-slate-500">{p.phone}</div>
                      </td>
                      <td className="px-4 py-2">{fmtDate(p.referredAt)}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[p.status] || "bg-slate-100 text-slate-600"}`}>
                          {p.status}
                        </span>
                        {p.reason && <div className="text-xs text-slate-500 mt-0.5">{REASONS[p.reason] || p.reason}</div>}
                      </td>
                      {tab === "delivery" && (
                        <td className="px-4 py-2 text-xs text-slate-600">
                          {p.accountStatus || "—"} · {p.deliveriesCompleted ?? 0} deliveries
                        </td>
                      )}
                      <td className="px-4 py-2 text-right">
                        {p.status === "credited" ? rupees(p.earnedAmount) : <span className="text-slate-400">{rupees(0)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
