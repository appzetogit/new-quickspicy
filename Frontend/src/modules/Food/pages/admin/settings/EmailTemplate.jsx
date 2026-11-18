import { useEffect, useRef, useState } from "react"
import {
  Info,
  Folder,
  Facebook,
  Instagram,
  Twitter,
  Linkedin,
  Save,
  RotateCcw,
  Loader2,
  X
} from "lucide-react"
import { toast } from "sonner"
import { uploadAPI } from "@food/api"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

const UPLOAD_FOLDER = "quickspicy/admin/email-templates"

const COMMON_FOOTER = {
  pageLinks: {
    privacyPolicy: true,
    refundPolicy: true,
    cancellationPolicy: true,
    contactUs: true
  },
  socialMediaLinks: {
    facebook: true,
    instagram: true,
    twitter: true,
    linkedin: true,
    pinterest: true
  },
  copyrightContent: "© Quick Spicy. All rights reserved."
}

// Template-specific default data, keyed by template id.
const TEMPLATE_DEFAULTS = {
  "forgot-password": {
    enabled: true,
    icon: "",
    mainTitle: "Change Password Request",
    mailBody: "The following user has forgotten his password & requested to change/reset their password. User Name: {userName}",
    footerText: "Footer Text Please contact us for any queries; we're always happy to help.",
    ...COMMON_FOOTER
  },
  "new-restaurant": {
    enabled: true,
    icon: "",
    mainTitle: "New Restaurant Registration",
    mailBody: "A new restaurant has been registered on the platform. Restaurant Name: {restaurantName}, Owner: {ownerName}, Email: {email}, Phone: {phone}",
    footerText: "Please review and approve the restaurant registration. Contact us for any queries.",
    ...COMMON_FOOTER
  },
  "new-deliveryman": {
    enabled: true,
    icon: "",
    mainTitle: "New Deliveryman Registration",
    mailBody: "A new deliveryman has registered on the platform. Name: {deliverymanName}, Email: {email}, Phone: {phone}, Vehicle Type: {vehicleType}",
    footerText: "Please review and approve the deliveryman registration. Contact us for any queries.",
    ...COMMON_FOOTER
  },
  "withdraw-request": {
    enabled: true,
    icon: "",
    mainTitle: "Withdraw Request",
    mailBody: "A withdraw request has been submitted. Request ID: {requestId}, Amount: {amount}, Requested By: {requestedBy}, Account Details: {accountDetails}",
    footerText: "Please process the withdraw request. Contact us for any queries.",
    ...COMMON_FOOTER
  },
  "campaign-join": {
    enabled: true,
    icon: "",
    mainTitle: "Campaign Join Request",
    mailBody: "A new campaign join request has been received. Campaign: {campaignName}, Restaurant: {restaurantName}, Requested By: {requestedBy}",
    footerText: "Please review and approve the campaign join request. Contact us for any queries.",
    ...COMMON_FOOTER
  },
  "refund-request": {
    enabled: true,
    icon: "",
    mainTitle: "Refund Request",
    mailBody: "A refund request has been submitted. Order ID: {orderId}, Amount: {amount}, Customer: {customerName}, Reason: {reason}",
    footerText: "Please process the refund request. Contact us for any queries.",
    ...COMMON_FOOTER
  },
  "new-advertisement": {
    enabled: true,
    icon: "",
    mainTitle: "New Advertisement",
    mailBody: "A new advertisement has been created. Ad Title: {adTitle}, Advertiser: {advertiserName}, Start Date: {startDate}, End Date: {endDate}",
    footerText: "Please review the advertisement details. Contact us for any queries.",
    ...COMMON_FOOTER
  }
}

const DEFAULTS = { templates: TEMPLATE_DEFAULTS }

const templates = [
  { id: "forgot-password", label: "Forgot Password", toggleLabel: "Send Mail On Forget Password" },
  { id: "new-restaurant", label: "New Restaurant Registration", toggleLabel: "Send Mail On New Restaurant Registration" },
  { id: "new-deliveryman", label: "New Deliveryman Registration", toggleLabel: "Send Mail On New Deliveryman Registration" },
  { id: "withdraw-request", label: "Withdraw Request", toggleLabel: "Send Mail On Withdraw Request" },
  { id: "campaign-join", label: "Campaign Join Request", toggleLabel: "Send Mail On Campaign Join Request" },
  { id: "refund-request", label: "Refund Request", toggleLabel: "Send Mail On Refund Request" },
  { id: "new-advertisement", label: "New Advertisement", toggleLabel: "Send Mail On New Advertisement" }
]

// Placeholder values used only to render the preview.
const PREVIEW_VALUES = {
  userName: "John Doe",
  restaurantName: "Sample Restaurant",
  ownerName: "Jane Smith",
  email: "owner@example.com",
  phone: "+911234567890",
  deliverymanName: "Mike Johnson",
  vehicleType: "Motorcycle",
  requestId: "REQ-12345",
  amount: "₹500.00",
  requestedBy: "Restaurant Owner",
  accountDetails: "Account: ****1234",
  campaignName: "Summer Special",
  orderId: "ORD-100156",
  customerName: "John Doe",
  reason: "Order not delivered",
  adTitle: "Summer Promotion",
  advertiserName: "Food Company",
  startDate: "2024-06-01",
  endDate: "2024-08-31"
}

const mergeTemplate = (id, stored) => {
  const base = TEMPLATE_DEFAULTS[id] || TEMPLATE_DEFAULTS["forgot-password"]
  const saved = stored && typeof stored === "object" ? stored : {}
  return {
    ...base,
    ...saved,
    pageLinks: { ...base.pageLinks, ...(saved.pageLinks || {}) },
    socialMediaLinks: { ...base.socialMediaLinks, ...(saved.socialMediaLinks || {}) }
  }
}

export default function EmailTemplate() {
  const [activeTemplate, setActiveTemplate] = useState("forgot-password")
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const { value, setValue, save, loading, saving } = usePlatformSetting("email_templates", DEFAULTS)
  // Last value loaded from (or saved to) the server, for Reset.
  const loadedRef = useRef(DEFAULTS)
  useEffect(() => {
    if (!loading) loadedRef.current = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const formData = mergeTemplate(activeTemplate, value.templates?.[activeTemplate])
  const sendMailEnabled = formData.enabled !== false

  const setTemplate = (patch) => {
    setValue(prev => ({
      ...prev,
      templates: {
        ...(prev.templates || {}),
        [activeTemplate]: { ...mergeTemplate(activeTemplate, prev.templates?.[activeTemplate]), ...patch }
      }
    }))
  }

  const handleInputChange = (field, fieldValue) => {
    setTemplate({ [field]: fieldValue })
  }

  const handleCheckboxChange = (section, field, checked) => {
    setTemplate({ [section]: { ...formData[section], [field]: checked } })
  }

  // The icon goes to the media store; only its URL is kept in the settings.
  const handleFileUpload = async (field, file) => {
    if (!file) return
    setUploadingIcon(true)
    try {
      const res = await uploadAPI.uploadMedia(file, { folder: UPLOAD_FOLDER })
      const url = res?.data?.data?.url
      if (!url) throw new Error("No URL returned")
      setTemplate({ [field]: url })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not upload the icon")
    } finally {
      setUploadingIcon(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const ok = await save(undefined, { successMessage: "Email templates saved" })
    if (ok) loadedRef.current = value
  }

  const handleTemplateChange = (templateId) => {
    setActiveTemplate(templateId)
  }

  const handleReset = () => {
    setValue(loadedRef.current)
  }

  // Preview text with sample values filled in; escaped because it is rendered as HTML.
  const getPreviewHtml = () => {
    const escape = (s) => String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
    const filled = String(formData.mailBody || "").replace(/{(\w+)}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(PREVIEW_VALUES, name) ? PREVIEW_VALUES[name] : match
    )
    return filled.split("\n").map(line => `<p>${escape(line)}</p>`).join("")
  }

  const activeTemplateMeta = templates.find(t => t.id === activeTemplate)

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-6 flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Email Templates</h1>
          {loading && <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />}
        </div>

        {/* Template Navigation */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateChange(template.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTemplate === template.id
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {template.label}
              </button>
            ))}
          </div>

          {/* Toggle Switch */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-slate-700">
                {activeTemplateMeta?.toggleLabel}
              </label>
              <Info className="w-4 h-4 text-slate-400" />
            </div>
            <button
              type="button"
              onClick={() => setTemplate({ enabled: !sendMailEnabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                sendMailEnabled ? "bg-blue-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  sendMailEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Main Content - Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Email Preview */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center overflow-hidden">
                {formData.icon ? (
                  <img src={formData.icon} alt="" className="w-full h-full object-contain" />
                ) : (
                  <Folder className="w-6 h-6 text-orange-600" />
                )}
              </div>
              <h2 className="text-lg font-bold text-slate-900">{formData.mainTitle}</h2>
            </div>

            <div className="space-y-4 text-sm text-slate-700">
              <div dangerouslySetInnerHTML={{ __html: getPreviewHtml() }} />
            </div>

            <div className="mt-8 pt-6 border-t border-slate-200">
              <p className="text-sm text-slate-600 mb-4">
                {formData.footerText} Thanks & Regards, Quick Spicy
              </p>

              {/* Page Links */}
              {(formData.pageLinks.privacyPolicy ||
                formData.pageLinks.refundPolicy ||
                formData.pageLinks.cancellationPolicy ||
                formData.pageLinks.contactUs) && (
                <div className="flex flex-wrap gap-2 mb-4 text-xs text-slate-600">
                  {formData.pageLinks.privacyPolicy && (
                    <span>• Privacy Policy</span>
                  )}
                  {formData.pageLinks.refundPolicy && (
                    <span>• Refund Policy</span>
                  )}
                  {formData.pageLinks.cancellationPolicy && (
                    <span>• Cancelation Policy</span>
                  )}
                  {formData.pageLinks.contactUs && (
                    <span>• Contact us</span>
                  )}
                </div>
              )}

              {/* Social Media Icons */}
              {(formData.socialMediaLinks.facebook ||
                formData.socialMediaLinks.instagram ||
                formData.socialMediaLinks.twitter ||
                formData.socialMediaLinks.linkedin ||
                formData.socialMediaLinks.pinterest) && (
                <div className="flex gap-3 mb-4">
                  {formData.socialMediaLinks.facebook && (
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                      <Facebook className="w-4 h-4 text-white" />
                    </div>
                  )}
                  {formData.socialMediaLinks.instagram && (
                    <div className="w-8 h-8 rounded-full bg-pink-600 flex items-center justify-center">
                      <Instagram className="w-4 h-4 text-white" />
                    </div>
                  )}
                  {formData.socialMediaLinks.twitter && (
                    <div className="w-8 h-8 rounded-full bg-blue-400 flex items-center justify-center">
                      <Twitter className="w-4 h-4 text-white" />
                    </div>
                  )}
                  {formData.socialMediaLinks.linkedin && (
                    <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center">
                      <Linkedin className="w-4 h-4 text-white" />
                    </div>
                  )}
                  {formData.socialMediaLinks.pinterest && (
                    <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">P</span>
                    </div>
                  )}
                </div>
              )}

              {/* Copyright */}
              <p className="text-xs text-slate-500">
                {formData.copyrightContent}
              </p>
            </div>
          </div>

          {/* Right Column - Editing Controls */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Placeholder help */}
              <p className="text-xs text-slate-500">
                Use placeholders such as {"{userName}"} or {"{orderId}"} in the mail body; the preview fills them with sample values.
              </p>

              {/* Icon Section */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  Icon
                  <Info className="w-4 h-4 text-slate-400" />
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Choose File"
                    value={uploadingIcon ? "Uploading..." : formData.icon ? "File selected" : ""}
                    readOnly
                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  {formData.icon && !uploadingIcon && (
                    <button
                      type="button"
                      onClick={() => handleInputChange("icon", "")}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
                      title="Remove icon"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <label className={`px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors text-sm font-medium ${uploadingIcon ? "opacity-60 pointer-events-none" : ""}`}>
                    Browse
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ""
                        handleFileUpload("icon", file)
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Header Content */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  Header Content
                  <Folder className="w-4 h-4 text-slate-400" />
                </label>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">
                    Main Title(Default)
                  </label>
                  <input
                    type="text"
                    value={formData.mainTitle}
                    onChange={(e) => handleInputChange("mainTitle", e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
              </div>

              {/* Mail Body Message */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  Mail Body Message(Default)
                  <Info className="w-4 h-4 text-slate-400" />
                </label>
                <div className="border border-slate-300 rounded-lg">
                  <textarea
                    value={formData.mailBody}
                    onChange={(e) => handleInputChange("mailBody", e.target.value)}
                    rows={8}
                    className="w-full px-4 py-2 border-0 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                  />
                </div>
              </div>

              {/* Footer Content */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  Footer Content
                  <Folder className="w-4 h-4 text-slate-400" />
                </label>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">
                      Section Text(Default)
                    </label>
                    <input
                      type="text"
                      value={formData.footerText}
                      onChange={(e) => handleInputChange("footerText", e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>

                  {/* Page Links Checkboxes */}
                  <div>
                    <label className="block text-xs text-slate-600 mb-2">Page Links</label>
                    <div className="space-y-2">
                      {[
                        { key: "privacyPolicy", label: "Privacy Policy" },
                        { key: "refundPolicy", label: "Refund Policy" },
                        { key: "cancellationPolicy", label: "Cancelation Policy" },
                        { key: "contactUs", label: "Contact Us" }
                      ].map((item) => (
                        <label key={item.key} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!formData.pageLinks[item.key]}
                            onChange={(e) => handleCheckboxChange("pageLinks", item.key, e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-slate-700">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Social Media Links Checkboxes */}
                  <div>
                    <label className="block text-xs text-slate-600 mb-2">Social Media Links</label>
                    <div className="space-y-2">
                      {[
                        { key: "facebook", label: "Facebook" },
                        { key: "instagram", label: "Instagram" },
                        { key: "twitter", label: "Twitter" },
                        { key: "linkedin", label: "LinkedIn" },
                        { key: "pinterest", label: "Pinterest" }
                      ].map((item) => (
                        <label key={item.key} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!formData.socialMediaLinks[item.key]}
                            onChange={(e) => handleCheckboxChange("socialMediaLinks", item.key, e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-slate-700">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Copyright Content */}
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">
                      Copyright Content(Default)
                    </label>
                    <input
                      type="text"
                      value={formData.copyrightContent}
                      onChange={(e) => handleInputChange("copyrightContent", e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={loading || saving || uploadingIcon}
                  className="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium flex items-center gap-2 disabled:opacity-60"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
                <button
                  type="submit"
                  disabled={loading || saving || uploadingIcon}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
