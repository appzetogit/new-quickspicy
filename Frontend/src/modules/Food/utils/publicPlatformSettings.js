import { publicConfigGetOnce } from "@food/api"

/**
 * The admin settings pages marked public (GET /food/platform-settings/public):
 * { firebase, analytics, app_web, login_setup, theme, ... }, secrets removed.
 * Fetched once per page load; resolves {} if the request fails, so a caller
 * never has to handle an error just to fall back to its defaults.
 */
let pending = null

export const getPublicPlatformSettings = () => {
  if (!pending) {
    pending = publicConfigGetOnce("/food/platform-settings/public")
      .then((res) => res?.data?.data || {})
      .catch(() => {
        pending = null
        return {}
      })
  }
  return pending
}

/** One page's settings, or {}. */
export const getPublicPlatformSetting = async (key) => (await getPublicPlatformSettings())[key] || {}
