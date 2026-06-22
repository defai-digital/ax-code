import { describe, expect, it } from "vitest"
import { shouldTriggerUpstreamHealthCheck } from "./upstream-health.js"

describe("shouldTriggerUpstreamHealthCheck", () => {
  it("checks health when no upstream response exists", () => {
    expect(shouldTriggerUpstreamHealthCheck(null)).toBe(true)
  })

  it("checks health for response-less fetch successes and server errors", () => {
    expect(shouldTriggerUpstreamHealthCheck({ ok: true, status: 204 })).toBe(true)
    expect(shouldTriggerUpstreamHealthCheck({ ok: false, status: 503 })).toBe(true)
  })

  it("skips health checks for response-less client errors", () => {
    expect(shouldTriggerUpstreamHealthCheck({ ok: false, status: 404 })).toBe(false)
  })

  it("checks only server errors once a response body exists", () => {
    expect(shouldTriggerUpstreamHealthCheck({ ok: true, status: 200, body: {} })).toBe(false)
    expect(shouldTriggerUpstreamHealthCheck({ ok: false, status: 401, body: {} })).toBe(false)
    expect(shouldTriggerUpstreamHealthCheck({ ok: false, status: 500, body: {} })).toBe(true)
  })
})
