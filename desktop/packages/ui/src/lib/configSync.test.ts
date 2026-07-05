import { describe, expect, test } from "vitest"
import { normalizeConfigChangeScopes } from "./configSync"

describe("normalizeConfigChangeScopes", () => {
  test("deduplicates scopes and collapses all", () => {
    expect(normalizeConfigChangeScopes(["agents", "providers", "agents"])).toEqual(["agents", "providers"])
    expect(normalizeConfigChangeScopes(["agents", "all", "providers"])).toEqual(["all"])
  })

  test("defaults empty scopes to all", () => {
    expect(normalizeConfigChangeScopes()).toEqual(["all"])
    expect(normalizeConfigChangeScopes([])).toEqual(["all"])
  })
})
