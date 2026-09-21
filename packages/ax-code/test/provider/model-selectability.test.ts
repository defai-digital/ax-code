import { describe, expect, test } from "vitest"
import {
  isNonChatModelID,
  modelContextFitBlockReason,
  modelSelectableForProvider,
  providerModelSelectable,
  sameSkuOnConnectedProvider,
} from "@/provider/model-selectability"
import {
  AX_ENGINE_CYBER_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID,
} from "@/provider/ax-engine/constants"

describe("providerModelSelectable", () => {
  test("tool-call models are selectable for any provider", () => {
    expect(providerModelSelectable({ providerID: "some-random-provider", toolcall: true })).toBe(true)
    expect(providerModelSelectable({ providerID: "some-random-provider", toolcall: undefined })).toBe(true)
  })

  test("non-toolcall models are hidden for providers outside the allowlist", () => {
    expect(providerModelSelectable({ providerID: "some-random-provider", toolcall: false })).toBe(false)
  })

  test("ax-engine still requires normal tool-call capability", () => {
    expect(providerModelSelectable({ providerID: "ax-engine", toolcall: false })).toBe(false)
  })
})

describe("modelSelectableForProvider", () => {
  test("rejects models that explicitly cannot return text", () => {
    expect(
      modelSelectableForProvider("alibaba-token-plan", {
        capabilities: { toolcall: false, output: { text: false } },
      }),
    ).toBe(false)
  })

  test("keeps text-capable CLI models selectable without tool-call metadata", () => {
    expect(
      modelSelectableForProvider("grok-build-cli", {
        capabilities: { toolcall: false, output: { text: true } },
      }),
    ).toBe(true)
  })

  test("does not reject models whose output capability is not known", () => {
    expect(modelSelectableForProvider("grok-build-cli", { capabilities: { toolcall: false } })).toBe(true)
    expect(modelSelectableForProvider("muse-cli", { capabilities: { toolcall: false } })).toBe(true)
    expect(modelSelectableForProvider("minimax-cli", { capabilities: { toolcall: false } })).toBe(false)
    expect(modelSelectableForProvider("qoder-cli", { capabilities: { toolcall: false } })).toBe(false)
  })
})

describe("ax-engine local MLX model list", () => {
  // Pinned candidates can be prepared before their live tool contract is known.
  test.each(AX_ENGINE_MODEL_IDS)("%s is selectable", (modelID) => {
    const def = AX_ENGINE_MODEL_DEFINITIONS[modelID]
    expect(
      modelSelectableForProvider("ax-engine", {
        capabilities: { toolcall: def.toolcall },
        options: { axEngineCandidate: Boolean(def.revision) },
      }),
      `${modelID} (toolcall=${def.toolcall}) should be selectable`,
    ).toBe(true)
  })

  // Every model AX Code offers for NEW local selection today must clear the
  // fixed agent/tool-schema budget on its own declared limit (#379): this is
  // the exact gate that would have caught the Tiel Coder regression before
  // it shipped as the default. Scoped to the two currently-selectable
  // aliases, not the full historical catalog — older excluded IDs (e.g.
  // Qwen3-Coder-Next) remain listed only for existing-install status and
  // cleanup and are a separate concern from new selection.
  test.each([AX_ENGINE_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID, AX_ENGINE_CYBER_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID] as const)(
    "%s clears the fixed agent/tool-schema budget",
    (modelID) => {
      const def = AX_ENGINE_MODEL_DEFINITIONS[modelID]
      expect(
        modelSelectableForProvider("ax-engine", {
          capabilities: { toolcall: def.toolcall },
          options: { axEngineCandidate: Boolean(def.revision) },
          limit: { context: def.contextTokens, output: def.outputTokens },
        }),
        `${modelID} (context=${def.contextTokens}, output=${def.outputTokens}) should clear the fixed budget`,
      ).toBe(true)
    },
  )

  test("Tiel packs advertise tool calling and keep a pinned revision", () => {
    for (const id of [
      AX_ENGINE_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID,
      AX_ENGINE_CYBER_TIEL_CODER_35B_AXQ_MXFP4_MODEL_ID,
    ] as const) {
      const definition = AX_ENGINE_MODEL_DEFINITIONS[id]
      expect(definition.toolcall).toBe(true)
      expect(definition.revision).toMatch(/^[a-f0-9]{40}$/)
    }
    expect(modelSelectableForProvider("ax-engine", { capabilities: { toolcall: false } })).toBe(false)
  })
})

describe("modelContextFitBlockReason", () => {
  test("blocks a local model whose usable input can't fit the fixed agent/tool budget", () => {
    // The Tiel Coder pack's original 32,768-context/8,192-output budget: only
    // 24,576 usable input tokens, below the fixed full-agent estimate — every
    // brand-new session on it failed before any turn could be sent (#379).
    expect(modelContextFitBlockReason("ax-engine", { limit: { context: 32_768, output: 8_192 } })).toMatch(/cannot fit/)
    expect(
      modelSelectableForProvider("ax-engine", {
        capabilities: { toolcall: false },
        options: { axEngineCandidate: true },
        limit: { context: 32_768, output: 8_192 },
      }),
    ).toBe(false)
  })

  test("allows a local model whose usable input clears the fixed agent/tool budget", () => {
    expect(modelContextFitBlockReason("ax-engine", { limit: { context: 65_536, output: 8_192 } })).toBeUndefined()
  })

  test("ignores non-ax-engine providers and models with no declared limit", () => {
    expect(modelContextFitBlockReason("anthropic", { limit: { context: 32_768, output: 8_192 } })).toBeUndefined()
    expect(modelContextFitBlockReason("ax-engine", {})).toBeUndefined()
    expect(modelContextFitBlockReason("ax-engine", undefined)).toBeUndefined()
  })
})

describe("isNonChatModelID", () => {
  test("flags embedding, rerank, speech, and image IDs", () => {
    for (const id of [
      "text-embedding-3-small",
      "bge-reranker-v2-m3",
      "whisper-1",
      "gpt-4o-mini-transcribe",
      "tts-1",
      "omni-moderation-latest",
      "dall-e-3",
      "gpt-image-1",
      "gpt-4o-realtime-preview",
    ]) {
      expect(isNonChatModelID(id), id).toBe(true)
    }
  })

  test("keeps chat and vision models", () => {
    for (const id of [
      "deepseek-v4-pro",
      "gpt-4o-mini",
      "glm-5.3-flash",
      "deepseek-v4-flash-vision-exp",
      "MiniMax-M2.7",
    ]) {
      expect(isNonChatModelID(id), id).toBe(false)
    }
  })
})

describe("sameSkuOnConnectedProvider", () => {
  const gateway = {
    id: "127-0-0-1",
    models: {
      "glm-5.3": { tool_call: true },
      "deepseek-v4-pro": { tool_call: true },
      "zai/glm-5.2[1m]": { tool_call: true },
      "text-embedding-3-small": { tool_call: false },
    },
  }

  test("prefers the exact model ID on another connected provider", () => {
    expect(sameSkuOnConnectedProvider([gateway], { providerID: "deepseek", modelID: "deepseek-v4-pro" })).toEqual({
      providerID: "127-0-0-1",
      modelID: "deepseek-v4-pro",
    })
  })

  test("matches across reseller prefixes and [1m] suffixes", () => {
    expect(sameSkuOnConnectedProvider([gateway], { providerID: "zai-coding-plan", modelID: "glm-5.2" })).toEqual({
      providerID: "127-0-0-1",
      modelID: "zai/glm-5.2[1m]",
    })
    expect(
      sameSkuOnConnectedProvider([gateway], { providerID: "nvidia", modelID: "deepseek-ai/DeepSeek-V4-Pro" }),
    ).toEqual({ providerID: "127-0-0-1", modelID: "deepseek-v4-pro" })
  })

  test("never returns the pinned provider itself or an unselectable lane", () => {
    expect(sameSkuOnConnectedProvider([gateway], { providerID: "127-0-0-1", modelID: "glm-5.3" })).toBeUndefined()
    expect(
      sameSkuOnConnectedProvider([gateway], { providerID: "openai", modelID: "text-embedding-3-small" }),
    ).toBeUndefined()
    expect(sameSkuOnConnectedProvider([gateway], { providerID: "openai", modelID: "gpt-5.2" })).toBeUndefined()
  })
})
