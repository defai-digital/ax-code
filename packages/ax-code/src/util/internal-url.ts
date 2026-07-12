import { Flag } from "../flag/flag"
import { isLoopbackHostname } from "../runtime/listen-security"

const DEFAULT_INTERNAL_BASE_URL = "http://opentui.internal"

export function internalBaseUrl() {
  const override = Flag.AX_CODE_INTERNAL_BASE_URL
  if (!override) return DEFAULT_INTERNAL_BASE_URL
  try {
    const url = new URL(override)
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_INTERNAL_BASE_URL
    if (!isLoopbackHostname(url.hostname) && !["opencode.internal", "opentui.internal"].includes(url.hostname)) {
      return DEFAULT_INTERNAL_BASE_URL
    }
    return url.toString().replace(/\/$/, "")
  } catch {
    return DEFAULT_INTERNAL_BASE_URL
  }
}

export function isInternalHostname(hostname: string) {
  if (isLoopbackHostname(hostname)) return true
  const allowed = new Set(["opencode.internal", "opentui.internal"])
  allowed.add(new URL(internalBaseUrl()).hostname)
  return allowed.has(hostname)
}
