const PREVIEW_PROXY_PREFIX = "/api/preview/proxy"

export const isPreviewProxyRequest = (req) => {
  const pathname = req?.path || req?.originalUrl || req?.url || ""
  return pathname === PREVIEW_PROXY_PREFIX || pathname.startsWith(`${PREVIEW_PROXY_PREFIX}/`)
}

export const applySecurityHeaders = (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  if (!isPreviewProxyRequest(req)) {
    res.setHeader("X-Frame-Options", "DENY")
  }
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("X-XSS-Protection", "0")
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: http: https:;",
  )
}
