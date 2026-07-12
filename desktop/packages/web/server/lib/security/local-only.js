export const normalizeLoopbackHostname = (value) => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  return normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized
}

export const isLoopbackHostname = (value) => {
  const hostname = normalizeLoopbackHostname(value)
  if (hostname === "localhost" || hostname === "::1") return true
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

export const assertLocalOnlyHostname = (value, label = "host") => {
  const hostname = typeof value === "string" ? value.trim() : ""
  if (!hostname) return undefined
  if (isLoopbackHostname(hostname)) return normalizeLoopbackHostname(hostname)
  throw new Error(`${label} must be a loopback address; remote AX Code access is disabled by the local-only policy`)
}

export const normalizeLoopbackHttpOrigin = (value) => {
  try {
    const url = new URL(String(value || ""))
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !isLoopbackHostname(url.hostname)) return null
    return url.origin
  } catch {
    return null
  }
}

export const isLoopbackHttpUrl = (value) => normalizeLoopbackHttpOrigin(value) !== null
