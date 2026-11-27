import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { adminAPI, uploadAPI } from "@food/api"
import { FOOD_TYPE_OPTIONS, normalizeFoodType } from "@food/utils/foodType"

/**
 * Edit a restaurant's pending dish from the approval dialog, before deciding.
 *
 * Saves through the admin food update (PATCH /food/admin/foods/:id), which
 * leaves the approval status alone: "Save" keeps the dish pending, "Save &
 * Approve" then approves it. The restaurant's own photos stay as they are
 * unless the admin removes them here.
 */

const MAX_IMAGES = 10

const newVariant = (v = {}) => ({
  key: `v-${Math.random().toString(36).slice(2, 9)}`,
  id: String(v.id || v._id || ""),
  name: String(v.name || ""),
  price: v.price != null ? String(v.price) : "",
  otherPrice: Number(v.otherPrice) > 0 ? String(v.otherPrice) : "",
})

const initialImages = (request) => {
  const list = (Array.isArray(request?.images) ? request.images : []).filter((u) => typeof u === "string" && u)
  if (request?.image && !list.includes(request.image)) list.unshift(request.image)
  return [...new Set(list)]
}

export default function FoodApprovalEditForm({ request, onCancel, onSaved }) {
  const foodId = request?._id || request?.id
  const restaurantId = String(request?.restaurantRefId || "")
  const hasOwnVariants = Array.isArray(request?.variants) && request.variants.length > 0

  const [name, setName] = useState(String(request?.itemName || ""))
  const [description, setDescription] = useState(String(request?.description || ""))
  const [categoryId, setCategoryId] = useState(String(request?.categoryId || ""))
  const [categoryName, setCategoryName] = useState(String(request?.category || ""))
  const [foodType, setFoodType] = useState(normalizeFoodType(request?.foodType))
  const [price, setPrice] = useState(hasOwnVariants ? "" : String(request?.price ?? ""))
  const [otherPrice, setOtherPrice] = useState(
    !hasOwnVariants && Number(request?.otherPrice) > 0 ? String(request.otherPrice) : "",
  )
  const [variants, setVariants] = useState(hasOwnVariants ? request.variants.map(newVariant) : [])
  const [images, setImages] = useState(() => initialImages(request))
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState([])
  const fileRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    adminAPI
      .getCategories({ limit: 1000 })
      .then((res) => {
        const list = res?.data?.data?.categories || []
        if (cancelled || !Array.isArray(list)) return
        // Global categories plus this restaurant's own, enabled and approved.
        setCategories(
          list
            .filter((c) => c.isActive !== false && (c.approvalStatus || "approved") === "approved")
            .filter((c) => {
              const owner = c.restaurantId && typeof c.restaurantId === "object" ? c.restaurantId._id || c.restaurantId.id : c.restaurantId
              return !owner || String(owner) === restaurantId
            })
            .map((c) => ({
              id: String(c.id || c._id),
              name: String(c.name || "").trim(),
              scope: c.foodTypeScope || "Both",
            }))
            .filter((c) => c.id && c.name),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  // A category the dish already uses but the list does not offer stays selectable.
  const categoryOptions = useMemo(() => {
    if (!categoryId || categories.some((c) => c.id === categoryId)) return categories
    return [{ id: categoryId, name: categoryName || "Current category", scope: "Both" }, ...categories]
  }, [categories, categoryId, categoryName])

  const moveImage = (index, delta) => {
    setImages((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ""
    if (!files.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      toast.error(`A dish can have up to ${MAX_IMAGES} photos`)
      return
    }
    setUploading(true)
    try {
      const urls = []
      for (const file of files.slice(0, room)) {
        const res = await uploadAPI.uploadMedia(file, { folder: "foods" })
        const url = res?.data?.data?.url || res?.data?.url || ""
        if (url) urls.push(url)
      }
      if (urls.length < Math.min(files.length, room)) toast.error("Some images failed to upload")
      setImages((prev) => [...new Set([...prev, ...urls])].slice(0, MAX_IMAGES))
    } catch (error) {
      toast.error(error?.response?.data?.message || "Image upload failed")
    } finally {
      setUploading(false)
    }
  }

  const buildPayload = () => {
    if (!name.trim()) return { error: "Item name is required" }
    if (!categoryName.trim()) return { error: "Choose a category" }
    const cleanVariants = variants
      .map((v) => ({ ...v, name: v.name.trim(), price: Number(v.price), otherPrice: Number(v.otherPrice) || 0 }))
      .filter((v) => v.name || v.id || v.price)
    if (cleanVariants.some((v) => !v.name)) return { error: "Each variant must have a name" }
    if (cleanVariants.some((v) => !Number.isFinite(v.price) || v.price <= 0)) {
      return { error: "Each variant's selling price must be greater than 0" }
    }
    const hasVariants = cleanVariants.length > 0
    const sell = Number(price)
    const unit = Number(otherPrice) || 0
    if (!hasVariants && (!Number.isFinite(sell) || sell <= 0)) return { error: "Selling price must be greater than 0" }
    if (!hasVariants && unit > 0 && unit <= sell) return { error: "Unit price should be greater than selling price" }
    return {
      payload: {
        name: name.trim(),
        description: description.trim(),
        categoryId: categoryId || undefined,
        categoryName: categoryName.trim(),
        foodType,
        ...(hasVariants ? {} : { price: sell, otherPrice: unit }),
        variants: cleanVariants.map((v) => ({
          ...(v.id ? { _id: v.id } : {}),
          name: v.name,
          price: v.price,
          otherPrice: v.otherPrice > 0 ? v.otherPrice : 0,
        })),
        image: images[0] || "",
        images,
      },
    }
  }

  const save = async (approve) => {
    const { payload, error } = buildPayload()
    if (error) {
      toast.error(error)
      return
    }
    setSaving(true)
    try {
      await adminAPI.updateFood(foodId, payload)
      if (approve) {
        await adminAPI.approveFoodItem(foodId)
        toast.success("Changes saved and item approved")
      } else {
        toast.success("Changes saved. The item is still pending approval")
      }
      onSaved?.({ approved: approve })
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save changes")
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
  const labelClass = "block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1"

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className={labelClass}>Item name</label>
          <input className={inputClass} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Description</label>
          <textarea className={inputClass} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select
            className={inputClass}
            value={categoryId}
            onChange={(e) => {
              const next = categoryOptions.find((c) => c.id === e.target.value)
              setCategoryId(e.target.value)
              if (next) setCategoryName(next.name)
            }}
          >
            {!categoryId && <option value="">{categoryName || "Choose a category"}</option>}
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.scope && c.scope !== "Both" ? ` (${c.scope})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Food type</label>
          <div className="flex gap-2">
            {/* Veg / Non-veg as in the restaurant app; Egg only for a dish that already is Egg. */}
            {FOOD_TYPE_OPTIONS.filter((opt) => opt.value !== "Egg" || foodType === "Egg").map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFoodType(opt.value)}
                className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold ${
                  foodType === opt.value
                    ? opt.value === "Veg"
                      ? "border-green-600 bg-green-50 text-green-700"
                      : opt.value === "Egg"
                        ? "border-amber-500 bg-amber-50 text-amber-700"
                        : "border-red-600 bg-red-50 text-red-700"
                    : "border-gray-200 bg-white text-gray-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {variants.length === 0 && (
          <>
            <div>
              <label className={labelClass}>Selling price (₹)</label>
              <input className={inputClass} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Unit price (₹)</label>
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                placeholder="Optional"
                value={otherPrice}
                onChange={(e) => setOtherPrice(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      {/* Variants */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={labelClass}>Variants {variants.length > 0 ? `(${variants.length})` : ""}</label>
          <button
            type="button"
            onClick={() => setVariants((prev) => [...prev, newVariant()])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
          >
            <Plus className="w-3.5 h-3.5" /> Add variant
          </button>
        </div>
        {variants.length > 0 && (
          <div className="space-y-2">
            {variants.map((v) => (
              <div key={v.key} className="grid grid-cols-[1fr_6rem_6rem_auto] gap-2 items-center">
                <input
                  className={inputClass}
                  placeholder="Name (e.g. Half)"
                  value={v.name}
                  onChange={(e) => setVariants((prev) => prev.map((x) => (x.key === v.key ? { ...x, name: e.target.value } : x)))}
                />
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  placeholder="Selling"
                  value={v.price}
                  onChange={(e) => setVariants((prev) => prev.map((x) => (x.key === v.key ? { ...x, price: e.target.value } : x)))}
                />
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  placeholder="Unit"
                  value={v.otherPrice}
                  onChange={(e) => setVariants((prev) => prev.map((x) => (x.key === v.key ? { ...x, otherPrice: e.target.value } : x)))}
                />
                <button
                  type="button"
                  title="Remove variant"
                  onClick={() => setVariants((prev) => prev.filter((x) => x.key !== v.key))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <p className="text-[11px] text-gray-500">With variants, the selling price is taken from them.</p>
          </div>
        )}
      </div>

      {/* Images */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={labelClass}>Images ({images.length}) — first is the main photo</label>
          <button
            type="button"
            disabled={uploading || images.length >= MAX_IMAGES}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
        </div>
        {images.length === 0 ? (
          <p className="text-xs text-gray-500">No images.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {images.map((url, index) => (
              <div key={url} className="relative w-24">
                <img
                  src={url}
                  alt={`Item ${index + 1}`}
                  className={`w-24 h-24 object-cover rounded-xl border ${index === 0 ? "border-blue-400" : "border-gray-100"}`}
                />
                <button
                  type="button"
                  title="Remove image"
                  onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                  className="absolute -top-2 -right-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-red-600 shadow border border-gray-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <div className="mt-1 flex justify-between">
                  <button
                    type="button"
                    title="Move left"
                    disabled={index === 0}
                    onClick={() => moveImage(index, -1)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Move right"
                    disabled={index === images.length - 1}
                    onClick={() => moveImage(index, 1)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => save(false)}
          disabled={saving || uploading}
          className="px-5 py-2 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => save(true)}
          disabled={saving || uploading}
          className="px-5 py-2 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save & Approve"}
        </button>
      </div>
    </div>
  )
}
