import { describe, expect, test } from "bun:test"
import { providerModelEquals, providerModelKey } from "../../src/provider/model-key"
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
})
