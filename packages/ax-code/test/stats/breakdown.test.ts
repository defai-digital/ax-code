import { describe, expect, test } from "bun:test"
import { calculateBreakdown, formatBreakdown, getStatus, estimateTokens } from "../../src/stats/breakdown"
import type { Provider } from "../../src/provider/provider"

function createModel(context: number): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context, output: Math.floor(context * 0.1) },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai" },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  } as Provider.Model
}

describe("stats.breakdown.calculateBreakdown", () => {
  test("uses context window from the provider model — Claude 1M", () => {
    const model = createModel(1_000_000)
    const result = calculateBreakdown({
      model,
      systemPromptLength: 0,
      toolCount: 0,
      memoryTokens: 0,
      historyTokens: 500_000,
    })
    expect(result.modelLimit).toBe(1_000_000)
    expect(result.total).toBe(500_000)
    expect(result.available).toBe(500_000)
  })

  test("uses context window from the provider model — GPT-5 400K", () => {
    const model = createModel(400_000)
    const result = calculateBreakdown({
      model,
      systemPromptLength: 0,
      toolCount: 0,
      memoryTokens: 0,
      historyTokens: 200_000,
    })
    expect(result.modelLimit).toBe(400_000)
    expect(result.available).toBe(200_000)
  })

  test("uses context window from the provider model — GLM 200K", () => {
    const model = createModel(200_000)
    const result = calculateBreakdown({
      model,
      systemPromptLength: 0,
      toolCount: 0,
      memoryTokens: 0,
      historyTokens: 50_000,
    })
    expect(result.modelLimit).toBe(200_000)
    expect(result.available).toBe(150_000)
  })

  test("includes tool definitions and memory in total", () => {
    const model = createModel(200_000)
    const result = calculateBreakdown({
      model,
      systemPromptLength: 0,
      toolCount: 10,
      memoryTokens: 5_000,
      historyTokens: 10_000,
    })
    // 10 tools * 800 + 5000 memory + 10000 history = 23_000
    expect(result.total).toBe(23_000)
  })

  test("falls back gracefully when model is unavailable", () => {
    const result = calculateBreakdown({
      model: undefined,
      systemPromptLength: 0,
      toolCount: 0,
      memoryTokens: 0,
      historyTokens: 50_000,
    })
    expect(result.modelLimit).toBe(0)
    expect(result.available).toBe(0)
    expect(result.total).toBe(50_000)
  })
})

describe("stats.breakdown.getStatus", () => {
  test("classifies usage thresholds", () => {
    expect(getStatus(0)).toBe("good")
    expect(getStatus(49)).toBe("good")
    expect(getStatus(50)).toBe("moderate")
    expect(getStatus(74)).toBe("moderate")
    expect(getStatus(75)).toBe("high")
    expect(getStatus(89)).toBe("high")
    expect(getStatus(90)).toBe("critical")
    expect(getStatus(100)).toBe("critical")
  })
})

describe("stats.breakdown.formatBreakdown", () => {
  test("renders unknown-limit branch when modelLimit is 0", () => {
    const out = formatBreakdown({
      systemPrompt: 0,
      toolDefinitions: 0,
      memory: 0,
      conversationHistory: 50_000,
      total: 50_000,
      available: 0,
      modelLimit: 0,
    })
    expect(out).toContain("unknown")
    // Status line is suppressed when limit is unknown.
    expect(out).not.toContain("CRITICAL")
    expect(out).not.toContain("GOOD")
  })

  test("renders percentage when modelLimit is known", () => {
    const out = formatBreakdown({
      systemPrompt: 0,
      toolDefinitions: 0,
      memory: 0,
      conversationHistory: 950_000,
      total: 950_000,
      available: 50_000,
      modelLimit: 1_000_000,
    })
    expect(out).toContain("1,000,000")
    expect(out).toContain("(95%)")
    expect(out).toContain("CRITICAL")
  })

  test("does not throw when token count overflows the model limit", () => {
    // Regression: an unclamped bar() called String.repeat with a negative
    // count when filled > barWidth, throwing RangeError.
    expect(() =>
      formatBreakdown({
        systemPrompt: 0,
        toolDefinitions: 0,
        memory: 0,
        conversationHistory: 1_500_000,
        total: 1_500_000,
        available: 0,
        modelLimit: 1_000_000,
      }),
    ).not.toThrow()
  })
})

describe("stats.breakdown.estimateTokens", () => {
  test("4 chars per token", () => {
    expect(estimateTokens("x".repeat(4000))).toBe(1000)
  })
})
