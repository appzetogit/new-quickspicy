import { useEffect, useRef } from "react"
import { Settings, Info, Smartphone, Apple, Loader2 } from "lucide-react"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

const EMPTY_VERSION = { minVersion: "", downloadUrl: "" }

const DEFAULTS = {
  generalSettings: {
    popularFoods: true,
    newRestaurants: true,
    popularRestaurants: true,
    mostReviewedFoods: true,
  },
  userAppAndroid: { ...EMPTY_VERSION },
  userAppIOS: { ...EMPTY_VERSION },
  restaurantAppAndroid: { ...EMPTY_VERSION },
  restaurantAppIOS: { ...EMPTY_VERSION },
  deliverymanAppAndroid: { ...EMPTY_VERSION },
  deliverymanAppIOS: { ...EMPTY_VERSION },
}

const GENERAL_TOGGLES = [
  { key: "popularFoods", label: "Popular Foods" },
  { key: "newRestaurants", label: "New Restaurants" },
  { key: "popularRestaurants", label: "Popular Restaurants" },
  { key: "mostReviewedFoods", label: "Most Reviewed Foods" },
]

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

function SectionButtons({ onReset, onSubmit, saving }) {
  return (
    <div className="flex justify-end gap-2 mt-4">
      <button
        type="button"
        onClick={onReset}
        disabled={saving}
        className="px-4 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving}
        className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-1"
      >
        {saving && <Loader2 className="w-3 h-3 animate-spin" />}
        {saving ? "Saving..." : "Submit"}
      </button>
    </div>
  )
}

function VersionSection({ title, appName, android, ios, onChange, onReset, onSubmit, saving, className }) {
  const platforms = [
    { group: android, label: "For Android", suffix: "Android", icon: <Smartphone className="w-4 h-4 text-green-600" /> },
    { group: ios, label: "For IOS", suffix: "Ios", icon: <Apple className="w-4 h-4 text-slate-700" /> },
  ]
  return (
    <div className={`bg-white rounded-lg shadow-sm border border-slate-200 p-4 ${className || ""}`}>
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4 text-slate-600" />
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>

      <div className="space-y-4">
        {platforms.map(({ group, label, suffix, icon }) => (
          <div key={suffix}>
            <div className="flex items-center gap-2 mb-3">
              {icon}
              <span className="text-xs font-semibold text-slate-700">{label}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                  Minimum {appName} Version for Force Update ({suffix})
                  <Info className="w-3 h-3 text-slate-400" />
                </label>
                <input
                  type="text"
                  value={group.value.minVersion || ""}
                  onChange={(e) => onChange(group.name, "minVersion", e.target.value)}
                  placeholder="App minimum version"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                  Download URL for {appName} ({suffix})
                  <Info className="w-3 h-3 text-slate-400" />
                </label>
                <input
                  type="text"
                  value={group.value.downloadUrl || ""}
                  onChange={(e) => onChange(group.name, "downloadUrl", e.target.value)}
                  placeholder="Download Url"
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <SectionButtons onReset={onReset} onSubmit={onSubmit} saving={saving} />
    </div>
  )
}

export default function AppWebSettings() {
  const { value, setValue, save, loading, saving } = usePlatformSetting("app_web", DEFAULTS)
  const loadedRef = useRef(DEFAULTS)

  useEffect(() => {
    if (!loading) loadedRef.current = value
    // Only snapshot what the server returned when loading finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const setGroupField = (group, field, fieldValue) => {
    setValue((prev) => ({ ...prev, [group]: { ...(prev[group] || {}), [field]: fieldValue } }))
  }

  const handleGeneralToggle = (key) => {
    setValue((prev) => ({
      ...prev,
      generalSettings: { ...prev.generalSettings, [key]: !prev.generalSettings?.[key] },
    }))
  }

  const resetGroups = (...groups) => {
    setValue((prev) => {
      const next = { ...prev }
      groups.forEach((g) => {
        next[g] = loadedRef.current[g] ?? DEFAULTS[g]
      })
      return next
    })
  }

  const handleSave = async () => {
    const ok = await save()
    if (ok) loadedRef.current = value
  }

  const group = (name) => ({ name, value: value[name] || EMPTY_VERSION })
  const general = value.generalSettings || DEFAULTS.generalSettings

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto max-w-6xl">
        {/* Page Title */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
              <Settings className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">App & Web Settings</h1>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading settings...
          </div>
        ) : (
          <>
            {/* General Web Settings */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-3">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">General Web Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {GENERAL_TOGGLES.map((t) => (
                  <div key={t.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-700">{t.label}</span>
                      <Info className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <ToggleSwitch enabled={!!general[t.key]} onToggle={() => handleGeneralToggle(t.key)} />
                  </div>
                ))}
              </div>
              <SectionButtons
                onReset={() => resetGroups("generalSettings")}
                onSubmit={handleSave}
                saving={saving}
              />
            </div>

            <VersionSection
              title="User App Version Control"
              appName="User App"
              android={group("userAppAndroid")}
              ios={group("userAppIOS")}
              onChange={setGroupField}
              onReset={() => resetGroups("userAppAndroid", "userAppIOS")}
              onSubmit={handleSave}
              saving={saving}
              className="mb-3"
            />

            <VersionSection
              title="Restaurant App Version Control"
              appName="Restaurant App"
              android={group("restaurantAppAndroid")}
              ios={group("restaurantAppIOS")}
              onChange={setGroupField}
              onReset={() => resetGroups("restaurantAppAndroid", "restaurantAppIOS")}
              onSubmit={handleSave}
              saving={saving}
              className="mb-3"
            />

            <VersionSection
              title="Deliveryman App Version Control"
              appName="Deliveryman App"
              android={group("deliverymanAppAndroid")}
              ios={group("deliverymanAppIOS")}
              onChange={setGroupField}
              onReset={() => resetGroups("deliverymanAppAndroid", "deliverymanAppIOS")}
              onSubmit={handleSave}
              saving={saving}
            />
          </>
        )}
      </div>
    </div>
  )
}
