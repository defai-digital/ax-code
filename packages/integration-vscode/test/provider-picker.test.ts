import { describe, expect, test } from "bun:test"
import { providerModelPickItems } from "../src/provider-picker"

describe("providerModelPickItems", () => {
  test("uses the generated provider.list response shape", () => {
    const items = providerModelPickItems({
      all: [
        {
          id: "xai",
          name: "x.ai",
          env: ["XAI_API_KEY"],
          models: {
            "grok-code": {
              id: "grok-code",
              name: "Grok Code",
              release_date: "",
              attachment: false,
              reasoning: false,
              tool_call: true,
              limit: { context: 128000, output: 4096 },
            },
          },
        },
      ],
      default: { xai: "grok-code" },
      connected: ["xai"],
    })

    expect(items).toEqual([{ label: "xai/grok-code", description: "x.ai" }])
  })
})
