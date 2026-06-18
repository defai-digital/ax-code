import { Flag } from "../flag/flag"

const DEFAULT_INTERNAL_BASE_URL = "http://opentui.internal"

export function internalBaseUrl() {
  const override = Flag.AX_CODE_INTERNAL_BASE_URL
  if (!override) return DEFAULT_INTERNAL_BASE_URL
  try {
    new URL(override)
    return override
  } catch {
    return DEFAULT_INTERNAL_BASE_URL
  }
}

export function isInternalHostname(hostname: string) {
  const allowed = new Set(["opencode.internal", "opentui.internal", "localhost", "127.0.0.1", "[::1]"])
  allowed.add(new URL(internalBaseUrl()).hostname)
  return allowed.has(hostname)
}
