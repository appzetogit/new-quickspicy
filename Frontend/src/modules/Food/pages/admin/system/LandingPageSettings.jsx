import { useState } from "react";
import { Monitor, Info, X, ChevronRight, RotateCcw, Save } from "lucide-react";
import { usePlatformSetting } from "@food/hooks/usePlatformSetting";

// Stored under "landing_admin": one entry per section.
const ADMIN_DEFAULTS = {
  header: {
    enabled: true,
    title: "Why stay Hungry!",
    subtitle: "when you can order always form",
    tagline: "Start Your Business or Download the App",
    buttonName: "Order Now",
    redirectLink: "",
    redirectLinkEnabled: true,
  },
  image: { enabled: true, contentImage: "", backgroundImage: "" },
  floatingIcon: { enabled: true, totalOrder: "5000", totalUser: "999", totalReviews: "2330" },
  aboutUs: { enabled: true, title: "", description: "" },
  features: { enabled: true, title: "", count: "" },
  services: { enabled: true, title: "", description: "" },
  earnMoney: { enabled: true, title: "", buttonText: "" },
  whyChooseUs: { enabled: true, title: "", count: "" },
  testimonials: { enabled: true, title: "", count: "" },
  availableZone: { enabled: true, title: "", showZones: true },
  fixedData: { enabled: true, companyName: "", contactEmail: "", contactPhone: "" },
  buttonLinks: { enabled: true, primaryText: "", primaryLink: "", secondaryText: "", secondaryLink: "" },
  backgroundColor: { enabled: true, primary: "#ffffff", secondary: "#f8f9fa", accent: "#E64100" },
};

// Stored under "landing_react": one entry per section.
const REACT_DEFAULTS = {
  header: {
    title: "Your Next Experience Awaits",
    subtitle: "Discover Restaurants Near You",
    backgroundImage: "",
  },
  locationPicker: { placeholder: "Enter location to search restaurant" },
  businessStats: { restaurant: "200", happyCustomer: "10000", averageDelivery: "30" },
  services: { title: "", description: "" },
  stepper: { step1: "", step2: "", step3: "" },
  promoBanner: { title: "", image: "" },
  categories: { title: "", count: "" },
  downloadApps: { title: "", playStoreLink: "", appStoreLink: "" },
  gallery: { title: "", perRow: "3" },
  availableZone: { title: "", showZones: false },
  registration: { title: "", buttonText: "" },
  testimonials: { title: "", count: "" },
};

const adminTabs = [
  "Header",
  "About us",
  "Features",
  "Services",
  "Earn money",
  "Why choose us",
  "Testimonials",
  "Available zone",
  "Fixed data",
  "Button & links",
  "Background color",
];

const reactTabs = [
  "Header",
  "Services",
  "Stepper Section",
  "Promotional Banner",
  "Categories",
  "Download Apps",
  "Gallery",
  "Available zone",
  "Registration section",
  "Testimonials",
];

const inputClass =
  "w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
const adminCardClass = "bg-white rounded-lg shadow-sm border border-slate-200 p-3 sm:p-4 w-full overflow-hidden";
const reactCardClass = "bg-white rounded-lg shadow-sm border border-slate-200 p-3 sm:p-4 max-w-full overflow-hidden";

function FieldLabel({ children, info }) {
  return (
    <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
      {children}
      {info && <Info className="w-3 h-3 text-slate-400" />}
    </label>
  );
}

function Field({ label, info, value, onChange, type = "text", placeholder, maxLength, rows }) {
  return (
    <div>
      <FieldLabel info={info}>{label}</FieldLabel>
      {rows ? (
        <textarea
          rows={rows}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      ) : (
        <input
          type={type}
          value={value ?? ""}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <FieldLabel info>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="w-16 h-10 rounded border border-slate-300 cursor-pointer"
        />
        <input
          type="text"
          value={value ?? ""}
          placeholder="#ffffff"
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>
    </div>
  );
}

// Image fields hold a URL (no upload endpoint exists for these pages).
function ImageUrlField({ label, hint, value, onChange, previewClass = "w-24 h-24 sm:w-32 sm:h-32" }) {
  return (
    <div>
      <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
      <div className="flex items-start gap-3">
        <div className="relative inline-block flex-shrink-0">
          {value ? (
            <div className="relative">
              <img
                src={value}
                alt={label}
                className={`${previewClass} object-cover rounded-lg border border-slate-300`}
              />
              <button
                type="button"
                onClick={() => onChange("")}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className={`${previewClass} border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center`}>
              <span className="text-xs text-slate-500">No image</span>
            </div>
          )}
        </div>
        <input
          type="url"
          value={value ?? ""}
          placeholder="https://... image URL"
          onChange={(e) => onChange(e.target.value)}
          className={`flex-1 min-w-0 ${inputClass}`}
        />
      </div>
    </div>
  );
}

function Actions({ onReset, onSave, saving }) {
  return (
    <div className="flex justify-end gap-2 mt-4">
      <button
        type="button"
        onClick={onReset}
        disabled={saving}
        className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors text-xs sm:text-sm font-medium flex items-center gap-1.5 disabled:opacity-60"
      >
        <RotateCcw className="w-3 h-3" />
        Reset
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs sm:text-sm font-medium flex items-center gap-1.5 disabled:opacity-60"
      >
        <Save className="w-3 h-3" />
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function AdminSection({ id, title, enabled, onToggle, children, actions }) {
  return (
    <div className={adminCardClass} style={{ maxWidth: "100%", boxSizing: "border-box" }}>
      <div className="flex items-center gap-2 mb-4">
        <input
          type="checkbox"
          id={id}
          checked={!!enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4 text-blue-600 rounded border-slate-300"
        />
        <label htmlFor={id} className="text-xs sm:text-sm font-semibold text-slate-900">
          {title}
        </label>
      </div>
      {children}
      {actions}
    </div>
  );
}

function ReactSection({ title, description, children, actions }) {
  return (
    <div className={reactCardClass}>
      <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-1.5">{title}</h2>
      <p className="text-xs sm:text-sm text-slate-600 mb-4">{description}</p>
      {children}
      {actions}
    </div>
  );
}

function LandingPageSettingsForm({ type }) {
  const isAdmin = type === "admin";
  const defaults = isAdmin ? ADMIN_DEFAULTS : REACT_DEFAULTS;
  const { value, setValue, save, loading, saving } = usePlatformSetting(
    isAdmin ? "landing_admin" : "landing_react",
    defaults
  );
  const [adminActiveTab, setAdminActiveTab] = useState("Header");
  const [reactActiveTab, setReactActiveTab] = useState("Header");

  const section = (name) => ({ ...defaults[name], ...(value[name] || {}) });
  const setField = (name, field) => (fieldValue) =>
    setValue((prev) => ({
      ...prev,
      [name]: { ...defaults[name], ...(prev[name] || {}), [field]: fieldValue },
    }));
  const resetSections = (...names) =>
    setValue((prev) => {
      const next = { ...prev };
      names.forEach((name) => {
        next[name] = { ...defaults[name] };
      });
      return next;
    });
  const handleSave = () => save();
  const actions = (...names) => (
    <Actions onReset={() => resetSections(...names)} onSave={handleSave} saving={saving} />
  );

  const loadingCard = (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 text-xs text-slate-500">
      Loading...
    </div>
  );

  if (isAdmin) {
    const header = section("header");
    const image = section("image");
    const floating = section("floatingIcon");

    const simpleAdminSection = (name, title, fields) => {
      const s = section(name);
      return (
        <AdminSection
          id={`admin-${name}`}
          title={title}
          enabled={s.enabled}
          onToggle={setField(name, "enabled")}
          actions={actions(name)}
        >
          <div className="space-y-3">
            {fields.map((f) => (
              <Field
                key={f.field}
                info
                label={f.label}
                type={f.type}
                rows={f.rows}
                placeholder={f.placeholder}
                value={s[f.field]}
                onChange={setField(name, f.field)}
              />
            ))}
          </div>
        </AdminSection>
      );
    };

    return (
      <>
        <div className="p-2 lg:p-3 bg-slate-50 min-h-screen overflow-x-hidden w-full" style={{ maxWidth: "100vw", boxSizing: "border-box" }}>
          <div className="w-full mx-auto overflow-hidden" style={{ maxWidth: "100%", boxSizing: "border-box" }}>
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 w-full overflow-hidden" style={{ maxWidth: "100%" }}>
              <div className="flex items-center gap-2 min-w-0">
                <Monitor className="w-5 h-5 text-slate-700 flex-shrink-0" />
                <h1 className="text-xl lg:text-2xl font-bold text-slate-900 truncate">Admin Landing Page</h1>
              </div>
            </div>

            {/* Main Navigation Tabs */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-2 mb-3 w-full overflow-hidden" style={{ maxWidth: "100%" }}>
              <div className="flex flex-wrap items-center gap-1.5 w-full">
                {adminTabs.map((tab) => {
                  const isActive = tab === adminActiveTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setAdminActiveTab(tab)}
                      className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                        isActive ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
                <ChevronRight className="w-4 h-4 text-slate-400 ml-1 flex-shrink-0" />
              </div>
            </div>

            {loading ? (
              loadingCard
            ) : (
              <>
                {adminActiveTab === "Header" && (
                  <div className="space-y-3 w-full overflow-hidden" style={{ maxWidth: "100%" }}>
                    <AdminSection
                      id="header-content"
                      title="Header Content Section"
                      enabled={header.enabled}
                      onToggle={setField("header", "enabled")}
                      actions={actions("header")}
                    >
                      <div className="space-y-3">
                        <Field info label="Title" value={header.title} onChange={setField("header", "title")} />
                        <Field info label="Subtitle" value={header.subtitle} onChange={setField("header", "subtitle")} />
                        <Field info label="Tagline" value={header.tagline} onChange={setField("header", "tagline")} />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <Field info label="Button Name" value={header.buttonName} onChange={setField("header", "buttonName")} />
                          <div>
                            <FieldLabel info>Redirect Link</FieldLabel>
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="text"
                                value={header.redirectLink ?? ""}
                                placeholder="https://..."
                                onChange={(e) => setField("header", "redirectLink")(e.target.value)}
                                className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                              <button
                                type="button"
                                onClick={() => setField("header", "redirectLinkEnabled")(!header.redirectLinkEnabled)}
                                className={`px-3 py-1.5 text-xs sm:text-sm rounded-lg transition-all whitespace-nowrap ${
                                  header.redirectLinkEnabled ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                                }`}
                              >
                                {header.redirectLinkEnabled ? "ON" : "OFF"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </AdminSection>

                    <AdminSection
                      id="image-content"
                      title="Image Content"
                      enabled={image.enabled}
                      onToggle={setField("image", "enabled")}
                      actions={actions("image")}
                    >
                      <div className="space-y-3">
                        <ImageUrlField
                          label="Content Image (800x800px)"
                          value={image.contentImage}
                          onChange={setField("image", "contentImage")}
                        />
                        <ImageUrlField
                          label="Section Background Image (1600x1700px)"
                          value={image.backgroundImage}
                          onChange={setField("image", "backgroundImage")}
                        />
                      </div>
                    </AdminSection>

                    <AdminSection
                      id="floating-icon"
                      title="Floating Icon Content"
                      enabled={floating.enabled}
                      onToggle={setField("floatingIcon", "enabled")}
                      actions={actions("floatingIcon")}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Field info label="Total Order" value={floating.totalOrder} onChange={setField("floatingIcon", "totalOrder")} />
                        <Field info label="Total User" value={floating.totalUser} onChange={setField("floatingIcon", "totalUser")} />
                        <Field info label="Total Reviews" value={floating.totalReviews} onChange={setField("floatingIcon", "totalReviews")} />
                      </div>
                    </AdminSection>
                  </div>
                )}

                {adminActiveTab === "About us" &&
                  simpleAdminSection("aboutUs", "About us Section", [
                    { field: "title", label: "Title", placeholder: "Enter about us title" },
                    { field: "description", label: "Description", placeholder: "Enter about us description", rows: 4 },
                  ])}

                {adminActiveTab === "Features" &&
                  simpleAdminSection("features", "Features Section", [
                    { field: "title", label: "Section Title", placeholder: "Enter features section title" },
                    { field: "count", label: "Number of Features", type: "number", placeholder: "Enter number" },
                  ])}

                {adminActiveTab === "Services" &&
                  simpleAdminSection("services", "Services Section", [
                    { field: "title", label: "Section Title", placeholder: "Enter services section title" },
                    { field: "description", label: "Section Description", placeholder: "Enter services description", rows: 3 },
                  ])}

                {adminActiveTab === "Earn money" &&
                  simpleAdminSection("earnMoney", "Earn money Section", [
                    { field: "title", label: "Section Title", placeholder: "Enter earn money section title" },
                    { field: "buttonText", label: "Button Text", placeholder: "Enter button text" },
                  ])}

                {adminActiveTab === "Why choose us" &&
                  simpleAdminSection("whyChooseUs", "Why choose us Section", [
                    { field: "title", label: "Section Title", placeholder: "Enter why choose us title" },
                    { field: "count", label: "Number of Reasons", type: "number", placeholder: "Enter number" },
                  ])}

                {adminActiveTab === "Testimonials" &&
                  simpleAdminSection("testimonials", "Testimonials Section", [
                    { field: "title", label: "Section Title", placeholder: "Enter testimonials section title" },
                    { field: "count", label: "Number of Testimonials", type: "number", placeholder: "Enter number" },
                  ])}

                {adminActiveTab === "Available zone" && (() => {
                  const s = section("availableZone");
                  return (
                    <AdminSection
                      id="admin-availableZone"
                      title="Available zone Section"
                      enabled={s.enabled}
                      onToggle={setField("availableZone", "enabled")}
                      actions={actions("availableZone")}
                    >
                      <div className="space-y-3">
                        <Field
                          info
                          label="Section Title"
                          placeholder="Enter available zone section title"
                          value={s.title}
                          onChange={setField("availableZone", "title")}
                        />
                        <div>
                          <FieldLabel info>Enable Zone Display</FieldLabel>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!!s.showZones}
                              onChange={(e) => setField("availableZone", "showZones")(e.target.checked)}
                              className="w-4 h-4 text-blue-600 rounded border-slate-300"
                            />
                            <span className="text-xs sm:text-sm text-slate-700">Show available zones</span>
                          </div>
                        </div>
                      </div>
                    </AdminSection>
                  );
                })()}

                {adminActiveTab === "Fixed data" &&
                  simpleAdminSection("fixedData", "Fixed data Section", [
                    { field: "companyName", label: "Company Name", placeholder: "Enter company name" },
                    { field: "contactEmail", label: "Contact Email", type: "email", placeholder: "Enter contact email" },
                    { field: "contactPhone", label: "Contact Phone", type: "tel", placeholder: "Enter contact phone" },
                  ])}

                {adminActiveTab === "Button & links" &&
                  simpleAdminSection("buttonLinks", "Button & links Section", [
                    { field: "primaryText", label: "Primary Button Text", placeholder: "Enter primary button text" },
                    { field: "primaryLink", label: "Primary Button Link", type: "url", placeholder: "Enter button link URL" },
                    { field: "secondaryText", label: "Secondary Button Text", placeholder: "Enter secondary button text" },
                    { field: "secondaryLink", label: "Secondary Button Link", type: "url", placeholder: "Enter button link URL" },
                  ])}

                {adminActiveTab === "Background color" && (() => {
                  const s = section("backgroundColor");
                  return (
                    <AdminSection
                      id="admin-backgroundColor"
                      title="Background color Section"
                      enabled={s.enabled}
                      onToggle={setField("backgroundColor", "enabled")}
                      actions={actions("backgroundColor")}
                    >
                      <div className="space-y-3">
                        <ColorField label="Primary Background Color" value={s.primary} onChange={setField("backgroundColor", "primary")} />
                        <ColorField label="Secondary Background Color" value={s.secondary} onChange={setField("backgroundColor", "secondary")} />
                        <ColorField label="Accent Color" value={s.accent} onChange={setField("backgroundColor", "accent")} />
                      </div>
                    </AdminSection>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // React Landing Page
  const rHeader = section("header");
  const rLocation = section("locationPicker");
  const rStats = section("businessStats");

  const simpleReactSection = (name, title, description, fields) => {
    const s = section(name);
    return (
      <ReactSection title={title} description={description} actions={actions(name)}>
        <div className="space-y-3">
          {fields.map((f) => (
            <Field
              key={f.field}
              label={f.label}
              type={f.type}
              rows={f.rows}
              placeholder={f.placeholder}
              value={s[f.field]}
              onChange={setField(name, f.field)}
            />
          ))}
        </div>
      </ReactSection>
    );
  };

  return (
    <>
      <style>{`
        .hide-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen overflow-x-hidden max-w-full">
        <div className="w-full mx-auto max-w-full overflow-hidden">
          {/* Page Header */}
          <div className="flex items-center gap-2 mb-3 max-w-full overflow-hidden">
            <Monitor className="w-5 h-5 text-slate-700" />
            <h1 className="text-xl lg:text-2xl font-bold text-slate-900">React Landing Page</h1>
          </div>

          {/* Main Navigation Tabs */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-2 mb-3 max-w-full overflow-hidden">
            <div className="overflow-x-auto w-full hide-scrollbar">
              <div className="flex items-center gap-1.5" style={{ width: "max-content" }}>
                {reactTabs.map((tab) => {
                  const isActive = tab === reactActiveTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setReactActiveTab(tab)}
                      className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                        isActive ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {loading ? (
            loadingCard
          ) : (
            <>
              {reactActiveTab === "Header" && (
                <div className="space-y-3 max-w-full overflow-hidden">
                  <ReactSection
                    title="Header Section"
                    description="Manage main banner content including title, subtitle, and background image."
                    actions={actions("header")}
                  >
                    <div className="space-y-3">
                      <Field
                        label={`Title (${String(rHeader.title || "").length}/50)*`}
                        maxLength={50}
                        value={rHeader.title}
                        onChange={setField("header", "title")}
                      />
                      <Field
                        label={`Subtitle (${String(rHeader.subtitle || "").length}/100)*`}
                        maxLength={100}
                        value={rHeader.subtitle}
                        onChange={setField("header", "subtitle")}
                      />
                      <ImageUrlField
                        label="Section Background Image*"
                        hint="Image URL. Jpeg, jpg, png, gif, webp (1260 x 360 px)"
                        previewClass="w-40 h-24 sm:w-48 sm:h-32"
                        value={rHeader.backgroundImage}
                        onChange={setField("header", "backgroundImage")}
                      />
                    </div>
                  </ReactSection>

                  <ReactSection
                    title="Location picker section"
                    description="Customize location search bar and placeholder text to help users find nearby restaurants."
                    actions={actions("locationPicker")}
                  >
                    <Field
                      label={`Placeholder (${String(rLocation.placeholder || "").length}/50)*`}
                      maxLength={50}
                      value={rLocation.placeholder}
                      onChange={setField("locationPicker", "placeholder")}
                    />
                  </ReactSection>

                  <ReactSection
                    title="Business Statistics Section"
                    description="Display key business statistics like total restaurants, happy customers, and average delivery time."
                    actions={actions("businessStats")}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Field label="Restaurant*" type="number" value={rStats.restaurant} onChange={setField("businessStats", "restaurant")} />
                      <Field label="Happy Customer*" type="number" value={rStats.happyCustomer} onChange={setField("businessStats", "happyCustomer")} />
                      <Field label="Average Delivery (Minutes)*" type="number" value={rStats.averageDelivery} onChange={setField("businessStats", "averageDelivery")} />
                    </div>
                  </ReactSection>
                </div>
              )}

              {reactActiveTab === "Services" &&
                simpleReactSection("services", "Services Section", "Configure services section content and settings.", [
                  { field: "title", label: "Section Title", placeholder: "Enter section title" },
                  { field: "description", label: "Section Description", placeholder: "Enter section description", rows: 4 },
                ])}

              {reactActiveTab === "Stepper Section" &&
                simpleReactSection("stepper", "Stepper Section", "Configure step-by-step process display.", [
                  { field: "step1", label: "Step 1 Title", placeholder: "Enter step 1 title" },
                  { field: "step2", label: "Step 2 Title", placeholder: "Enter step 2 title" },
                  { field: "step3", label: "Step 3 Title", placeholder: "Enter step 3 title" },
                ])}

              {reactActiveTab === "Promotional Banner" && (() => {
                const s = section("promoBanner");
                return (
                  <ReactSection
                    title="Promotional Banner"
                    description="Configure promotional banner content and images."
                    actions={actions("promoBanner")}
                  >
                    <div className="space-y-3">
                      <Field label="Banner Title" placeholder="Enter banner title" value={s.title} onChange={setField("promoBanner", "title")} />
                      <ImageUrlField
                        label="Banner Image"
                        previewClass="w-40 h-24 sm:w-48 sm:h-32"
                        value={s.image}
                        onChange={setField("promoBanner", "image")}
                      />
                    </div>
                  </ReactSection>
                );
              })()}

              {reactActiveTab === "Categories" &&
                simpleReactSection("categories", "Categories Section", "Configure food categories display settings.", [
                  { field: "title", label: "Section Title", placeholder: "Enter categories section title" },
                  { field: "count", label: "Number of Categories to Display", type: "number", placeholder: "Enter number" },
                ])}

              {reactActiveTab === "Download Apps" &&
                simpleReactSection("downloadApps", "Download Apps Section", "Configure mobile app download links and information.", [
                  { field: "title", label: "Section Title", placeholder: "Enter section title" },
                  { field: "playStoreLink", label: "Google Play Store Link", type: "url", placeholder: "https://play.google.com/..." },
                  { field: "appStoreLink", label: "Apple App Store Link", type: "url", placeholder: "https://apps.apple.com/..." },
                ])}

              {reactActiveTab === "Gallery" && (() => {
                const s = section("gallery");
                return (
                  <ReactSection
                    title="Gallery Section"
                    description="Configure image gallery settings and display options."
                    actions={actions("gallery")}
                  >
                    <div className="space-y-3">
                      <Field label="Section Title" placeholder="Enter gallery section title" value={s.title} onChange={setField("gallery", "title")} />
                      <div>
                        <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                          Number of Images per Row
                        </label>
                        <select
                          value={String(s.perRow ?? "3")}
                          onChange={(e) => setField("gallery", "perRow")(e.target.value)}
                          className={inputClass}
                        >
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="6">6</option>
                        </select>
                      </div>
                    </div>
                  </ReactSection>
                );
              })()}

              {reactActiveTab === "Available zone" && (() => {
                const s = section("availableZone");
                return (
                  <ReactSection
                    title="Available Zone Section"
                    description="Configure available delivery zones display."
                    actions={actions("availableZone")}
                  >
                    <div className="space-y-3">
                      <Field label="Section Title" placeholder="Enter section title" value={s.title} onChange={setField("availableZone", "title")} />
                      <div>
                        <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                          Enable Zone Display
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!!s.showZones}
                            onChange={(e) => setField("availableZone", "showZones")(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded border-slate-300"
                          />
                          <span className="text-xs sm:text-sm text-slate-700">Show available zones</span>
                        </div>
                      </div>
                    </div>
                  </ReactSection>
                );
              })()}

              {reactActiveTab === "Registration section" &&
                simpleReactSection("registration", "Registration Section", "Configure user registration section settings.", [
                  { field: "title", label: "Section Title", placeholder: "Enter registration section title" },
                  { field: "buttonText", label: "Registration Button Text", placeholder: "Enter button text" },
                ])}

              {reactActiveTab === "Testimonials" &&
                simpleReactSection("testimonials", "Testimonials Section", "Configure customer testimonials display settings.", [
                  { field: "title", label: "Section Title", placeholder: "Enter testimonials section title" },
                  { field: "count", label: "Number of Testimonials to Display", type: "number", placeholder: "Enter number" },
                ])}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function LandingPageSettings({ type = "admin" }) {
  // Keyed by type so switching between the admin and react routes reloads the right settings.
  return <LandingPageSettingsForm key={type} type={type} />;
}
