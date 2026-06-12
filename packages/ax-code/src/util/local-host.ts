/**
 * Hostname check shared by provider discovery (loaders) and Super-Long
 * pacing: a host that resolves to the local machine has no remote quota
 * or rate limit to protect.
 */
export function isLocalHostname(hostname: string) {
  // WHATWG URL reports IPv6 hostnames in bracketed form ("[::1]").
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
  if (host === "localhost" || host === "0.0.0.0" || host === "::1") return true
  if (host.endsWith(".localhost")) return true
  if (host.startsWith("127.")) return true
  return false
}
