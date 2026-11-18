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

/**
 * ADR-170: a profile with a narrowing origin list enforces exact origins at
 * launch and at call time; an empty list navigates any http(s) origin and
 * the grant machinery stays dormant (no grant prompts, no relaunches).
 */
export function restricted(profile: { allowedOrigins: readonly string[] }): boolean {
  return profile.allowedOrigins.length > 0
}

/**
 * Bind a page URL to its HTTP(S) origin, including hand-opened LAN HTTP pages.
 * This does not grant access or admit navigation; those apply their own policy.
 */
export function pageOrigin(pageUrl: string | undefined): string | undefined {
  if (!pageUrl) return undefined
  try {
    const url = new URL(pageUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    // A credentialed landing URL (a redirect target or a page-side
    // navigation) must fail closed: `origin` drops userinfo, so checking
    // membership alone would silently admit what validateCall rejects at
    // request time.
    if (url.username || url.password) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * Explain why a page URL cannot be bound to an origin. The generic "could
 * not be located" wording hid the two cases a model can act on: the tab
 * crashed into a browser error page, or it left the list entirely.
 */
export function unlocatedPageMessage(pageUrl: string | undefined, action: string): string {
  if (!pageUrl) {
    return `WebMCP page ${action}: it is not in the bridge page list (it may have closed or crashed). Call list_pages and use a current pageId, or open the page again.`
  }
  if (/^chrome-error:/i.test(pageUrl)) {
    return `WebMCP page ${action}: the tab is showing a browser error page (chrome-error), so the site failed to load or crashed. Navigate again or try a different URL; do not retry the same call.`
  }
  return `WebMCP page ${action}: the tab is on a non-web address, so it has no origin to bind to. Navigate it to an http(s) page first.`
}
