import { expect, test } from "vitest"
import { pinWarnings } from "../../src/cli/cmd/debug/routing"

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
