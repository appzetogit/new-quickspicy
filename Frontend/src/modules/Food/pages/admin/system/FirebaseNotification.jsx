import { useEffect, useRef, useState } from "react"
import { Cloud, Settings, Info, Loader2 } from "lucide-react"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

const NOTIFICATION_MESSAGES = [
  { key: "orderPending", label: "Order pending message", text: "Your order {orderId} is pending", enabled: true },
  { key: "orderConfirmation", label: "Order confirmation message", text: "Your order {orderId} has been confirmed", enabled: true },
  { key: "orderProcessing", label: "Order processing message", text: "Your order {orderId} is being processed", enabled: true },
  { key: "restaurantHandover", label: "Restaurant handover message", text: "Your order {orderId} has been handed over to restaurant {restaurantName}", enabled: true },
  { key: "orderOutForDelivery", label: "Order out for delivery message", text: "Your order {orderId} is out for delivery", enabled: true },
  { key: "orderDelivered", label: "Order delivered message", text: "Your order {orderId} has been delivered", enabled: true },
  { key: "deliverymanAssign", label: "Deliveryman assign message", text: "Deliveryman {userName} has been assigned to your order {orderId}", enabled: true },
  { key: "deliverymanDelivered", label: "Deliveryman delivered message", text: "Deliveryman {userName} has delivered your order {orderId}", enabled: true },
  { key: "orderCanceled", label: "Order canceled message", text: "Your order {orderId} has been canceled", enabled: true },
  { key: "orderRefunded", label: "Order refunded message", text: "Your order {orderId} has been refunded", enabled: true },
  { key: "orderRefundCancel", label: "Order Refund cancel message", text: "Refund for order {orderId} has been canceled", enabled: true },
  { key: "offlineOrderDeny", label: "Offline order deny message", text: "", placeholder: "Ex : Your offline payment is denied", enabled: false },
  { key: "offlineOrderAccept", label: "Offline order accept message", text: "", placeholder: "Ex : Your offline payment is accepted", enabled: false },
]

const DEFAULT_MESSAGES = NOTIFICATION_MESSAGES.reduce((acc, m) => {
  acc[m.key] = { enabled: m.enabled, text: m.text }
  return acc
}, {})

const DEFAULT_CONFIG = {
  // Service account JSON. Named "...Credential" so the server masks it on read
  // and strips it from the public settings endpoint.
  serviceAccountCredential: "",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  fcmProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "",
  // Realtime Database, for live rider tracking on the website.
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "",
}

const DEFAULTS = {
  messages: DEFAULT_MESSAGES,
  ...DEFAULT_CONFIG,
}

const CONFIG_FIELDS = [
  { key: "fcmProjectId", label: "FCM Project ID" },
  { key: "authDomain", label: "Auth Domain" },
  { key: "messagingSenderId", label: "Messaging Sender Id" },
  { key: "appId", label: "App Id" },
  { key: "storageBucket", label: "Storage Bucket" },
  { key: "measurementId", label: "Measurement Id", placeholder: "Ex: F-12345678" },
  { key: "databaseURL", label: "Realtime Database URL", placeholder: "https://your-project-default-rtdb.firebaseio.com" },
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

export default function FirebaseNotification() {
  const [activeTab, setActiveTab] = useState("push-notification")
  const { value, setValue, update, save, loading, saving } = usePlatformSetting("firebase", DEFAULTS)
  const loadedRef = useRef(DEFAULTS)

  useEffect(() => {
    if (!loading) loadedRef.current = value
    // Snapshot what the server returned once loading finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const messages = { ...DEFAULT_MESSAGES, ...(value.messages || {}) }

  const setMessage = (key, patch) => {
    setValue((prev) => {
      const current = { ...DEFAULT_MESSAGES, ...(prev.messages || {}) }
      return { ...prev, messages: { ...current, [key]: { ...current[key], ...patch } } }
    })
  }

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    const ok = await save()
    if (ok) loadedRef.current = value
  }

  const handleReset = () => {
    setValue((prev) => ({ ...prev, messages: loadedRef.current.messages || DEFAULT_MESSAGES }))
  }

  const saveLabel = (
    <>
      {saving && <Loader2 className="w-3 h-3 animate-spin" />}
      {saving ? "Saving..." : "Submit"}
    </>
  )

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto max-w-6xl">
        {/* Page Title */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
                <Cloud className="w-3.5 h-3.5 text-white" />
              </div>
              <h1 className="text-lg font-bold text-slate-900">Firebase Push Notification Setup</h1>
            </div>
            {activeTab === "push-notification" && (
              <a
                href="https://firebase.google.com/docs/cloud-messaging"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                Read Documentation
                <Info className="w-3 h-3" />
              </a>
            )}
            {activeTab === "firebase-configuration" && (
              <a
                href="https://console.firebase.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                Where to get this information
                <Info className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Primary Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-2 mb-3">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("push-notification")}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                activeTab === "push-notification"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Push Notification</span>
            </button>
            <button
              onClick={() => setActiveTab("firebase-configuration")}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                activeTab === "firebase-configuration"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <Settings className="w-3.5 h-3.5" />
              <span>Firebase Configuration</span>
            </button>
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading settings...
          </div>
        )}

        {/* Push Notification Tab Content */}
        {!loading && activeTab === "push-notification" && (
          <div className="space-y-3">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <div className="space-y-4">
                {NOTIFICATION_MESSAGES.map((m) => {
                  const msg = messages[m.key] || { enabled: m.enabled, text: m.text }
                  return (
                    <div key={m.key} className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <label className="text-xs font-semibold text-slate-700 flex-1">{m.label}</label>
                        <ToggleSwitch
                          enabled={!!msg.enabled}
                          onToggle={() => setMessage(m.key, { enabled: !msg.enabled })}
                        />
                      </div>
                      <textarea
                        value={msg.text || ""}
                        onChange={(e) => setMessage(m.key, { text: e.target.value })}
                        rows={2}
                        className={`${inputClass} resize-none`}
                        placeholder={m.placeholder || "Enter notification message"}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Firebase Configuration Tab Content */}
        {!loading && activeTab === "firebase-configuration" && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <form onSubmit={handleSubmit}>
              {/* Service File Content */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                  Service File Content
                  <Info className="w-3 h-3 text-slate-400" />
                </label>
                <textarea
                  value={value.serviceAccountCredential || ""}
                  onChange={(e) => update("serviceAccountCredential", e.target.value)}
                  rows={6}
                  placeholder="Paste your Firebase service file content here"
                  className={`${inputClass} resize-none font-mono`}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Stored securely on the server; only the last 4 characters are shown after saving.
                </p>
              </div>

              {/* API Key */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Api Key</label>
                <input
                  type="text"
                  value={value.apiKey || ""}
                  onChange={(e) => update("apiKey", e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* Firebase Configuration Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {CONFIG_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{f.label}</label>
                    <input
                      type="text"
                      value={value[f.key] || ""}
                      onChange={(e) => update(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>

              {/* Submit Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-1"
                >
                  {saveLabel}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Action Buttons (for Push Notification tab) */}
        {!loading && activeTab === "push-notification" && (
          <div className="flex justify-end gap-2 mt-3">
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
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-1"
            >
              {saveLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
