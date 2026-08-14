import { describe, expect, test } from "vitest"
import { resolveConnectedProviderID, resolveExplicitMemberSelection } from "../../src/mode/ensemble-shared"

describe("resolveConnectedProviderID", () => {
  const connected = ["alibaba-pai", "grok-build-cli", "deepseek"]

  test("returns an exact connected id", () => {
    expect(resolveConnectedProviderID("grok-build-cli", connected)).toBe("grok-build-cli")
  })

  test("maps colloquial grok/xai to grok-build-cli when connected", () => {
    expect(resolveConnectedProviderID("grok", connected)).toBe("grok-build-cli")
    expect(resolveConnectedProviderID("xai", connected)).toBe("grok-build-cli")
  })

  test("does not invent a provider that is not connected", () => {
    expect(resolveConnectedProviderID("codex", connected)).toBeUndefined()
    expect(resolveConnectedProviderID("codex-cli", connected)).toBeUndefined()
  })

  test("is case-insensitive for exact ids", () => {
    expect(resolveConnectedProviderID("DeepSeek", connected)).toBe("deepseek")
  })
})

describe("resolveExplicitMemberSelection", () => {
  const connectedIDs = ["alibaba-pai", "grok-build-cli", "deepseek"]
  const selectableModels = {
    "alibaba-pai": ["Ornith-1.0-397B-FP8"],
    "grok-build-cli": ["grok-build-cli"],
    deepseek: ["deepseek-chat"],
  }

  test("maps grok + unknown model to grok-build-cli default", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "xai",
      requestedModel: "grok-4",
      connectedIDs,
      selectableModels,
    })
    expect(result).toEqual({
      member: { providerID: "grok-build-cli", modelID: "grok-build-cli" },
      note: 'Requested "xai/grok-4" is not selectable; using grok-build-cli/grok-build-cli.',
    })
  })

  test("rejects unknown providers without inventing them", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "codex",
      requestedModel: "codex-cli",
      connectedIDs,
      selectableModels,
    })
    expect(result).toMatchObject({ rejected: expect.stringContaining("Unknown provider") })
    if ("rejected" in result) {
      expect(result.rejected).toContain("grok-build-cli")
      expect(result.rejected).toContain("authoritative")
    }
  })

  test("keeps an exact selectable model", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "deepseek",
      requestedModel: "deepseek-chat",
      connectedIDs,
      selectableModels,
    })
    expect(result).toEqual({ member: { providerID: "deepseek", modelID: "deepseek-chat" } })
  })
})
