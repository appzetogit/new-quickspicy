import { Monitor, Loader2 } from "lucide-react"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

// "reactLicenseSecret" is named so the server masks it on read and strips it
// from the public settings endpoint (react_site is a public settings key).
const DEFAULTS = {
  reactLicenseSecret: "",
  reactDomain: "",
}

const inputClass =
  "w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"

export default function ReactSite() {
  const { value, update, save, loading, saving } = usePlatformSetting("react_site", DEFAULTS)

  const handleSave = async (e) => {
    e.preventDefault()
    await save()
  }

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto max-w-5xl">
        {/* Page Title */}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-slate-600" />
            <h1 className="text-lg font-bold text-slate-900">React Site Setup</h1>
          </div>
        </div>

        {/* Form Section */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading settings...
            </div>
          ) : (
            <form onSubmit={handleSave}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">React License Code</label>
                  <input
                    type="text"
                    value={value.reactLicenseSecret || ""}
                    onChange={(e) => update("reactLicenseSecret", e.target.value)}
                    placeholder="React license code"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">React Domain</label>
                  <input
                    type="text"
                    value={value.reactDomain || ""}
                    onChange={(e) => update("reactDomain", e.target.value)}
                    placeholder="React Domain"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
