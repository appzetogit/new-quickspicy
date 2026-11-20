import usePagedRows from "@food/components/admin/usePagedRows"
import { useEffect, useState } from "react"
import { Wallet, ChevronDown, FileText, FileSpreadsheet, Loader2, Calendar } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { exportReportsToCSV, exportReportsToExcel } from "@food/components/admin/reports/reportsExportUtils"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import searchIcon from "@food/assets/Dashboard-icons/image8.png"
import exportIcon from "@food/assets/Dashboard-icons/image9.png"

const money = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const EMPTY_SUMMARY = {
  totalCredited: 0, spentOnOrders: 0, otherDebits: 0, totalDebited: 0, net: 0,
  customersUsingWallet: 0, customersSpentFromWallet: 0, outstandingBalance: 0, customersWithBalance: 0,
}

const SORTS = [
  { value: "spent", label: "Most spent" },
  { value: "credited", label: "Most credited" },
  { value: "balance", label: "Highest balance" },
  { value: "recent", label: "Recently used" },
]

/**
 * Customer wallet utilisation: credits by source (top-up, cashback, referral,
 * refund, admin...), spend on orders, and per customer.
 */
export default function CustomerWalletReport() {
  const [filters, setFilters] = useState({ fromDate: "", toDate: "", sort: "spent" })
  const [searchQuery, setSearchQuery] = useState("")
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [sources, setSources] = useState([])
  const [customers, setCustomers] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let stale = false
    const load = async () => {
      try {
        setRefreshing(true)
        const res = await adminAPI.getCustomerWalletReport({
          fromDate: filters.fromDate || undefined,
          toDate: filters.toDate || undefined,
          sort: filters.sort,
          search: searchQuery.trim() || undefined,
          limit: 1000,
        })
        if (stale) return
        const data = res?.data?.data
        setSummary({ ...EMPTY_SUMMARY, ...(data?.summary || {}) })
        setSources(data?.creditsBySource || [])
        setCustomers(data?.customers || [])
        setTotalCount(data?.pagination?.total ?? (data?.customers || []).length)
      } catch (error) {
        if (stale) return
        toast.error(error?.response?.data?.message || "Failed to fetch customer wallet report")
        setCustomers([])
        setSources([])
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
  }, [filters, searchQuery, refreshTick])

  const { pageRows, offset, pager } = usePagedRows(customers)

  const handleReset = () => {
    setFilters({ fromDate: "", toDate: "", sort: "spent" })
    setSearchQuery("")
  }

  const handleExport = (format) => {
    if (!customers.length) {
      toast.error("No data to export")
      return
    }
    const sourceKeys = sources.map((s) => s.key)
    const data = customers.map((c, i) => ({
      sl: String(i + 1),
      name: c.name || (c.deleted ? "Deleted customer" : ""),
      phone: c.phone,
      ...Object.fromEntries(sourceKeys.map((k) => [k, Number(c.credits?.[k] || 0).toFixed(2)])),
      credited: Number(c.credited).toFixed(2),
      spentOnOrders: Number(c.spentOnOrders).toFixed(2),
      otherDebits: Number(c.otherDebits).toFixed(2),
      currentBalance: Number(c.currentBalance).toFixed(2),
    }))
    const headers = [
      { key: "sl", label: "SI" },
      { key: "name", label: "Customer" },
      { key: "phone", label: "Phone" },
      ...sources.map((s) => ({ key: s.key, label: s.label })),
      { key: "credited", label: "Total Credited" },
      { key: "spentOnOrders", label: "Spent on Orders" },
      { key: "otherDebits", label: "Other Debits" },
      { key: "currentBalance", label: "Current Balance" },
    ]
    const name = "customer_wallet_report"
    if (format === "csv") exportReportsToCSV(data, headers, name)
    else exportReportsToExcel(data, headers, name)
  }

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading customer wallet report...</p>
        </div>
      </div>
    )
  }

  const cards = [
    { label: "Total credited", value: money(summary.totalCredited), sub: "Into customer wallets", tone: "text-green-600" },
    { label: "Spent on orders", value: money(summary.spentOnOrders), sub: summary.otherDebits ? `Other debits ${money(summary.otherDebits)}` : "Paid from wallets", tone: "text-orange-600" },
    { label: "Net", value: money(summary.net), sub: "Credited less debited", tone: "text-slate-900" },
    { label: "Customers using wallet", value: Number(summary.customersUsingWallet).toLocaleString("en-IN"), sub: `${summary.customersSpentFromWallet} spent from it`, tone: "text-slate-900" },
    { label: "Balance held now", value: money(summary.outstandingBalance), sub: `${summary.customersWithBalance} customers, all time`, tone: "text-blue-600" },
  ]

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Wallet className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Customer Wallet Report</h1>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
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
            <div className="relative flex-1 min-w-0">
              <select
                value={filters.sort}
                onChange={(e) => setFilters((prev) => ({ ...prev, sort: e.target.value }))}
                className="w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
                aria-label="Sort"
              >
                {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          {cards.map((card) => (
            <div key={card.label} className="rounded-lg shadow-sm border border-slate-200 p-3" style={{ backgroundColor: "#f1f5f9" }}>
              <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{card.label}</p>
              <p className={`text-base font-bold mt-1 ${card.tone}`}>{card.value}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Credits by source */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <h2 className="text-sm font-bold text-slate-900 mb-2">Credited by source</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {sources.map((s) => (
              <div key={s.key} className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">{s.label}</p>
                <p className="text-sm font-semibold text-slate-900">{money(s.amount)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Per customer */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <h2 className="text-base font-bold text-slate-900">Customers {totalCount}</h2>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:flex-initial min-w-[180px]">
                <input
                  type="text"
                  placeholder="Search by name or phone"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 pr-2 py-1.5 w-full text-[11px] rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <img src={searchIcon} alt="Search" className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" />
                {refreshing && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 animate-spin" />}
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
          </div>
          {totalCount > customers.length ? (
            <p className="text-[11px] text-slate-500 mb-2">Showing the first {customers.length}. Narrow the dates or search to see the rest.</p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: "900px" }}>
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["SI", "Customer", "Phone", "Credited", "Spent on Orders", "Other Debits", "Current Balance", "Last Used"].map((h) => (
                    <th key={h} className="px-1.5 py-1 text-left text-[8px] font-bold text-slate-700 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-20 text-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">No wallet activity in this range</p>
                    </td>
                  </tr>
                ) : (
                  pageRows.map((c, index) => (
                    <tr key={c.customerId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-1.5 py-1 text-[10px] font-medium text-slate-700">{offset + index + 1}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-700">{c.name || (c.deleted ? "Deleted customer" : "—")}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-700">{c.phone || "—"}</td>
                      <td
                        className="px-1.5 py-1 text-[10px] text-green-700 font-medium"
                        title={sources.filter((s) => c.credits?.[s.key]).map((s) => `${s.label}: ${money(c.credits[s.key])}`).join("\n")}
                      >
                        {money(c.credited)}
                      </td>
                      <td className="px-1.5 py-1 text-[10px] text-orange-700 font-medium">{money(c.spentOnOrders)}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-700">{money(c.otherDebits)}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-900 font-semibold">{money(c.currentBalance)}</td>
                      <td className="px-1.5 py-1 text-[10px] text-slate-500 whitespace-nowrap">
                        {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
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
