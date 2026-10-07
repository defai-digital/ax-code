import { describe, expect, test } from "vitest"
import { webMcpApprovalLines } from "../../src/mcp/webmcp-approval"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const base = () => WebMcpProfile.config({ allowedOrigins: ["https://example.test"] }, true).webmcp

describe("WebMCP session origin grants (ADR-168)", () => {
  test("an unknown HTTPS or loopback origin raises a grantable error", () => {
    const profile = base()
    for (const url of ["https://news.test/a", "http://localhost:4321/"]) {
      let caught: unknown
      try {
        WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1, url })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(WebMcpProfile.OriginNotGrantedError)
      expect((caught as WebMcpProfile.OriginNotGrantedError).origin).toBe(new URL(url).origin)
      expect((caught as Error).message).toBe("WebMCP navigation origin is not allowed")
    }
  })

  test("non-grantable shapes stay plain errors", () => {
    const profile = base()
    for (const url of [
      "http://news.test/",
      "blob:https://news.test/x",
      "https://user:pw@news.test/",
      "ftp://x.test/",
    ]) {
      let caught: unknown
      try {
        WebMcpProfile.validateCall(profile, "new_page", { url })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(Error)
      expect(caught).not.toBeInstanceOf(WebMcpProfile.OriginNotGrantedError)
    }
  })

  test("withGrants extends the effective list and the regenerated argv, not the configured profile", () => {
    const profile = base()
    const effective = WebMcpProfile.withGrants(profile, ["https://news.test"])
    expect(effective.allowedOrigins).toEqual(["https://example.test", "https://news.test"])
    expect(Object.isFrozen(effective.allowedOrigins)).toBe(true)
    expect(profile.allowedOrigins).toEqual(["https://example.test"])
    expect(WebMcpProfile.command(effective)).toContain("--allowed-url-pattern=https://news.test/*")
    expect(WebMcpProfile.command(profile)).not.toContain("--allowed-url-pattern=https://news.test/*")
    expect(() => WebMcpProfile.validateCall(effective, "new_page", { url: "https://news.test/a" })).not.toThrow()
    expect(WebMcpProfile.withGrants(profile, [])).toBe(profile)
    expect(WebMcpProfile.withGrants(profile, ["https://example.test"])).toBe(profile)
  })

  test("the managed requirement is a ceiling: refusals never offer a grant", () => {
    const profile = base()
    expect(WebMcpProfile.checkGrant(undefined, profile, [], "https://news.test")).toEqual({ ok: true })
    expect(WebMcpProfile.checkGrant({ allow: true }, profile, [], "https://news.test")).toEqual({ ok: true })
    expect(WebMcpProfile.checkGrant({ allow: false }, profile, [], "https://news.test")).toMatchObject({ ok: false })
    expect(
      WebMcpProfile.checkGrant({ allowedOrigins: ["https://example.test"] }, profile, [], "https://news.test"),
    ).toMatchObject({ ok: false, error: expect.stringContaining("managed policy") })
    expect(
      WebMcpProfile.checkGrant({ allowedOrigins: ["https://news.test"] }, profile, [], "https://news.test"),
    ).toEqual({ ok: true })
  })

  test("grants reject non-exact origins and respect the 8-origin cap", () => {
    const profile = base()
    for (const origin of ["https://news.test/path", "*", "http://news.test", "https://*.news.test"]) {
      expect(WebMcpProfile.checkGrant(undefined, profile, [], origin)).toMatchObject({ ok: false })
    }
    const granted = Array.from({ length: 7 }, (_, i) => `https://g${i}.test`)
    expect(WebMcpProfile.checkGrant(undefined, profile, granted, "https://extra.test")).toMatchObject({ ok: false })
    expect(WebMcpProfile.checkGrant(undefined, profile, granted, "https://g0.test")).toEqual({ ok: true })
  })

  test("a grant under a managed narrowing is not widened by evaluate", () => {
    const effective = WebMcpProfile.withGrants(base(), ["https://news.test"])
    const decision = WebMcpProfile.evaluate({ allowedOrigins: ["https://example.test"] }, effective)
    expect(decision.ok && decision.profile.allowedOrigins).toEqual(["https://example.test"])
  })

  test("the grant prompt names the origin, the relaunch and the session scope", () => {
    const lines = webMcpApprovalLines({
      originGrant: true,
      server: "webmcp",
      origin: "https://news.test",
      allowedOrigins: ["https://example.test"],
    })
    expect(lines).toContain("Origin to allow: https://news.test")
    expect(lines.join("\n")).toContain("restarts the browser bridge")
    expect(lines.join("\n")).toContain("session only")
  })
})
