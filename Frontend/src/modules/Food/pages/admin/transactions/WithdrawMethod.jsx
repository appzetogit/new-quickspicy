import { useState } from "react"
import { Banknote, Loader2, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

/**
 * The ways restaurants and riders can be paid (bank transfer, UPI ...) and the
 * details each needs. The apps read the active ones from
 * /platform-settings/public (withdraw_methods).
 */
const BLANK_FIELD = { label: "", type: "text", placeholder: "", required: true }
const BLANK = { name: "", forRestaurants: true, forRiders: true, isActive: true, isDefault: false, fields: [{ ...BLANK_FIELD }] }
const DEFAULTS = {
  methods: [
    { name: "Bank transfer", forRestaurants: true, forRiders: true, isActive: true, isDefault: true, fields: [
      { label: "Account holder name", type: "text", placeholder: "As on the bank account", required: true },
      { label: "Account number", type: "number", placeholder: "", required: true },
      { label: "IFSC code", type: "text", placeholder: "e.g. SBIN0001234", required: true },
    ] },
    { name: "UPI", forRestaurants: true, forRiders: true, isActive: true, isDefault: false, fields: [
      { label: "UPI id", type: "text", placeholder: "name@bank", required: true },
    ] },
  ],
}

export default function WithdrawMethod() {
  const { value, setValue, save, loading, saving } = usePlatformSetting("withdraw_methods", DEFAULTS)
  const [draft, setDraft] = useState(null)
  const [editing, setEditing] = useState(null)
  const methods = Array.isArray(value.methods) ? value.methods : []

  const persist = (nextMethods, message) => {
    const next = { ...value, methods: nextMethods }
    setValue(next)
    return save(next, { successMessage: message })
  }

  const submit = async (e) => {
    e.preventDefault()
    const name = draft.name.trim()
    if (!name) return toast.error("Give the method a name")
    const fields = draft.fields.map((f) => ({ ...f, label: f.label.trim() })).filter((f) => f.label)
    if (!fields.length) return toast.error("Add at least one detail to collect")
    if (!draft.forRestaurants && !draft.forRiders) return toast.error("Choose who can use it")
    if (methods.some((m, i) => i !== editing && m.name.toLowerCase() === name.toLowerCase())) return toast.error("A method with this name already exists")
    let next = editing === null ? [...methods, { ...draft, name, fields }] : methods.map((m, i) => (i === editing ? { ...draft, name, fields } : m))
    const idx = editing === null ? next.length - 1 : editing
    if (next[idx].isDefault) next = next.map((m, i) => ({ ...m, isDefault: i === idx }))
    if (await persist(next, editing === null ? "Method added" : "Method updated")) { setDraft(null); setEditing(null) }
  }

  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
  const setField = (i, key, v) => setDraft((d) => ({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, [key]: v } : f)) }))

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Banknote className="w-6 h-6 text-orange-600" /> Withdraw Methods</h1>
            <p className="text-sm text-slate-500 mt-1">How restaurants and riders can ask to be paid, and the details each method collects.</p>
          </div>
          {!draft && <button type="button" onClick={() => { setEditing(null); setDraft({ ...BLANK, fields: [{ ...BLANK_FIELD }] }) }} className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white"><Plus className="w-4 h-4" />Add method</button>}
        </div>

        {draft && (
          <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">{editing === null ? "New method" : "Edit method"}</h2><button type="button" onClick={() => setDraft(null)} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button></div>
            <label className="block text-sm font-medium text-slate-700">Name<input className={input} maxLength={40} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Bank transfer" /></label>
            <div className="flex flex-wrap gap-5 text-sm text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-orange-600" checked={draft.forRestaurants} onChange={(e) => setDraft({ ...draft, forRestaurants: e.target.checked })} />Restaurants</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-orange-600" checked={draft.forRiders} onChange={(e) => setDraft({ ...draft, forRiders: e.target.checked })} />Riders</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-orange-600" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />Active</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-orange-600" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />Default</label>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Details to collect</p>
              {draft.fields.map((f, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input className="col-span-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Label, e.g. IFSC code" value={f.label} onChange={(e) => setField(i, "label", e.target.value)} />
                  <select className="col-span-2 rounded-lg border border-slate-300 px-2 py-2 text-sm" value={f.type} onChange={(e) => setField(i, "type", e.target.value)}><option value="text">Text</option><option value="number">Number</option><option value="email">Email</option><option value="phone">Phone</option></select>
                  <input className="col-span-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Hint (optional)" value={f.placeholder} onChange={(e) => setField(i, "placeholder", e.target.value)} />
                  <label className="col-span-1 flex items-center gap-1 text-xs"><input type="checkbox" className="accent-orange-600" checked={f.required} onChange={(e) => setField(i, "required", e.target.checked)} />Req.</label>
                  <button type="button" className="col-span-1 text-red-600 justify-self-end" aria-label="Remove detail" onClick={() => setDraft((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }))}><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setDraft((d) => ({ ...d, fields: [...d.fields, { ...BLANK_FIELD }] }))} className="text-sm font-semibold text-orange-600">+ Add a detail</button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save method"}</button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>
          ) : !methods.length ? (
            <p className="p-8 text-center text-sm text-slate-500">No withdraw methods yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Method</th><th className="px-4 py-3 text-left">Collects</th><th className="px-4 py-3 text-left">For</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody>{methods.map((m, i) => (
                <tr key={`${m.name}-${i}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{m.name}{m.isDefault && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-700">Default</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{(m.fields || []).map((f) => f.label).join(", ")}</td>
                  <td className="px-4 py-3 text-slate-600">{[m.forRestaurants && "Restaurants", m.forRiders && "Riders"].filter(Boolean).join(", ")}</td>
                  <td className="px-4 py-3"><button type="button" disabled={saving} onClick={() => persist(methods.map((x, j) => (j === i ? { ...x, isActive: !x.isActive } : x)), "Saved")} className={`rounded-full px-3 py-1 text-xs font-semibold ${m.isActive ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-700"}`}>{m.isActive ? "Active" : "Off"}</button></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    <button type="button" onClick={() => { setEditing(i); setDraft({ ...BLANK, ...m, fields: (m.fields || []).map((f) => ({ ...BLANK_FIELD, ...f })) }) }} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold">Edit</button>
                    <button type="button" disabled={saving} onClick={() => window.confirm(`Delete the withdraw method "${m.name}"?`) && persist(methods.filter((_, j) => j !== i), "Method deleted")} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">Delete</button>
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
