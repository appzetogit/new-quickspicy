import { useEffect, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

/**
 * Salaried rider incentive, on the Delivery fee screen.
 *
 * A salaried rider earns nothing per order for their first N delivered orders
 * of the day (their salary covers them); from order N+1 they earn the normal
 * rider pay for each order. Gig riders are not affected. With a zone picked
 * above, the values here override the global ones for riders whose home zone
 * it is (blank / "Same as global" inherits).
 */
export default function SalariedIncentiveCard({ selectedZoneId = "", zoneLabel = "this zone" }) {
  const [settings, setSettings] = useState({ enabled: false, dailyThreshold: 0, zones: {} })
  const [enabled, setEnabled] = useState("")
  const [threshold, setThreshold] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const applyToForm = (s, zoneId) => {
    if (zoneId) {
      const z = s.zones?.[zoneId] || {}
      setEnabled(z.enabled === true ? "on" : z.enabled === false ? "off" : "")
      setThreshold(z.dailyThreshold ?? "")
    } else {
      setEnabled(s.enabled ? "on" : "off")
      setThreshold(s.dailyThreshold ?? 0)
    }
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const res = await adminAPI.getSalariedIncentive()
        const data = res?.data?.data || { enabled: false, dailyThreshold: 0, zones: {} }
        if (cancelled) return
        setSettings(data)
        applyToForm(data, selectedZoneId)
      } catch {
        if (!cancelled) toast.error("Failed to load the salaried rider incentive")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedZoneId])

  const handleSave = async () => {
    const t = threshold === "" ? null : Number(threshold)
    if (t !== null && (!Number.isInteger(t) || t < 0 || t > 1000)) {
      toast.error("Daily order threshold must be a whole number from 0 to 1000")
      return
    }
    const body = {
      enabled: settings.enabled,
      dailyThreshold: settings.dailyThreshold,
      zones: { ...(settings.zones || {}) },
    }
    if (selectedZoneId) {
      body.zones[selectedZoneId] = {
        enabled: enabled === "" ? null : enabled === "on",
        dailyThreshold: t,
      }
    } else {
      body.enabled = enabled === "on"
      body.dailyThreshold = t ?? 0
    }
    try {
      setSaving(true)
      const res = await adminAPI.saveSalariedIncentive(body)
      const data = res?.data?.data
      if (data) {
        setSettings(data)
        applyToForm(data, selectedZoneId)
      }
      toast.success(selectedZoneId ? `Salaried incentive saved for ${zoneLabel}` : "Salaried incentive saved")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save the salaried rider incentive")
    } finally {
      setSaving(false)
    }
  }

  const effectiveThreshold =
    selectedZoneId && threshold === "" ? settings.dailyThreshold : Number(threshold) || 0

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-6">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Salaried rider incentive</h2>
            <p className="text-sm text-slate-500 mt-1">
              Salaried riders earn nothing per order for their first N delivered orders of the day (their salary
              covers them). From order N+1 they earn the normal rider pay for each order as an incentive. Tips always
              go to the rider. Gig riders are not affected.
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save incentive
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-green-600" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Status</label>
              <select
                value={enabled}
                onChange={(e) => setEnabled(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
              >
                {selectedZoneId ? (
                  <option value="">Same as global ({settings.enabled ? "On" : "Off"})</option>
                ) : null}
                <option value="on">On</option>
                <option value="off">Off (salaried riders are paid per order like gig riders)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Daily order threshold (N)</label>
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                onKeyDown={(e) => {
                  if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault()
                }}
                placeholder={selectedZoneId ? `Same as global (${settings.dailyThreshold})` : "25"}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-slate-500">
                {effectiveThreshold > 0
                  ? `Orders 1 to ${effectiveThreshold} of the day are covered by salary; order ${effectiveThreshold + 1} onward pays the normal rider earning.`
                  : "0 switches the incentive off."}
                {selectedZoneId ? ` Applies to riders whose home zone is ${zoneLabel}.` : ""}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
