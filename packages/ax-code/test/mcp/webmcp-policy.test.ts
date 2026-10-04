import { describe, expect, test } from "vitest"
import { Config } from "../../src/config/config"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const origins = ["https://example.test", "https://other.test"]
const profile = () => WebMcpProfile.config({ allowedOrigins: origins }, true).webmcp

describe("WebMCP managed requirement", () => {
  test("schema admits allow and exact origins only", () => {
    expect(Config.Info.safeParse({ webmcp: {} }).success).toBe(true)
    expect(Config.Info.safeParse({ webmcp: { allow: false } }).success).toBe(true)
    expect(Config.Info.safeParse({ webmcp: { allow: true, allowedOrigins: origins } }).success).toBe(true)
    expect(Config.Info.safeParse({ webmcp: { allowedOrigins: ["*"] } }).success).toBe(false)
    expect(Config.Info.safeParse({ webmcp: { allowedOrigins: [] } }).success).toBe(false)
    expect(Config.Info.safeParse({ webmcp: { allow: "no" } }).success).toBe(false)
    expect(Config.Info.safeParse({ webmcp: { extra: true } }).success).toBe(false)
  })

  test("an absent requirement leaves the profile untouched", () => {
    const current = profile()
    expect(WebMcpProfile.applyRequirement(undefined, current)).toBe(current)
    expect(WebMcpProfile.applyRequirement({ allow: true }, current)).toBe(current)
  })

  test("a managed deny fails closed", () => {
    expect(() => WebMcpProfile.applyRequirement({ allow: false }, profile())).toThrow("disabled by managed policy")
  })

  test("evaluate reports denial reasons without throwing", () => {
    const current = profile()
    expect(WebMcpProfile.evaluate(undefined, current)).toEqual({ ok: true, profile: current })
    expect(WebMcpProfile.evaluate({ allow: false }, current)).toEqual({ ok: false, reason: "managed_policy" })
    expect(WebMcpProfile.evaluate({ allowedOrigins: ["https://unlisted.test"] }, current)).toEqual({
      ok: false,
      reason: "managed_origins",
    })
    const decision = WebMcpProfile.evaluate({ allow: true, allowedOrigins: ["https://other.test"] }, current)
    expect(decision.ok && decision.profile.allowedOrigins).toEqual(["https://other.test"])
  })

  test("a managed origin list narrows to the intersection", () => {
    const narrowed = WebMcpProfile.applyRequirement(
      { allow: true, allowedOrigins: ["https://example.test", "https://unlisted.test"] },
      profile(),
    )
    expect(narrowed.allowedOrigins).toEqual(["https://example.test"])
    expect(Object.isFrozen(narrowed.allowedOrigins)).toBe(true)
    expect(() => WebMcpProfile.validateCall(narrowed, "new_page", { url: "https://other.test/" })).toThrow(
      "origin is not allowed",
    )
    expect(() => WebMcpProfile.validateCall(narrowed, "new_page", { url: "https://example.test/" })).not.toThrow()
  })

  test("a managed origin list with no overlap fails closed", () => {
    expect(() => WebMcpProfile.applyRequirement({ allowedOrigins: ["https://unlisted.test"] }, profile())).toThrow(
      "excludes every origin",
    )
  })

  test("narrowing never rewrites the launch argv, which stays validated against the full profile", () => {
    const config = WebMcpProfile.config({ allowedOrigins: origins }, true)
    const validated = WebMcpProfile.validateLaunch(config)!
    const effective = WebMcpProfile.applyRequirement({ allowedOrigins: ["https://example.test"] }, validated)
    expect(effective.allowedOrigins).toEqual(["https://example.test"])
    expect(WebMcpProfile.validateLaunch(config)).toEqual(validated)
  })

  test("parses the bridge's structured listing and page text", () => {
    const pages = WebMcpProfile.parsePages("## Pages\n1: about:blank\n2: Home (https://example.test/) [selected]")
    expect(pages.get(1)).toBe("about:blank")
    expect(pages.get(2)).toBe("https://example.test/")

    const listing = WebMcpProfile.parseToolListing({
      structuredContent: {
        webmcpTools: [
          {
            name: "a",
            description: "d",
            inputSchema: { type: "object" },
            annotations: { readOnly: true, consequential: true },
          },
        ],
      },
    })
    expect(listing).toHaveLength(1)
    expect(listing?.[0]?.annotations).toEqual({ readOnly: true, untrustedContent: false, consequential: true })
    expect(WebMcpProfile.parseToolListing({})).toBeUndefined()
  })

  test("descriptor caps fail closed", () => {
    const state = WebMcpProfile.stateFor(profile())
    const many = Array.from({ length: WebMcpProfile.MAX_TOOLS + 1 }, (_, i) => ({ name: `t${i}` }))
    expect(WebMcpProfile.recordListing(state, 1, many)).toMatchObject({ ok: false })
    expect(
      WebMcpProfile.recordListing(state, 2, [
        { name: "a", description: "x".repeat(WebMcpProfile.MAX_DESCRIPTOR_BYTES) },
      ]),
    ).toMatchObject({ ok: false })
  })

  test("definition churn past the cap disables the page", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    for (let i = 0; i <= WebMcpProfile.MAX_REGISTRATION_CHANGES; i++) {
      WebMcpProfile.recordListing(state, 1, [{ name: "a", description: `v${i}` }])
    }
    expect(WebMcpProfile.verifyBinding(current, 1, "a", [], "https://example.test/")).toMatchObject({ ok: false })
  })

  test("verifyBinding matches the listed descriptor and rejects drift", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "search", description: "d", inputSchema: { type: "object" } }
    expect(WebMcpProfile.recordListing(state, 5, [descriptor])).toEqual({ ok: true })
    expect(WebMcpProfile.verifyBinding(current, 5, "search", [descriptor], "https://example.test/page")).toEqual({
      ok: true,
    })
    expect(
      WebMcpProfile.verifyBinding(
        current,
        5,
        "search",
        [{ ...descriptor, description: "changed" }],
        "https://example.test/page",
      ),
    ).toMatchObject({ ok: false })
    expect(WebMcpProfile.verifyBinding(current, 5, "search", [descriptor], "https://evil.test/page")).toMatchObject({
      ok: false,
    })
    expect(WebMcpProfile.verifyBinding(current, 5, "search", [descriptor])).toMatchObject({ ok: false })
  })

  test("a persistent profile requires the managed opt-in", () => {
    const persistent = WebMcpProfile.config({ allowedOrigins: ["https://example.test"], persistentProfile: true }, true)
    expect(WebMcpProfile.evaluate(undefined, persistent.webmcp)).toEqual({ ok: false, reason: "persistent_profile" })
    expect(WebMcpProfile.evaluate({ allowPersistentProfile: true }, persistent.webmcp)).toMatchObject({ ok: true })
    expect(WebMcpProfile.evaluate({ allow: false }, persistent.webmcp)).toEqual({ ok: false, reason: "managed_policy" })
  })

  test("a persistent profile uses a dedicated user-data-dir with a visible window", () => {
    const config = WebMcpProfile.config(
      { allowedOrigins: ["https://example.test"], persistentProfile: true, headless: true },
      true,
    )
    expect(config.command.some((arg) => arg.startsWith("--user-data-dir="))).toBe(true)
    expect(config.command).not.toContain("--isolated")
    expect(config.command).not.toContain("--headless")
    expect(WebMcpProfile.validateLaunch(config)).toEqual(config.webmcp)
  })
})
