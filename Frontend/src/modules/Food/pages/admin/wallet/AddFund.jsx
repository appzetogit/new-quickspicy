import { useEffect, useRef, useState } from "react"
import { Loader2, Search, Wallet } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

/**
 * Add money to a customer's wallet (goodwill, a refund made by hand ...).
 * Every credit needs a reason and is listed below and in Customer Rewards.
 * A fresh request id per submission means a double-click credits once.
 */
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const newRequestId = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

export default function AddFund() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [customer, setCustomer] = useState(null)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const requestId = useRef(newRequestId())
  const [credits, setCredits] = useState([])
  const [loadingCredits, setLoadingCredits] = useState(true)

  const loadCredits = () => {
    setLoadingCredits(true)
    adminAPI
      .getCustomerWalletCredits({ limit: 50 })
      .then((res) => setCredits(res?.data?.data?.credits || []))
      .catch(() => setCredits([]))
      .finally(() => setLoadingCredits(false))
  }
  useEffect(loadCredits, [])

  useEffect(() => {
    const q = query.trim()
    if (customer || q.length < 2) { setResults([]); return undefined }
    const t = setTimeout(() => {
      setSearching(true)
      adminAPI
        .getCustomers({ search: q, limit: 8 })
        .then((res) => setResults(res?.data?.data?.customers || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [query, customer])

  const submit = async (e) => {
    e.preventDefault()
    if (!customer) return toast.error("Choose a customer")
    const value = Number(amount)
    if (!(value > 0)) return toast.error("Enter an amount above 0")
    if (!reason.trim()) return toast.error("Say why the money is being added")
    if (!window.confirm(`Add ${rupees(value)} to ${customer.name || customer.phone}'s wallet?`)) return
    setSaving(true)
    try {
      const res = await adminAPI.creditCustomerWallet(customer.id || customer._id, { amount: value, reason: reason.trim(), requestId: requestId.current })
      const balance = res?.data?.data?.balance
      toast.success(`Added ${rupees(value)}. New balance ${rupees(balance)}`)
      requestId.current = newRequestId()
      setAmount("")
      setReason("")
      setCustomer(null)
      setQuery("")
      loadCredits()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not add the money")
    } finally {
      setSaving(false)
    }
  }

  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Wallet className="w-6 h-6 text-orange-600" /> Add Fund</h1>
          <p className="text-sm text-slate-500 mt-1">Add money to a customer's wallet. It is spendable on their next order straight away. At most ₹50,000 at a time.</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative md:col-span-1">
            <label className="text-sm font-medium text-slate-700">Customer</label>
            {customer ? (
              <div className="mt-1 flex items-center justify-between rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm">
                <span><b>{customer.name || "Customer"}</b> · {customer.phone}</span>
                <button type="button" className="text-orange-700 font-semibold" onClick={() => { setCustomer(null); setQuery("") }}>Change</button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input className={`${input} pl-9`} placeholder="Search name or phone" value={query} onChange={(e) => setQuery(e.target.value)} />
                {(searching || results.length > 0) && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                    {searching ? <p className="p-3 text-sm text-slate-500">Searching…</p> : results.map((c) => (
                      <button type="button" key={c.id || c._id} onClick={() => setCustomer(c)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <b>{c.name || "Customer"}</b> · {c.phone}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <label className="text-sm font-medium text-slate-700">Amount (₹)
            <input type="number" min="1" max="50000" step="0.01" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="text-sm font-medium text-slate-700">Reason
            <input className={input} maxLength={200} placeholder="e.g. Late delivery on order 1234" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="md:col-span-3 flex justify-end">
            <button type="submit" disabled={saving} className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">{saving ? "Adding…" : "Add to wallet"}</button>
          </div>
        </form>

        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <h2 className="px-4 pt-4 font-semibold text-slate-900">Recent admin credits</h2>
          {loadingCredits ? (
            <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-orange-600" /></div>
          ) : !credits.length ? (
            <p className="p-6 text-sm text-slate-500">No money has been added by an admin yet.</p>
          ) : (
            <table className="w-full text-sm mt-2">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Customer</th><th className="px-4 py-3 text-left">Reason</th><th className="px-4 py-3 text-right">Amount</th></tr></thead>
              <tbody>{credits.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(c.date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-4 py-3"><b>{c.name || "Customer"}</b><p className="text-xs text-slate-500">{c.phone}</p></td>
                  <td className="px-4 py-3 text-slate-600">{c.reason}</td>
                  <td className="px-4 py-3 text-right font-semibold">{rupees(c.amount)}</td>
                </tr>))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
