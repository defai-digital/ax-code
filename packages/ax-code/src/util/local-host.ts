/**
 * Hostname check shared by provider discovery (loaders) and Super-Long
 * pacing: a host that resolves to the local machine has no remote quota
 * or rate limit to protect.
 */
export function isLocalHostname(hostname: string) {
  // WHATWG URL reports IPv6 hostnames in bracketed form ("[::1]").
  const normalized = hostname.toLowerCase()
  const host = normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized
  if (host === "localhost" || host === "0.0.0.0" || host === "::1") return true
  if (host.endsWith(".localhost")) return true
  if (isIPv4Loopback(host)) return true
  return false
}

function isIPv4Loopback(hostname: string) {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}
