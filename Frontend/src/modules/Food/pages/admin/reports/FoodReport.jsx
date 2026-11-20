import { useEffect, useState } from "react"
import { TrendingUp, Loader2 } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import usePagedRows from "@food/components/admin/usePagedRows"
import {
  DEFAULT_REPORT_FILTERS, ReportFilterBar, ReportExportMenu, SummaryCard, TH, TD,
  rangeFor, rupees, useReportFilterOptions,
} from "@food/components/admin/reports/ReportFilterBar"

/**
 * Popular items & analytics: top-selling dishes, the hours orders come in
 * (India time) and the busiest zones. Delivered orders only.
 */

const EMPTY = { summary: {}, topItems: [], peakHours: [], zones: [] }

const ITEM_HEADERS = [
  { key: "rank", label: "Rank" },
  { key: "name", label: "Item" },
  { key: "restaurantName", label: "Restaurant" },
  { key: "quantity", label: "Quantity sold" },
  { key: "orders", label: "Orders" },
  { key: "revenue", label: "Revenue" },
]

export default function FoodReport() {
  const { zones, restaurants } = useReportFilterOptions()
  const [filters, setFilters] = useState(DEFAULT_REPORT_FILTERS)
  const [limit, setLimit] = useState(20)
  const [tick, setTick] = useState(0)
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let stale = false
    setRefreshing(true)
    adminAPI.getPopularItemsReport({
      ...rangeFor(filters),
      zoneId: filters.zone || undefined,
      restaurantId: filters.restaurant || undefined,
      limit,
    })
      .then((res) => { if (!stale) setData(res?.data?.data || EMPTY) })
      .catch(() => { if (!stale) { toast.error("Failed to load the popular items report"); setData(EMPTY) } })
      .finally(() => { if (!stale) { setRefreshing(false); setLoading(false) } })
    return () => { stale = true }
  }, [filters, limit, tick])

  const { pageRows, offset, pager } = usePagedRows(data.topItems)
  const s = data.summary || {}

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading popular items...</p>
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
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Popular Items & Analytics</h1>
            {refreshing ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" /> : null}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Delivered orders only, by the time they were placed (India time).</p>
        </div>

        <ReportFilterBar
          filters={filters}
          setFilters={setFilters}
          zones={zones}
          restaurants={restaurants}
          showRestaurant
          onApply={() => setTick((t) => t + 1)}
          onReset={() => setFilters(DEFAULT_REPORT_FILTERS)}
        />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <SummaryCard label="Delivered orders" value={(s.deliveredOrders || 0).toLocaleString("en-IN")} tone="blue" />
          <SummaryCard label="Revenue" value={rupees(s.revenue)} sub={`Avg order ${rupees(s.averageOrderValue)}`} tone="green" />
          <SummaryCard label="Items sold" value={(s.itemsSold || 0).toLocaleString("en-IN")} sub={`${s.restaurants || 0} restaurants`} />
          <SummaryCard label="Peak hour" value={s.peakHour ? s.peakHour.label : "-"} sub={s.peakHour ? `${s.peakHour.orders} orders` : "No orders"} tone="amber" />
          <SummaryCard label="Top zone" value={s.topZone ? s.topZone.name : "-"} sub={s.topZone ? `${s.topZone.orders} orders` : "No orders"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <h2 className="text-base font-bold text-slate-900 mb-2">Peak order hours</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.peakHours}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" stroke="#6b7280" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis stroke="#6b7280" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}
                    formatter={(value, name) => (name === "Orders" ? value : rupees(value))}
                  />
                  <Bar dataKey="orders" fill="#0ea5e9" radius={[6, 6, 0, 0]} name="Orders" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-bold text-slate-900">High-demand zones</h2>
              <ReportExportMenu
                rows={data.zones}
                headers={[
                  { key: "name", label: "Zone" },
                  { key: "orders", label: "Orders" },
                  { key: "share", label: "Share %" },
                  { key: "revenue", label: "Revenue" },
                  { key: "averageOrderValue", label: "Avg order" },
                  { key: "restaurants", label: "Restaurants" },
                ]}
                filename="zone_demand_report"
                title="High-demand zones"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={TH}>Zone</th>
                    <th className={TH}>Orders</th>
                    <th className={TH}>Share</th>
                    <th className={TH}>Revenue</th>
                    <th className={TH}>Avg order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.zones.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500">No delivered orders in this period</td></tr>
                  ) : data.zones.map((z) => (
                    <tr key={z.zoneId || "none"} className="hover:bg-slate-50">
                      <td className={`${TD} font-medium`}>{z.name}</td>
                      <td className={TD}>{z.orders}</td>
                      <td className={TD}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded bg-slate-100">
                            <div className="h-1.5 rounded bg-blue-500" style={{ width: `${Math.min(100, z.share)}%` }} />
                          </div>
                          {z.share}%
                        </div>
                      </td>
                      <td className={TD}>{rupees(z.revenue)}</td>
                      <td className={TD}>{rupees(z.averageOrderValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Top-selling items</h2>
              <p className="text-[11px] text-slate-500">Revenue is line price (with add-ons) x quantity, before order discounts.</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="px-2 py-1.5 border border-slate-300 rounded-lg bg-white text-[11px]"
                aria-label="How many items"
              >
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>Top {n}</option>)}
              </select>
              <ReportExportMenu rows={data.topItems} headers={ITEM_HEADERS} filename="popular_items_report" title="Top-selling items" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className={TH}>#</th>
                  <th className={TH}>Item</th>
                  <th className={TH}>Restaurant</th>
                  <th className={TH}>Quantity sold</th>
                  <th className={TH}>Orders</th>
                  <th className={TH}>Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">No items were sold in this period</p>
                    </td>
                  </tr>
                ) : pageRows.map((item, index) => (
                  <tr key={`${item.restaurantId}-${item.itemId}`} className="hover:bg-slate-50">
                    <td className={TD}>{offset + index + 1}</td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                        <span className={`w-2 h-2 rounded-full ${item.isVeg ? "bg-green-500" : "bg-red-500"}`} />
                        {item.name}
                      </span>
                    </td>
                    <td className={TD}>{item.restaurantName}</td>
                    <td className={`${TD} font-semibold`}>{item.quantity}</td>
                    <td className={TD}>{item.orders}</td>
                    <td className={TD}>{rupees(item.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pager}
          </div>
        </div>
      </div>
    </div>
  )
}
