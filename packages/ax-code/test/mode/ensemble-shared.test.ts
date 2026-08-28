import { describe, expect, test } from "vitest"
import {
  followSkuOnConnectedProviders,
  keepDistinctProviderMembers,
  resolveConnectedProviderID,
  resolveExplicitMemberSelection,
} from "../../src/mode/ensemble-shared"

describe("resolveConnectedProviderID", () => {
  const connected = ["alibaba-pai", "grok-build-cli", "deepseek"]

  test("returns an exact connected id", () => {
    expect(resolveConnectedProviderID("grok-build-cli", connected)).toBe("grok-build-cli")
  })

  test("maps colloquial grok/xai to grok-build-cli when connected", () => {
    expect(resolveConnectedProviderID("grok", connected)).toBe("grok-build-cli")
    expect(resolveConnectedProviderID("Grok Build", connected)).toBe("grok-build-cli")
    expect(resolveConnectedProviderID("grokbuild", connected)).toBe("grok-build-cli")
    expect(resolveConnectedProviderID("xai", connected)).toBe("grok-build-cli")
  })

  test("does not invent a provider that is not connected", () => {
    expect(resolveConnectedProviderID("codex", connected)).toBeUndefined()
    expect(resolveConnectedProviderID("codex-cli", connected)).toBeUndefined()
  })

  test("is case-insensitive for exact ids", () => {
    expect(resolveConnectedProviderID("DeepSeek", connected)).toBe("deepseek")
  })

  test("maps colloquial names for cli providers", () => {
    const cliConnected = ["grok-build-cli", "kimi-cli", "claude-code", "codex-cli"]
    expect(resolveConnectedProviderID("gemini", cliConnected)).toBeUndefined()
    expect(resolveConnectedProviderID("kimi", cliConnected)).toBe("kimi-cli")
    expect(resolveConnectedProviderID("Kimi Code", cliConnected)).toBe("kimi-cli")
    expect(resolveConnectedProviderID("Grok Build CLI", cliConnected)).toBe("grok-build-cli")
    expect(resolveConnectedProviderID("qodercli", cliConnected)).toBeUndefined()
    expect(resolveConnectedProviderID("claude", cliConnected)).toBe("claude-code")
    expect(resolveConnectedProviderID("openai", cliConnected)).toBe("codex-cli")
    expect(resolveConnectedProviderID("chatgpt", cliConnected)).toBe("codex-cli")
    expect(resolveConnectedProviderID("gemini", ["google"])).toBe("google")
  })

  test("maps colloquial minimax to the coding-plan provider when connected", () => {
    const connected = ["ax-trust-defai-digital", "claude-code", "minimax-coding-plan"]
    expect(resolveConnectedProviderID("minimax", connected)).toBe("minimax-coding-plan")
    expect(resolveConnectedProviderID("MiniMax Token Plan", connected)).toBe("minimax-coding-plan")
    expect(resolveConnectedProviderID("deepseek", connected)).toBeUndefined()
  })

  test("maps plan-provider colloquial names to the connected first-party id", () => {
    const connected = [
      "alibaba-token-plan",
      "zai-coding-plan",
      "kimi-cli",
      "minimax-coding-plan",
      "grok-build-cli",
      "ax-trust-defai-digital",
    ]
    expect(resolveConnectedProviderID("qwen", connected)).toBe("alibaba-token-plan")
    expect(resolveConnectedProviderID("alibaba", connected)).toBe("alibaba-token-plan")
    expect(resolveConnectedProviderID("dashscope", connected)).toBe("alibaba-token-plan")
    expect(resolveConnectedProviderID("glm", connected)).toBe("zai-coding-plan")
    expect(resolveConnectedProviderID("zai", connected)).toBe("zai-coding-plan")
    expect(resolveConnectedProviderID("Z.AI", connected)).toBe("zai-coding-plan")
    expect(resolveConnectedProviderID("zhipu", connected)).toBe("zai-coding-plan")
    expect(resolveConnectedProviderID("moonshot", connected)).toBe("kimi-cli")
    expect(resolveConnectedProviderID("grok-4.6", connected)).toBe("grok-build-cli")
    expect(resolveConnectedProviderID("ax-trust", connected)).toBe("ax-trust-defai-digital")
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
      note:
        'Provider "xai" resolved to connected alias grok-build-cli. ' +
        'Requested "xai/grok-4" is not selectable; using grok-build-cli/grok-build-cli.',
    })
  })

  test("reports a provider alias even when the requested model is selectable", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "Grok Build",
      connectedIDs,
      selectableModels,
    })

    expect(result).toEqual({
      member: { providerID: "grok-build-cli", modelID: "grok-build-cli" },
      note: 'Provider "Grok Build" resolved to connected alias grok-build-cli.',
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

  test("explains an undecryptable credential instead of calling the provider unknown", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "codex-cli",
      connectedIDs,
      selectableModels,
      undecryptableIDs: ["codex-cli", "xai"],
    })
    expect(result).toMatchObject({ rejected: expect.stringContaining("cannot be decrypted") })
    if ("rejected" in result) {
      expect(result.rejected).toContain("ax-code providers login --provider codex-cli")
      expect(result.rejected).not.toContain("Unknown provider")
    }
  })

  test("resolves aliases against the undecryptable set too", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "codex",
      connectedIDs,
      selectableModels,
      undecryptableIDs: ["codex-cli"],
    })
    expect(result).toMatchObject({ rejected: expect.stringContaining("codex-cli") })
    if ("rejected" in result) {
      expect(result.rejected).toContain("cannot be decrypted")
    }
  })

  test("still reports unknown when the provider is neither connected nor undecryptable", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "codex",
      connectedIDs,
      selectableModels,
      undecryptableIDs: ["groq"],
    })
    expect(result).toMatchObject({ rejected: expect.stringContaining("Unknown provider") })
  })

  test("follows a disabled native SKU onto a mixed gateway catalog", () => {
    const gatewayConnected = ["ax-trust-defai-digital", "claude-code", "minimax-coding-plan"]
    const gatewayModels = {
      "ax-trust-defai-digital": ["qwen3.8-max", "MiniMax-M3", "deepseek-v4-pro", "deepseek-v4-flash"],
      "claude-code": ["opus"],
      "minimax-coding-plan": ["MiniMax-M2.7"],
    }
    const result = resolveExplicitMemberSelection({
      requestedProvider: "deepseek",
      connectedIDs: gatewayConnected,
      selectableModels: gatewayModels,
      disabledIDs: ["deepseek"],
    })
    expect(result).toEqual({
      member: { providerID: "ax-trust-defai-digital", modelID: "deepseek-v4-pro" },
      note: 'Provider "deepseek" is disabled; using ax-trust-defai-digital/deepseek-v4-pro (same SKU on a connected provider).',
    })
  })

  test("follows an explicit model ID onto the connected gateway", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "deepseek",
      requestedModel: "deepseek-v4-flash",
      connectedIDs: ["ax-trust-defai-digital"],
      selectableModels: {
        "ax-trust-defai-digital": ["qwen3.8-max", "deepseek-v4-pro", "deepseek-v4-flash"],
      },
      disabledIDs: ["deepseek"],
    })
    expect(result).toEqual({
      member: { providerID: "ax-trust-defai-digital", modelID: "deepseek-v4-flash" },
      note: 'Provider "deepseek" is disabled; using ax-trust-defai-digital/deepseek-v4-flash (same SKU on a connected provider).',
    })
  })

  test("says disabled instead of unknown when the native provider is off and no SKU exists", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "deepseek",
      connectedIDs: ["claude-code"],
      selectableModels: { "claude-code": ["opus"] },
      disabledIDs: ["deepseek"],
    })
    expect(result).toMatchObject({ rejected: expect.stringContaining("is disabled") })
    if ("rejected" in result) {
      expect(result.rejected).toContain("ax-code providers enable deepseek")
      expect(result.rejected).not.toContain("Unknown provider")
    }
  })

  test("aliases minimax without taking another family from a gateway", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "minimax",
      connectedIDs: ["ax-trust-defai-digital", "minimax-coding-plan"],
      selectableModels: {
        "ax-trust-defai-digital": ["qwen3.8-max", "deepseek-v4-pro"],
        "minimax-coding-plan": ["MiniMax-M2.7", "MiniMax-M3"],
      },
    })
    expect(result).toEqual({
      member: { providerID: "minimax-coding-plan", modelID: "MiniMax-M2.7" },
      note: 'Provider "minimax" resolved to connected alias minimax-coding-plan.',
    })
  })

  const mixedGateway = {
    connectedIDs: ["ax-trust-defai-digital", "claude-code"],
    selectableModels: {
      "ax-trust-defai-digital": [
        "qwen3.8-max",
        "MiniMax-M3",
        "deepseek-v4-pro",
        "glm-5.3",
        "glm-4.7",
        "k3",
        "grok-4.6",
      ],
      "claude-code": ["opus"],
    },
  }

  test("follows disabled Alibaba Qwen onto the gateway qwen SKU", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "qwen",
      ...mixedGateway,
      disabledIDs: ["alibaba-token-plan"],
    })
    expect(result).toMatchObject({
      member: { providerID: "ax-trust-defai-digital", modelID: "qwen3.8-max" },
    })
    if ("note" in result) expect(result.note).toContain("qwen3.8-max")
  })

  test("follows disabled GLM / Z.AI onto the gateway glm SKU", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "glm",
      ...mixedGateway,
      disabledIDs: ["zai-coding-plan"],
    })
    expect(result).toMatchObject({
      member: { providerID: "ax-trust-defai-digital", modelID: "glm-5.3" },
    })
  })

  test("follows disabled Kimi onto gateway k3, not qwen", () => {
    const result = resolveExplicitMemberSelection({
      requestedProvider: "kimi",
      ...mixedGateway,
      disabledIDs: ["kimi-cli"],
    })
    expect(result).toMatchObject({
      member: { providerID: "ax-trust-defai-digital", modelID: "k3" },
    })
  })
})

describe("followSkuOnConnectedProviders", () => {
  test("does not pick the gateway's first non-matching model", () => {
    expect(
      followSkuOnConnectedProviders({
        requestedProvider: "deepseek",
        connectedIDs: ["ax-trust-defai-digital"],
        selectableModels: {
          "ax-trust-defai-digital": ["qwen3.8-max", "MiniMax-M3", "deepseek-v4-pro"],
        },
      }),
    ).toEqual({ providerID: "ax-trust-defai-digital", modelID: "deepseek-v4-pro" })
  })

  test("maps short glm/zai names onto glm SKUs", () => {
    expect(
      followSkuOnConnectedProviders({
        requestedProvider: "glm",
        connectedIDs: ["ax-trust-defai-digital"],
        selectableModels: {
          "ax-trust-defai-digital": ["qwen3.8-max", "glm-5.3", "deepseek-v4-pro"],
        },
      }),
    ).toEqual({ providerID: "ax-trust-defai-digital", modelID: "glm-5.3" })
  })

  test("maps kimi onto k3 when the catalog uses the k3 id", () => {
    expect(
      followSkuOnConnectedProviders({
        requestedProvider: "kimi",
        connectedIDs: ["ax-trust-defai-digital"],
        selectableModels: {
          "ax-trust-defai-digital": ["qwen3.8-max", "k3", "k3-256k"],
        },
      }),
    ).toEqual({ providerID: "ax-trust-defai-digital", modelID: "k3" })
  })
})

describe("keepDistinctProviderMembers", () => {
  test("rejects the later member when two names collapse onto one provider", () => {
    const result = keepDistinctProviderMembers([
      { providerID: "ax-trust-defai-digital", memberId: "ax-trust-defai-digital/deepseek-v4-pro" },
      { providerID: "ax-trust-defai-digital", memberId: "ax-trust-defai-digital/MiniMax-M3" },
    ])
    expect(result.members).toEqual([
      { providerID: "ax-trust-defai-digital", memberId: "ax-trust-defai-digital/deepseek-v4-pro" },
    ])
    expect(result.rejected).toEqual([
      "Council requires distinct providers — ax-trust-defai-digital/MiniMax-M3 collides with another member on ax-trust-defai-digital.",
    ])
  })
})
