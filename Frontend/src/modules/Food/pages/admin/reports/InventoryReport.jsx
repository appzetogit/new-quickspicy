import { useEffect, useState } from "react"
import { Package, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import usePagedRows from "@food/components/admin/usePagedRows"
import {
  DEFAULT_REPORT_FILTERS, ReportFilterBar, ReportExportMenu, SummaryCard, TH, TD,
  rupees, formatDateTime, useReportFilterOptions,
} from "@food/components/admin/reports/ReportFilterBar"

/**
 * Inventory & stock: what each restaurant can sell right now, and the dishes
 * switched off. A current snapshot -- no stock history is stored.
 */

const EMPTY = { summary: {}, restaurants: [], outOfStockItems: [], pagination: {}, notes: [] }

const MODE_LABELS = {
  manual: "Until turned on",
  specific_time: "Until a set time",
  next_business_day: "Next business day",
  custom_date_time: "Until a set date",
}

const RESTAURANT_HEADERS = [
  { key: "restaurantName", label: "Restaurant" },
  { key: "zoneName", label: "Zone" },
  { key: "totalItems", label: "Total items" },
  { key: "available", label: "Available" },
  { key: "outOfStock", label: "Out of stock" },
  { key: "timedResume", label: "Timed resume" },
  { key: "manualOff", label: "Off until turned on" },
  { key: "outOfStockPct", label: "Out of stock %" },
]

const ITEM_HEADERS = [
  { key: "name", label: "Item" },
  { key: "restaurantName", label: "Restaurant" },
  { key: "categoryName", label: "Category" },
  { key: "price", label: "Price" },
  { key: "mode", label: "Off" },
  { key: "resumesAt", label: "Resumes at" },
  { key: "lastUpdatedAt", label: "Last updated (approx. since)" },
]

export default function InventoryReport() {
  const { zones, restaurants } = useReportFilterOptions()
  const [filters, setFilters] = useState(DEFAULT_REPORT_FILTERS)
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState("items")
  const [tick, setTick] = useState(0)
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Search the server a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let stale = false
    setRefreshing(true)
    adminAPI.getInventoryReport({
      zoneId: filters.zone || undefined,
      restaurantId: filters.restaurant || undefined,
      search: query || undefined,
    })
      .then((res) => { if (!stale) setData(res?.data?.data || EMPTY) })
      .catch(() => { if (!stale) { toast.error("Failed to load the inventory report"); setData(EMPTY) } })
      .finally(() => { if (!stale) { setRefreshing(false); setLoading(false) } })
    return () => { stale = true }
  }, [filters.zone, filters.restaurant, query, tick])

  const items = data.outOfStockItems
  const itemPage = usePagedRows(items)
  const restaurantPage = usePagedRows(data.restaurants)
  const s = data.summary || {}

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading inventory report...</p>
        </div>
      </div>
    )
  }

  const tabButton = (key, label) => (
    <button
      onClick={() => setTab(key)}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${tab === key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
    >
      {label}
    </button>
  )

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Package className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Inventory & Stock Report</h1>
            {refreshing ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" /> : null}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Current stock of approved dishes at approved restaurants.</p>
          {(data.notes || []).map((note) => (
            <p key={note} className="text-[11px] text-slate-500 mt-0.5">{note}</p>
          ))}
        </div>

        <ReportFilterBar
          filters={filters}
          setFilters={setFilters}
          zones={zones}
          restaurants={restaurants}
          showRestaurant
          showTime={false}
          onApply={() => setTick((t) => t + 1)}
          onReset={() => { setFilters(DEFAULT_REPORT_FILTERS); setSearch("") }}
        />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <SummaryCard label="Total items" value={(s.totalItems || 0).toLocaleString("en-IN")} sub={`${s.restaurants || 0} restaurants`} />
          <SummaryCard label="Available" value={(s.available || 0).toLocaleString("en-IN")} tone="green" />
          <SummaryCard label="Out of stock" value={(s.outOfStock || 0).toLocaleString("en-IN")} sub={`${s.outOfStockPct || 0}% of items`} tone="red" />
          <SummaryCard label="Timed resume" value={(s.timedResume || 0).toLocaleString("en-IN")} sub="Come back by themselves" tone="amber" />
          <SummaryCard label="Restaurants with stockouts" value={(s.restaurantsWithStockouts || 0).toLocaleString("en-IN")} sub={`${s.manualOff || 0} items off until turned on`} />
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              {tabButton("items", `Out-of-stock items ${data.pagination?.total ?? items.length}`)}
              {tabButton("restaurants", `By restaurant ${data.restaurants.length}`)}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search item or restaurant"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-2 py-1.5 min-w-[200px] text-[11px] rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {tab === "items" ? (
                <ReportExportMenu
                  rows={items.map((i) => ({
                    ...i,
                    mode: MODE_LABELS[i.stockOffMode] || i.stockOffMode,
                    resumesAt: i.resumesAt ? formatDateTime(i.resumesAt) : "-",
                    lastUpdatedAt: formatDateTime(i.lastUpdatedAt),
                  }))}
                  headers={ITEM_HEADERS}
                  filename="out_of_stock_items"
                  title="Out-of-stock items"
                />
              ) : (
                <ReportExportMenu rows={data.restaurants} headers={RESTAURANT_HEADERS} filename="inventory_by_restaurant" title="Inventory by restaurant" />
              )}
            </div>
          </div>

          {data.pagination?.truncated && tab === "items" ? (
            <p className="text-[11px] text-slate-500 mb-2">Showing {items.length} of {data.pagination.total}. Narrow the filters to see the rest.</p>
          ) : null}

          <div className="overflow-x-auto">
            {tab === "items" ? (
              <table className="w-full min-w-[900px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={TH}>SI</th>
                    <th className={TH}>Item</th>
                    <th className={TH}>Restaurant</th>
                    <th className={TH}>Category</th>
                    <th className={TH}>Price</th>
                    <th className={TH}>Off</th>
                    <th className={TH}>Resumes at</th>
                    <th className={TH} title="No out-of-stock timestamp is stored; this is the dish's last edit of any kind.">Last updated (approx. since)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {itemPage.pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <p className="text-lg font-semibold text-slate-700 mb-1">Everything is in stock</p>
                        <p className="text-sm text-slate-500">No dishes are switched off for these filters</p>
                      </td>
                    </tr>
                  ) : itemPage.pageRows.map((i, index) => (
                    <tr key={i.id} className="hover:bg-slate-50">
                      <td className={TD}>{itemPage.offset + index + 1}</td>
                      <td className={`${TD} font-medium text-slate-900`}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${i.foodType === "Veg" ? "bg-green-500" : "bg-red-500"}`} />
                          {i.name}
                        </span>
                      </td>
                      <td className={TD}>
                        <div>{i.restaurantName}</div>
                        {i.zoneName ? <div className="text-[10px] text-slate-400">{i.zoneName}</div> : null}
                      </td>
                      <td className={TD}>{i.categoryName || "-"}</td>
                      <td className={TD}>{rupees(i.price)}</td>
                      <td className={TD}>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${i.resumesAt ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                          {MODE_LABELS[i.stockOffMode] || i.stockOffMode}
                        </span>
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{i.resumesAt ? formatDateTime(i.resumesAt) : "-"}</td>
                      <td className={`${TD} whitespace-nowrap text-slate-500`}>{formatDateTime(i.lastUpdatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[820px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={TH}>SI</th>
                    <th className={TH}>Restaurant</th>
                    <th className={TH}>Total items</th>
                    <th className={TH}>Available</th>
                    <th className={TH}>Out of stock</th>
                    <th className={TH}>Timed resume</th>
                    <th className={TH}>Off until turned on</th>
                    <th className={TH}>Out of stock %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {restaurantPage.pageRows.length === 0 ? (
                    <tr><td colSpan={8} className="px-6 py-16 text-center text-sm text-slate-500">No restaurants with dishes for these filters</td></tr>
                  ) : restaurantPage.pageRows.map((r, index) => (
                    <tr
                      key={r.restaurantId}
                      className="hover:bg-slate-50 cursor-pointer"
                      title="Show this restaurant's out-of-stock items"
                      onClick={() => { setFilters((prev) => ({ ...prev, restaurant: r.restaurantId })); setTab("items") }}
                    >
                      <td className={TD}>{restaurantPage.offset + index + 1}</td>
                      <td className={TD}>
                        <div className="font-medium text-slate-900">{r.restaurantName}</div>
                        <div className="text-[10px] text-slate-400">{r.zoneName || "No zone"}{r.online ? "" : " · offline"}</div>
                      </td>
                      <td className={TD}>{r.totalItems}</td>
                      <td className={`${TD} text-green-700`}>{r.available}</td>
                      <td className={`${TD} font-semibold ${r.outOfStock ? "text-red-600" : ""}`}>{r.outOfStock}</td>
                      <td className={TD}>{r.timedResume}</td>
                      <td className={TD}>{r.manualOff}</td>
                      <td className={TD}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded bg-slate-100">
                            <div className="h-1.5 rounded bg-red-400" style={{ width: `${Math.min(100, r.outOfStockPct)}%` }} />
                          </div>
                          {r.outOfStockPct}%
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === "items" ? itemPage.pager : restaurantPage.pager}
          </div>
        </div>
      </div>
    </div>
  )
}
