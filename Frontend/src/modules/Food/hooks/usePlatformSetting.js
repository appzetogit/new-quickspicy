import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

/**
 * Load and save one admin settings page, stored on the server as one JSON
 * object under `key` (see Backend platformSettings.service.js for the keys).
 *
 *   const { value, setValue, save, loading, saving } = usePlatformSetting("theme", { primaryColor: "#EB590E" })
 *
 * `defaults` fills anything the server has not stored yet, so a page opened for
 * the first time shows its usual starting form. Secrets come back masked
 * ("••••1234"); send them back unchanged and the server keeps the real value.
 */
export function usePlatformSetting(key, defaults = {}) {
  const defaultsRef = useRef(defaults)
  const [value, setValue] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminAPI
      .getPlatformSetting(key)
      .then((res) => {
        if (cancelled) return
        const data = res?.data?.data || {}
        const stored = data.value && typeof data.value === "object" ? data.value : {}
        setValue({ ...defaultsRef.current, ...stored })
        setUpdatedAt(data.updatedAt || null)
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load these settings")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  /** Saves `next` (or the current value). Resolves true on success. */
  const save = useCallback(
    async (next, { successMessage = "Settings saved" } = {}) => {
      const body = next ?? value
      setSaving(true)
      try {
        const res = await adminAPI.savePlatformSetting(key, body)
        const data = res?.data?.data || {}
        if (data.value) setValue({ ...defaultsRef.current, ...data.value })
        setUpdatedAt(data.updatedAt || null)
        if (successMessage) toast.success(successMessage)
        return true
      } catch (error) {
        toast.error(error?.response?.data?.message || "Could not save these settings")
        return false
      } finally {
        setSaving(false)
      }
    },
    [key, value],
  )

  /** setValue for one field: update("primaryColor", "#fff"). */
  const update = useCallback((field, fieldValue) => {
    setValue((prev) => ({ ...prev, [field]: fieldValue }))
  }, [])

  return { value, setValue, update, save, loading, saving, updatedAt }
}

export default usePlatformSetting
