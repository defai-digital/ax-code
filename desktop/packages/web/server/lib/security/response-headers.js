const PREVIEW_PROXY_PREFIX = "/api/preview/proxy"
const DASHBOARD_PROXY_PREFIXES = ["/dre-graph", "/graph"]
export const PACKAGED_RENDERER_ORIGIN = "app://ax-code"

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

export const applyPackagedRendererCorsHeaders = (req, res) => {
  const origin = typeof req?.headers?.origin === "string" ? req.headers.origin.trim() : ""
  if (origin !== PACKAGED_RENDERER_ORIGIN) return false
  res.setHeader("Access-Control-Allow-Origin", PACKAGED_RENDERER_ORIGIN)
  res.setHeader("Access-Control-Allow-Credentials", "true")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization")
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
  res.setHeader("Vary", "Origin")
  return true
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
    // img-src allows https://models.dev for provider logo fallbacks
    // (packages/ui/src/hooks/useProviderLogo.ts).
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://models.dev; font-src 'self' data:; connect-src 'self' ws: wss: http: https:;",
  )
}
