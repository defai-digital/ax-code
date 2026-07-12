export function isLoopbackHostname(hostname: string): boolean {
  const host = normalizeLoopbackHostname(hostname)
  if (host === "localhost" || host === "::1") return true
  return isIPv4Loopback(host)
}

export function normalizeLoopbackHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase()
  return normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized
}

export function formatHostnameForUrl(hostname: string): string {
  const normalized = normalizeLoopbackHostname(hostname)
  return normalized.includes(":") ? `[${normalized}]` : normalized
}

function isIPv4Loopback(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

export function assertAuthenticatedNetworkBind(hostname: string): void {
  if (isLoopbackHostname(hostname)) return
  throw new Error(
    "AX Code is local-only and cannot bind to a non-loopback address. Use localhost, 127.0.0.0/8, or ::1.",
  )
}

export function assertLoopbackHttpUrl(raw: string, label = "AX Code server URL"): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} must be a valid loopback HTTP URL`)
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !isLoopbackHostname(url.hostname)) {
    throw new Error(`${label} must use a loopback address; remote AX Code access is disabled by the local-only policy`)
  }
  return url
}

export function normalizeLoopbackHttpOrigin(raw: string): string | null {
  try {
    return assertLoopbackHttpUrl(raw).origin
  } catch {
    return null
  }
}
