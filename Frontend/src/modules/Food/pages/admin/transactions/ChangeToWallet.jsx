import { useEffect, useState } from "react"
import { Check, X, Wallet, QrCode, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

/**
 * Change to wallet, and company-UPI payments to reconcile.
 *
 * Change: a cash customer overpaid and the rider had no change. The rider
 * recorded it; approving credits the customer's wallet and adds the amount to
 * the rider's cash in hand (they kept the customer's money). Usually cleared
 * by end of day, hence the daily summary.
 *
 * UPI: COD orders paid by UPI straight to the company account. Only the rider
 * said the customer paid; match each against the bank statement.
 */

const rupees = (n) => `₹${(Number(n) || 0).toFixed(2)}`
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—")
const TONES = { slate: "text-slate-700", green: "text-green-700", red: "text-red-700", amber: "text-amber-700" }
const todayIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)

const CHANGE_TABS = [
  { key: "pending", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
]
const UPI_TABS = [
  { key: "rider_confirmed", label: "To reconcile" },
  { key: "mismatch", label: "Mismatch" },
  { key: "reconciled", label: "Reconciled" },
  { key: "awaiting_payment", label: "QR shown, not paid" },
]

function Summary({ date, setDate, summary }) {
  const s = summary || {}
  const tile = (label, v, tone = "slate") => (
    <div className="rounded-lg border border-slate-200 bg-white p-3 min-w-[140px] flex-1">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${TONES[tone] || TONES.slate}`}>{rupees(v?.amount)}</p>
      <p className="text-xs text-slate-500">{v?.count || 0} request{v?.count === 1 ? "" : "s"}</p>
    </div>
  )
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">Daily summary</p>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div className="flex flex-wrap gap-2">
        {tile("Requested this day", {
          count: (s.requested?.pending?.count || 0) + (s.requested?.approved?.count || 0) + (s.requested?.rejected?.count || 0),
          amount: (s.requested?.pending?.amount || 0) + (s.requested?.approved?.amount || 0) + (s.requested?.rejected?.amount || 0),
        })}
        {tile("Approved this day", s.approvedToday, "green")}
        {tile("Rejected this day", s.rejectedToday, "red")}
        {tile("Still waiting (all days)", s.pendingTotal, "amber")}
      </div>
      {s.pendingTotal?.oldestAt ? (
        <p className="text-xs text-amber-700">Oldest waiting since {when(s.pendingTotal.oldestAt)}</p>
      ) : null}
      {s.approvedByRider?.length ? (
        <div className="text-xs text-slate-600">
          <p className="font-medium text-slate-700 mb-1">Added to riders' cash in hand this day</p>
          <div className="flex flex-wrap gap-2">
            {s.approvedByRider.map((r) => (
              <span key={r.deliveryPartnerId} className="rounded-full bg-slate-100 px-2.5 py-1">
                {r.name || r.deliveryPartnerId}: {rupees(r.amount)} ({r.count})
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ChangeRequests() {
  const [status, setStatus] = useState("pending")
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState("")
  const [date, setDate] = useState(todayIst())
  const [summary, setSummary] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([
        adminAPI.getChangeCredits({ status, limit: 200 }),
        adminAPI.getChangeCreditSummary({ date }),
      ])
      setItems(list?.data?.data?.items || [])
      setSummary(sum?.data?.data || null)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load change requests")
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status, date]) // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (r) => {
    if (!window.confirm(`Credit ${rupees(r.amount)} to ${r.customer?.name || "the customer"}'s wallet? It is also added to ${r.rider?.name || "the rider"}'s cash in hand.`)) return
    setBusyId(r.id)
    try {
      await adminAPI.approveChangeCredit(r.id)
      toast.success("Credited to the customer's wallet")
      await load()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not approve")
    } finally {
      setBusyId(null)
    }
  }

  const reject = async () => {
    if (!reason.trim()) { toast.error("Give a reason"); return }
    setBusyId(rejecting.id)
    try {
      await adminAPI.rejectChangeCredit(rejecting.id, reason.trim())
      toast.success("Rejected")
      setRejecting(null)
      setReason("")
      await load()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not reject")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <Summary date={date} setDate={setDate} summary={summary} />

      <div className="flex flex-wrap gap-2">
        {CHANGE_TABS.map((t) => (
          <button key={t.key} onClick={() => setStatus(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${status === t.key ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
            {t.label}
          </button>
        ))}
        <button onClick={load} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 inline-flex items-center gap-1">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
              <th className="p-3">Order</th>
              <th className="p-3">Rider</th>
              <th className="p-3">Customer</th>
              <th className="p-3 text-right">Cash due</th>
              <th className="p-3 text-right">Cash collected</th>
              <th className="p-3 text-right">Change owed</th>
              <th className="p-3">Recorded</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Loading...</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-slate-500">Nothing {status === "pending" ? "waiting" : status}.</td></tr>
            )}
            {!loading && items.map((r) => {
              const mismatch = Math.abs((r.overpaid || 0) - r.amount) > 0.009
              return (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="p-3">
                    <p className="font-medium text-slate-900">#{r.orderDisplayId}</p>
                    <p className="text-xs text-slate-500">Total {rupees(r.orderTotal)} · {r.orderStatus}</p>
                  </td>
                  <td className="p-3">{r.rider?.name || "—"}<p className="text-xs text-slate-500">{r.rider?.phone}</p></td>
                  <td className="p-3">{r.customer?.name || "—"}<p className="text-xs text-slate-500">{r.customer?.phone}</p></td>
                  <td className="p-3 text-right">{rupees(r.orderCashDue)}</td>
                  <td className="p-3 text-right">{rupees(r.cashCollected)}</td>
                  <td className="p-3 text-right font-semibold">
                    {rupees(r.amount)}
                    {mismatch ? <p className="text-xs font-normal text-amber-700">overpaid {rupees(r.overpaid)}</p> : null}
                  </td>
                  <td className="p-3 text-xs text-slate-600">
                    {when(r.createdAt)}
                    {r.riderNote ? <p className="text-slate-500">“{r.riderNote}”</p> : null}
                    {r.status === "rejected" && r.rejectReason ? <p className="text-red-600">Rejected: {r.rejectReason}</p> : null}
                    {r.status === "approved" ? <p className="text-green-700">Approved {when(r.reviewedAt)}</p> : null}
                  </td>
                  <td className="p-3">
                    {r.status === "pending" && (
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setRejecting(r)} disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-red-600 disabled:opacity-50">
                          <X className="h-4 w-4" /> Reject
                        </button>
                        <button onClick={() => approve(r)} disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 font-medium text-white disabled:opacity-50">
                          <Check className="h-4 w-4" /> Approve
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5">
            <p className="font-semibold text-slate-900">Reject {rupees(rejecting.amount)} change on order #{rejecting.orderDisplayId}?</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300}
              placeholder="Reason (shown to the rider)" className="w-full rounded-lg border border-slate-300 p-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setRejecting(null); setReason("") }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
              <button onClick={reject} disabled={busyId === rejecting.id} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UpiCollections() {
  const [status, setStatus] = useState("rider_confirmed")
  const [data, setData] = useState({ items: [], summary: {} })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getUpiCollections({ status, limit: 200 })
      setData(res?.data?.data || { items: [], summary: {} })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load UPI payments")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const settle = async (row, outcome) => {
    let note = ""
    if (outcome === "mismatch") {
      note = window.prompt("What does not match? (amount, not received, ...)") || ""
      if (!note.trim()) return
    } else if (!window.confirm(`Found ${rupees(row.amount)} for order #${row.orderDisplayId} in the bank statement?`)) {
      return
    }
    setBusyId(row.id)
    try {
      await adminAPI.reconcileUpiCollection(row.orderId, { outcome, note })
      toast.success(outcome === "reconciled" ? "Marked reconciled" : "Marked as mismatch")
      await load()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not update")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {UPI_TABS.map((t) => {
          const s = data.summary?.[t.key]
          return (
            <button key={t.key} onClick={() => setStatus(t.key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${status === t.key ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
              {t.label}{s ? ` · ${s.count} · ${rupees(s.amount)}` : ""}
            </button>
          )
        })}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
              <th className="p-3">Order</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Rider</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">UPI ref</th>
              <th className="p-3">Confirmed</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-6 text-center text-slate-500">Loading...</td></tr>}
            {!loading && data.items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">Nothing here.</td></tr>}
            {!loading && data.items.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="p-3"><p className="font-medium">#{r.orderDisplayId}</p><p className="text-xs text-slate-500">to {r.upiId}</p></td>
                <td className="p-3">{r.customerName || "—"}<p className="text-xs text-slate-500">{r.customerPhone}</p></td>
                <td className="p-3">{r.rider?.name || "—"}</td>
                <td className="p-3 text-right font-semibold">{rupees(r.amount)}</td>
                <td className="p-3 font-mono text-xs">{r.utr || "—"}</td>
                <td className="p-3 text-xs text-slate-600">
                  {when(r.confirmedAt)}
                  {r.reconcileNote ? <p className="text-amber-700">{r.reconcileNote}</p> : null}
                </td>
                <td className="p-3">
                  {["rider_confirmed", "mismatch"].includes(r.status) && (
                    <div className="flex gap-2 justify-end">
                      {r.status !== "mismatch" && (
                        <button onClick={() => settle(r, "mismatch")} disabled={busyId === r.id}
                          className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-amber-700 disabled:opacity-50">Mismatch</button>
                      )}
                      <button onClick={() => settle(r, "reconciled")} disabled={busyId === r.id}
                        className="rounded-lg bg-green-600 px-2.5 py-1.5 font-medium text-white disabled:opacity-50">Found in bank</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ChangeToWallet() {
  const [tab, setTab] = useState("change")
  return (
    <div className="min-h-screen space-y-4 bg-slate-50 p-4 lg:p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-slate-700" />
          <h1 className="text-xl font-bold text-slate-900">Change to wallet & UPI payments</h1>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Change riders could not give back on cash orders: approve to credit the customer's wallet (the amount is added
          to the rider's cash in hand). Clear these by end of day. COD orders paid to the company UPI need matching with
          the bank statement.
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setTab("change")}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm ${tab === "change" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
            <Wallet className="h-4 w-4" /> Change to wallet
          </button>
          <button onClick={() => setTab("upi")}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm ${tab === "upi" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
            <QrCode className="h-4 w-4" /> Company UPI payments
          </button>
        </div>
      </div>
      {tab === "change" ? <ChangeRequests /> : <UpiCollections />}
    </div>
  )
}
