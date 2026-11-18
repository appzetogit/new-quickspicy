import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Download, Loader2, TicketPercent } from "lucide-react"
import { adminAPI } from "@food/api"
import { toDayInput } from "@food/utils/dayInput"

/**
 * Orders placed with a coupon: per coupon (orders, discount given and who paid
 * for it), and the orders themselves. Coupons are created under Coupons.
 */
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthStart = () => { const d = new Date(); d.setDate(1); return toDayInput(d) }

export default function CampaignOrderReport() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(toDayInput(new Date()))
  const [couponCode, setCouponCode] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ coupons: [], orders: [], pagination: { total: 0, pages: 1 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => { setPage(1) }, [from, to, couponCode])
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      setError("")
      adminAPI
        .getCouponOrderReport({ from: from || undefined, to: to || undefined, couponCode: couponCode.trim() || undefined, page, limit: 50 })
        .then((res) => { if (!cancelled) setData(res?.data?.data || { coupons: [], orders: [], pagination: { total: 0, pages: 1 } }) })
        .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Could not load the report") })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [from, to, couponCode, page])

  const totals = data.coupons.reduce((t, c) => ({ orders: t.orders + c.orders, discount: t.discount + c.discount }), { orders: 0, discount: 0 })

  const exportCsv = () => {
    const lines = [["Date", "Order", "Coupon", "Restaurant", "Discount", "Order total", "Status", "Payment"],
      ...data.orders.map((o) => [toDayInput(o.date), o.displayId, o.couponCode, o.restaurantName, o.discount, o.total, o.status, o.paymentMethod])]
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }))
    a.download = `coupon-orders-${from || "all"}-to-${to || "today"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><TicketPercent className="w-6 h-6 text-orange-600" /> Campaign Order Report</h1>
            <p className="text-sm text-slate-500 mt-1">Orders placed with a coupon. Coupons are managed under <Link to="/admin/food/coupons" className="text-orange-600 font-medium hover:underline">Coupons</Link>.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs text-slate-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <input placeholder="Coupon code" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase" />
            <button type="button" onClick={exportCsv} disabled={!data.orders.length} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Download className="w-4 h-4" /> CSV</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Orders with a coupon</p><p className="text-2xl font-bold text-slate-900">{totals.orders}</p></div>
          <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Discount given</p><p className="text-2xl font-bold text-slate-900">{rupees(totals.discount)}</p></div>
          <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Coupons used</p><p className="text-2xl font-bold text-slate-900">{data.coupons.length}</p></div>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>
        ) : error ? (
          <p className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-red-600">{error}</p>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <h2 className="px-4 pt-4 font-semibold text-slate-900">By coupon</h2>
              {!data.coupons.length ? <p className="p-6 text-sm text-slate-500">No coupon was used in this period.</p> : (
                <table className="w-full text-sm mt-2">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Coupon</th><th className="px-4 py-3 text-right">Orders</th><th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Paid by platform</th><th className="px-4 py-3 text-right">Paid by restaurants</th><th className="px-4 py-3 text-right">Order value</th></tr></thead>
                  <tbody>{data.coupons.map((c) => (
                    <tr key={c.couponCode} className="border-t border-slate-100 cursor-pointer hover:bg-orange-50" onClick={() => setCouponCode(c.couponCode)}>
                      <td className="px-4 py-3 font-semibold">{c.couponCode}</td><td className="px-4 py-3 text-right">{c.orders}</td><td className="px-4 py-3 text-right">{rupees(c.discount)}</td><td className="px-4 py-3 text-right">{rupees(c.adminShare)}</td><td className="px-4 py-3 text-right">{rupees(c.restaurantShare)}</td><td className="px-4 py-3 text-right">{rupees(c.orderTotal)}</td>
                    </tr>))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <h2 className="px-4 pt-4 font-semibold text-slate-900">Orders</h2>
              {!data.orders.length ? <p className="p-6 text-sm text-slate-500">No orders.</p> : (
                <table className="w-full text-sm mt-2">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Order</th><th className="px-4 py-3 text-left">Coupon</th><th className="px-4 py-3 text-left">Restaurant</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Total</th></tr></thead>
                  <tbody>{data.orders.map((o) => (
                    <tr key={o.orderId} className="border-t border-slate-100">
                      <td className="px-4 py-3 whitespace-nowrap">{new Date(o.date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td className="px-4 py-3">{o.displayId}</td><td className="px-4 py-3">{o.couponCode}</td><td className="px-4 py-3">{o.restaurantName}</td><td className="px-4 py-3 capitalize">{String(o.status || "").replace(/_/g, " ")}</td><td className="px-4 py-3 text-right">{rupees(o.discount)}</td><td className="px-4 py-3 text-right font-semibold">{rupees(o.total)}</td>
                    </tr>))}
                  </tbody>
                </table>
              )}
            </div>
            {data.pagination?.pages > 1 && (
              <div className="flex justify-end gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">Previous</button>
                <span className="px-2 py-1.5 text-sm text-slate-600">Page {page} of {data.pagination.pages}</span>
                <button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
