export const normalizeLoopbackHostname = (hostname: string): string => {
  const normalized = String(hostname || "")
    .trim()
    .toLowerCase()
  return normalized.replace(/^\[|\]$/g, "")
}

export const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = normalizeLoopbackHostname(hostname)
  if (normalized === "localhost" || normalized === "0.0.0.0" || normalized === "::" || normalized === "::1") {
    return true
  }

  const v4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!v4) return false
  const octets = v4.slice(1).map((part) => Number(part))
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127
}
