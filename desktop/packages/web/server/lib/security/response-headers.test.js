import { describe, expect, it } from "vitest"

import { applySecurityHeaders, isPreviewProxyRequest } from "./response-headers.js"

const createResponse = () => {
  const headers = new Map()
  return {
    headers,
    setHeader(name, value) {
      headers.set(name, value)
    },
  }
}

describe("response security headers", () => {
  it("sets X-Frame-Options for ordinary routes", () => {
    const res = createResponse()
    applySecurityHeaders({ path: "/" }, res)

    expect(res.headers.get("X-Frame-Options")).toBe("DENY")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("does not set X-Frame-Options on preview proxy responses", () => {
    const res = createResponse()
    applySecurityHeaders({ path: "/api/preview/proxy/abc123/" }, res)

    expect(res.headers.has("X-Frame-Options")).toBe(false)
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("recognizes preview proxy requests from originalUrl when path is unavailable", () => {
    expect(isPreviewProxyRequest({ originalUrl: "/api/preview/proxy/abc123/?ocPreview=1" })).toBe(true)
  })
})
