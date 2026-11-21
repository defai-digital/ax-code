import { expect, test } from "vitest"
import { configuredPins, pinWarnings } from "../../src/cli/cmd/debug/routing"

test("configuredPins lists every configured exact model selection with stable keys", () => {
  const pins = configuredPins({
    model: "gateway/qwen3.8-max",
    small_model: "gateway/glm-5.3",
    wiki: { model: "gateway/xiaomi/mimo-v2.6-pro" },
    experimental: { planner_architect_model: "gateway/glm-5.3" },
    agent: { build: { model: "gateway/qwen3.8-max" }, scout: {} },
    llm_routing: { fallback: [{ providerID: "gateway", modelID: "qwen3.8-max" }] },
  })
  expect(pins).toEqual([
    ["model", "gateway/qwen3.8-max"],
    ["small_model", "gateway/glm-5.3"],
    ["wiki.model", "gateway/xiaomi/mimo-v2.6-pro"],
    ["experimental.planner_architect_model", "gateway/glm-5.3"],
    ["agent.build.model", "gateway/qwen3.8-max"],
    ["llm_routing.fallback[0]", { providerID: "gateway", modelID: "qwen3.8-max" }],
  ])
})

test("configuredPins omits unset keys so configured pin counts stay accurate", () => {
  expect(configuredPins({})).toEqual([])
  expect(configuredPins({ wiki: {}, agent: { scout: {} }, llm_routing: {} })).toEqual([])
})

test("debug routing flags pins whose provider or model is not configured", async () => {
  const providers: Record<string, { models: Record<string, unknown> }> = {
    gateway: { models: { "qwen3.8-max": {}, "xiaomi/mimo-v2.6-pro": {} } },
  }
  const warnings = await pinWarnings(
    [
      ["model", "alibaba-token-plan/qwen3.8-max"],
      ["small_model", "gateway/deepseek-v4-flash"],
      ["wiki.model", undefined],
      ["agent.build.model", "gateway/qwen3.8-max"],
      ["agent.scout.model", "gateway/xiaomi/mimo-v2.6-pro"],
      ["llm_routing.fallback[0]", { providerID: "gateway", modelID: "toString" }],
    ],
    async (providerID) => providers[providerID],
  )
  expect(warnings).toEqual([
    { pin: "model", target: "alibaba-token-plan/qwen3.8-max", reason: "provider not configured" },
    { pin: "small_model", target: "gateway/deepseek-v4-flash", reason: "model not in provider catalog" },
    { pin: "llm_routing.fallback[0]", target: "gateway/toString", reason: "model not in provider catalog" },
  ])
})
