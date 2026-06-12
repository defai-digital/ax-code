import { describe, expect, test } from "bun:test"
import { classifyQwen37MaxRoute, qwen37MaxReadiness, isQwen37MaxModel } from "../../src/provider/qwen37-readiness"

describe("classifyQwen37MaxRoute", () => {
  test("recognizes Alibaba plan providers", () => {
    expect(classifyQwen37MaxRoute("alibaba-coding-plan")).toBe("alibaba")
    expect(classifyQwen37MaxRoute("alibaba-token-plan")).toBe("alibaba")
    expect(classifyQwen37MaxRoute("alibaba-coding-plan-cn")).toBe("alibaba")
    expect(classifyQwen37MaxRoute("alibaba-token-plan-cn")).toBe("alibaba")
  })

  test("recognizes Together AI provider", () => {
    expect(classifyQwen37MaxRoute("togetherai")).toBe("together")
  })

  test("recognizes gateway providers", () => {
    expect(classifyQwen37MaxRoute("llmgateway")).toBe("gateway")
    expect(classifyQwen37MaxRoute("vercel")).toBe("gateway")
  })

  test("returns unknown for unrecognized providers", () => {
    expect(classifyQwen37MaxRoute("some-custom-provider")).toBe("unknown")
  })
})

describe("qwen37MaxReadiness — Alibaba", () => {
  test("thinking is supported", () => {
    expect(qwen37MaxReadiness("alibaba-coding-plan").thinking).toBe("supported")
  })

  test("preserve-thinking is supported", () => {
    expect(qwen37MaxReadiness("alibaba-coding-plan").preserveThinking).toBe("supported")
  })

  test("tool-calling is supported", () => {
    expect(qwen37MaxReadiness("alibaba-coding-plan").toolCalling).toBe("supported")
  })

  test("prompt cache is supported", () => {
    expect(qwen37MaxReadiness("alibaba-token-plan").promptCache).toBe("supported")
  })

  test("web/built-in tools are supported", () => {
    expect(qwen37MaxReadiness("alibaba-coding-plan").webOrBuiltInTools).toBe("supported")
  })
})

describe("qwen37MaxReadiness — Together AI", () => {
  test("thinking is supported", () => {
    expect(qwen37MaxReadiness("togetherai").thinking).toBe("supported")
  })

  test("preserve-thinking is experimental", () => {
    expect(qwen37MaxReadiness("togetherai").preserveThinking).toBe("experimental")
  })

  test("prompt cache is experimental", () => {
    expect(qwen37MaxReadiness("togetherai").promptCache).toBe("experimental")
  })
})

describe("qwen37MaxReadiness — unknown provider", () => {
  test("all features are blocked", () => {
    const matrix = qwen37MaxReadiness("unknown-provider")
    expect(matrix.thinking).toBe("blocked")
    expect(matrix.preserveThinking).toBe("blocked")
    expect(matrix.toolCalling).toBe("blocked")
    expect(matrix.structuredOutput).toBe("blocked")
    expect(matrix.promptCache).toBe("blocked")
    expect(matrix.webOrBuiltInTools).toBe("blocked")
  })
})

describe("isQwen37MaxModel", () => {
  test("recognizes qwen3.7-max model id", () => {
    expect(isQwen37MaxModel("qwen3.7-max")).toBe(true)
  })

  test("recognizes qwen37-max model id variant", () => {
    expect(isQwen37MaxModel("qwen37-max")).toBe(true)
  })

  test("is case-insensitive", () => {
    expect(isQwen37MaxModel("Qwen3.7-Max")).toBe(true)
    expect(isQwen37MaxModel("QWEN37-MAX")).toBe(true)
  })

  test("recognizes provider-specific spellings", () => {
    // Venice lists the model with dash separators
    expect(isQwen37MaxModel("qwen-3-7-max")).toBe(true)
    // Together prefixes the org
    expect(isQwen37MaxModel("Qwen/Qwen3.7-Max")).toBe(true)
    // nano-gpt appends a variant suffix
    expect(isQwen37MaxModel("qwen3.7-max:thinking")).toBe(true)
  })

  test("does not match qwen3.7-plus or other qwen tiers", () => {
    expect(isQwen37MaxModel("qwen3.7-plus")).toBe(false)
    expect(isQwen37MaxModel("qwen-3-7-plus")).toBe(false)
    expect(isQwen37MaxModel("qwen3.6-plus")).toBe(false)
    expect(isQwen37MaxModel("qwen-max")).toBe(false)
  })

  test("does not match unrelated models", () => {
    expect(isQwen37MaxModel("qwen3-max")).toBe(false)
    expect(isQwen37MaxModel("claude-opus-4")).toBe(false)
    expect(isQwen37MaxModel("gpt-4o")).toBe(false)
  })
})
