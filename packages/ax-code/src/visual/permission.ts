/**
 * Browser permission model (ADR-047).
 *
 * Browser Agent permissions are host-scoped and separate from
 * shell/file permissions. The agent asks before first use of a host.
 * Localhost can have a project-level trust shortcut after user approval.
 */

export type BrowserSiteMode = "allow-session" | "always-allow" | "deny"

export type BrowserSitePermission = {
  host: string
  mode: BrowserSiteMode
  grantedAt: string
}

export type ComputerAppPermission = {
  appID: string
  displayName: string
  mode: BrowserSiteMode
  canCapture: boolean
  canInput: boolean
  grantedAt: string
}

export namespace BrowserPermission {
  /**
   * Check if a URL is allowed by the permission store.
   * Returns undefined if no permission exists (first use).
   */
  export function check(url: string, store: BrowserSitePermission[]): boolean | undefined {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    const host = parsed.hostname
    const entry = store.find((e) => e.host === host || e.host === "*")
    if (!entry) return undefined
    if (entry.mode === "deny") return false
    return true
  }

  /**
   * Check if a URL targets localhost or a local development server.
   */
  export function isLocalUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.replace(/^\[|\]$/g, "")
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")
    } catch {
      return false
    }
  }

  /**
   * Validate that a URL is safe for Browser Agent use.
   * Only http/https protocols are allowed. File:// and data: are blocked.
   */
  export function validateUrl(url: string): { valid: boolean; reason?: string } {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { valid: false, reason: "Invalid URL format" }
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        valid: false,
        reason: `Protocol "${parsed.protocol}" is not allowed. Only http:// and https:// are supported.`,
      }
    }
    return { valid: true }
  }
}
