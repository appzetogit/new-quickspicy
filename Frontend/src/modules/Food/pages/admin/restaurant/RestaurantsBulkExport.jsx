import { useState } from "react"
import { Download, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import { toCsv, downloadCsv } from "@food/utils/csv"
import { toDayInput } from "@food/utils/dayInput"

/** Every restaurant (or one status) as a CSV, in the same columns Bulk Import reads. */
const COLUMNS = [
  { label: "restaurantName", key: "restaurantName" },
  { label: "ownerName", key: "ownerName" },
  { label: "ownerPhone", key: "ownerPhone" },
  { label: "ownerEmail", key: "ownerEmail" },
  { label: "zone", value: (r) => r.zone?.name || r.zoneName || r.zone || "" },
  { label: "city", value: (r) => r.location?.city || r.city || "" },
  { label: "area", value: (r) => r.location?.area || r.area || "" },
  { label: "address", value: (r) => r.location?.formattedAddress || r.address || "" },
  { label: "pincode", value: (r) => r.location?.pincode || r.pincode || "" },
  { label: "latitude", value: (r) => r.location?.latitude ?? r.latitude ?? "" },
  { label: "longitude", value: (r) => r.location?.longitude ?? r.longitude ?? "" },
  { label: "cuisines", value: (r) => (Array.isArray(r.cuisines) ? r.cuisines.join("|") : "") },
  { label: "status", key: "status" },
  { label: "rating", key: "rating" },
  { label: "id", value: (r) => r.id || r._id },
]

export default function RestaurantsBulkExport() {
  const [status, setStatus] = useState("all")
  const [busy, setBusy] = useState(false)

  const exportAll = async () => {
    setBusy(true)
    try {
      const all = []
      for (let page = 1; page <= 50; page++) {
        const res = await adminAPI.getRestaurants({ page, limit: 500, ...(status !== "all" ? { status } : {}) })
        const batch = res?.data?.data?.restaurants || []
        all.push(...batch)
        if (batch.length < 500) break
      }
      if (!all.length) return toast.error("No restaurants to export")
      downloadCsv(toCsv(all, COLUMNS), `restaurants-${status}-${toDayInput(new Date())}.csv`)
      toast.success(`Exported ${all.length} restaurants`)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Export failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FileSpreadsheet className="w-6 h-6 text-orange-600" /> Export Restaurants</h1>
          <p className="text-sm text-slate-500 mt-1">A CSV of your restaurants, in the same columns Bulk Import reads, so a file can be edited and imported again.</p>
        </div>
        <label className="block text-sm font-medium text-slate-700">Which restaurants
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="all">All</option><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={exportAll} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          <Download className="w-4 h-4" />{busy ? "Exporting…" : "Download CSV"}
        </button>
      </div>
    </div>
  )
}
