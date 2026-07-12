const normalizeHostname = (value) => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  return normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized
}

export const isLoopbackHostname = (value) => {
  const hostname = normalizeHostname(value)
  if (hostname === "localhost" || hostname === "::1") return true
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

export const assertLocalOnlyHostname = (value, label = "host") => {
  const hostname = typeof value === "string" ? value.trim() : ""
  if (!hostname) return undefined
  if (isLoopbackHostname(hostname)) return normalizeHostname(hostname)
  throw new Error(`${label} must be a loopback address; remote AX Code access is disabled by the local-only policy`)
}

export const isLoopbackHttpUrl = (value) => {
  try {
    const url = new URL(String(value || ""))
    return (url.protocol === "http:" || url.protocol === "https:") && isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}
