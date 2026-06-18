import { Flag } from "@/flag/flag"

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  const host = normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized
  if (host === "localhost" || host === "::1") return true
  return isIPv4Loopback(host)
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
  if (Flag.AX_CODE_SERVER_PASSWORD) return
  throw new Error(
    "AX_CODE_SERVER_PASSWORD is required when binding to a non-loopback address. " +
      "Set the environment variable to secure the server.",
  )
}
