/**
 * The WebMCP origin shape rule shared by the bridge policy, the approval
 * store and the TUI allowlist dialog: HTTPS anywhere, or HTTP on a loopback
 * host, never with credentials. Pure and dependency-free so the TUI can
 * offer exactly what the server will accept without importing the Node
 * modules the policy and the store need.
 */
export const WEBMCP_LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"])

/** https: anywhere, or http: on a loopback host. */
export function webMcpSchemeAllowed(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && WEBMCP_LOOPBACK_HOSTS.has(url.hostname))
}

/**
 * The exact origin of a URL that could ever be granted, or undefined for
 * other schemes (`blob:` and friends fake a web origin), credentials or
 * malformed input.
 */
export function grantableOrigin(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.username || url.password) return undefined
    return webMcpSchemeAllowed(url) ? url.origin : undefined
  } catch {
    return undefined
  }
}

/** Whether a configured value already is an exact grantable origin: no path, no pattern characters. */
export function exactOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return value === url.origin && !/[*+(){}\\]/.test(value) && webMcpSchemeAllowed(url)
  } catch {
    return false
  }
}
