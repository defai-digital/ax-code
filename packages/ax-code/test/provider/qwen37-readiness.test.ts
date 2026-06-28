import { describe, expect, test } from "vitest"
import {
  classifyQwen37MaxRoute,
  classifyQwen37Route,
  qwen37MaxReadiness,
  qwen37PlusReadiness,
  isQwen37MaxModel,
  isQwen37PlusModel,
} from "../../src/provider/qwen37-readiness"

describe("classifyQwen37Route", () => {
  test("recognizes Alibaba plan providers", () => {
    expect(classifyQwen37Route("alibaba-coding-plan")).toBe("alibaba")
    expect(classifyQwen37Route("alibaba-token-plan")).toBe("alibaba")
    expect(classifyQwen37Route("alibaba-coding-plan-cn")).toBe("alibaba")
    expect(classifyQwen37Route("alibaba-token-plan-cn")).toBe("alibaba")
  })

  test("recognizes Together AI provider", () => {
    expect(classifyQwen37Route("togetherai")).toBe("together")
  })

  test("recognizes gateway providers", () => {
    expect(classifyQwen37Route("llmgateway")).toBe("gateway")
    expect(classifyQwen37Route("vercel")).toBe("gateway")
  })

  test("returns unknown for unrecognized providers", () => {
    expect(classifyQwen37Route("some-custom-provider")).toBe("unknown")
  })

  test("classifyQwen37MaxRoute is an alias for classifyQwen37Route", () => {
    expect(classifyQwen37MaxRoute).toBe(classifyQwen37Route)
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

describe("qwen37PlusReadiness — Alibaba", () => {
  test("thinking is supported", () => {
    expect(qwen37PlusReadiness("alibaba-coding-plan").thinking).toBe("supported")
  })

  test("preserve-thinking is supported", () => {
    expect(qwen37PlusReadiness("alibaba-coding-plan").preserveThinking).toBe("supported")
  })

  test("tool-calling is supported", () => {
    expect(qwen37PlusReadiness("alibaba-coding-plan").toolCalling).toBe("supported")
  })

  test("prompt cache is supported", () => {
    expect(qwen37PlusReadiness("alibaba-token-plan").promptCache).toBe("supported")
  })

  test("web/built-in tools are blocked (unlike Max)", () => {
    expect(qwen37PlusReadiness("alibaba-coding-plan").webOrBuiltInTools).toBe("blocked")
  })
})

describe("qwen37PlusReadiness — Together AI", () => {
  test("thinking is supported", () => {
    expect(qwen37PlusReadiness("togetherai").thinking).toBe("supported")
  })

  test("preserve-thinking is experimental", () => {
    expect(qwen37PlusReadiness("togetherai").preserveThinking).toBe("experimental")
  })

  test("prompt cache is experimental", () => {
    expect(qwen37PlusReadiness("togetherai").promptCache).toBe("experimental")
  })
})

describe("qwen37PlusReadiness — unknown provider", () => {
  test("all features are blocked", () => {
    const matrix = qwen37PlusReadiness("unknown-provider")
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
    expect(isQwen37MaxModel("qwen-3-7-max")).toBe(true)
    expect(isQwen37MaxModel("Qwen/Qwen3.7-Max")).toBe(true)
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

describe("isQwen37PlusModel", () => {
  test("recognizes qwen3.7-plus model id", () => {
    expect(isQwen37PlusModel("qwen3.7-plus")).toBe(true)
  })

  test("recognizes qwen37-plus model id variant", () => {
    expect(isQwen37PlusModel("qwen37-plus")).toBe(true)
  })

  test("is case-insensitive", () => {
    expect(isQwen37PlusModel("Qwen3.7-Plus")).toBe(true)
    expect(isQwen37PlusModel("QWEN37-PLUS")).toBe(true)
  })

  test("recognizes provider-specific spellings", () => {
    expect(isQwen37PlusModel("qwen-3-7-plus")).toBe(true)
    expect(isQwen37PlusModel("Qwen/Qwen3.7-Plus")).toBe(true)
  })

  test("does not match qwen3.7-max or other qwen tiers", () => {
    expect(isQwen37PlusModel("qwen3.7-max")).toBe(false)
    expect(isQwen37PlusModel("qwen-3-7-max")).toBe(false)
    expect(isQwen37PlusModel("qwen3.6-plus")).toBe(false)
    expect(isQwen37PlusModel("qwen-max")).toBe(false)
  })

  test("does not match unrelated models", () => {
    expect(isQwen37PlusModel("claude-opus-4")).toBe(false)
    expect(isQwen37PlusModel("gpt-4o")).toBe(false)
  })
})
