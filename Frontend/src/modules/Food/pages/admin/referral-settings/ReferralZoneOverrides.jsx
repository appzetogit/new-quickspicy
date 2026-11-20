import { Fragment, useEffect, useMemo, useState } from "react"
import { Loader2, Plus, Trash2, Pencil, X, Check } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

/**
 * Per-zone overrides of the referral rewards and limits. A blank field means
 * "use the global value above". Customer referrals go by the referred
 * customer's address zone; rider referrals by the referred rider's home zone.
 */
const FIELDS = [
  { key: "referralRewardUser", label: "Customer reward (₹)" },
  { key: "referralLimitUser", label: "Customer max credits", whole: true },
  { key: "referralRewardDelivery", label: "Rider reward (₹)" },
  { key: "referralLimitDelivery", label: "Rider max credits", whole: true },
]

const EMPTY = { zoneId: "", referralRewardUser: "", referralLimitUser: "", referralRewardDelivery: "", referralLimitDelivery: "" }

const cleanNumber = (raw, whole) =>
  String(raw ?? "").replace(whole ? /[^\d]/g : /[^\d.]/g, "")

export default function ReferralZoneOverrides({ globalSettings }) {
  const [rows, setRows] = useState([])
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState(null) // { ...EMPTY, isNew }
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const [res, zr] = await Promise.all([
        adminAPI.getReferralZoneSettings(),
        adminAPI.getZones({ page: 1, limit: 1000 }),
      ])
      setRows(res?.data?.data?.zoneSettings || [])
      const list = zr?.data?.data?.zones || []
      setZones((Array.isArray(list) ? list : []).map((z) => ({
        id: String(z?._id || z?.id || ""),
        name: z?.zoneName || z?.name || "Zone",
        city: z?.city || "",
      })).filter((z) => z.id))
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load zone overrides")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const zoneName = (id) => {
    const z = zones.find((x) => x.id === id)
    return z ? [z.name, z.city].filter(Boolean).join(" · ") : null
  }

  const freeZones = useMemo(
    () => zones.filter((z) => !rows.some((r) => r.zoneId === z.id)),
    [zones, rows],
  )

  const startEdit = (row) => setDraft({
    zoneId: row.zoneId,
    referralRewardUser: row.referralRewardUser ?? "",
    referralLimitUser: row.referralLimitUser ?? "",
    referralRewardDelivery: row.referralRewardDelivery ?? "",
    referralLimitDelivery: row.referralLimitDelivery ?? "",
    isNew: false,
  })

  const save = async () => {
    if (!draft?.zoneId) {
      toast.error("Choose a zone")
      return
    }
    const body = {}
    for (const f of FIELDS) {
      const v = String(draft[f.key] ?? "").trim()
      body[f.key] = v === "" ? null : Number(v)
    }
    try {
      setSaving(true)
      await adminAPI.upsertReferralZoneSetting(draft.zoneId, body)
      toast.success("Zone override saved")
      setDraft(null)
      await load()
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save zone override")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row) => {
    if (!window.confirm(`Remove the override for ${zoneName(row.zoneId) || row.zoneName || "this zone"}? It will use the global values.`)) return
    try {
      await adminAPI.deleteReferralZoneSetting(row.zoneId)
      toast.success("Zone override removed")
      await load()
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to remove zone override")
    }
  }

  const globalHint = (key) => {
    const v = globalSettings?.[key]
    return v === "" || v === undefined || v === null ? "global" : `global: ${v}`
  }

  const draftRow = draft && (
    <tr className="bg-orange-50/50">
      <td className="px-3 py-2">
        {draft.isNew ? (
          <select
            value={draft.zoneId}
            onChange={(e) => setDraft((d) => ({ ...d, zoneId: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="">Choose zone…</option>
            {freeZones.map((z) => (
              <option key={z.id} value={z.id}>{[z.name, z.city].filter(Boolean).join(" · ")}</option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-medium">{zoneName(draft.zoneId) || draft.zoneId}</span>
        )}
      </td>
      {FIELDS.map((f) => (
        <td key={f.key} className="px-3 py-2">
          <input
            value={draft[f.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: cleanNumber(e.target.value, f.whole) }))}
            inputMode="numeric"
            placeholder={globalHint(f.key)}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
          />
        </td>
      ))}
      <td className="px-3 py-2 whitespace-nowrap text-right">
        <button type="button" onClick={save} disabled={saving} className="p-1.5 rounded hover:bg-green-100 text-green-700" title="Save">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
        <button type="button" onClick={() => setDraft(null)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Cancel">
          <X className="w-4 h-4" />
        </button>
      </td>
    </tr>
  )

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-6">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Zone overrides</h2>
            <p className="text-sm text-slate-500 mt-1">
              Different rewards or limits for a zone. Blank fields use the global values above.
              A customer referral uses the referred customer's address zone (else the referrer's);
              a rider referral uses the referred rider's home zone (else the referrer's).
            </p>
          </div>
          <Button
            onClick={() => setDraft({ ...EMPTY, isNew: true })}
            disabled={Boolean(draft) || loading || freeZones.length === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add zone
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-600 border-b border-slate-200">
                  <th className="px-3 py-2">Zone</th>
                  {FIELDS.map((f) => <th key={f.key} className="px-3 py-2">{f.label}</th>)}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {draft?.isNew && draftRow}
                {rows.map((row) => (draft && !draft.isNew && draft.zoneId === row.zoneId ? (
                  <Fragment key={row.zoneId}>{draftRow}</Fragment>
                ) : (
                  <tr key={row.zoneId}>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {zoneName(row.zoneId) || row.zoneName || <span className="text-slate-400">Deleted zone</span>}
                    </td>
                    {FIELDS.map((f) => (
                      <td key={f.key} className="px-3 py-2">
                        {row[f.key] === null || row[f.key] === undefined
                          ? <span className="text-slate-400">global</span>
                          : row[f.key]}
                      </td>
                    ))}
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button type="button" onClick={() => startEdit(row)} disabled={Boolean(draft)} className="p-1.5 rounded hover:bg-slate-100 text-slate-700" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => remove(row)} disabled={Boolean(draft)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Remove">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )))}
                {!rows.length && !draft && (
                  <tr>
                    <td colSpan={FIELDS.length + 2} className="px-3 py-6 text-center text-slate-500">
                      No zone overrides. Every zone uses the global values.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
