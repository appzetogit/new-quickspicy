import { useEffect, useState } from "react"
import { Filter, Loader2, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { adminAPI } from "@food/api"
import {
  DEFAULT_REPORT_FILTERS, ReportFilterBar, ReportExportMenu, SummaryCard, TH, TD,
  rangeFor, useReportFilterOptions,
} from "@food/components/admin/reports/ReportFilterBar"

/**
 * Customer acquisition funnel: app open -> restaurant browsing -> cart ->
 * checkout -> payment, counted in sessions (one app launch / browser visit),
 * with the drop-off between stages. Days are India days.
 */

const STAGE_COLORS = {
  app_open: "#2563eb",
  restaurant_view: "#7c3aed",
  add_to_cart: "#f59e0b",
  checkout_start: "#0891b2",
  payment_success: "#16a34a",
}

const PLATFORM_LABELS = { android: "Android", ios: "iOS", web: "Website", unknown: "Unknown (server only)" }

const EMPTY = { stages: [], totals: {}, segments: [], platforms: [], daily: [], notes: [] }

const STAGE_HEADERS = [
  { key: "label", label: "Stage" },
  { key: "sessions", label: "Sessions" },
  { key: "users", label: "Signed-in users" },
  { key: "inOrder", label: "Sessions through every earlier stage" },
  { key: "fromPrevious", label: "Conversion from previous (%)" },
  { key: "fromFirst", label: "Conversion from app open (%)" },
  { key: "dropOff", label: "Drop-off (%)" },
  { key: "dropped", label: "Sessions lost" },
]

const percent = (value) => (value === null || value === undefined ? "-" : `${value}%`)
const count = (value) => (Number(value) || 0).toLocaleString("en-IN")
const shortDay = (day) => {
  const d = new Date(`${day}T00:00:00`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

function StageTable({ stages, compact = false }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${compact ? "min-w-[560px]" : "min-w-[820px]"}`}>
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className={TH}>Stage</th>
            <th className={TH}>Sessions</th>
            <th className={TH}>Users</th>
            {!compact && <th className={TH}>In order</th>}
            <th className={TH}>From previous</th>
            <th className={TH}>From app open</th>
            <th className={TH}>Drop-off</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {stages.map((s) => (
            <tr key={s.key}>
              <td className={`${TD} font-medium`}>{s.label}</td>
              <td className={`${TD} font-semibold`}>{count(s.sessions)}</td>
              <td className={TD}>{count(s.users)}</td>
              {!compact && <td className={TD} title="Sessions that also reached every earlier stage">{count(s.inOrder)}</td>}
              <td className={TD}>{percent(s.fromPrevious)}</td>
              <td className={TD}>{percent(s.fromFirst)}</td>
              <td className={`${TD} ${s.dropOff > 50 ? "text-red-600 font-semibold" : ""}`}>
                {s.dropOff === null ? "-" : `${s.dropOff}% (${count(s.dropped)})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CustomerFunnelReport() {
  const { zones } = useReportFilterOptions()
  const [filters, setFilters] = useState(DEFAULT_REPORT_FILTERS)
  const [platform, setPlatform] = useState("")
  const [tick, setTick] = useState(0)
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let stale = false
    setRefreshing(true)
    adminAPI.getCustomerFunnelReport({
      ...rangeFor(filters),
      zoneId: filters.zone || undefined,
      platform: platform || undefined,
    })
      .then((res) => { if (!stale) setData({ ...EMPTY, ...(res?.data?.data || {}) }) })
      .catch((err) => {
        if (stale) return
        toast.error(err?.response?.data?.message || "Failed to load the customer funnel")
        setData(EMPTY)
      })
      .finally(() => { if (!stale) { setRefreshing(false); setLoading(false) } })
    return () => { stale = true }
  }, [filters, platform, tick])

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading customer funnel...</p>
        </div>
      </div>
    )
  }

  const t = data.totals || {}
  const stages = data.stages || []
  const first = stages[0]?.sessions || 0
  const last = stages[stages.length - 1]
  const worst = stages.slice(1).reduce((w, s) => (s.dropOff !== null && (!w || s.dropOff > w.dropOff) ? s : w), null)
  const stageLabel = Object.fromEntries(stages.map((s) => [s.key, s.label]))
  const exportStages = stages.map((s) => ({ ...s, fromPrevious: s.fromPrevious ?? "", fromFirst: s.fromFirst ?? "", dropOff: s.dropOff ?? "" }))
  const dailyHeaders = [{ key: "day", label: "Day" }, ...stages.map((s) => ({ key: s.key, label: s.label }))]

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Filter className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Customer Funnel</h1>
            {refreshing ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" /> : null}
          </div>
          {data.range ? (
            <p className="text-[11px] text-slate-500 mt-1">{data.range.from} to {data.range.to} ({data.range.days} days)</p>
          ) : null}
          {(data.notes || []).map((note) => (
            <p key={note} className="text-[11px] text-slate-500 mt-1">{note}</p>
          ))}
        </div>

        <ReportFilterBar
          filters={filters}
          setFilters={setFilters}
          zones={zones}
          onApply={() => setTick((n) => n + 1)}
          onReset={() => { setFilters(DEFAULT_REPORT_FILTERS); setPlatform("") }}
        >
          <div className="relative flex-1 min-w-0">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
              aria-label="Platform"
            >
              <option value="">All platforms</option>
              <option value="android">Android</option>
              <option value="ios">iOS</option>
              <option value="web">Website</option>
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>
        </ReportFilterBar>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-3">
          <SummaryCard label="Sessions" value={count(t.sessions)} sub={`${count(first)} opened the app`} />
          <SummaryCard label="New installs" value={count(t.installs)} sub="First open of the app" tone="blue" />
          <SummaryCard label="Signed-in customers" value={count(t.users)} />
          <SummaryCard label="Paid sessions" value={count(last?.sessions)} sub={`${count(last?.users)} customers`} tone="green" />
          <SummaryCard label="Overall conversion" value={percent(last?.fromFirst)} sub="App open to payment" tone="green" />
          <SummaryCard
            label="Biggest drop-off"
            value={worst ? `${worst.dropOff}%` : "-"}
            sub={worst ? `Before ${worst.label.toLowerCase()}` : ""}
            tone="red"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <h2 className="text-base font-bold text-slate-900 mb-2">Funnel</h2>
            {first === 0 && !stages.some((s) => s.sessions) ? (
              <p className="py-10 text-center text-sm text-slate-500">No sessions in this period</p>
            ) : (
              <ul className="space-y-2.5">
                {stages.map((s) => {
                  const top = Math.max(first, ...stages.map((x) => x.sessions), 1)
                  const width = Math.max(2, Math.round((s.sessions / top) * 100))
                  return (
                    <li key={s.key}>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-800 font-medium">{s.label}</span>
                        <span className="text-slate-500 whitespace-nowrap">
                          {count(s.sessions)} sessions
                          {s.fromPrevious !== null ? ` · ${s.fromPrevious}% of previous` : ""}
                        </span>
                      </div>
                      <div className="h-3 rounded bg-slate-100 mt-1">
                        <div className="h-3 rounded" style={{ width: `${width}%`, backgroundColor: STAGE_COLORS[s.key] || "#64748b" }} />
                      </div>
                      {s.dropOff !== null && s.dropped > 0 ? (
                        <p className="text-[10px] text-red-500 mt-0.5">{count(s.dropped)} sessions dropped off ({s.dropOff}%)</p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="text-[10px] text-slate-400 mt-3">
              Also in this period: {count(t.menuItemViews)} sessions viewed a dish, {count(t.paymentFailed)} had a failed or abandoned payment.
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className="text-base font-bold text-slate-900">Daily trend</h2>
              <ReportExportMenu rows={data.daily} headers={dailyHeaders} filename="customer_funnel_daily" title="Customer funnel by day" />
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10 }} minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={36} />
                  <Tooltip labelFormatter={shortDay} formatter={(value, key) => [count(value), stageLabel[key] || key]} />
                  <Legend formatter={(key) => stageLabel[key] || key} wrapperStyle={{ fontSize: 10 }} />
                  {stages.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} stroke={STAGE_COLORS[s.key] || "#64748b"} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-base font-bold text-slate-900">Stage by stage</h2>
            <ReportExportMenu rows={exportStages} headers={STAGE_HEADERS} filename="customer_funnel" title="Customer funnel" />
          </div>
          <StageTable stages={stages} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <h2 className="text-base font-bold text-slate-900 mb-1">New vs returning</h2>
            <p className="text-[11px] text-slate-500 mb-2">New: the customer signed up inside the period. Not signed in: guest sessions.</p>
            {(data.segments || []).map((seg) => (
              <div key={seg.key} className="mb-3 last:mb-0">
                <p className="text-xs font-semibold text-slate-800 mb-1">{seg.label} · {count(seg.sessions)} sessions</p>
                <StageTable stages={seg.stages || []} compact />
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <h2 className="text-base font-bold text-slate-900 mb-2">By platform</h2>
            {(data.platforms || []).length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">No sessions in this period</p>
            ) : (
              (data.platforms || []).map((p) => (
                <div key={p.platform} className="mb-3 last:mb-0">
                  <p className="text-xs font-semibold text-slate-800 mb-1">{PLATFORM_LABELS[p.platform] || p.platform} · {count(p.sessions)} sessions</p>
                  <StageTable stages={p.stages || []} compact />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
