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
})
