export const AX_CODE_DIRECTORY_HEADER = "x-ax-code-directory"
export const AX_CODE_WORKSPACE_HEADER = "x-ax-code-workspace"
export const LEGACY_OPENCODE_DIRECTORY_HEADER = "x-opencode-directory"
export const LEGACY_OPENCODE_WORKSPACE_HEADER = "x-opencode-workspace"

const isIpv4Loopback = (hostname: string) => {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

export function assertLocalAxCodeBaseUrl(raw: string) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("AX Code client baseUrl must be a valid local HTTP URL")
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  const localHostname =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "opencode.internal" ||
    hostname === "opentui.internal" ||
    isIpv4Loopback(hostname)
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !localHostname) {
    throw new Error("AX Code client baseUrl must be local; remote AX Code access is disabled by the local-only policy")
  }
}

export function headersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

export function encodeDirectoryHeader(directory: string) {
  return /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory
}

export function withDirectoryHeaders(headers: Record<string, string> | undefined, directory: string) {
  const encodedDirectory = encodeDirectoryHeader(directory)
  return {
    ...headers,
    [AX_CODE_DIRECTORY_HEADER]: encodedDirectory,
    [LEGACY_OPENCODE_DIRECTORY_HEADER]: encodedDirectory,
  }
}

export function withWorkspaceHeaders(headers: Record<string, string> | undefined, workspaceID: string) {
  return {
    ...headers,
    [AX_CODE_WORKSPACE_HEADER]: workspaceID,
    [LEGACY_OPENCODE_WORKSPACE_HEADER]: workspaceID,
  }
}

/**
 * Create a fetch wrapper that disables Bun's per-request timeout.
 *
 * Bun extends `Request` with a `timeout` property (`false` = no per-request
 * timeout). Without this wrapper, SSE connections and long agent sessions
 * are killed by Bun's default connection timeout.
 */
export function createNoTimeoutFetch(): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    if (input instanceof Request) {
      ;(input as Request & { timeout?: boolean }).timeout = false
      return fetch(input, { timeout: false, ...init } as RequestInit)
    }
    return fetch(input, { timeout: false, ...init } as RequestInit)
  }) as typeof fetch
}
