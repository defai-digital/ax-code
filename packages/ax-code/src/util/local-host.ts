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
  // IPv4-mapped IPv6 form ("::ffff:127.0.0.1") is loopback too — some stacks
  // report local addresses this way, and treating them as remote would apply
  // remote pacing/quota logic to the local machine. WHATWG URL normalizes the
  // dotted octets to hex ("[::ffff:127.0.0.1]" -> "[::ffff:7f00:1]"), so both
  // spellings of 127.0.0.0/8 must be accepted.
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice("::ffff:".length)
    return isIPv4Loopback(mapped) || isIPv4MappedHexLoopback(mapped)
  }
  return false
}

export function isIPv4Loopback(hostname: string) {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

// Hex form of an IPv4-mapped IPv6 address ("7f00:1" for 127.0.0.1): the
// first 16-bit group must sit in 0x7f00–0x7fff (127.0.0.0/8) and the second
// group carries the low 16 bits. Leading zeros are omitted in the WHATWG
// form ("7f00:1", not "7f00:0001"), so the groups are parsed as hex rather
// than pattern-matched — "7f0:1" is 7.240.0.1 and must stay non-local.
function isIPv4MappedHexLoopback(mapped: string) {
  const parts = mapped.split(":")
  if (parts.length !== 2) return false
  if (!/^[0-9a-f]{1,4}$/.test(parts[0]) || !/^[0-9a-f]{1,4}$/.test(parts[1])) return false
  const high = Number.parseInt(parts[0], 16)
  return high >= 0x7f00 && high <= 0x7fff
}
