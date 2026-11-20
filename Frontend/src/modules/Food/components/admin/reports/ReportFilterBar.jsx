import { useEffect, useState } from "react"
import { ChevronDown, Calendar, FileText, FileSpreadsheet, Code } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { exportReportsToCSV, exportReportsToExcel, exportReportsToPDF, exportReportsToJSON } from "@food/components/admin/reports/reportsExportUtils"
import { adminAPI } from "@food/api"
import exportIcon from "@food/assets/Dashboard-icons/image9.png"

/**
 * Filter bar shared by the Popular Items, Cancellation and Inventory reports,
 * styled like the Transaction Report's. Dates go to the server as bare days,
 * which it reads as whole India days.
 */

const SELECT_CLASS =
  "w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"

const pad = (n) => String(n).padStart(2, "0")
const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const DEFAULT_REPORT_FILTERS = { zone: "", restaurant: "", time: "This Month", fromDate: "", toDate: "" }

/** The from/to days a time preset stands for. */
export function rangeFor(filters) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (filters.time) {
    case "Today":
      return { from: toDay(now), to: toDay(now) }
    case "Last 7 Days":
      return { from: toDay(new Date(y, m, now.getDate() - 6)), to: toDay(now) }
    case "This Month":
      return { from: toDay(new Date(y, m, 1)), to: toDay(now) }
    case "Last Month":
      return { from: toDay(new Date(y, m - 1, 1)), to: toDay(new Date(y, m, 0)) }
    case "This Year":
      return { from: toDay(new Date(y, 0, 1)), to: toDay(now) }
    case "Custom Range":
      return { from: filters.fromDate || undefined, to: filters.toDate || undefined }
    default:
      return {}
  }
}

/** Zones and restaurants for the dropdowns. */
export function useReportFilterOptions() {
  const [zones, setZones] = useState([])
  const [restaurants, setRestaurants] = useState([])
  useEffect(() => {
    let live = true
    adminAPI.getZones({ limit: 1000 })
      .then((res) => { if (live) setZones(res?.data?.data?.zones || []) })
      .catch(() => {})
    adminAPI.getRestaurants({ limit: 1000 })
      .then((res) => { if (live) setRestaurants(res?.data?.data?.restaurants || []) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  return { zones, restaurants }
}

export function ReportFilterBar({ filters, setFilters, onApply, onReset, zones = [], restaurants = [], showTime = true, showRestaurant = false, children }) {
  const active = (filters.zone ? 1 : 0) + (filters.restaurant ? 1 : 0) + (showTime && filters.time !== DEFAULT_REPORT_FILTERS.time ? 1 : 0)
  const idOf = (row) => String(row?._id || row?.id || "")
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <select
            value={filters.zone}
            // A restaurant from another zone would leave the report empty.
            onChange={(e) => setFilters((prev) => ({ ...prev, zone: e.target.value, restaurant: "" }))}
            className={SELECT_CLASS}
            aria-label="Zone"
          >
            <option value="">All Zones</option>
            {zones.map((zone) => (
              <option key={idOf(zone)} value={idOf(zone)}>{zone.zoneName || zone.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
        </div>

        {showRestaurant ? (
          <div className="relative flex-1 min-w-0">
            <select
              value={filters.restaurant}
              onChange={(e) => setFilters((prev) => ({ ...prev, restaurant: e.target.value }))}
              className={SELECT_CLASS}
              aria-label="Restaurant"
            >
              <option value="">All restaurants</option>
              {restaurants
                .filter((r) => !filters.zone || !r.zoneId || String(r.zoneId?._id || r.zoneId) === filters.zone)
                .map((r) => (
                  <option key={idOf(r)} value={idOf(r)}>{r.restaurantName || r.name}</option>
                ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>
        ) : null}

        {showTime ? (
          <div className="relative flex-1 min-w-0">
            <select
              value={filters.time}
              onChange={(e) => setFilters((prev) => ({
                ...prev,
                time: e.target.value,
                ...(e.target.value !== "Custom Range" ? { fromDate: "", toDate: "" } : {}),
              }))}
              className={SELECT_CLASS}
              aria-label="Period"
            >
              {["Today", "Last 7 Days", "This Month", "Last Month", "This Year", "All Time", "Custom Range"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>
        ) : null}

        {children}

        <button
          onClick={onApply}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all whitespace-nowrap relative ${active > 0 ? "ring-2 ring-blue-300" : ""}`}
        >
          Filter
          {active > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-white rounded-full text-[8px] flex items-center justify-center font-bold">
              {active}
            </span>
          )}
        </button>
        <button
          onClick={onReset}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all whitespace-nowrap"
        >
          Reset
        </button>
      </div>

      {showTime && filters.time === "Custom Range" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
          {["fromDate", "toDate"].map((key) => (
            <div className="relative" key={key}>
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={filters[key]}
                onChange={(e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label={key === "fromDate" ? "From date" : "To date"}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Export dropdown. `rows` are plain objects keyed like `headers`
 * ([{ key, label }]); values are turned into text first so a 0 is not
 * exported as a blank cell.
 */
export function ReportExportMenu({ rows = [], headers = [], filename = "report", title = "Report" }) {
  const asText = () => rows.map((row) => Object.fromEntries(headers.map((h) => [h.key, row[h.key] == null ? "" : String(row[h.key])])))
  const run = (format) => {
    if (!rows.length) {
      alert("No data to export")
      return
    }
    if (format === "csv") exportReportsToCSV(asText(), headers, filename)
    if (format === "excel") exportReportsToExcel(asText(), headers, filename)
    if (format === "pdf") exportReportsToPDF(asText(), headers, filename, title)
    if (format === "json") exportReportsToJSON(rows, filename)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1 transition-all">
          <img src={exportIcon} alt="" className="w-3 h-3" />
          <span>Export</span>
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
        <DropdownMenuLabel>Export Format</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run("csv")} className="cursor-pointer"><FileText className="w-4 h-4 mr-2" />Export as CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("excel")} className="cursor-pointer"><FileSpreadsheet className="w-4 h-4 mr-2" />Export as Excel</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("pdf")} className="cursor-pointer"><FileText className="w-4 h-4 mr-2" />Export as PDF</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("json")} className="cursor-pointer"><Code className="w-4 h-4 mr-2" />Export as JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const rupees = (amount) =>
  `₹ ${(Number(amount) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const formatDateTime = (value) => {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function SummaryCard({ label, value, sub, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    green: "text-green-600",
    red: "text-red-600",
    amber: "text-amber-600",
    blue: "text-blue-600",
  }
  return (
    <div className="rounded-lg shadow-sm border border-slate-200 p-3" style={{ backgroundColor: "#f1f5f9" }}>
      <p className="text-xs text-slate-600">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${tones[tone] || tones.slate}`}>{value}</p>
      {sub ? <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p> : null}
    </div>
  )
}

export const TH = "px-2 py-1.5 text-left text-[9px] font-bold text-slate-700 uppercase tracking-wider"
export const TD = "px-2 py-1.5 text-[11px] text-slate-700"
