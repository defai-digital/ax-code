import { describe, expect, test } from "vitest"
import { isEligibleWorkModel, workModelIneligibleReason } from "../../../src/visual/computer/model-policy"

describe("WorkModelPolicy", () => {
  test("qualifies gpt-5.6-sol and grok-4.5 with vision + tools", () => {
    expect(
      isEligibleWorkModel({
        providerID: "openai",
        modelID: "gpt-5.6-sol",
        capabilities: { imageInput: true, toolCall: true },
      }),
    ).toBe(true)
    expect(
      isEligibleWorkModel({
        providerID: "xai",
        modelID: "grok-4.5",
        capabilities: { imageInput: true, toolCall: true },
      }),
    ).toBe(true)
  })

  test("rejects text-only, unknown IDs, and local providers", () => {
    expect(
      workModelIneligibleReason({
        providerID: "openai",
        modelID: "gpt-5.6",
        capabilities: { imageInput: false, toolCall: true },
      }),
    ).toMatch(/image input/)
    expect(
      workModelIneligibleReason({
        providerID: "openai",
        modelID: "gpt-4.6",
        capabilities: { imageInput: true, toolCall: true },
      }),
    ).toMatch(/qualification table/)
    expect(
      workModelIneligibleReason({
        providerID: "ollama",
        modelID: "llama",
        capabilities: { imageInput: true, toolCall: true },
      }),
    ).toMatch(/not a cloud Work route/)
  })

  test("does not treat qwen3.8-max as qualified until the route is probed", () => {
    expect(
      isEligibleWorkModel({
        providerID: "alibaba-token-plan",
        modelID: "qwen3.8-max",
        capabilities: { imageInput: true, toolCall: true },
      }),
    ).toBe(false)
  })
})
