import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

const addons = [
  {
    key: "restaurant_app",
    title: "Restaurant app",
    description: "With this app your vendor will mange their business through mobile app",
  },
  {
    key: "deliveryman_app",
    title: "Deliveryman app",
    description: "With this app your all your deliveryman will mange their orders through mobile app",
  },
  {
    key: "react_user_website",
    title: "React user website",
    description: "With this react website your customers will experience your system in a more attractive and seamless way",
  },
]

const DEFAULTS = {
  restaurant_app: true,
  deliveryman_app: false,
  react_user_website: false,
}

function ToggleSwitch({ enabled, onToggle, disabled }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`inline-flex items-center w-11 h-6 rounded-full border transition-all disabled:opacity-60 ${
        enabled
          ? "bg-blue-600 border-blue-600 justify-end"
          : "bg-slate-200 border-slate-300 justify-start"
      }`}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
    </button>
  )
}

export default function AddonActivation() {
  const { value, save, loading, saving } = usePlatformSetting("addon_activation", DEFAULTS)

  const handleToggle = (key) => {
    const next = { ...value, [key]: !value[key] }
    save(next, { successMessage: `${addons.find(a => a.key === key)?.title || "Add-on"} ${next[key] ? "activated" : "deactivated"}` })
  }

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto max-w-5xl">
        {/* Page Title */}
        <div className="mb-4">
          <h1 className="text-lg font-bold text-slate-900">Add on activation</h1>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 text-xs text-slate-500">
            Loading...
          </div>
        ) : (
          <div className="space-y-3">
            {addons.map((addon) => (
              <div
                key={addon.key}
                className="bg-white rounded-lg shadow-sm border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Title and Description */}
                  <div className="flex-1">
                    <h2 className="text-sm font-semibold text-slate-900 mb-1">
                      {addon.title}
                    </h2>
                    <p className="text-xs text-slate-600">
                      {addon.description}
                    </p>
                  </div>

                  {/* Right: Toggle */}
                  <div className="flex items-center gap-3">
                    <ToggleSwitch
                      enabled={!!value[addon.key]}
                      disabled={saving}
                      onToggle={() => handleToggle(addon.key)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
