import { useEffect, useState } from "react"
import { Settings, Eye, EyeOff, CheckCircle, XCircle } from "lucide-react"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

const thirdPartyServices = [
  {
    id: "stripe",
    name: "Stripe",
    category: "Payment Gateway",
    description: "Online payment processing",
    fields: [
      { key: "publishableKey", label: "Publishable Key", type: "password" },
      { key: "secretKey", label: "Secret Key", type: "password" }
    ]
  },
  {
    id: "paypal",
    name: "PayPal",
    category: "Payment Gateway",
    description: "PayPal payment integration",
    fields: [
      { key: "clientId", label: "Client ID", type: "text" },
      { key: "clientSecret", label: "Client Secret", type: "password" }
    ]
  },
  {
    id: "razorpay",
    name: "Razorpay",
    category: "Payment Gateway",
    description: "Online payments, wallet top-ups and refunds. Used when the server has no Razorpay keys of its own. Test keys start rzp_test_, live keys rzp_live_.",
    fields: [
      { key: "keyId", label: "Key ID", type: "text" },
      { key: "keySecret", label: "Key Secret", type: "password" },
      { key: "webhookSecret", label: "Webhook Secret (Razorpay → Settings → Webhooks, URL https://api-new.quickspicy.in/api/v1/payments/webhook/razorpay)", type: "password" }
    ]
  },
  {
    id: "sms_india_hub",
    name: "SMS India Hub",
    category: "SMS Service",
    description: "Sends login OTPs. Used first when switched on. The message must match your registered DLT template exactly; put {otp} where the code goes.",
    fields: [
      { key: "username", label: "Username", type: "text" },
      { key: "apiKey", label: "API Key", type: "password" },
      { key: "senderId", label: "Sender ID", type: "text" },
      { key: "dltTemplateId", label: "DLT Template ID", type: "text" },
      { key: "messageTemplate", label: "OTP message (with {otp})", type: "text" }
    ]
  },
  {
    id: "twilio",
    name: "Twilio",
    category: "SMS Service",
    description: "Sends login OTPs when SMS India Hub is not set up.",
    fields: [
      { key: "accountSid", label: "Account SID", type: "text" },
      { key: "authToken", label: "Auth Token", type: "password" },
      { key: "phoneNumber", label: "Phone Number", type: "text" },
      { key: "messageTemplate", label: "OTP message (with {otp})", type: "text" }
    ]
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    category: "Email Service",
    description: "Transactional email service",
    fields: [
      { key: "apiKey", label: "API Key", type: "password" },
      { key: "fromEmail", label: "From Email", type: "email" }
    ]
  },
  {
    id: "google_maps",
    name: "Google Maps",
    category: "Map Service",
    description: "Google Maps API integration",
    fields: [
      { key: "apiKey", label: "API Key", type: "password" }
    ]
  },
  {
    id: "aws_s3",
    name: "AWS S3",
    category: "Storage Service",
    description: "Amazon S3 file storage",
    fields: [
      { key: "accessKeyId", label: "Access Key ID", type: "text" },
      { key: "secretAccessKey", label: "Secret Access Key", type: "password" },
      { key: "bucketName", label: "Bucket Name", type: "text" },
      { key: "region", label: "Region", type: "text" }
    ]
  }
]

// One entry per service: { enabled, ...fieldValues }
const DEFAULTS = thirdPartyServices.reduce((acc, service) => {
  acc[service.id] = service.fields.reduce(
    (fields, field) => ({ ...fields, [field.key]: "" }),
    { enabled: false }
  )
  return acc
}, {})

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

export default function ThirdParty() {
  const { value, setValue, save, loading, saving } = usePlatformSetting("third_party", DEFAULTS)
  const [saved, setSaved] = useState(DEFAULTS)
  const [expandedService, setExpandedService] = useState(null)
  const [visibleFields, setVisibleFields] = useState({})

  // Remember the last stored state so Reset can return to it.
  useEffect(() => {
    if (!loading) setSaved(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const serviceValue = (serviceId) => ({ ...DEFAULTS[serviceId], ...(value[serviceId] || {}) })
  const savedServiceValue = (serviceId) => ({ ...DEFAULTS[serviceId], ...(saved[serviceId] || {}) })

  const isConfigured = (service) => {
    const stored = savedServiceValue(service.id)
    return service.fields.some(field => String(stored[field.key] || "").trim() !== "")
  }

  const persist = async (next, successMessage) => {
    const ok = await save(next, { successMessage })
    if (ok) setSaved(next)
    return ok
  }

  const handleToggle = (service) => {
    // Only the stored state of this service changes; unsaved edits in other services stay local.
    const current = savedServiceValue(service.id)
    const nextService = { ...current, enabled: !current.enabled }
    const next = { ...saved, [service.id]: nextService }
    persist(next, `${service.name} ${nextService.enabled ? "enabled" : "disabled"}`).then(ok => {
      if (ok) {
        setValue(prev => ({ ...prev, [service.id]: { ...serviceValue(service.id), enabled: nextService.enabled } }))
      }
    })
  }

  const handleFieldChange = (serviceId, fieldKey, fieldValue) => {
    setValue(prev => ({
      ...prev,
      [serviceId]: { ...DEFAULTS[serviceId], ...(prev[serviceId] || {}), [fieldKey]: fieldValue }
    }))
  }

  const toggleFieldVisibility = (serviceId, fieldKey) => {
    const key = `${serviceId}-${fieldKey}`
    setVisibleFields(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const handleSave = (service) => {
    const next = { ...saved, [service.id]: serviceValue(service.id) }
    persist(next, `${service.name} configuration saved`)
  }

  const handleReset = (serviceId) => {
    setValue(prev => ({ ...prev, [serviceId]: savedServiceValue(serviceId) }))
  }

  const categories = [...new Set(thirdPartyServices.map(s => s.category))]

  return (
    <div className="p-2 lg:p-3 bg-slate-50 min-h-screen">
      <div className="w-full mx-auto max-w-6xl">
        {/* Page Title */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center">
              <Settings className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">3rd Party Configuration</h1>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 text-xs text-slate-500">
            Loading...
          </div>
        ) : (
          <div className="space-y-4">
            {categories.map((category) => {
              const categoryServices = thirdPartyServices.filter(s => s.category === category)
              return (
                <div key={category} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                  <h2 className="text-sm font-semibold text-slate-900 mb-3">{category}</h2>
                  <div className="space-y-3">
                    {categoryServices.map((service) => {
                      const current = serviceValue(service.id)
                      const configured = isConfigured(service)
                      return (
                        <div
                          key={service.id}
                          className="border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition-colors"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-xs font-semibold text-slate-900">{service.name}</h3>
                                <div className="flex items-center gap-1">
                                  {configured ? (
                                    <>
                                      <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                                      <span className="text-[10px] text-green-600">Configured</span>
                                    </>
                                  ) : (
                                    <>
                                      <XCircle className="w-3.5 h-3.5 text-red-600" />
                                      <span className="text-[10px] text-red-600">Not Configured</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <p className="text-[10px] text-slate-600">{service.description}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <ToggleSwitch
                                enabled={!!savedServiceValue(service.id).enabled}
                                disabled={saving}
                                onToggle={() => handleToggle(service)}
                              />
                              <button
                                type="button"
                                onClick={() => setExpandedService(expandedService === service.id ? null : service.id)}
                                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                              >
                                {expandedService === service.id ? "Hide" : "Configure"}
                              </button>
                            </div>
                          </div>

                          {/* Configuration Fields */}
                          {expandedService === service.id && (
                            <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
                              {service.fields.map((field) => {
                                const fieldKey = `${service.id}-${field.key}`
                                const isPassword = field.type === "password"
                                const isVisible = visibleFields[fieldKey]
                                const fieldValue = current[field.key] ?? ""

                                return (
                                  <div key={field.key}>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                      {field.label}
                                    </label>
                                    <div className="relative">
                                      <input
                                        type={isPassword && !isVisible ? "password" : field.type === "email" ? "email" : "text"}
                                        value={fieldValue}
                                        onChange={(e) => handleFieldChange(service.id, field.key, e.target.value)}
                                        placeholder={`Enter ${field.label.toLowerCase()}`}
                                        className="w-full px-3 py-2 pr-10 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      />
                                      {isPassword && (
                                        <button
                                          type="button"
                                          onClick={() => toggleFieldVisibility(service.id, field.key)}
                                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                                        >
                                          {isVisible ? (
                                            <EyeOff className="w-3.5 h-3.5" />
                                          ) : (
                                            <Eye className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                              <div className="flex justify-end gap-2 pt-2">
                                <button
                                  type="button"
                                  onClick={() => handleReset(service.id)}
                                  disabled={saving}
                                  className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
                                >
                                  Reset
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSave(service)}
                                  disabled={saving}
                                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
                                >
                                  {saving ? "Saving..." : "Save"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
