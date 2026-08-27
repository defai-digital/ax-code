import { describe, expect, test } from "vitest"
import { disabledProviderIDs } from "../../../src/cli/cmd/tui/component/provider-list-view-model"

describe("tui provider list view model", () => {
  test("returns empty when config is undefined", () => {
    expect(disabledProviderIDs(undefined, ["anthropic"])).toEqual([])
  })

  test("returns empty when disabled_providers is empty", () => {
    expect(disabledProviderIDs({ disabled_providers: [] }, ["anthropic"])).toEqual([])
    expect(disabledProviderIDs({}, ["anthropic"])).toEqual([])
  })

  test("filters retired provider IDs", () => {
    expect(disabledProviderIDs({ disabled_providers: ["xai", "qoder-cli", "openrouter"] }, [])).toEqual(["openrouter"])
  })

  test("filters IDs that are already present in the connected list", () => {
    // During the window between a config update and the provider list refetch,
    // a freshly disabled provider is still present in both lists; it must not
    // be double-counted as disabled.
    expect(disabledProviderIDs({ disabled_providers: ["anthropic", "openai"] }, ["anthropic"])).toEqual(["openai"])
  })

  test("keeps valid disabled IDs not present in the connected list", () => {
    expect(disabledProviderIDs({ disabled_providers: ["openai", "groq"] }, ["anthropic"])).toEqual(["openai", "groq"])
  })

  test("retired matching is case-insensitive", () => {
    expect(disabledProviderIDs({ disabled_providers: ["XAI", "anthropic"] }, [])).toEqual(["anthropic"])
  })
})
