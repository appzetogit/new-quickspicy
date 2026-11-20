import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, Download, Info, Loader2, TicketPercent } from "lucide-react"
import { adminAPI } from "@food/api"
import { toDayInput } from "@food/utils/dayInput"

/**
 * Promo & discount usage: per coupon (redemptions, customers, discount and who
 * funded it, revenue, redemption rate, ROI), then referral and cashback
 * payouts in the same range. Order-by-order detail stays on the Campaign
 * Order Report.
 */
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthStart = () => { const d = new Date(); d.setDate(1); return toDayInput(d) }
const roiText = (v) => (v == null ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}x`)
const pct = (v) => (v == null ? "—" : `${v}%`)

const selectClass = "w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
const inputClass = "w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"

const EMPTY = { totals: null, coupons: [], cashback: null, referral: null, referralNote: null, definitions: {} }

const Card = ({ label, value, sub }) => (
  <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
    <p className="text-[11px] text-slate-500">{label}</p>
    <p className="text-xl font-bold text-slate-900 mt-1">{value}</p>
    {sub ? <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p> : null}
  </div>
)

export default function PromoUsageReport() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(toDayInput(new Date()))
  const [zoneId, setZoneId] = useState("")
  const [couponCode, setCouponCode] = useState("")
  const [zones, setZones] = useState([])
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    adminAPI.getZones({ limit: 1000 })
      .then((res) => setZones(res?.data?.data?.zones || []))
      .catch(() => setZones([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      setError("")
      adminAPI
        .getPromoUsageReport({ from: from || undefined, to: to || undefined, zoneId: zoneId || undefined, couponCode: couponCode.trim() || undefined })
        .then((res) => { if (!cancelled) setData(res?.data?.data || EMPTY) })
        .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Could not load the report") })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [from, to, zoneId, couponCode])

  const t = data.totals

  const exportCsv = () => {
    const head = ["Coupon", "Status", "Redemptions", "Cancelled", "Unique customers", "Discount", "Admin funded", "Restaurant funded", "Admin %", "Restaurant %", "Delivered orders", "Revenue", "Usage limit", "Redemption rate %", "ROI"]
    const lines = [head, ...data.coupons.map((c) => [c.couponCode, c.status, c.redemptions, c.cancelledOrders, c.uniqueCustomers, c.totalDiscount, c.adminFunded, c.restaurantFunded, c.adminFundedPercent, c.restaurantFundedPercent, c.deliveredOrders, c.revenue, c.usageLimit, c.redemptionRatePercent, c.roi])]
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }))
    a.download = `promo-usage-${from || "all"}-to-${to || "today"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <TicketPercent className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Promo &amp; Discount Usage</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">Order-by-order detail is on the <Link to="/admin/food/order-report/campaign" className="text-blue-600 hover:underline">Campaign Order Report</Link>.</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <label className="text-[11px] text-slate-600">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} mt-1`} /></label>
            <label className="text-[11px] text-slate-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} mt-1`} /></label>
            <label className="text-[11px] text-slate-600">Zone
              <div className="relative mt-1">
                <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={selectClass}>
                  <option value="">All Zones</option>
                  {zones.map((z) => <option key={z._id || z.id} value={z._id || z.id}>{z.zoneName || z.name}</option>)}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
              </div>
            </label>
            <label className="text-[11px] text-slate-600">Coupon code<input placeholder="All coupons" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} className={`${inputClass} mt-1 uppercase`} /></label>
            <button type="button" onClick={exportCsv} disabled={!data.coupons.length} className="inline-flex items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export CSV</button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg border border-slate-200 p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : error ? (
          <p className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-red-600">{error}</p>
        ) : (
          <>
            {t && (
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-3">
                <Card label="Redemptions" value={t.redemptions.toLocaleString("en-IN")} sub={`${t.couponsUsed} coupons used`} />
                <Card label="Unique customers" value={t.uniqueCustomers.toLocaleString("en-IN")} />
                <Card label="Discount given" value={rupees(t.totalDiscount)} />
                <Card label="Funded by platform / restaurants" value={rupees(t.adminFunded)} sub={`Restaurants ${rupees(t.restaurantFunded)}`} />
                <Card label="Revenue from coupon orders" value={rupees(t.revenue)} sub={`${t.deliveredOrders} delivered`} />
                <Card label="ROI" value={roiText(t.roi)} sub="(revenue − discount) / discount" />
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto mb-3">
              <h2 className="px-3 pt-3 text-sm font-semibold text-slate-900">By coupon</h2>
              {!data.coupons.length ? <p className="p-6 text-sm text-slate-500">No coupon was used in this period.</p> : (
                <table className="w-full text-xs mt-2">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Coupon</th>
                      <th className="px-3 py-2 text-right">Redemptions</th>
                      <th className="px-3 py-2 text-right">Customers</th>
                      <th className="px-3 py-2 text-right">Discount</th>
                      <th className="px-3 py-2 text-right">Platform / Restaurant</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                      <th className="px-3 py-2 text-right">Redemption rate</th>
                      <th className="px-3 py-2 text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.coupons.map((c) => (
                      <tr key={c.couponCode} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setCouponCode(couponCode ? "" : c.couponCode)}>
                        <td className="px-3 py-2"><div className="font-semibold text-slate-900">{c.couponCode}</div><div className="text-slate-500 capitalize">{c.status}{c.cancelledOrders ? ` · ${c.cancelledOrders} cancelled` : ""}</div></td>
                        <td className="px-3 py-2 text-right font-semibold">{c.redemptions}</td>
                        <td className="px-3 py-2 text-right">{c.uniqueCustomers}</td>
                        <td className="px-3 py-2 text-right">{rupees(c.totalDiscount)}</td>
                        <td className="px-3 py-2 text-right">{pct(c.adminFundedPercent)} / {pct(c.restaurantFundedPercent)}<div className="text-slate-500">{rupees(c.adminFunded)} / {rupees(c.restaurantFunded)}</div></td>
                        <td className="px-3 py-2 text-right">{rupees(c.revenue)}<div className="text-slate-500">{c.deliveredOrders} delivered</div></td>
                        <td className="px-3 py-2 text-right">{c.usageLimit ? <>{pct(c.redemptionRatePercent)}<div className="text-slate-500">of limit {c.usageLimit} · {c.lifetimeUsed} used ever</div></> : <span className="text-slate-400">No limit</span>}</td>
                        <td className="px-3 py-2 text-right font-semibold">{roiText(c.roi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
              {data.cashback && (
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
                  <h2 className="text-sm font-semibold text-slate-900 mb-2">Cashback paid</h2>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-slate-500">Paid</p><p className="text-lg font-bold">{rupees(data.cashback.amount)}</p><p className="text-slate-500">{data.cashback.awards} awards · {data.cashback.customers} customers</p></div>
                    <div><p className="text-slate-500">Earned on</p><p className="text-lg font-bold">{data.cashback.earnedOnOrders} orders</p><p className="text-slate-500">{rupees(data.cashback.earnedOnOrderValue)}</p></div>
                    <div><p className="text-slate-500">Orders after the cashback</p><p className="text-lg font-bold">{data.cashback.followOnOrders.ordersPlaced}</p><p className="text-slate-500">{data.cashback.followOnOrders.ordersDelivered} delivered · {rupees(data.cashback.followOnOrders.revenue)}</p></div>
                    <div><p className="text-slate-500">ROI on follow-on orders</p><p className="text-lg font-bold">{roiText(data.cashback.roi)}</p></div>
                  </div>
                </div>
              )}
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
                <h2 className="text-sm font-semibold text-slate-900 mb-2">Referral bonuses paid</h2>
                {!data.referral ? <p className="text-xs text-slate-500">{data.referralNote}</p> : (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-slate-500">Customer referrals</p><p className="text-lg font-bold">{rupees(data.referral.customer.amount)}</p><p className="text-slate-500">{data.referral.customer.rewards} rewards · {data.referral.customer.referredCustomers} new customers</p></div>
                    <div><p className="text-slate-500">Orders by referred customers</p><p className="text-lg font-bold">{data.referral.customer.ordersByReferred.ordersPlaced}</p><p className="text-slate-500">{data.referral.customer.ordersByReferred.ordersDelivered} delivered · {rupees(data.referral.customer.ordersByReferred.revenue)} · ROI {roiText(data.referral.customer.roi)}</p></div>
                    <div><p className="text-slate-500">Rider referrals</p><p className="text-lg font-bold">{rupees(data.referral.rider.amount)}</p><p className="text-slate-500">{data.referral.rider.rewards} rewards</p></div>
                    <div><p className="text-slate-500">Deliveries by referred riders</p><p className="text-lg font-bold">{data.referral.rider.deliveriesByReferred}</p></div>
                  </div>
                )}
              </div>
            </div>

            {data.definitions && Object.keys(data.definitions).length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 text-[11px] text-slate-600 space-y-1">
                <p className="flex items-center gap-1 font-semibold text-slate-800"><Info className="w-3.5 h-3.5" /> How these are worked out</p>
                {Object.entries(data.definitions).map(([k, v]) => <p key={k}><span className="font-medium capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}:</span> {v}</p>)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
