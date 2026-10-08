import { describe, expect, test } from "vitest"
import { webMcpApprovalLines } from "../../src/mcp/webmcp-approval"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const base = () => WebMcpProfile.config({ allowedOrigins: ["https://example.test"] }, true).webmcp

describe("WebMCP session origin grants (ADR-168)", () => {
  test("counterpartOrigin pairs apex and www only for default-port HTTPS names", () => {
    expect(WebMcpProfile.counterpartOrigin("https://news.test")).toBe("https://www.news.test")
    expect(WebMcpProfile.counterpartOrigin("https://www.news.test")).toBe("https://news.test")
    for (const origin of [
      "https://news.test:8443",
      "http://news.test",
      "https://localhost",
      "https://127.0.0.1",
      "https://[::1]",
      "http://localhost:4321",
    ]) {
      expect(WebMcpProfile.counterpartOrigin(origin)).toBeUndefined()
    }
  })

  test("the approval lines name both origins of a pair", () => {
    const lines = webMcpApprovalLines({
      originGrant: true,
      server: "bridge",
      origin: "https://news.test",
      alsoOrigin: "https://www.news.test",
      allowedOrigins: ["https://example.test"],
    })
    expect(lines.join("\n")).toContain("https://news.test and https://www.news.test")
  })

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

  test("an over-cap union reports a decision instead of throwing", () => {
    const profile = base()
    const granted = Array.from({ length: 8 }, (_, i) => `https://g${i}.test`)
    expect(WebMcpProfile.checkGrant(undefined, profile, granted, "https://new.test")).toMatchObject({
      ok: false,
      error: expect.stringContaining("maximum of 8"),
    })
    expect(WebMcpProfile.checkGrant(undefined, profile, granted, "https://g0.test")).toEqual({ ok: true })
    expect(() => WebMcpProfile.withGrants(profile, granted)).toThrow("maximum of 8")
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

describe("WebMCP grantable origin + landing membership (ADR-168)", () => {
  test("grantableOrigin accepts only HTTPS or loopback HTTP without credentials", () => {
    expect(WebMcpProfile.grantableOrigin("https://news.test/a")).toBe("https://news.test")
    expect(WebMcpProfile.grantableOrigin("http://localhost:4321/")).toBe("http://localhost:4321")
    expect(WebMcpProfile.grantableOrigin("http://[::1]:4321/")).toBe("http://[::1]:4321")
    for (const value of [
      "http://news.test/",
      "blob:https://news.test/x",
      "https://user:pw@news.test/",
      "ftp://x.test/",
      "not a url",
    ]) {
      expect(WebMcpProfile.grantableOrigin(value)).toBeUndefined()
    }
  })

  test("validateLanding accepts a landing on any allowed origin but rejects outside the allowlist", () => {
    const profile = WebMcpProfile.config({ allowedOrigins: ["https://a.test", "https://b.test"] }, true).webmcp
    const landing = (url: string, title = "") => ({
      structuredContent: { pages: [{ id: 1, url, title, selected: true }] },
    })
    // A redirect from a.test to b.test is permitted once both are granted.
    expect(() =>
      WebMcpProfile.validateLanding(profile, "new_page", { url: "https://a.test/x" }, landing("https://b.test/")),
    ).not.toThrow()
    // A landing outside the allowlist still fails closed.
    expect(() =>
      WebMcpProfile.validateLanding(profile, "new_page", { url: "https://a.test/x" }, landing("https://c.test/")),
    ).toThrow()
    // The untrusted page title must never decide the origin.
    expect(() =>
      WebMcpProfile.validateLanding(
        profile,
        "new_page",
        { url: "https://a.test/x" },
        landing("chrome-error://chromewebdata/", "b.test"),
      ),
    ).toThrow()
  })
})
