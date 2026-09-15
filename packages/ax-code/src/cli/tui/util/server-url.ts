/**
 * Resolve a root-relative API route against the TUI's configured server while
 * preventing network-path and absolute-URL overrides from changing origin.
 */
export function urlAllowlistServerRoute(baseURL: string, route: string): URL {
  if (!route.startsWith("/") || route.startsWith("//")) {
    throw new TypeError("Server routes must be root-relative paths")
  }

  const base = new URL(baseURL)
  const resolved = new URL(route, base)
  if (resolved.origin !== base.origin) {
    throw new TypeError("Server routes must stay on the configured origin")
  }
  return resolved
}
