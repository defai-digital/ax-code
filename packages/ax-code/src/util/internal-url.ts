const DEFAULT_INTERNAL_BASE_URL = "http://opentui.internal"

export function internalBaseUrl() {
  return process.env.AX_CODE_INTERNAL_BASE_URL ?? DEFAULT_INTERNAL_BASE_URL
}

export function isInternalHostname(hostname: string) {
  const allowed = new Set(["opencode.internal", "opentui.internal", "localhost", "127.0.0.1", "[::1]"])
  try {
    allowed.add(new URL(internalBaseUrl()).hostname)
  } catch {
    // Ignore invalid overrides and fall back to the default allowlist.
  }
  return allowed.has(hostname)
}
