import { describe, expect, it } from "vitest"

import { applySecurityHeaders, isDashboardProxyRequest, isPreviewProxyRequest } from "./response-headers.js"
import { createMockResponse } from "../../test-helpers/route-harness.js"

describe("response security headers", () => {
  it("sets X-Frame-Options for ordinary routes", () => {
    const res = createMockResponse()
    applySecurityHeaders({ path: "/" }, res)

    expect(res.getHeader("X-Frame-Options")).toBe("DENY")
    expect(res.getHeader("X-Content-Type-Options")).toBe("nosniff")
  })

  it("does not set X-Frame-Options on preview proxy responses", () => {
    const res = createMockResponse()
    applySecurityHeaders({ path: "/api/preview/proxy/abc123/" }, res)

    expect(res.getHeader("X-Frame-Options")).toBeUndefined()
    expect(res.getHeader("X-Content-Type-Options")).toBe("nosniff")
  })

  it("does not set X-Frame-Options on dashboard proxy responses", () => {
    const res = createMockResponse()
    applySecurityHeaders({ path: "/dre-graph/session/session-1" }, res)

    expect(res.getHeader("X-Frame-Options")).toBeUndefined()
    expect(res.getHeader("X-Content-Type-Options")).toBe("nosniff")
  })

  it("recognizes preview proxy requests from originalUrl when path is unavailable", () => {
    expect(isPreviewProxyRequest({ originalUrl: "/api/preview/proxy/abc123/?ocPreview=1" })).toBe(true)
  })

  it("recognizes dashboard proxy requests from originalUrl when path is unavailable", () => {
    expect(isDashboardProxyRequest({ originalUrl: "/dre-graph?directory=/workspace/project" })).toBe(true)
  })
})
