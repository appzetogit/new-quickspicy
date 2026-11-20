import { useEffect, useState } from "react"
import { XCircle, Loader2, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import usePagedRows from "@food/components/admin/usePagedRows"
import {
  DEFAULT_REPORT_FILTERS, ReportFilterBar, ReportExportMenu, SummaryCard, TH, TD,
  rangeFor, rupees, formatDateTime, useReportFilterOptions,
} from "@food/components/admin/reports/ReportFilterBar"

/**
 * Cancellation & refund report: who cancelled, what it cost, what was
 * refunded and why. The period is when the order was placed (India time).
 */

const EMPTY = { summary: {}, byActor: [], topReasons: [], orders: [], pagination: {}, notes: [] }

const ACTOR_COLORS = {
  customer: "bg-blue-100 text-blue-700",
  restaurant: "bg-orange-100 text-orange-700",
  admin: "bg-purple-100 text-purple-700",
  delivery: "bg-cyan-100 text-cyan-700",
  system: "bg-slate-100 text-slate-700",
}

const REFUND_BADGES = {
  processed: ["Refunded", "bg-green-100 text-green-700"],
  pending: ["Pending", "bg-yellow-100 text-yellow-700"],
  failed: ["Failed", "bg-red-100 text-red-700"],
  none: ["No refund", "bg-slate-100 text-slate-600"],
  not_applicable: ["Not paid", "bg-slate-100 text-slate-600"],
}

const ORDER_HEADERS = [
  { key: "orderId", label: "Order ID" },
  { key: "placedAt", label: "Placed" },
  { key: "cancelledAt", label: "Cancelled" },
  { key: "restaurantName", label: "Restaurant" },
  { key: "zoneName", label: "Zone" },
  { key: "actorLabel", label: "Cancelled by" },
  { key: "reason", label: "Reason" },
  { key: "orderTotal", label: "Order value" },
  { key: "paymentMethod", label: "Payment" },
  { key: "refundStatus", label: "Refund status" },
  { key: "refunded", label: "Refunded" },
]

export default function CancellationReport() {
  const { zones, restaurants } = useReportFilterOptions()
  const [filters, setFilters] = useState(DEFAULT_REPORT_FILTERS)
  const [actor, setActor] = useState("")
  const [search, setSearch] = useState("")
  const [tick, setTick] = useState(0)
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let stale = false
    setRefreshing(true)
    adminAPI.getCancellationReport({
      ...rangeFor(filters),
      zoneId: filters.zone || undefined,
      restaurantId: filters.restaurant || undefined,
      actor: actor || undefined,
    })
      .then((res) => { if (!stale) setData(res?.data?.data || EMPTY) })
      .catch(() => { if (!stale) { toast.error("Failed to load the cancellation report"); setData(EMPTY) } })
      .finally(() => { if (!stale) { setRefreshing(false); setLoading(false) } })
    return () => { stale = true }
  }, [filters, actor, tick])

  const q = search.trim().toLowerCase()
  const rows = q
    ? data.orders.filter((o) => [o.orderId, o.restaurantName, o.customerName, o.reason].some((v) => String(v || "").toLowerCase().includes(q)))
    : data.orders
  const { pageRows, offset, pager } = usePagedRows(rows)
  const s = data.summary || {}

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading cancellation report...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <XCircle className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Cancellation & Refund Report</h1>
            {refreshing ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" /> : null}
          </div>
          {(data.notes || []).map((note) => (
            <p key={note} className="text-[11px] text-slate-500 mt-1">{note}</p>
          ))}
        </div>

        <ReportFilterBar
          filters={filters}
          setFilters={setFilters}
          zones={zones}
          restaurants={restaurants}
          showRestaurant
          onApply={() => setTick((t) => t + 1)}
          onReset={() => { setFilters(DEFAULT_REPORT_FILTERS); setActor("") }}
        >
          <div className="relative flex-1 min-w-0">
            <select
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
              aria-label="Cancelled by"
            >
              <option value="">Cancelled by: anyone</option>
              {data.byActor.map((a) => <option key={a.actor} value={a.actor}>{a.label}</option>)}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>
        </ReportFilterBar>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <SummaryCard
            label="Cancelled orders"
            value={(s.cancelledOrders || 0).toLocaleString("en-IN")}
            sub={`${s.cancellationRate || 0}% of ${(s.placedOrders || 0).toLocaleString("en-IN")} placed`}
            tone="red"
          />
          <SummaryCard label="Order value lost" value={rupees(s.valueLost)} tone="red" />
          <SummaryCard label="Refunded" value={rupees(s.refunded)} sub={`${rupees(s.refundProcessed)} done, ${rupees(s.refundPending)} pending`} tone="green" />
          <SummaryCard label="Refunds failed" value={rupees(s.refundFailed)} tone="amber" />
          <SummaryCard label="Charged to restaurants" value={rupees(s.chargedToRestaurant)} sub="Refunds taken from payouts" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <h2 className="text-base font-bold text-slate-900 mb-2">By who cancelled</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={TH}>Cancelled by</th>
                    <th className={TH}>Orders</th>
                    <th className={TH}>Share</th>
                    <th className={TH}>Value lost</th>
                    <th className={TH}>Refunded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.byActor.map((a) => (
                    <tr
                      key={a.actor}
                      onClick={() => setActor(actor === a.actor ? "" : a.actor)}
                      className={`cursor-pointer hover:bg-slate-50 ${actor === a.actor ? "bg-blue-50" : ""}`}
                      title={actor === a.actor ? "Tap to show all" : "Tap to list these orders"}
                    >
                      <td className={TD}>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACTOR_COLORS[a.actor] || ""}`}>{a.label}</span>
                      </td>
                      <td className={`${TD} font-semibold`}>{a.count}</td>
                      <td className={TD}>{a.share}%</td>
                      <td className={TD}>{rupees(a.valueLost)}</td>
                      <td className={TD}>{rupees(a.refunded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <h2 className="text-base font-bold text-slate-900 mb-2">Top cancellation reasons</h2>
            {data.topReasons.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">No cancellations in this period</p>
            ) : (
              <ul className="space-y-2">
                {data.topReasons.map((r) => {
                  const pct = s.cancelledOrders ? Math.round((r.count / s.cancelledOrders) * 100) : 0
                  return (
                    <li key={r.reason}>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-800 truncate" title={r.reason}>{r.reason}</span>
                        <span className="text-slate-500 whitespace-nowrap">{r.count} orders · {rupees(r.valueLost)}</span>
                      </div>
                      <div className="h-1.5 rounded bg-slate-100 mt-1">
                        <div className="h-1.5 rounded bg-red-400" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Cancelled orders {data.pagination?.total ?? rows.length}</h2>
              {(data.pagination?.total || 0) > data.orders.length ? (
                <p className="text-[11px] text-slate-500">Showing the newest {data.orders.length}. Narrow the filters to see older ones.</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search order, restaurant, reason"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-2 py-1.5 min-w-[200px] text-[11px] rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <ReportExportMenu
                rows={rows.map((o) => ({ ...o, placedAt: formatDateTime(o.placedAt), cancelledAt: formatDateTime(o.cancelledAt) }))}
                headers={ORDER_HEADERS}
                filename="cancellation_report"
                title="Cancelled orders"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className={TH}>SI</th>
                  <th className={TH}>Order ID</th>
                  <th className={TH}>Cancelled</th>
                  <th className={TH}>Restaurant</th>
                  <th className={TH}>Cancelled by</th>
                  <th className={TH}>Reason</th>
                  <th className={TH}>Order value</th>
                  <th className={TH}>Payment</th>
                  <th className={TH}>Refund</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-16 text-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">No cancelled orders match these filters</p>
                    </td>
                  </tr>
                ) : pageRows.map((o, index) => {
                  const [refundLabel, refundClass] = REFUND_BADGES[o.refundStatus] || [o.refundStatus, "bg-slate-100 text-slate-600"]
                  return (
                    <tr key={o.id} className="hover:bg-slate-50 align-top">
                      <td className={TD}>{offset + index + 1}</td>
                      <td className={`${TD} whitespace-nowrap font-medium`}>{o.orderId}</td>
                      <td className={`${TD} whitespace-nowrap`}>{formatDateTime(o.cancelledAt)}</td>
                      <td className={TD}>
                        <div>{o.restaurantName}</div>
                        {o.zoneName ? <div className="text-[10px] text-slate-400">{o.zoneName}</div> : null}
                      </td>
                      <td className={TD}>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACTOR_COLORS[o.actor] || ""}`}>{o.actorLabel}</span>
                        {o.automatic ? <div className="text-[10px] text-slate-400 mt-0.5">Automatic</div> : null}
                      </td>
                      <td className={`${TD} max-w-[260px]`}><span className="line-clamp-2" title={o.reason}>{o.reason}</span></td>
                      <td className={TD}>{rupees(o.orderTotal)}</td>
                      <td className={`${TD} uppercase text-[10px]`}>{o.paymentMethod}</td>
                      <td className={TD}>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${refundClass}`}>{refundLabel}</span>
                        {o.refunded > 0 ? <div className="text-[10px] text-slate-500 mt-0.5">{rupees(o.refunded)}</div> : null}
                        {o.refundFailed > 0 ? <div className="text-[10px] text-red-500">{rupees(o.refundFailed)} failed</div> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {pager}
          </div>
        </div>
      </div>
    </div>
  )
}
