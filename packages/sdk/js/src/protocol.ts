/** Header carrying the workspace directory on every scoped request. */
export const AX_CODE_DIRECTORY_HEADER = "x-ax-code-directory"
/** Header carrying the workspace id on every scoped request. */
export const AX_CODE_WORKSPACE_HEADER = "x-ax-code-workspace"
/** Legacy directory header still emitted for older runtimes. */
export const LEGACY_OPENCODE_DIRECTORY_HEADER = "x-opencode-directory"
/** Legacy workspace header still emitted for older runtimes. */
export const LEGACY_OPENCODE_WORKSPACE_HEADER = "x-opencode-workspace"

const isIpv4Loopback = (hostname: string) => {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

/**
 * Enforce the local-only client policy: the base URL must be a loopback
 * HTTP(S) URL (or a same-origin path for browser clients). Remote hosts are
 * rejected.
 */
export function assertLocalAxCodeBaseUrl(raw: string) {
  const value = typeof raw === "string" ? raw.trim() : ""
  if (!value) {
    throw new Error("AX Code client baseUrl must be a valid local HTTP URL or same-origin path")
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    // Browser clients commonly use `/api`. Resolve relative values against a
    // fixed loopback origin and require the result to remain on that origin;
    // this rejects protocol-relative forms such as `//remote.example/api`.
    const sameOriginBase = "http://localhost"
    try {
      const resolved = new URL(value, sameOriginBase)
      if (resolved.origin === sameOriginBase) return
    } catch {}
    throw new Error("AX Code client baseUrl must be a valid local HTTP URL or same-origin path")
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  const localHostname =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "opencode.internal" ||
    hostname === "ax-code.internal" ||
    isIpv4Loopback(hostname)
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !localHostname) {
    throw new Error("AX Code client baseUrl must be local; remote AX Code access is disabled by the local-only policy")
  }
}

/** Normalize `Headers`/array/record header forms into a plain record. */
export function headersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

/** Percent-encode a directory value when it contains non-ASCII characters. */
export function encodeDirectoryHeader(directory: string) {
  return /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory
}

/** Add the directory scoping headers (current + legacy) to a header set. */
export function withDirectoryHeaders(headers: Record<string, string> | undefined, directory: string) {
  const encodedDirectory = encodeDirectoryHeader(directory)
  return {
    ...headers,
    [AX_CODE_DIRECTORY_HEADER]: encodedDirectory,
    [LEGACY_OPENCODE_DIRECTORY_HEADER]: encodedDirectory,
  }
}

/** Add the workspace scoping headers (current + legacy) to a header set. */
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
