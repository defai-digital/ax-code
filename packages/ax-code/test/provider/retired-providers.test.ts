import { describe, expect, test } from "vitest"
import { RETIRED_PROVIDER_IDS, isRetiredProviderID } from "../../src/provider/retired-providers"
import { CLI_PROVIDER_IDS, isKnownCliProviderID } from "../../src/provider/cli/ids"
import { getCliProviderDefinition } from "../../src/provider/cli/config"
import { CUSTOM_LOADERS } from "../../src/provider/loaders"

describe("retired providers", () => {
  test("retires the MiniMax Code CLI without touching the MiniMax API providers", () => {
    expect(RETIRED_PROVIDER_IDS).toContain("minimax-cli")
    expect(isRetiredProviderID("minimax-cli")).toBe(true)
    expect(isRetiredProviderID("MiniMax-CLI")).toBe(true)

    for (const providerID of ["minimax", "minimax-coding-plan", "minimax-cn-coding-plan"]) {
      expect(isRetiredProviderID(providerID), providerID).toBe(false)
    }
  })

  test("does not load or offer the retired MiniMax Code CLI", () => {
    expect(CLI_PROVIDER_IDS).not.toContain("minimax-cli")
    expect(isKnownCliProviderID("minimax-cli")).toBe(false)
    expect(getCliProviderDefinition("minimax-cli")).toBeUndefined()
    expect(CUSTOM_LOADERS["minimax-cli"]).toBeUndefined()
  })
})
