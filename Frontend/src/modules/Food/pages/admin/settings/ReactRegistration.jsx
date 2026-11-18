import { useEffect, useRef, useState } from "react"
import { Upload, X, RotateCcw, Plus, Save, Info, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { uploadAPI } from "@food/api"
import { usePlatformSetting } from "@food/hooks/usePlatformSetting"

const UPLOAD_FOLDER = "quickspicy/admin/react-registration"
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const DEFAULTS = {
  heroImage: "",
  steeperSteps: [
    { id: 1, title: "Step 1", description: "" },
    { id: 2, title: "Step 2", description: "" },
    { id: 3, title: "Step 3", description: "" },
  ],
  opportunities: [
    { id: 1, title: "", description: "", icon: "" },
    { id: 2, title: "", description: "", icon: "" },
  ],
  faqs: [
    { id: 1, question: "", answer: "" },
    { id: 2, question: "", answer: "" },
  ],
}

export default function ReactRegistration() {
  const [activeTab, setActiveTab] = useState("hero-section")
  const [uploading, setUploading] = useState(null) // "hero" | opportunity index | null
  const { value, setValue, update, save, loading, saving } = usePlatformSetting("react_registration", DEFAULTS)
  // Last value loaded from (or saved to) the server, for Reset.
  const loadedRef = useRef(DEFAULTS)
  useEffect(() => {
    if (!loading) loadedRef.current = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const heroImagePreview = value.heroImage || ""
  const steeperSteps = Array.isArray(value.steeperSteps) ? value.steeperSteps : DEFAULTS.steeperSteps
  const opportunities = Array.isArray(value.opportunities) ? value.opportunities : DEFAULTS.opportunities
  const faqs = Array.isArray(value.faqs) ? value.faqs : DEFAULTS.faqs

  const updateItem = (field, list, index, patch) => {
    update(field, list.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const tabs = [
    { id: "hero-section", label: "Hero Section" },
    { id: "steeper", label: "Steeper" },
    { id: "opportunities", label: "Opportunities" },
    { id: "faq", label: "FAQ" }
  ]

  // Images go to the media store; only their URLs are kept in the settings.
  const uploadImage = async (file) => {
    if (!file) return ""
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image must be less than 5MB")
      return ""
    }
    try {
      const res = await uploadAPI.uploadMedia(file, { folder: UPLOAD_FOLDER })
      const url = res?.data?.data?.url
      if (!url) throw new Error("No URL returned")
      return url
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not upload the image")
      return ""
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setUploading("hero")
    const url = await uploadImage(file)
    setUploading(null)
    if (url) update("heroImage", url)
  }

  const handleOpportunityIcon = async (e, index) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setUploading(index)
    const url = await uploadImage(file)
    setUploading(null)
    if (url) updateItem("opportunities", opportunities, index, { icon: url })
  }

  const handleRemoveImage = () => {
    update("heroImage", "")
  }

  const handleReset = () => {
    setValue(loadedRef.current)
  }

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    const ok = await save()
    if (ok) loadedRef.current = value
  }

  const busy = loading || saving || uploading !== null

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        {/* Page Header */}
        <div className="mb-6 flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">React Registration Page</h1>
          {loading && <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />}
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-2 mb-6">
          <div className="flex gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hero Section Content */}
        {activeTab === "hero-section" && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Hero Section Image</h2>

            {/* Image Upload Area */}
            <div className="mb-4">
              {heroImagePreview ? (
                <div className="relative border-2 border-slate-200 rounded-lg p-4 bg-slate-50">
                  <img
                    src={heroImagePreview}
                    alt="Hero section preview"
                    className="w-full h-auto rounded-lg max-h-96 object-contain mx-auto"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-2 right-2 p-2 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-blue-500 transition-colors bg-slate-50">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    {uploading === "hero" ? (
                      <Loader2 className="w-10 h-10 text-slate-400 mb-3 animate-spin" />
                    ) : (
                      <Upload className="w-10 h-10 text-slate-400 mb-3" />
                    )}
                    <p className="text-sm font-medium text-slate-700 mb-1">
                      {uploading === "hero" ? "Uploading..." : "Upload Image"}
                    </p>
                    <p className="text-xs text-slate-500">JPG, JPEG, PNG Less Than 5MB (1200 x 750 px)</p>
                  </div>
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png"
                    onChange={handleImageUpload}
                    disabled={uploading !== null}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* File Requirements */}
            <div className="text-xs text-slate-500 mb-6">
              <p>JPG, JPEG, PNG Less Than 5MB (1200 x 750 px)</p>
            </div>
          </div>
        )}

        {/* Steeper Section */}
        {activeTab === "steeper" && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Steeper Section</h2>
            <p className="text-sm text-slate-600 mb-6">
              Configure step-by-step registration process display.
            </p>

            <div className="space-y-6">
              {steeperSteps.map((step, index) => (
                <div key={step.id} className="border border-slate-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Step {step.id}</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        Step Title
                        <Info className="w-3 h-3 text-slate-400" />
                      </label>
                      <input
                        type="text"
                        value={step.title}
                        onChange={(e) => updateItem("steeperSteps", steeperSteps, index, { title: e.target.value })}
                        placeholder={`Enter step ${step.id} title`}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        Step Description
                        <Info className="w-3 h-3 text-slate-400" />
                      </label>
                      <textarea
                        rows={3}
                        value={step.description}
                        onChange={(e) => updateItem("steeperSteps", steeperSteps, index, { description: e.target.value })}
                        placeholder={`Enter step ${step.id} description`}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Opportunities Section */}
        {activeTab === "opportunities" && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Opportunities Section</h2>
            <p className="text-sm text-slate-600 mb-6">
              Configure available opportunities for registration.
            </p>

            <div className="space-y-6">
              {opportunities.map((opp, index) => (
                <div key={opp.id} className="border border-slate-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Opportunity {opp.id}</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        Opportunity Title
                        <Info className="w-3 h-3 text-slate-400" />
                      </label>
                      <input
                        type="text"
                        value={opp.title}
                        onChange={(e) => updateItem("opportunities", opportunities, index, { title: e.target.value })}
                        placeholder="Enter opportunity title"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        Opportunity Description
                        <Info className="w-3 h-3 text-slate-400" />
                      </label>
                      <textarea
                        rows={3}
                        value={opp.description}
                        onChange={(e) => updateItem("opportunities", opportunities, index, { description: e.target.value })}
                        placeholder="Enter opportunity description"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Opportunity Icon
                      </label>
                      <div className="relative inline-block">
                        {opp.icon ? (
                          <div className="relative">
                            <img
                              src={opp.icon}
                              alt="Icon"
                              className="w-24 h-24 object-cover rounded-lg border border-slate-300"
                            />
                            <button
                              type="button"
                              onClick={() => updateItem("opportunities", opportunities, index, { icon: "" })}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <label className="cursor-pointer">
                            <div className="w-24 h-24 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center hover:border-blue-500 transition-colors">
                              {uploading === index ? (
                                <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                              ) : (
                                <Upload className="w-6 h-6 text-slate-400" />
                              )}
                            </div>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleOpportunityIcon(e, index)}
                              disabled={uploading !== null}
                              className="hidden"
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const nextId = opportunities.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1
                  update("opportunities", [...opportunities, { id: nextId, title: "", description: "", icon: "" }])
                }}
                className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add New Opportunity
              </button>
            </div>
          </div>
        )}

        {/* FAQ Section */}
        {activeTab === "faq" && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">FAQ Section</h2>
            <p className="text-sm text-slate-600 mb-6">
              Configure frequently asked questions for registration.
            </p>

            <div className="space-y-6">
              {faqs.map((faq, index) => (
                <div key={faq.id} className="border border-slate-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">FAQ {faq.id}</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        Question
                        <Info className="w-3 h-3 text-slate-400" />
                      </label>
                      <input
                        type="text"
                        value={faq.question}
                        onChange={(e) => updateItem("faqs", faqs, index, { question: e.target.value })}
                        placeholder="Enter question"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        Answer
                        <Info className="w-3 h-3 text-slate-400" />
                      </label>
                      <textarea
                        rows={4}
                        value={faq.answer}
                        onChange={(e) => updateItem("faqs", faqs, index, { answer: e.target.value })}
                        placeholder="Enter answer"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const nextId = faqs.reduce((max, f) => Math.max(max, Number(f.id) || 0), 0) + 1
                  update("faqs", [...faqs, { id: nextId, question: "", answer: "" }])
                }}
                className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add New FAQ
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={handleReset}
            disabled={busy}
            className="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium flex items-center gap-2 disabled:opacity-60"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
