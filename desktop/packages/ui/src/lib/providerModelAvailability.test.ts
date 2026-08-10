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

  test("blocks models whose context cannot fit the default agent/tool setup (#379)", () => {
    const small = {
      name: "Qwen3.6 27B (AX Engine Local)",
      capabilities: { output: { text: true } },
      limit: { context: 16384, input: 14745, output: 1639 },
    }
    const reason = getProviderModelDisabledReason(small, "openai")
    expect(reason).toContain("cannot fit the current AX Code agent/tool setup")
    expect(isProviderModelSelectable(small, "openai")).toBe(false)
  })

  test("blocks the reported AX Engine Qwen3.6 27B Local usable budget (#379)", () => {
    // Issue evidence: fixed ~38799, usable 14745 on AX Engine local. Selection
    // must use the full-agent estimate (~40k), not a core-profile underestimate.
    const model = {
      name: "Qwen3.6 27B (AX Engine Local)",
      capabilities: { output: { text: true }, toolcall: true },
      limit: { context: 16384, input: 14745, output: 1639 },
    }
    const reason = getProviderModelDisabledReason(model, "ax-engine")
    expect(reason).toContain("cannot fit the current AX Code agent/tool setup")
    expect(reason).toContain("14745")
    expect(reason).toMatch(/~?40000|40000/)
    expect(isProviderModelSelectable(model, "ax-engine")).toBe(false)
  })

  test("allows large-context models for the full agent surface", () => {
    const large = {
      name: "GPT",
      capabilities: { output: { text: true } },
      limit: { context: 200_000, input: 180_000, output: 16_000 },
    }
    expect(getProviderModelDisabledReason(large, "openai")).toBe("")
    expect(isProviderModelSelectable(large, "openai")).toBe(true)
    // Sufficient ax-engine context remains selectable.
    expect(
      isProviderModelSelectable(
        {
          name: "Qwen large",
          capabilities: { output: { text: true } },
          limit: { context: 65_536, input: 57_000, output: 8_192 },
        },
        "ax-engine",
      ),
    ).toBe(true)
  })
})
