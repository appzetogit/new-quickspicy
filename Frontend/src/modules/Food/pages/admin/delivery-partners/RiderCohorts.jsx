import { useEffect, useMemo, useState } from "react"
import { Loader2, Pencil, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import { Switch } from "@food/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@food/components/ui/dialog"

/**
 * Rider cohorts: groups of riders (shift, vehicle, region ...) that each serve
 * a set of zones. A rider keeps one home zone and may belong to one cohort; the
 * zones they may serve are their home zone plus their cohort's zones. Riders
 * are put into a cohort from Add Deliveryman or the Deliveryman list's Edit.
 */

const blankForm = () => ({ name: "", description: "", zoneIds: [], isActive: true })
const zoneKey = (z) => String(z?.id || z?._id || "")

export default function RiderCohorts() {
  const [cohorts, setCohorts] = useState([])
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")

  const [editing, setEditing] = useState(null) // null: closed, {}: new, cohort: edit
  const [form, setForm] = useState(blankForm)
  const [zoneSearch, setZoneSearch] = useState("")
  const [saving, setSaving] = useState(false)

  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    adminAPI
      .getZones()
      .then((res) => {
        const data = res?.data?.data ?? res?.data ?? {}
        setZones(Array.isArray(data.zones) ? data.zones : [])
      })
      .catch(() => setZones([]))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    adminAPI
      .getRiderCohorts({ includeInactive: true })
      .then((res) => {
        if (!active) return
        const data = res?.data?.data ?? res?.data ?? {}
        setCohorts(Array.isArray(data.cohorts) ? data.cohorts : [])
      })
      .catch((err) => {
        if (!active) return
        toast.error(err?.response?.data?.message || "Failed to load rider cohorts")
        setCohorts([])
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [refreshKey])

  const zoneNameById = useMemo(() => new Map(zones.map((z) => [zoneKey(z), z.name])), [zones])

  const filteredCohorts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return cohorts
    return cohorts.filter((c) => {
      const names = (c.zones || []).map((z) => z.name).join(" ")
      return `${c.name} ${c.description || ""} ${names}`.toLowerCase().includes(q)
    })
  }, [cohorts, searchQuery])

  const filteredZones = useMemo(() => {
    const q = zoneSearch.trim().toLowerCase()
    return q ? zones.filter((z) => String(z.name || "").toLowerCase().includes(q)) : zones
  }, [zones, zoneSearch])

  const openCreate = () => {
    setForm(blankForm())
    setZoneSearch("")
    setEditing({})
  }

  const openEdit = (cohort) => {
    setForm({
      name: cohort.name || "",
      description: cohort.description || "",
      zoneIds: (cohort.zoneIds || []).map(String),
      isActive: cohort.isActive !== false,
    })
    setZoneSearch("")
    setEditing(cohort)
  }

  const toggleZone = (id) =>
    setForm((f) => ({
      ...f,
      zoneIds: f.zoneIds.includes(id) ? f.zoneIds.filter((z) => z !== id) : [...f.zoneIds, id],
    }))

  const handleSave = async () => {
    const name = form.name.trim()
    if (!name) {
      toast.error("Cohort name is required")
      return
    }
    const body = {
      name,
      description: form.description.trim(),
      zoneIds: form.zoneIds,
      isActive: form.isActive,
    }
    const id = editing?.id || editing?._id
    try {
      setSaving(true)
      if (id) await adminAPI.updateRiderCohort(id, body)
      else await adminAPI.createRiderCohort(body)
      toast.success(id ? "Cohort updated" : "Cohort created")
      setEditing(null)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save the cohort")
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const id = pendingDelete?.id || pendingDelete?._id
    if (!id) return
    try {
      setDeleting(true)
      const res = await adminAPI.deleteRiderCohort(id)
      const released = res?.data?.data?.ridersReleased
      toast.success(released ? `Cohort deleted. ${released} rider(s) now have no cohort.` : "Cohort deleted")
      setPendingDelete(null)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not delete the cohort")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Rider cohorts</h1>
            <div className="text-sm text-slate-500 mt-1">
              Groups of riders that serve a set of zones. A rider serves their home zone plus their cohort's zones.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              + New cohort
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search cohorts or zones..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
            />
          </div>
          <div className="text-sm text-slate-600">
            Showing <span className="font-semibold">{filteredCohorts.length}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">SL</th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Name</th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Zones</th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Riders</th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                      <p className="text-sm text-slate-500">Loading cohorts...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredCohorts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">
                        {cohorts.length ? "No cohorts match your search" : "Create a cohort to group riders by the zones they serve"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCohorts.map((cohort, index) => {
                  const zoneNames = (cohort.zones?.length ? cohort.zones.map((z) => z.name) : (cohort.zoneIds || []).map((id) => zoneNameById.get(String(id))))
                    .filter(Boolean)
                  return (
                    <tr key={String(cohort.id || cohort._id)} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-700">{index + 1}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-900">{cohort.name}</span>
                          {cohort.description ? <span className="text-xs text-slate-500">{cohort.description}</span> : null}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {zoneNames.length ? (
                          <div className="flex flex-wrap gap-1 max-w-md">
                            {zoneNames.map((name) => (
                              <span key={name} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No zones</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-slate-900">{Number(cohort.riderCount || 0)}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            cohort.isActive !== false ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {cohort.isActive !== false ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <button
                            onClick={() => openEdit(cohort)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </button>
                          <button
                            onClick={() => setPendingDelete(cohort)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / edit */}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && !saving && setEditing(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {editing?.id || editing?._id ? "Edit cohort" : "New cohort"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700">Name</label>
              <input
                value={form.name}
                maxLength={80}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Night shift, Bicycle riders"
                className="mt-1 w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700">Description (optional)</label>
              <input
                value={form.description}
                maxLength={300}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="mt-1 w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-slate-700">Zones</label>
                <span className="text-xs text-slate-500">{form.zoneIds.length} selected</span>
              </div>
              <input
                value={zoneSearch}
                onChange={(e) => setZoneSearch(e.target.value)}
                placeholder="Search zones..."
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {filteredZones.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-slate-500 text-center">
                    {zones.length ? "No zones match" : "No zones set up yet"}
                  </p>
                ) : (
                  filteredZones.map((z) => {
                    const id = zoneKey(z)
                    return (
                      <label key={id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={form.zoneIds.includes(id)}
                          onChange={() => toggleZone(id)}
                        />
                        <span className="text-slate-800">{z.name}</span>
                        {z.isActive === false ? <span className="text-xs text-slate-400">(inactive)</span> : null}
                      </label>
                    )
                  })
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Active</p>
                <p className="text-xs text-slate-500">An inactive cohort adds no zones to its riders.</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: Boolean(v) }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50">
            <button
              onClick={() => setEditing(null)}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {editing?.id || editing?._id ? "Save" : "Create"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
        <DialogContent className="max-w-md w-full rounded-xl p-0 overflow-hidden shadow-xl">
          <div className="px-5 py-4 border-b border-slate-200">
            <DialogTitle className="text-lg font-semibold text-slate-900">Delete cohort?</DialogTitle>
          </div>
          <div className="px-5 py-4 text-sm text-slate-600 space-y-2">
            <p>
              <span className="font-semibold text-slate-900">{pendingDelete?.name}</span> will be deleted.
            </p>
            {Number(pendingDelete?.riderCount) > 0 ? (
              <p>
                Its {pendingDelete.riderCount} rider(s) are kept but will have no cohort, so they serve only their home zone.
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
            <button
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
              className="px-4 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
