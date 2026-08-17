import { describe, expect, test } from "vitest"
import { providerModelPickItems } from "../src/provider-picker"

describe("providerModelPickItems", () => {
  test("uses the generated provider.list response shape", () => {
    const items = providerModelPickItems({
      all: [
        {
          id: "groq",
          name: "GroqCloud",
          env: ["GROQ_API_KEY"],
          models: {
            "qwen/qwen3.6-27b": {
              id: "qwen/qwen3.6-27b",
              name: "Qwen 3.6 27B",
              release_date: "",
              attachment: false,
              reasoning: false,
              tool_call: true,
              limit: { context: 128000, output: 4096 },
            },
          },
        },
      ],
      default: { groq: "qwen/qwen3.6-27b" },
      connected: ["groq"],
    })

    expect(items).toEqual([{ label: "groq/qwen/qwen3.6-27b", description: "GroqCloud" }])
  })

  test("excludes models from providers that are not connected", () => {
    const items = providerModelPickItems({
      all: [
        {
          id: "unconnected",
          name: "Unconnected Provider",
          env: [],
          models: {
            "model-a": {
              id: "model-a",
              name: "Model A",
              release_date: "",
              attachment: false,
              reasoning: false,
              tool_call: true,
              limit: { context: 1000, output: 1000 },
            },
          },
        },
        {
          id: "groq",
          name: "GroqCloud",
          env: ["GROQ_API_KEY"],
          models: {
            "qwen/qwen3.6-27b": {
              id: "qwen/qwen3.6-27b",
              name: "Qwen 3.6 27B",
              release_date: "",
              attachment: false,
              reasoning: false,
              tool_call: true,
              limit: { context: 128000, output: 4096 },
            },
          },
        },
      ],
      default: {},
      connected: ["groq"],
    })

    // Only the connected provider's model is offered.
    expect(items).toEqual([{ label: "groq/qwen/qwen3.6-27b", description: "GroqCloud" }])
  })

  test("returns nothing when no provider is connected", () => {
    const items = providerModelPickItems({
      all: [
        {
          id: "unconnected",
          name: "Unconnected Provider",
          env: [],
          models: {
            "model-a": {
              id: "model-a",
              name: "Model A",
              release_date: "",
              attachment: false,
              reasoning: false,
              tool_call: true,
              limit: { context: 1000, output: 1000 },
            },
          },
        },
      ],
      default: {},
      connected: [],
    })

    expect(items).toEqual([])
  })
})
