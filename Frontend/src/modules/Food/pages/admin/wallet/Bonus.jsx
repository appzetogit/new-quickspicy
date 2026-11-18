import { useState } from "react"
import { Gift, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

/**
 * Bonus money for topping up the wallet: "add ₹1000 or more, get 10% extra (up
 * to ₹150)". The best matching rule pays once per top-up, straight after the
 * payment is confirmed (adminTools.service.js applyTopupBonus). Customers see
 * the rules through /platform-settings/public (wallet_bonus).
 */
const BLANK = { title: "", minAmount: "", bonusType: "flat", value: "", maxBonus: "", startDate: "", endDate: "", isActive: true }
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`

const describe = (r) => {
  const amount = r.bonusType === "percentage" ? `${Number(r.value) || 0}% extra${Number(r.maxBonus) ? ` (up to ${rupees(r.maxBonus)})` : ""}` : `${rupees(r.value)} extra`
  return `Add ${rupees(r.minAmount)} or more, get ${amount}`
}

export default function Bonus() {
  const { value, setValue, save, loading, saving } = usePlatformSetting("wallet_bonus", { enabled: false, rules: [] })
  const [draft, setDraft] = useState(BLANK)
  const [editing, setEditing] = useState(null) // index being edited, or null for a new rule
  const rules = Array.isArray(value.rules) ? value.rules : []

  const persist = (next, message) => {
    setValue(next)
    return save(next, { successMessage: message })
  }

  const submitRule = async (e) => {
    e.preventDefault()
    const rule = {
      ...draft,
      title: draft.title.trim(),
      minAmount: Number(draft.minAmount),
      value: Number(draft.value),
      maxBonus: draft.maxBonus === "" ? 0 : Number(draft.maxBonus),
    }
    if (!rule.title) return toast.error("Give the bonus a name")
    if (!(rule.minAmount > 0)) return toast.error("Minimum top-up must be above 0")
    if (!(rule.value > 0)) return toast.error("Bonus must be above 0")
    if (rule.bonusType === "percentage" && rule.value > 100) return toast.error("A percentage cannot be over 100")
    if (rule.startDate && rule.endDate && rule.endDate < rule.startDate) return toast.error("End date is before the start date")
    const nextRules = editing === null ? [...rules, rule] : rules.map((r, i) => (i === editing ? rule : r))
    const ok = await persist({ ...value, rules: nextRules }, editing === null ? "Bonus added" : "Bonus updated")
    if (ok) { setDraft(BLANK); setEditing(null) }
  }

  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Gift className="w-6 h-6 text-orange-600" /> Wallet Bonus</h1>
            <p className="text-sm text-slate-500 mt-1">Extra money for topping up the wallet. The best matching rule is paid once per top-up, right after payment.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 whitespace-nowrap">
            <input type="checkbox" className="h-5 w-5 accent-orange-600" disabled={loading || saving} checked={Boolean(value.enabled)}
              onChange={(e) => persist({ ...value, enabled: e.target.checked }, e.target.checked ? "Top-up bonus is on" : "Top-up bonus is off")} />
            {value.enabled ? "On" : "Off"}
          </label>
        </div>

        <form onSubmit={submitRule} className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
          <h2 className="md:col-span-4 font-semibold text-slate-900">{editing === null ? "New bonus" : "Edit bonus"}</h2>
          <label className="text-sm font-medium text-slate-700 md:col-span-2">Name<input className={input} maxLength={60} placeholder="e.g. Weekend top-up" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label className="text-sm font-medium text-slate-700">Minimum top-up (₹)<input type="number" min="1" className={input} value={draft.minAmount} onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })} /></label>
          <label className="text-sm font-medium text-slate-700">Type
            <select className={input} value={draft.bonusType} onChange={(e) => setDraft({ ...draft, bonusType: e.target.value })}>
              <option value="flat">Fixed amount</option><option value="percentage">Percentage</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">{draft.bonusType === "percentage" ? "Bonus (%)" : "Bonus (₹)"}<input type="number" min="0" step="0.01" className={input} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></label>
          <label className="text-sm font-medium text-slate-700">Maximum bonus (₹)<input type="number" min="0" disabled={draft.bonusType !== "percentage"} className={`${input} disabled:bg-slate-100`} placeholder="No cap" value={draft.maxBonus} onChange={(e) => setDraft({ ...draft, maxBonus: e.target.value })} /></label>
          <label className="text-sm font-medium text-slate-700">Starts<input type="date" className={input} value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></label>
          <label className="text-sm font-medium text-slate-700">Ends<input type="date" className={input} value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></label>
          <div className="md:col-span-4 flex justify-end gap-2">
            {editing !== null && <button type="button" onClick={() => { setEditing(null); setDraft(BLANK) }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button>}
            <button type="submit" disabled={saving || loading} className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><Plus className="w-4 h-4" />{editing === null ? "Add bonus" : "Save bonus"}</button>
          </div>
        </form>

        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>
          ) : !rules.length ? (
            <p className="p-8 text-center text-sm text-slate-500">No bonus rules yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Bonus</th><th className="px-4 py-3 text-left">Rule</th><th className="px-4 py-3 text-left">Dates</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody>{rules.map((r, i) => (
                <tr key={`${r.title}-${i}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{r.title}</td>
                  <td className="px-4 py-3 text-slate-600">{describe(r)}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.startDate || "Now"} → {r.endDate || "No end"}</td>
                  <td className="px-4 py-3">
                    <button type="button" disabled={saving} onClick={() => persist({ ...value, rules: rules.map((x, j) => (j === i ? { ...x, isActive: x.isActive === false } : x)) }, "Saved")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${r.isActive === false ? "bg-slate-200 text-slate-700" : "bg-green-100 text-green-800"}`}>{r.isActive === false ? "Paused" : "Active"}</button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    <button type="button" onClick={() => { setEditing(i); setDraft({ ...BLANK, ...r, maxBonus: r.maxBonus || "" }) }} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold">Edit</button>
                    <button type="button" disabled={saving} onClick={() => window.confirm(`Delete the bonus "${r.title}"?`) && persist({ ...value, rules: rules.filter((_, j) => j !== i) }, "Bonus deleted")}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"><Trash2 className="w-3.5 h-3.5" />Delete</button>
                  </td>
                </tr>))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
