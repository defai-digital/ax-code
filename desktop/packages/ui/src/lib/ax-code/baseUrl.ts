import { API_PATHS } from "@/lib/http"

const API_CONFIG_SUFFIX_PATTERN = /(^|\/)api\/config$/

const stripTrailingSlashes = (value: string): string => (value.length > 1 ? value.replace(/\/+$/, "") : value)

const stripConfigApiSuffix = (value: string): string =>
  stripTrailingSlashes(value).replace(API_CONFIG_SUFFIX_PATTERN, "$1api")

/**
 * The SDK base URL must point at the API root, not at a specific resource
 * group. A stale or externally supplied `/api/config` base makes SDK provider
 * calls hit `/api/config/provider*`, which the ax-code runtime does not serve.
 */
export const normalizeAxCodeSdkBaseUrl = (baseUrl: string): string => {
  const trimmed = typeof baseUrl === "string" ? baseUrl.trim() : ""
  if (!trimmed) {
    return trimmed
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      url.pathname = stripConfigApiSuffix(url.pathname)
      return url.toString()
    } catch {
      return stripConfigApiSuffix(trimmed)
    }
  }

  return stripConfigApiSuffix(trimmed)
}

export const buildAxCodeApiUrl = (baseUrl: string, endpoint: string): string => {
  const normalizedBase = stripTrailingSlashes(baseUrl.trim())
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`

  if (!normalizedBase) {
    return normalizedEndpoint
  }

  if (normalizedBase.endsWith(API_PATHS.base) && normalizedEndpoint.startsWith(`${API_PATHS.base}/`)) {
    return `${normalizedBase}${normalizedEndpoint.slice(API_PATHS.base.length)}`
  }

  return `${normalizedBase}${normalizedEndpoint}`
}
