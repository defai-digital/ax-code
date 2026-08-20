import { Flag } from "../flag/flag"
import { isLoopbackHostname } from "../runtime/listen-security"

const DEFAULT_INTERNAL_BASE_URL = "http://ax-code.internal"

export function internalBaseUrl() {
  const override = Flag.AX_CODE_INTERNAL_BASE_URL
  if (!override) return DEFAULT_INTERNAL_BASE_URL
  try {
    const url = new URL(override)
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_INTERNAL_BASE_URL
    if (!isLoopbackHostname(url.hostname) && !["ax-code.internal", "opencode.internal"].includes(url.hostname)) {
      return DEFAULT_INTERNAL_BASE_URL
    }
    return url.toString().replace(/\/$/, "")
  } catch {
    return DEFAULT_INTERNAL_BASE_URL
  }
}

export function isInternalHostname(hostname: string) {
  if (isLoopbackHostname(hostname)) return true
  const allowed = new Set(["ax-code.internal", "opencode.internal"])
  allowed.add(new URL(internalBaseUrl()).hostname)
  return allowed.has(hostname)
}
