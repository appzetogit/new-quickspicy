import { useEffect, useRef, useState } from "react"
import { Bot, Settings, Store, Loader2 } from "lucide-react"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

const DEFAULTS = {
  enabled: true,
  apiKey: "",
  organization: "",
  sectionWiseLimit: "60",
  imageUploadLimit: "20",
}

const inputClass =
  "w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"

function ToggleSwitch({ enabled, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center w-11 h-6 rounded-full border transition-all ${
        enabled
          ? "bg-blue-600 border-blue-600 justify-end"
          : "bg-slate-200 border-slate-300 justify-start"
      }`}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
    </button>
  )
}

export default function AISetup() {
  const [activeTab, setActiveTab] = useState("ai-configuration")
  const { value, setValue, update, save, loading, saving } = usePlatformSetting("ai", DEFAULTS)
  const loadedRef = useRef(DEFAULTS)

  useEffect(() => {
    if (!loading) loadedRef.current = value
    // Snapshot what the server returned once loading finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const resetFields = (...fields) => {
    setValue((prev) => {
      const next = { ...prev }
      fields.forEach((f) => {
        next[f] = loadedRef.current[f] ?? DEFAULTS[f]
      })
      return next
    })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    const ok = await save()
    if (ok) loadedRef.current = value
  }

  const saveButton = (label) => (
    <button
      type="submit"
      disabled={saving}
      className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-1"
    >
      {saving && <Loader2 className="w-3 h-3 animate-spin" />}
      {saving ? "Saving..." : label}
    </button>
  )

  const resetButton = (onClick) => (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="px-4 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
    >
      Reset
    </button>
  )

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto max-w-5xl">
        {/* Page Title */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">OpenAI Configuration</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-2 mb-3">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("ai-configuration")}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "ai-configuration"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              AI Configuration
            </button>
            <button
              onClick={() => setActiveTab("ai-settings")}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "ai-settings"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              AI Settings
            </button>
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading settings...
          </div>
        )}

        {/* AI Configuration Content */}
        {!loading && activeTab === "ai-configuration" && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-semibold text-slate-900">OpenAI Configuration</h2>
            </div>

            <form onSubmit={handleSave}>
              {/* Toggle Switch */}
              <div className="flex items-center justify-between mb-4 p-3 bg-slate-50 rounded-lg">
                <span className="text-xs font-medium text-slate-700">
                  {value.enabled ? "AI features are ON" : "AI features are OFF"}
                </span>
                <ToggleSwitch enabled={!!value.enabled} onToggle={() => update("enabled", !value.enabled)} />
              </div>

              {/* API Key Input */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">OpenAI API Key</label>
                <input
                  type="text"
                  value={value.apiKey || ""}
                  onChange={(e) => update("apiKey", e.target.value)}
                  placeholder="Ex: sk-proj-K0LhsdcbHJ......."
                  className={inputClass}
                />
              </div>

              {/* Organization Input */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">OpenAI Organization</label>
                <input
                  type="text"
                  value={value.organization || ""}
                  onChange={(e) => update("organization", e.target.value)}
                  placeholder="Ex: org-xxxxxxxxxxxx"
                  className={inputClass}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2">
                {resetButton(() => resetFields("enabled", "apiKey", "organization"))}
                {saveButton("Save")}
              </div>
            </form>
          </div>
        )}

        {/* AI Settings Content */}
        {!loading && activeTab === "ai-settings" && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <form onSubmit={handleSave}>
              {/* Restaurant Limits Section */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <Store className="w-4 h-4 text-slate-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Restaurant Limits On Using AI</h2>
                </div>

                {/* Section Wise Data Generation */}
                <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-xs text-slate-600 mb-3">
                    Set how many times AI can generate data for each element of the restaurant panel or app.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Section Wise Data Generation Limit
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={value.sectionWiseLimit ?? ""}
                      onChange={(e) => update("sectionWiseLimit", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Image Based Data Generation */}
                <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-xs text-slate-600 mb-3">
                    Set how many times AI can generate data from an image upload.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Image Upload Generation Limit
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={value.imageUploadLimit ?? ""}
                      onChange={(e) => update("imageUploadLimit", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2">
                {resetButton(() => resetFields("sectionWiseLimit", "imageUploadLimit"))}
                {saveButton("Save Information")}
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
