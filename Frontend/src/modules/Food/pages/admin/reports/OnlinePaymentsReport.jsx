import usePagedRows from "@food/components/admin/usePagedRows"
import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { CreditCard, ChevronDown, FileText, FileSpreadsheet, Loader2, Calendar } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { exportReportsToCSV, exportReportsToExcel } from "@food/components/admin/reports/reportsExportUtils"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import exportIcon from "@food/assets/Dashboard-icons/image9.png"

const money = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : ""

const EMPTY_SUMMARY = {
  total: 0, count: 0,
  orders: { count: 0, amount: 0 },
  topups: { included: false, count: 0, amount: 0 },
  refundedOnOrders: { count: 0, amount: 0 },
}

const STATUS_CLASSES = {
  Paid: "bg-green-100 text-green-700",
  Credited: "bg-green-100 text-green-700",
  Authorized: "bg-yellow-100 text-yellow-700",
  "Partly refunded": "bg-yellow-100 text-yellow-700",
  Refunded: "bg-red-100 text-red-700",
}

/**
 * Money received through Razorpay: orders paid online (checkout or the
 * rider's QR) and wallet top-ups. Opened from the dashboard tile with its
 * range and zone in the URL (?from=&to=&zoneId=).
 */
export default function OnlinePaymentsReport() {
  const [searchParams] = useSearchParams()
  const initial = () => ({
    fromDate: searchParams.get("from") || "",
    toDate: searchParams.get("to") || "",
    zone: searchParams.get("zoneId") || "all",
    kind: "all",
  })
  const [filters, setFilters] = useState(initial)
  const [zones, setZones] = useState([])
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [payments, setPayments] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    adminAPI.getZones({ limit: 1000 })
      .then((res) => setZones(res?.data?.data?.zones || []))
      .catch(() => setZones([]))
  }, [])

  useEffect(() => {
    let stale = false
    const load = async () => {
      try {
        setRefreshing(true)
        const res = await adminAPI.getOnlinePaymentsReport({
          fromDate: filters.fromDate || undefined,
          toDate: filters.toDate || undefined,
          zoneId: filters.zone !== "all" ? filters.zone : undefined,
          kind: filters.kind,
          limit: 1000,
        })
        if (stale) return
        const data = res?.data?.data
        setSummary({ ...EMPTY_SUMMARY, ...(data?.summary || {}) })
        setPayments(data?.payments || [])
        setTotalCount(data?.pagination?.total ?? (data?.payments || []).length)
      } catch (error) {
        if (stale) return
        toast.error(error?.response?.data?.message || "Failed to fetch online payments")
        setPayments([])
        setSummary(EMPTY_SUMMARY)
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

  const { pageRows, offset, pager } = usePagedRows(payments)

  const handleReset = () => setFilters({ fromDate: "", toDate: "", zone: "all", kind: "all" })

  const handleExport = (format) => {
    if (!payments.length) {
      toast.error("No data to export")
      return
    }
    const data = payments.map((p, i) => ({
      sl: String(i + 1),
      date: formatDateTime(p.date),
      orderId: p.orderId,
      customer: p.customerName,
      phone: p.customerPhone,
      amount: Number(p.amount).toFixed(2),
      method: p.method,
      paymentId: p.paymentId,
      status: p.status,
    }))
    const headers = [
      { key: "sl", label: "SI" },
      { key: "date", label: "Date" },
      { key: "orderId", label: "Order ID" },
      { key: "customer", label: "Customer" },
      { key: "phone", label: "Phone" },
      { key: "amount", label: "Amount" },
      { key: "method", label: "Method" },
      { key: "paymentId", label: "Payment ID" },
      { key: "status", label: "Status" },
    ]
    const name = "online_payments"
    if (format === "csv") exportReportsToCSV(data, headers, name)
    else exportReportsToExcel(data, headers, name)
  }

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading online payments...</p>
        </div>
      </div>
    )
  }

  const cards = [
    { label: "Online payments received", value: money(summary.total), sub: `${summary.count} payments`, tone: "text-green-600" },
    { label: "Orders paid online", value: money(summary.orders.amount), sub: `${summary.orders.count} orders`, tone: "text-slate-900" },
    {
      label: "Wallet top-ups",
      value: summary.topups.included ? money(summary.topups.amount) : "—",
      sub: summary.topups.included ? `${summary.topups.count} top-ups` : "Not zone-specific: shown for all zones only",
      tone: "text-slate-900",
    },
    { label: "Refunded on these orders", value: money(summary.refundedOnOrders.amount), sub: `${summary.refundedOnOrders.count} orders`, tone: "text-red-600" },
  ]

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <CreditCard className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Online Payments Received</h1>
              <p className="text-[11px] text-slate-500">Razorpay checkout and QR payments on orders, and wallet top-ups.</p>
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
              <select
                value={filters.kind}
                onChange={(e) => setFilters((prev) => ({ ...prev, kind: e.target.value }))}
                className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
                aria-label="Type"
              >
                <option value="all">Orders and top-ups</option>
                <option value="orders">Orders only</option>
                <option value="topups">Wallet top-ups only</option>
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
          <p className="text-[11px] text-slate-500 mt-2">No dates: all time. Dates are India days.</p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          {cards.map((card) => (
            <div key={card.label} className="rounded-lg shadow-sm border border-slate-200 p-3" style={{ backgroundColor: "#f1f5f9" }}>
              <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{card.label}</p>
              <p className={`text-base font-bold mt-1 ${card.tone}`}>{card.value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* List */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                Payments {totalCount}
                {refreshing && <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />}
              </h2>
              {totalCount > payments.length ? (
                <p className="text-[11px] text-slate-500">Showing the newest {payments.length}. Narrow the dates to see older ones.</p>
              ) : null}
            </div>
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
            <table className="w-full" style={{ minWidth: "1000px" }}>
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["SI", "Date", "Order Id", "Customer", "Amount", "Method", "Payment Id", "Status"].map((h) => (
                    <th key={h} className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-20 text-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">No online payments in this range</p>
                    </td>
                  </tr>
                ) : (
                  pageRows.map((p, index) => (
                    <tr key={`${p.type}-${p.id}`} className="hover:bg-slate-50 transition-colors">
                      <td className="px-1.5 py-1 text-[10px] font-medium text-slate-700">{offset + index + 1}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-700 whitespace-nowrap">{formatDateTime(p.date)}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-700 whitespace-nowrap">{p.orderId}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-700">
                        <span className="block truncate">{p.customerName || "—"}</span>
                        {p.customerPhone ? <span className="block text-slate-400">{p.customerPhone}</span> : null}
                      </td>
                      <td className="px-1.5 py-1 text-[10px] font-semibold text-slate-900 whitespace-nowrap" title={p.walletPart ? `Order total ${money(p.orderTotal)}, wallet ${money(p.walletPart)}` : undefined}>
                        {money(p.amount)}
                      </td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-700 whitespace-nowrap">{p.method}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-700 font-mono break-all">{p.paymentId || "—"}</td>
                      <td className="px-1.5 py-1">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_CLASSES[p.status] || "bg-slate-100 text-slate-700"}`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {pager}
          </div>
        </div>
      </div>
    </div>
  )
}
