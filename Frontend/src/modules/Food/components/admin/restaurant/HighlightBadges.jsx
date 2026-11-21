import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

/**
 * Restaurant card tags (Bestseller, Popular, ...), kept in the database so an
 * admin can add one without a release.
 */

const errorText = (err, fallback) => err?.response?.data?.message || fallback

export function useHighlightBadges() {
  const [badges, setBadges] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getHighlightBadges()
      setBadges(res?.data?.data?.badges || [])
    } catch {
      setBadges([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { badges, loading, reload }
}

const Pill = ({ badge }) => (
  <span
    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
    style={{ backgroundColor: badge.color || "#E23744" }}
  >
    {badge.label}
  </span>
)

/** The tag picker on a restaurant's details, with a quick "add new". */
export function HighlightBadgeSelect({ value, onChange }) {
  const { badges, loading, reload } = useHighlightBadges()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState("")
  const [saving, setSaving] = useState(false)

  const active = badges.filter((b) => b.isActive)
  // An old value that is no longer an active tag still shows, so saving the
  // form does not fail on it unnoticed.
  const unknown = value && !active.some((b) => b.key === value)

  const add = async () => {
    if (!label.trim()) return
    try {
      setSaving(true)
      const res = await adminAPI.createHighlightBadge({ label: label.trim() })
      const badge = res?.data?.data?.badge
      await reload()
      if (badge?.key) onChange(badge.key)
      setLabel("")
      setAdding(false)
      toast.success(`Tag "${badge?.label || label}" added`)
    } catch (err) {
      toast.error(errorText(err, "Couldn't add the tag"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <select
          className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white text-sm"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
        >
          <option value="">None</option>
          {active.map((b) => (
            <option key={b.key} value={b.key}>{b.label}</option>
          ))}
          {unknown && <option value={value}>{value} (removed)</option>}
        </select>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="shrink-0 h-10 px-3 rounded-md border border-slate-200 bg-white text-sm hover:bg-slate-50 flex items-center gap-1"
          title="Add a new tag"
        >
          <Plus className="w-4 h-4" /> New
        </button>
      </div>
      {adding && (
        <div className="flex gap-2">
          <input
            autoFocus
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="e.g. New, Trending, Pure Veg"
            className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm"
          />
          <button
            type="button"
            onClick={add}
            disabled={saving || !label.trim()}
            className="shrink-0 h-9 px-3 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
          </button>
        </div>
      )}
    </div>
  )
}

/** Most tags on one restaurant; the backend enforces the same limit. */
export const MAX_HIGHLIGHT_BADGES = 5

/**
 * Several tags on one restaurant. `value` is the list of tag keys in display
 * order (the first is what older app builds show); click a tag to add or
 * remove it.
 */
export function HighlightBadgeMultiSelect({ value, onChange }) {
  const { badges, loading, reload } = useHighlightBadges()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState("")
  const [saving, setSaving] = useState(false)

  const selected = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
  const active = badges.filter((b) => b.isActive)
  const byKey = new Map(badges.map((b) => [b.key, b]))
  // A tag that was switched off or deleted still shows on a restaurant that has
  // it, so the admin can see and remove it; the server would refuse to save it.
  const stale = selected.filter((k) => !active.some((b) => b.key === k))
  const full = selected.length >= MAX_HIGHLIGHT_BADGES

  const toggle = (key) => {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key))
    else if (!full) onChange([...selected, key])
    else toast.error(`At most ${MAX_HIGHLIGHT_BADGES} tags per restaurant`)
  }

  const add = async () => {
    if (!label.trim()) return
    try {
      setSaving(true)
      const res = await adminAPI.createHighlightBadge({ label: label.trim() })
      const badge = res?.data?.data?.badge
      await reload()
      if (badge?.key && !selected.includes(badge.key) && !full) onChange([...selected, badge.key])
      setLabel("")
      setAdding(false)
      toast.success(`Tag "${badge?.label || label}" added`)
    } catch (err) {
      toast.error(errorText(err, "Couldn't add the tag"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        {!loading && active.length === 0 && (
          <span className="text-xs text-slate-500">No tags yet. Add one, or manage them in Restaurant settings.</span>
        )}
        {active.map((b) => {
          const on = selected.includes(b.key)
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => toggle(b.key)}
              aria-pressed={on}
              className={`h-8 px-3 rounded-full border text-xs font-semibold transition-colors ${
                on ? "text-white border-transparent" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
              style={on ? { backgroundColor: b.color || "#E23744" } : undefined}
            >
              {on ? `${selected.indexOf(b.key) + 1}. ` : ""}{b.label}
            </button>
          )
        })}
        {stale.map((k) => (
          <button
            key={`stale-${k}`}
            type="button"
            onClick={() => onChange(selected.filter((x) => x !== k))}
            className="h-8 px-3 rounded-full border border-dashed border-amber-300 bg-amber-50 text-amber-800 text-xs"
            title="This tag is off or deleted. Click to remove it."
          >
            {byKey.get(k)?.label || k} (removed) ×
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="h-8 px-3 rounded-full border border-slate-200 bg-white text-xs hover:bg-slate-50 flex items-center gap-1"
          title="Add a new tag"
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        {selected.length
          ? `${selected.length} selected. The numbers are the order the card shows them in; older app versions show only the first.`
          : "No tags: the card shows none."}
      </p>
      {adding && (
        <div className="flex gap-2">
          <input
            autoFocus
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="e.g. New, Trending, Pure Veg"
            className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm"
          />
          <button
            type="button"
            onClick={add}
            disabled={saving || !label.trim()}
            className="shrink-0 h-9 px-3 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
          </button>
        </div>
      )}
    </div>
  )
}

/** Full list: rename, recolour, hide, delete. */
export function HighlightBadgeManager() {
  const { badges, loading, reload } = useHighlightBadges()
  const [draft, setDraft] = useState({ label: "", color: "#E23744" })
  const [busyId, setBusyId] = useState(null)

  const run = async (id, fn, done) => {
    try {
      setBusyId(id)
      await fn()
      await reload()
      if (done) toast.success(done)
    } catch (err) {
      toast.error(errorText(err, "Couldn't save the tag"))
    } finally {
      setBusyId(null)
    }
  }

  const create = () => {
    if (!draft.label.trim()) return
    run("new", () => adminAPI.createHighlightBadge(draft), "Tag added").then(() =>
      setDraft({ label: "", color: "#E23744" }),
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-semibold text-slate-600 mb-1">New tag</label>
          <input
            value={draft.label}
            maxLength={40}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="e.g. Trending"
            className="w-full h-10 px-3 rounded-md border border-slate-200 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Colour</label>
          <input
            type="color"
            value={draft.color}
            onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
            className="h-10 w-14 rounded-md border border-slate-200 bg-white"
          />
        </div>
        <button
          type="button"
          onClick={create}
          disabled={busyId === "new" || !draft.label.trim()}
          className="h-10 px-4 rounded-md bg-slate-900 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5"
        >
          {busyId === "new" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add tag
        </button>
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {badges.length === 0 && <p className="p-4 text-sm text-slate-500">No tags yet.</p>}
          {badges.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-3 p-3">
              <Pill badge={b} />
              <input
                defaultValue={b.label}
                maxLength={40}
                onBlur={(e) => {
                  const label = e.target.value.trim()
                  if (label && label !== b.label) run(b.id, () => adminAPI.updateHighlightBadge(b.id, { label }), "Tag renamed")
                }}
                className="h-9 px-2 rounded-md border border-slate-200 text-sm w-44"
              />
              <input
                type="color"
                defaultValue={b.color}
                onBlur={(e) => {
                  if (e.target.value.toUpperCase() !== String(b.color).toUpperCase()) {
                    run(b.id, () => adminAPI.updateHighlightBadge(b.id, { color: e.target.value }), "Colour saved")
                  }
                }}
                className="h-9 w-12 rounded-md border border-slate-200 bg-white"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={b.isActive}
                  onChange={(e) => run(b.id, () => adminAPI.updateHighlightBadge(b.id, { isActive: e.target.checked }))}
                />
                Shown in app
              </label>
              <span className="text-xs text-slate-500">{b.restaurantCount || 0} restaurants</span>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete "${b.label}"? It will be removed from ${b.restaurantCount || 0} restaurants.`)) {
                    run(b.id, () => adminAPI.deleteHighlightBadge(b.id), "Tag deleted")
                  }
                }}
                disabled={busyId === b.id}
                className="ml-auto p-1.5 rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
                title="Delete tag"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
