import { useEffect, useState } from "react"
import { Bike, ChevronDown, Download, Info, Loader2 } from "lucide-react"
import { adminAPI } from "@food/api"
import { toDayInput } from "@food/utils/dayInput"

/**
 * Delivery performance: per rider and overall -- deliveries, restaurant
 * accept/ready to pickup, transit, placed to delivered, late deliveries and
 * utilisation (busy time over online time). Definitions come from the server.
 */
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDayInput(d) }
const mins = (v) => (v == null ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 })} min`)
const pct = (v) => (v == null ? "—" : `${v}%`)
const hours = (m) => (m ? `${(m / 60).toLocaleString("en-IN", { maximumFractionDigits: 1 })} h` : "0 h")

const selectClass = "w-full px-2.5 py-1.5 pr-5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs appearance-none cursor-pointer"
const inputClass = "w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"

const EMPTY = { overall: null, riders: [], definitions: {}, range: null, truncated: false }

export default function DeliveryPerformanceReport() {
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(toDayInput(new Date()))
  const [zoneId, setZoneId] = useState("")
  const [riderId, setRiderId] = useState("")
  const [lateAfter, setLateAfter] = useState("")
  const [zones, setZones] = useState([])
  const [riders, setRiders] = useState([])
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    adminAPI.getZones({ limit: 1000 })
      .then((res) => setZones(res?.data?.data?.zones || []))
      .catch(() => setZones([]))
  }, [])

  useEffect(() => {
    adminAPI.getDeliveryPartners({ page: 1, limit: 1000, status: "approved", ...(zoneId ? { zoneId } : {}) })
      .then((res) => setRiders(res?.data?.data?.deliveryPartners || []))
      .catch(() => setRiders([]))
  }, [zoneId])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      setError("")
      adminAPI
        .getDeliveryPerformanceReport({
          from: from || undefined,
          to: to || undefined,
          zoneId: zoneId || undefined,
          deliveryPartnerId: riderId || undefined,
          lateAfterMinutes: Number(lateAfter) > 0 ? Number(lateAfter) : undefined,
        })
        .then((res) => { if (!cancelled) setData(res?.data?.data || EMPTY) })
        .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Could not load the report") })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [from, to, zoneId, riderId, lateAfter])

  const o = data.overall

  const exportCsv = () => {
    const head = ["Rider", "Phone", "Zone", "Deliveries", "Accept to pickup (min)", "Ready to pickup (min)", "Transit (min)", "Placed to delivered (min)", "Late", "Late %", "Online (min)", "Busy (min)", "Utilisation %", "Online days", "Deliveries / online hour"]
    const lines = [head, ...data.riders.map((r) => [r.name, r.phone, r.zoneName, r.deliveries, r.avgAcceptToPickupMinutes, r.avgReadyToPickupMinutes, r.avgTransitMinutes, r.avgTotalMinutes, r.lateDeliveries, r.latePercent, r.onlineMinutes, r.busyMinutes, r.utilisationPercent, r.onlineDays, r.deliveriesPerOnlineHour])]
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }))
    a.download = `delivery-performance-${from || "start"}-to-${to || "today"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const cards = o ? [
    { label: "Deliveries", value: o.deliveries.toLocaleString("en-IN"), sub: `${o.riders} riders delivered` },
    { label: "Accept → pickup", value: mins(o.avgAcceptToPickupMinutes), sub: `Ready → pickup ${mins(o.avgReadyToPickupMinutes)}` },
    { label: "Transit (pickup → delivered)", value: mins(o.avgTransitMinutes) },
    { label: "Placed → delivered", value: mins(o.avgTotalMinutes), sub: o.scheduledExcluded ? `${o.scheduledExcluded} scheduled left out` : "" },
    { label: "Late deliveries", value: o.lateDeliveries.toLocaleString("en-IN"), sub: o.latePercent == null ? "" : `${o.latePercent}% of timed orders` },
    { label: "Utilisation", value: pct(o.utilisationPercent), sub: `${hours(o.busyMinutes)} busy of ${hours(o.onlineMinutes)} online` },
  ] : []

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Bike className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Delivery Performance Report</h1>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <label className="text-[11px] text-slate-600">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} mt-1`} /></label>
            <label className="text-[11px] text-slate-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} mt-1`} /></label>
            <label className="text-[11px] text-slate-600">Zone
              <div className="relative mt-1">
                <select value={zoneId} onChange={(e) => { setZoneId(e.target.value); setRiderId("") }} className={selectClass}>
                  <option value="">All Zones</option>
                  {zones.map((z) => <option key={z._id || z.id} value={z._id || z.id}>{z.zoneName || z.name}</option>)}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
              </div>
            </label>
            <label className="text-[11px] text-slate-600">Rider
              <div className="relative mt-1">
                <select value={riderId} onChange={(e) => setRiderId(e.target.value)} className={selectClass}>
                  <option value="">All riders</option>
                  {riders.map((r) => <option key={r._id || r.id} value={r._id || r.id}>{r.name}{r.phone ? ` (${r.phone})` : ""}</option>)}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
              </div>
            </label>
            <label className="text-[11px] text-slate-600">Late after (min, optional)<input type="number" min="1" placeholder="Restaurant's time" value={lateAfter} onChange={(e) => setLateAfter(e.target.value)} className={`${inputClass} mt-1`} /></label>
            <button type="button" onClick={exportCsv} disabled={!data.riders.length} className="inline-flex items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export CSV</button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg border border-slate-200 p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : error ? (
          <p className="bg-white rounded-lg border border-slate-200 p-6 text-sm text-red-600">{error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-3">
              {cards.map((c) => (
                <div key={c.label} className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
                  <p className="text-[11px] text-slate-500">{c.label}</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">{c.value}</p>
                  {c.sub ? <p className="text-[11px] text-slate-500 mt-0.5">{c.sub}</p> : null}
                </div>
              ))}
            </div>

            {data.truncated && <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Only the most recent 20,000 deliveries were read. Narrow the dates for exact figures.</p>}

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto mb-3">
              {!data.riders.length ? <p className="p-6 text-sm text-slate-500">No deliveries or rider shifts in this period.</p> : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Rider</th>
                      <th className="px-3 py-2 text-left">Zone</th>
                      <th className="px-3 py-2 text-right">Deliveries</th>
                      <th className="px-3 py-2 text-right">Accept → pickup</th>
                      <th className="px-3 py-2 text-right">Ready → pickup</th>
                      <th className="px-3 py-2 text-right">Transit</th>
                      <th className="px-3 py-2 text-right">Placed → delivered</th>
                      <th className="px-3 py-2 text-right">Late</th>
                      <th className="px-3 py-2 text-right">Online</th>
                      <th className="px-3 py-2 text-right">Utilisation</th>
                      <th className="px-3 py-2 text-right">Per online hour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.riders.map((r) => (
                      <tr key={r.deliveryPartnerId} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setRiderId(riderId === r.deliveryPartnerId ? "" : r.deliveryPartnerId)}>
                        <td className="px-3 py-2"><div className="font-semibold text-slate-900">{r.name}</div><div className="text-slate-500">{r.phone}</div></td>
                        <td className="px-3 py-2">{r.zoneName || "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{r.deliveries}</td>
                        <td className="px-3 py-2 text-right">{mins(r.avgAcceptToPickupMinutes)}</td>
                        <td className="px-3 py-2 text-right">{mins(r.avgReadyToPickupMinutes)}</td>
                        <td className="px-3 py-2 text-right">{mins(r.avgTransitMinutes)}</td>
                        <td className="px-3 py-2 text-right">{mins(r.avgTotalMinutes)}</td>
                        <td className="px-3 py-2 text-right">{r.lateDeliveries}{r.latePercent != null ? <span className="text-slate-500"> ({r.latePercent}%)</span> : null}</td>
                        <td className="px-3 py-2 text-right">{hours(r.onlineMinutes)}<div className="text-slate-500">{r.onlineDays} day{r.onlineDays === 1 ? "" : "s"}</div></td>
                        <td className="px-3 py-2 text-right">{pct(r.utilisationPercent)}</td>
                        <td className="px-3 py-2 text-right">{r.deliveriesPerOnlineHour ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
