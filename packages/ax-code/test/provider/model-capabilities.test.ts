import { describe, expect, it } from "bun:test"
import {
  getModelCapabilities,
  supportsLongAgent,
  getContextPackBudget,
  isQwen37MaxModel,
  listRegisteredModels,
} from "../../src/provider/model-capabilities.js"

describe("Model Capability Registry", () => {
  describe("getModelCapabilities", () => {
    it("should return Qwen 3.7 Max capabilities for Alibaba Cloud", () => {
      const caps = getModelCapabilities("qwen-3-7-max", "alibaba-coding-plan")
      expect(caps.contextWindow).toBe(131_072)
      expect(caps.thinking).toBe("supported")
      expect(caps.preserveThinking).toBe("supported")
      expect(caps.promptCache).toBe("supported")
      expect(caps.toolCalling).toBe("supported")
      expect(caps.rateLimitTier).toBe("extended")
    })

    it("should return Qwen 3.7 Max capabilities for Together AI", () => {
      const caps = getModelCapabilities("qwen-3-7-max", "togetherai")
      expect(caps.contextWindow).toBe(131_072)
      expect(caps.thinking).toBe("supported")
      expect(caps.preserveThinking).toBe("experimental")
      expect(caps.promptCache).toBe("experimental")
      expect(caps.rateLimitTier).toBe("standard")
    })

    it("should return Qwen 3.7 Max capabilities for gateway routes", () => {
      const caps = getModelCapabilities("qwen-3-7-max", "llmgateway")
      expect(caps.contextWindow).toBe(131_072)
      expect(caps.thinking).toBe("experimental")
      expect(caps.preserveThinking).toBe("experimental")
      expect(caps.promptCache).toBe("blocked")
      expect(caps.toolCalling).toBe("experimental")
    })

    it("should return Claude 3.7 Sonnet capabilities for Anthropic", () => {
      const caps = getModelCapabilities("claude-3-7-sonnet", "anthropic")
      expect(caps.contextWindow).toBe(200_000)
      expect(caps.thinking).toBe("supported")
      expect(caps.preserveThinking).toBe("blocked")
      expect(caps.promptCache).toBe("supported")
    })

    it("should return default capabilities for unknown models", () => {
      const caps = getModelCapabilities("unknown-model")
      expect(caps.contextWindow).toBe(32_000)
      expect(caps.thinking).toBe("blocked")
      expect(caps.preserveThinking).toBe("blocked")
      expect(caps.rateLimitTier).toBe("standard")
    })

    it("should handle model ID variations", () => {
      const caps1 = getModelCapabilities("qwen3.7-max")
      const caps2 = getModelCapabilities("qwen3_7_max")
      const caps3 = getModelCapabilities("Qwen3-7-Max")

      expect(caps1.contextWindow).toBe(131_072)
      expect(caps2.contextWindow).toBe(131_072)
      expect(caps3.contextWindow).toBe(131_072)
    })

    it("should handle Ollama models with unlimited rate limit", () => {
      const caps = getModelCapabilities("llama3", "ollama")
      expect(caps.rateLimitTier).toBe("unlimited")
      expect(caps.contextWindow).toBe(32_000)
    })
  })

  describe("supportsLongAgent", () => {
    it("should return true for Qwen 3.7 Max on Alibaba", () => {
      expect(supportsLongAgent("qwen-3-7-max", "alibaba-coding-plan")).toBe(true)
    })

    it("should return true for Qwen 3.7 Max on Together AI", () => {
      expect(supportsLongAgent("qwen-3-7-max", "togetherai")).toBe(true)
    })

    it("should return true for Qwen 3.7 Max on unknown providers (fallback)", () => {
      expect(supportsLongAgent("qwen-3-7-max", "unknown-provider")).toBe(true)
    })

    it("should return false for models without thinking support", () => {
      expect(supportsLongAgent("claude-3-5-sonnet", "anthropic")).toBe(false)
    })

    it("should return false for small context models", () => {
      expect(supportsLongAgent("gpt-3.5-turbo")).toBe(false)
    })

    it("should return true for Claude 3.7 Sonnet", () => {
      expect(supportsLongAgent("claude-3-7-sonnet", "anthropic")).toBe(true)
    })

    it("should return true for GPT-5", () => {
      expect(supportsLongAgent("gpt-5", "openai")).toBe(true)
    })
  })

  describe("getContextPackBudget", () => {
    it("should return 128k for Qwen 3.7 Max", () => {
      expect(getContextPackBudget("qwen-3-7-max", "alibaba-coding-plan")).toBe(128_000)
    })

    it("should return 128k for Claude 3.7 Sonnet", () => {
      expect(getContextPackBudget("claude-3-7-sonnet", "anthropic")).toBe(128_000)
    })

    it("should return 128k for GPT-5", () => {
      expect(getContextPackBudget("gpt-5", "openai")).toBe(128_000)
    })

    it("should return 8k for unknown models", () => {
      expect(getContextPackBudget("unknown-model")).toBe(8_000)
    })
  })

  describe("isQwen37MaxModel (deprecated)", () => {
    it("should detect Qwen 3.7 Max with hyphens", () => {
      expect(isQwen37MaxModel("qwen-3-7-max")).toBe(true)
    })

    it("should detect Qwen 3.7 Max with dots", () => {
      expect(isQwen37MaxModel("qwen3.7-max")).toBe(true)
    })

    it("should detect Qwen 3.7 Max with underscores", () => {
      expect(isQwen37MaxModel("qwen3_7_max")).toBe(true)
    })

    it("should detect Qwen 3.7 Max case-insensitive", () => {
      expect(isQwen37MaxModel("Qwen3.7-Max")).toBe(true)
    })

    it("should not detect other models", () => {
      expect(isQwen37MaxModel("claude-3-7-sonnet")).toBe(false)
      expect(isQwen37MaxModel("gpt-4")).toBe(false)
    })
  })

  describe("listRegisteredModels", () => {
    it("should return array of registrations", () => {
      const models = listRegisteredModels()
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)
    })

    it("should include Qwen 3.7 Max registrations", () => {
      const models = listRegisteredModels()
      const qwenModels = models.filter((m) =>
        typeof m.pattern === "string" ? m.pattern.includes("qwen") : m.pattern.source.includes("qwen"),
      )
      expect(qwenModels.length).toBeGreaterThan(0)
    })
  })
})
