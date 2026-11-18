import { useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle2, Download, FileUp, Loader2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import { parseCsv, toCsv, downloadCsv } from "@food/utils/csv"

/**
 * Create many restaurants from a CSV. Each comes in as pending, without
 * documents: the owner logs in with OTP on their phone, completes onboarding,
 * and an admin approves it as usual.
 */
const TEMPLATE_COLUMNS = ["restaurantName", "ownerName", "ownerPhone", "ownerEmail", "zone", "city", "area", "address", "pincode", "latitude", "longitude", "cuisines"]
const SAMPLE = [{ restaurantName: "Sample Biryani House", ownerName: "Ravi Kumar", ownerPhone: "9876543210", ownerEmail: "", zone: "INDORE BRANCH", city: "Indore", area: "Vijay Nagar", address: "12 Scheme 54", pincode: "452010", latitude: "22.7533", longitude: "75.8937", cuisines: "Biryani|North Indian" }]

export default function RestaurantsBulkImport() {
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const downloadTemplate = () =>
    downloadCsv(toCsv(SAMPLE, TEMPLATE_COLUMNS.map((c) => ({ label: c, key: c }))), "restaurants-import-template.csv")

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!/\.csv$/i.test(file.name)) return toast.error("Choose a .csv file (Excel: File → Save as → CSV)")
    const parsed = parseCsv(await file.text())
    if (!parsed.length) return toast.error("The file has no rows under the header")
    if (parsed.length > 500) return toast.error("At most 500 restaurants per file")
    const missing = ["restaurantName", "ownerName", "ownerPhone", "zone"].filter((c) => !(c in parsed[0]))
    if (missing.length) return toast.error(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`)
    setRows(parsed)
    setFileName(file.name)
    setResult(null)
  }

  const run = async () => {
    setBusy(true)
    try {
      const res = await adminAPI.bulkImportRestaurants(rows)
      const data = res?.data?.data
      setResult(data)
      toast.success(`${data.created} created, ${data.failed} not created`)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Import failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FileUp className="w-6 h-6 text-orange-600" /> Bulk Import Restaurants</h1>
            <p className="text-sm text-slate-500 mt-1">Restaurants are created as <b>pending</b>. Owners log in with their phone, finish onboarding (documents, bank), and you approve them under <Link to="/admin/food/restaurants/joining-request" className="text-orange-600 font-medium hover:underline">Joining requests</Link>.</p>
          </div>
          <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold whitespace-nowrap"><Download className="w-4 h-4" />Template</button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <ol className="list-decimal pl-5 text-sm text-slate-600 space-y-1">
            <li>Download the template and fill one restaurant per row. <b>restaurantName, ownerName, ownerPhone</b> (10 digits) and <b>zone</b> (zone name as in Zone Setup) are required.</li>
            <li>cuisines: up to 3, separated by <code>|</code>. latitude/longitude pin the restaurant on the map; the owner can set it later if left empty.</li>
            <li>Upload the file, check the preview, and import.</li>
          </ol>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-sm text-slate-600 hover:border-orange-400">
            <FileUp className="w-5 h-5" />{fileName ? `${fileName} · ${rows.length} rows` : "Choose a CSV file"}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={pick} />
          </label>
          {rows.length > 0 && !result && (
            <div className="flex justify-end"><button type="button" disabled={busy} onClick={run} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? "Importing…" : `Import ${rows.length} restaurants`}</button></div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <h2 className="px-4 pt-4 font-semibold text-slate-900">{result ? `Result: ${result.created} created, ${result.failed} not created` : "Preview"}</h2>
            <table className="w-full text-sm mt-2">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Line</th><th className="px-3 py-2 text-left">Restaurant</th><th className="px-3 py-2 text-left">Owner</th><th className="px-3 py-2 text-left">Phone</th><th className="px-3 py-2 text-left">Zone</th>{result && <th className="px-3 py-2 text-left">Result</th>}</tr></thead>
              <tbody>{rows.slice(0, 500).map((r, i) => {
                const res = result?.results?.find((x) => x.line === i + 2)
                return (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-400">{i + 2}</td><td className="px-3 py-2">{r.restaurantName}</td><td className="px-3 py-2">{r.ownerName}</td><td className="px-3 py-2">{r.ownerPhone}</td><td className="px-3 py-2">{r.zone}</td>
                    {result && <td className="px-3 py-2">{res?.ok ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="w-4 h-4" />Created</span> : <span className="inline-flex items-center gap-1 text-red-600"><XCircle className="w-4 h-4" />{res?.reason || "Not created"}</span>}</td>}
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
