const PREVIEW_PROXY_PREFIX = "/api/preview/proxy"
const DASHBOARD_PROXY_PREFIXES = ["/dre-graph", "/graph"]

const getRequestPathname = (req) => {
  const pathname = req?.path || req?.originalUrl || req?.url || ""
  return pathname.split("?")[0]
}

export const isPreviewProxyRequest = (req) => {
  const pathname = getRequestPathname(req)
  return pathname === PREVIEW_PROXY_PREFIX || pathname.startsWith(`${PREVIEW_PROXY_PREFIX}/`)
}

export const isDashboardProxyRequest = (req) => {
  const pathname = getRequestPathname(req)
  return DASHBOARD_PROXY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export const applySecurityHeaders = (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  if (!isPreviewProxyRequest(req) && !isDashboardProxyRequest(req)) {
    res.setHeader("X-Frame-Options", "DENY")
  }
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("X-XSS-Protection", "0")
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: http: https:;",
  )
}
