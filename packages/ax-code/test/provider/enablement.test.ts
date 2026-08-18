import { describe, expect, test } from "vitest"
import { disableProviderPatch, enableProviderPatch, isProviderDisabled } from "@/provider/enablement"
import type { Config } from "@/config/config"

function config(input: Partial<Config.Info>): Config.Info {
  return input as Config.Info
}

describe("disableProviderPatch", () => {
  test("appends to an empty disabled list", () => {
    expect(disableProviderPatch(config({}), "openai")).toEqual({ disabled_providers: ["openai"] })
  })

  test("appends to existing disabled providers", () => {
    expect(disableProviderPatch(config({ disabled_providers: ["anthropic"] }), "openai")).toEqual({
      disabled_providers: ["anthropic", "openai"],
    })
  })

  test("is a no-op when already disabled", () => {
    expect(disableProviderPatch(config({ disabled_providers: ["openai"] }), "openai")).toEqual({})
  })
})

describe("enableProviderPatch", () => {
  test("removes from disabled_providers", () => {
    expect(enableProviderPatch(config({ disabled_providers: ["openai", "anthropic"] }), "openai")).toEqual({
      disabled_providers: ["anthropic"],
    })
  })

  test("adds to enabled_providers allowlist when one exists", () => {
    expect(
      enableProviderPatch(config({ disabled_providers: ["openai"], enabled_providers: ["anthropic"] }), "openai"),
    ).toEqual({
      disabled_providers: [],
      enabled_providers: ["anthropic", "openai"],
    })
  })

  test("does not duplicate an allowlisted provider", () => {
    expect(
      enableProviderPatch(config({ disabled_providers: ["openai"], enabled_providers: ["openai"] }), "openai"),
    ).toEqual({ disabled_providers: [] })
  })

  test("is a no-op for a provider that is not disabled", () => {
    expect(enableProviderPatch(config({}), "openai")).toEqual({})
  })
})

describe("isProviderDisabled", () => {
  test("reflects disabled_providers", () => {
    expect(isProviderDisabled(config({ disabled_providers: ["openai"] }), "openai")).toBe(true)
    expect(isProviderDisabled(config({ disabled_providers: ["openai"] }), "anthropic")).toBe(false)
  })

  test("reflects the enabled_providers allowlist", () => {
    expect(isProviderDisabled(config({ enabled_providers: ["anthropic"] }), "openai")).toBe(true)
    expect(isProviderDisabled(config({ enabled_providers: ["anthropic"] }), "anthropic")).toBe(false)
  })

  test("disabled_providers wins over the allowlist", () => {
    expect(
      isProviderDisabled(config({ disabled_providers: ["openai"], enabled_providers: ["openai"] }), "openai"),
    ).toBe(true)
  })
})
