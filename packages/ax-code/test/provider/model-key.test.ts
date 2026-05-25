import { describe, expect, test } from "bun:test"
import {
  isProviderModelKeyInput,
  providerModelEquals,
  providerModelKey,
  providerModelList,
} from "../../src/provider/model-key"
import { ModelID, ProviderID } from "../../src/provider/schema"

describe("providerModelKey", () => {
  test("formats provider and model identity consistently", () => {
    expect(
      providerModelKey({
        providerID: ProviderID.make("openai"),
        modelID: ModelID.make("gpt-5"),
      }),
    ).toBe("openai/gpt-5")
  })

  test("compares provider and model identity by value", () => {
    expect(
      providerModelEquals(
        { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
        { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
      ),
    ).toBe(true)
    expect(
      providerModelEquals(
        { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5") },
        { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("gpt-5") },
      ),
    ).toBe(false)
  })

  test("validates provider model identity boundary values", () => {
    expect(isProviderModelKeyInput({ providerID: "openai", modelID: "gpt-5" })).toBe(true)
    expect(isProviderModelKeyInput({ providerID: "", modelID: "gpt-5" })).toBe(false)
    expect(isProviderModelKeyInput({ providerID: "openai", id: "gpt-5" })).toBe(false)
    expect(isProviderModelKeyInput(null)).toBe(false)
  })

  test("filters stored provider model lists into plain identity objects", () => {
    expect(
      providerModelList([
        { providerID: "openai", modelID: "gpt-5", extra: true },
        { providerID: "anthropic", modelID: "" },
        { providerID: "xai", modelID: "grok-code-fast-1" },
        "not-a-model",
      ]),
    ).toEqual([
      { providerID: "openai", modelID: "gpt-5" },
      { providerID: "xai", modelID: "grok-code-fast-1" },
    ])
    expect(providerModelList({ providerID: "openai", modelID: "gpt-5" })).toEqual([])
  })
})
