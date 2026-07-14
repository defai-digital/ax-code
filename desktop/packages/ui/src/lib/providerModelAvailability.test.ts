// @vitest-environment node

import { describe, expect, test } from "vitest"
import { getProviderModelDisabledReason, isProviderModelSelectable } from "./providerModelAvailability"

describe("provider model availability", () => {
  test("blocks image-only models from the AX Code model picker", () => {
    const model = { capabilities: { output: { text: false, image: true } } }

    expect(getProviderModelDisabledReason(model)).toBe("This model cannot return text responses required by AX Code.")
    expect(isProviderModelSelectable(model)).toBe(false)
  })

  test("keeps text-capable models selectable unless another restriction applies", () => {
    expect(isProviderModelSelectable({ capabilities: { output: { text: true } } })).toBe(true)
    expect(
      getProviderModelDisabledReason({
        capabilities: { output: { text: true } },
        options: { memoryBlockReason: "Requires more memory" },
      }),
    ).toBe("Requires more memory")
  })
})
