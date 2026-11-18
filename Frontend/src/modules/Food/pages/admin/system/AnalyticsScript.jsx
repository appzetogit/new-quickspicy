import { useEffect, useRef, useState } from "react"
import { Lightbulb, ChevronDown, Loader2 } from "lucide-react"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

const MARKETING_TOOLS = [
  { key: "googleAnalytics", name: "Google Analytics", idLabel: "Measurement ID", placeholder: "Ex: G-XXXXXXXXXX" },
  { key: "googleTagManager", name: "Google Tag Manager", idLabel: "Container ID", placeholder: "Ex: GTM-XXXXXXX" },
  { key: "linkedinInsightTag", name: "LinkedIn Insight Tag", idLabel: "Partner ID", placeholder: "Ex: 1234567" },
  { key: "metaPixel", name: "Meta Pixel", idLabel: "Pixel ID", placeholder: "Ex: 123456789012345" },
  { key: "pinterestPixel", name: "Pinterest Pixel", idLabel: "Tag ID", placeholder: "Ex: 2612345678901" },
  { key: "snapchatPixel", name: "Snapchat Pixel", idLabel: "Pixel ID", placeholder: "Ex: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
  { key: "tiktokPixel", name: "TikTok Pixel", idLabel: "Pixel ID", placeholder: "Ex: CXXXXXXXXXXXXXXXXXXX" },
  { key: "xPixel", name: "X (Twitter) Pixel", idLabel: "Pixel ID", placeholder: "Ex: oxxxx" },
]

const DEFAULTS = MARKETING_TOOLS.reduce((acc, tool) => {
  acc[tool.key] = { enabled: false, id: "" }
  return acc
}, {})

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

export default function AnalyticsScript() {
  const { value, setValue, save, loading, saving } = usePlatformSetting("analytics", DEFAULTS)
  const [expanded, setExpanded] = useState({})
  const loadedRef = useRef(DEFAULTS)

  useEffect(() => {
    if (!loading) loadedRef.current = value
    // Snapshot what the server returned once loading finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const setTool = (key, patch) => {
    setValue((prev) => ({ ...prev, [key]: { ...DEFAULTS[key], ...(prev[key] || {}), ...patch } }))
  }

  const handleToggle = (key) => {
    const current = value[key] || DEFAULTS[key]
    setTool(key, { enabled: !current.enabled })
    // Show the ID field when turning a tool on, so it can be filled in.
    if (!current.enabled) setExpanded((prev) => ({ ...prev, [key]: true }))
  }

  const handleSave = async () => {
    const ok = await save()
    if (ok) loadedRef.current = value
  }

  const handleReset = () => setValue(loadedRef.current)

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto max-w-6xl">
        {/* Page Title */}
        <div className="mb-3">
          <h1 className="text-lg font-bold text-slate-900">Marketing Tool</h1>
        </div>

        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-start gap-3">
          <Lightbulb className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-slate-700">
            In this page you can add credentials to show your analytics on the platform make sure fill with proper data other wise you can not see the analytics properly
          </p>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading settings...
          </div>
        ) : (
          <>
            {/* Marketing Tools Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {MARKETING_TOOLS.map((tool) => {
                const state = value[tool.key] || DEFAULTS[tool.key]
                const isOpen = !!expanded[tool.key]
                return (
                  <div key={tool.key} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-slate-900 mb-2">{tool.name}</h3>
                      <p className="text-xs text-slate-600">
                        Enter the {tool.idLabel} from your {tool.name} account under View, then switch it on.
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [tool.key]: !prev[tool.key] }))}
                        className="flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
                      >
                        <span>View</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                      <ToggleSwitch enabled={!!state.enabled} onToggle={() => handleToggle(tool.key)} />
                    </div>

                    {isOpen && (
                      <div className="mt-3">
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">{tool.idLabel}</label>
                        <input
                          type="text"
                          value={state.id || ""}
                          onChange={(e) => setTool(tool.key, { id: e.target.value })}
                          placeholder={tool.placeholder}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={handleReset}
                disabled={saving}
                className="px-4 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-1"
              >
                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
