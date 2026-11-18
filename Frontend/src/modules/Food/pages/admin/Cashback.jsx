import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Loader2, PiggyBank } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

/**
 * Cashback on delivered orders, credited to the customer's wallet. One set of
 * rules for the whole platform; the order flow awards it on delivery
 * (cashback.service.js). Who received what is under Customer Rewards.
 */
const EMPTY = {
  isEnabled: false,
  cashbackType: "percentage",
  cashbackValue: 0,
  minOrderValue: 0,
  maxCashback: 0,
  firstOrderOnly: false,
  perUserLimit: 0,
}

const numberOr0 = (v) => (v === "" || v == null ? 0 : Number(v))

export default function Cashback() {
  const [form, setForm] = useState(EMPTY)
  const loaded = useRef(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminAPI
      .getCashbackSettings()
      .then((res) => {
        const s = res?.data?.data?.cashbackSettings || {}
        const next = {
          isEnabled: Boolean(s.isEnabled),
          cashbackType: s.cashbackType === "flat" ? "flat" : "percentage",
          cashbackValue: Number(s.cashbackValue) || 0,
          minOrderValue: Number(s.minOrderValue) || 0,
          maxCashback: Number(s.maxCashback) || 0,
          firstOrderOnly: Boolean(s.firstOrderOnly),
          perUserLimit: Number(s.perUserLimit) || 0,
        }
        loaded.current = next
        setForm(next)
      })
      .catch(() => toast.error("Could not load cashback settings"))
      .finally(() => setLoading(false))
  }, [])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const save = async (e) => {
    e.preventDefault()
    const value = numberOr0(form.cashbackValue)
    if (form.isEnabled && !(value > 0)) return toast.error("Enter the cashback amount or percentage")
    if (form.cashbackType === "percentage" && value > 100) return toast.error("A percentage cannot be over 100")
    setSaving(true)
    try {
      const body = {
        ...form,
        cashbackValue: value,
        minOrderValue: numberOr0(form.minOrderValue),
        maxCashback: numberOr0(form.maxCashback),
        perUserLimit: Math.trunc(numberOr0(form.perUserLimit)),
      }
      await adminAPI.saveCashbackSettings(body)
      loaded.current = body
      toast.success("Cashback settings saved")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save cashback settings")
    } finally {
      setSaving(false)
    }
  }

  const pct = form.cashbackType === "percentage"
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><PiggyBank className="w-6 h-6 text-orange-600" /> Cashback</h1>
          <p className="text-sm text-slate-500 mt-1">
            Customers get this back in their wallet when an order is delivered. See who received what under{" "}
            <Link to="/admin/food/loyalty-point/report" className="text-orange-600 font-medium hover:underline">Customer Rewards</Link>.
          </p>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>
        ) : (
          <form onSubmit={save} className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
            <label className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 p-4">
              <span>
                <span className="block font-semibold text-slate-900">Cashback is {form.isEnabled ? "on" : "off"}</span>
                <span className="block text-xs text-slate-500">When off, no order earns cashback.</span>
              </span>
              <input type="checkbox" className="h-5 w-5 accent-orange-600" checked={form.isEnabled} onChange={(e) => set("isEnabled", e.target.checked)} />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-sm font-medium text-slate-700">Type
                <select className={input} value={form.cashbackType} onChange={(e) => set("cashbackType", e.target.value)}>
                  <option value="percentage">Percentage of the item total</option>
                  <option value="flat">Fixed amount</option>
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700">{pct ? "Cashback (%)" : "Cashback (₹)"}
                <input type="number" min="0" step="0.01" className={input} value={form.cashbackValue} onChange={(e) => set("cashbackValue", e.target.value)} />
              </label>
              <label className="text-sm font-medium text-slate-700">Minimum order (₹)
                <input type="number" min="0" step="1" className={input} value={form.minOrderValue} onChange={(e) => set("minOrderValue", e.target.value)} />
                <span className="text-xs text-slate-400">Item total needed to qualify. 0 = any order.</span>
              </label>
              <label className="text-sm font-medium text-slate-700">Maximum cashback (₹)
                <input type="number" min="0" step="1" disabled={!pct} className={`${input} disabled:bg-slate-100`} value={form.maxCashback} onChange={(e) => set("maxCashback", e.target.value)} />
                <span className="text-xs text-slate-400">{pct ? "Cap per order. 0 = no cap." : "Only for percentage cashback."}</span>
              </label>
              <label className="text-sm font-medium text-slate-700">Times per customer
                <input type="number" min="0" step="1" className={input} value={form.perUserLimit} onChange={(e) => set("perUserLimit", e.target.value)} />
                <span className="text-xs text-slate-400">0 = every qualifying order.</span>
              </label>
              <label className="flex items-center gap-3 text-sm font-medium text-slate-700 md:mt-6">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={form.firstOrderOnly} onChange={(e) => set("firstOrderOnly", e.target.checked)} />
                First order only
              </label>
            </div>

            <p className="rounded-lg bg-orange-50 p-3 text-sm text-orange-800">
              {form.isEnabled
                ? `A ${pct ? `${numberOr0(form.cashbackValue)}%` : `₹${numberOr0(form.cashbackValue)}`} cashback${pct && numberOr0(form.maxCashback) ? ` (up to ₹${numberOr0(form.maxCashback)})` : ""} on ${form.firstOrderOnly ? "a customer's first order" : "delivered orders"}${numberOr0(form.minOrderValue) ? ` of ₹${numberOr0(form.minOrderValue)} or more` : ""}.`
                : "Cashback is off."}
            </p>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(loaded.current)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Reset</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
