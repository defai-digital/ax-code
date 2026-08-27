import { describe, expect, test } from "vitest"
import { isNonChatModelID, modelSelectableForProvider, providerModelSelectable } from "@/provider/model-selectability"
import { AX_ENGINE_MODEL_DEFINITIONS, AX_ENGINE_MODEL_IDS } from "@/provider/ax-engine/constants"

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
  })
})

describe("ax-engine local MLX model list", () => {
  // All AX Engine local models are expected to advertise tool calling. This
  // keeps every catalog model selectable through the normal model picker path.
  test.each(AX_ENGINE_MODEL_IDS)("%s is selectable", (modelID) => {
    const def = AX_ENGINE_MODEL_DEFINITIONS[modelID]
    expect(
      modelSelectableForProvider("ax-engine", { capabilities: { toolcall: def.toolcall } }),
      `${modelID} (toolcall=${def.toolcall}) should be selectable`,
    ).toBe(true)
  })

  test("all catalog models declare tool-call support", () => {
    const definitions: Record<string, { toolcall?: boolean }> = AX_ENGINE_MODEL_DEFINITIONS
    expect(AX_ENGINE_MODEL_IDS.filter((id) => definitions[id]?.toolcall === false)).toEqual([])
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
