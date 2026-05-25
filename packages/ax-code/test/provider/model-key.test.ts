import { describe, expect, test } from "bun:test"
import { providerModelKey } from "../../src/provider/model-key"
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
})
