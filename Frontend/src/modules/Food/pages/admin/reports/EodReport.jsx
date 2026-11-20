import { useEffect, useState } from "react"
import { CalendarClock, ChevronDown, FileText, FileSpreadsheet, Loader2, Calendar } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { exportReportsToCSV, exportReportsToExcel } from "@food/components/admin/reports/reportsExportUtils"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import exportIcon from "@food/assets/Dashboard-icons/image9.png"

/** An India calendar day, n days from today, as YYYY-MM-DD. */
const istDay = (offsetDays = 0) =>
  new Date(Date.now() + 330 * 60000 + offsetDays * 86400000).toISOString().slice(0, 10)

const money = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "2026-03-05" -> "5 Mar 2026", as a calendar day. */
const formatDay = (day) => {
  if (!day) return ""
  const [y, m, d] = String(day).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

const COLUMNS = [
  { key: "deliveredOrders", label: "Delivered", count: true },
  { key: "cancelledOrders", label: "Cancelled", count: true },
  { key: "grossOrderValue", label: "Gross Order Value" },
  { key: "restaurantAmount", label: "Restaurant Amount" },
  { key: "platformCommission", label: "Commission" },
  { key: "deliveryCharges", label: "Delivery Charges" },
  { key: "platformFee", label: "Platform Fee" },
  { key: "gst", label: "GST" },
  { key: "discounts", label: "Discounts" },
  { key: "riderEarning", label: "Rider Earning" },
  { key: "adminEarning", label: "Admin Earning" },
  { key: "refunds", label: "Refunds" },
  { key: "cumulativeGrossOrderValue", label: "Cumulative Gross" },
]

const EMPTY_TOTALS = Object.fromEntries(COLUMNS.map((c) => [c.key, 0]))

export default function EodReport() {
  const [zones, setZones] = useState([])
  const [filters, setFilters] = useState({ fromDate: istDay(-6), toDate: istDay(0), zone: "all" })
  const [rows, setRows] = useState([])
  const [totals, setTotals] = useState(EMPTY_TOTALS)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    adminAPI.getZones({ limit: 1000 })
      .then((res) => setZones(res?.data?.data?.zones || []))
      .catch(() => setZones([]))
  }, [])

  useEffect(() => {
    // A half-typed range keeps what is on screen.
    if (!filters.fromDate || !filters.toDate) return
    let stale = false
    const load = async () => {
      try {
        setRefreshing(true)
        const res = await adminAPI.getEodReport({
          fromDate: filters.fromDate,
          toDate: filters.toDate,
          zoneId: filters.zone !== "all" ? filters.zone : undefined,
        })
        if (stale) return
        const data = res?.data?.data
        setRows(data?.rows || [])
        setTotals({ ...EMPTY_TOTALS, ...(data?.totals || {}) })
      } catch (error) {
        if (stale) return
        toast.error(error?.response?.data?.message || "Failed to fetch EOD report")
        setRows([])
        setTotals(EMPTY_TOTALS)
      } finally {
        if (!stale) {
          setRefreshing(false)
          setLoading(false)
        }
      }
    }
    load()
    return () => { stale = true }
  }, [filters, refreshTick])

  const handleReset = () => setFilters({ fromDate: istDay(-6), toDate: istDay(0), zone: "all" })

  const handleExport = (format) => {
    if (!rows.length) {
      toast.error("No data to export")
      return
    }
    const fmt = (row) => ({
      date: row.date ? formatDay(row.date) : "Total",
      ...Object.fromEntries(COLUMNS.map((c) => [c.key, c.count ? String(row[c.key] ?? 0) : Number(row[c.key] || 0).toFixed(2)])),
    })
    const data = [...rows.map(fmt), fmt({ ...totals, date: null, cumulativeGrossOrderValue: totals.grossOrderValue })]
    const headers = [{ key: "date", label: "Date" }, ...COLUMNS.map((c) => ({ key: c.key, label: c.label }))]
    const name = `eod_report_${filters.fromDate}_${filters.toDate}`
    if (format === "csv") exportReportsToCSV(data, headers, name)
    else exportReportsToExcel(data, headers, name)
  }

  const cards = [
    { label: "Delivered orders", value: Number(totals.deliveredOrders || 0).toLocaleString("en-IN"), sub: `${totals.cancelledOrders || 0} cancelled` },
    { label: "Gross order value", value: money(totals.grossOrderValue), sub: `Item total ${money(totals.itemTotal)}` },
    { label: "Restaurant amount", value: money(totals.restaurantAmount), sub: "What restaurants earn" },
    { label: "Platform commission", value: money(totals.platformCommission), sub: `Admin earning ${money(totals.adminEarning)}` },
    { label: "Delivery charges", value: money(totals.deliveryCharges), sub: `Rider earning ${money(totals.riderEarning)}` },
    { label: "Platform fee", value: money(totals.platformFee), sub: "Charged to customers" },
    { label: "GST", value: money(totals.gst), sub: "Tax on orders" },
    { label: "Discounts", value: money(totals.discounts), sub: `Refunds ${money(totals.refunds)}` },
  ]

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading EOD report...</p>
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
              <CalendarClock className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">EOD Cumulative Report</h1>
              <p className="text-[11px] text-slate-500">Day by day (India time), delivered orders. Amounts match the Transaction Report for the same days and zone.</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <select
                value={filters.zone}
                onChange={(e) => setFilters((prev) => ({ ...prev, zone: e.target.value }))}
                className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
              >
                <option value="all">All Zones</option>
                {zones.map((zone) => (
                  <option key={zone._id || zone.id} value={zone._id || zone.id}>{zone.zoneName || zone.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
            <div className="relative flex-1 min-w-0">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={filters.fromDate}
                max={filters.toDate || undefined}
                onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="From date"
              />
            </div>
            <div className="relative flex-1 min-w-0">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={filters.toDate}
                min={filters.fromDate || undefined}
                onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value }))}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="To date"
              />
            </div>
            <button
              onClick={() => setRefreshTick((t) => t + 1)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all whitespace-nowrap"
            >
              Filter
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all whitespace-nowrap"
            >
              Reset
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Up to 92 days at a time.</p>
        </div>

        {/* Cumulative cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          {cards.map((card) => (
            <div key={card.label} className="rounded-lg shadow-sm border border-slate-200 p-3" style={{ backgroundColor: "#f1f5f9" }}>
              <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{card.label}</p>
              <p className="text-base font-bold text-slate-900 mt-1">{card.value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Day table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              Days {rows.length}
              {refreshing && <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />}
            </h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1 transition-all">
                  <img src={exportIcon} alt="Export" className="w-3 h-3" />
                  <span>Export</span>
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                <DropdownMenuLabel>Export Format</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleExport("csv")} className="cursor-pointer">
                  <FileText className="w-4 h-4 mr-2" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("excel")} className="cursor-pointer">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Export as Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: "1200px" }}>
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider">Date</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-1.5 py-1 text-right text-[8px] font-bold text-slate-700 uppercase tracking-wider">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="px-6 py-20 text-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">Pick a date range</p>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50 transition-colors">
                      <td className="px-1.5 py-1 text-[10px] font-medium text-slate-700 whitespace-nowrap">{formatDay(row.date)}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-1.5 py-1 text-[10px] text-slate-700 text-right whitespace-nowrap">
                          {c.count ? row[c.key] : money(row[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                  <tr>
                    <td className="px-1.5 py-1.5 text-[10px] font-bold text-slate-900">Total</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-1.5 py-1.5 text-[10px] font-bold text-slate-900 text-right whitespace-nowrap">
                        {c.key === "cumulativeGrossOrderValue"
                          ? money(totals.grossOrderValue)
                          : c.count ? totals[c.key] : money(totals[c.key])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
