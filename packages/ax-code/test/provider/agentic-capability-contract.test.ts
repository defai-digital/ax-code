import { describe, expect, test } from "vitest"
import { createAnthropic } from "@ai-sdk/anthropic"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"
import { isModelSupportedForProvider } from "../../src/provider/model-support"
import { longAgentProfileForModel } from "../../src/provider/agent-optimization-profile"
import { SuperLongPolicy } from "../../src/session/super-long-policy"
import { ReasoningPolicy } from "../../src/control-plane/reasoning-policy"
import { parseJsonStrict } from "../../src/util/json-value"

describe("current model request contracts", () => {
  test.each(["gpt-6", "gpt-6-astra"])("admits first-party %s", (id) => {
    expect(isModelSupportedForProvider("openai", id)).toBe(true)
  })

  test.each(["gpt-5.5", "gpt-5.2", "gpt-60-astra", "gpt-7"])("keeps unsupported %s excluded", (id) => {
    expect(isModelSupportedForProvider("openai", id)).toBe(false)
  })

  test.each(["claude-opus-5", "claude-opus-4-8", "claude-opus-4-5"])(
    "serializes %s through the installed SDK",
    async (id) => {
      const model = {
        id,
        providerID: "anthropic",
        api: { id, npm: "@ai-sdk/anthropic" },
        capabilities: { reasoning: true },
        limit: { context: 1_000_000, output: 128_000 },
        options: {},
      } as Provider.Model
      model.variants = ProviderTransform.variants(model)
      const decision = ReasoningPolicy.decide({ model, agent: { name: "build" }, messages: [], autonomous: true })
      let body: any
      const sdk = createAnthropic({
        apiKey: "test",
        fetch: async (_url, init) => {
          body = parseJsonStrict(String(init?.body))
          throw new Error("intercepted request")
        },
      })
      await expect(
        sdk(id).doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Test" }] }],
          maxOutputTokens: ProviderTransform.maxOutputTokens(model),
          providerOptions: { anthropic: decision.options as any },
        }),
      ).rejects.toThrow("intercepted request")
      expect(body.output_config.effort).toBe("high")
      expect(body.thinking).toEqual(
        id === "claude-opus-4-5" ? { type: "enabled", budget_tokens: 16384 } : { type: "adaptive" },
      )
    },
  )
})

describe("observed long-task capability", () => {
  test("positive metadata does not override an explicit registered restriction", () => {
    expect(
      longAgentProfileForModel("claude-3-5-sonnet", "anthropic", {
        contextWindow: 200_000,
        thinking: true,
        toolCalling: true,
      }).contextPackingBudget,
    ).toBe("narrow")
  })
  test.each(["qwen3.8-max", "deepseek-flash", "gpt-6-astra", "grok-4.6", "claude-opus-5"])(
    "packs %s without granting transport features or marathon mode",
    (modelID) => {
      const observed = { contextWindow: 200_000, thinking: true, toolCalling: true }
      expect(longAgentProfileForModel(modelID, "custom-route", observed)).toMatchObject({
        contextPackingBudget: "wide",
        thinkingEnabled: true,
        promptCacheEligible: false,
        preserveThinkingEligible: false,
      })
      expect(SuperLongPolicy.state({ modelID, providerID: "custom-route", observed }).enabled).toBe(false)
      expect(
        longAgentProfileForModel(modelID, "custom-route", { ...observed, toolCalling: false }).contextPackingBudget,
      ).toBe("narrow")
    },
  )
})

test("GPT-6 compatibility options stay on the first-party Responses route", () => {
  const model = {
    id: "gpt-6-astra",
    providerID: "openai",
    api: { id: "gpt-6-astra", npm: "@ai-sdk/openai" },
    capabilities: {},
  } as Provider.Model
  expect(ProviderTransform.sanitizeOptions(model, { reasoningEffort: "none" })).toEqual({
    forceReasoning: true,
    reasoningEffort: "none",
  })
  expect(ProviderTransform.sanitizeOptions({ ...model, providerID: "custom" } as Provider.Model, {})).toEqual({})
  expect(
    ProviderTransform.sanitizeOptions({ ...model, api: { ...model.api, npm: "@ai-sdk/openai-compatible" } }, {}),
  ).toEqual({})
})
