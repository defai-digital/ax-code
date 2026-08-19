import { describe, expect, it } from "vitest"
import {
  getModelCapabilities,
  supportsLongAgent,
  getContextPackBudget,
  isQwen37MaxModel,
  isQwen37PlusModel,
  isQwen37MaxOrPlusModel,
  listRegisteredModels,
} from "../../src/provider/model-capabilities.js"

describe("Model Capability Registry", () => {
  describe("getModelCapabilities", () => {
    it("should return Qwen 3.7 Max capabilities for Alibaba Cloud", () => {
      const caps = getModelCapabilities("qwen-3-7-max", "alibaba-coding-plan")
      expect(caps.contextWindow).toBe(1_000_000)
      expect(caps.thinking).toBe("supported")
      expect(caps.preserveThinking).toBe("supported")
      expect(caps.promptCache).toBe("supported")
      expect(caps.toolCalling).toBe("supported")
      expect(caps.rateLimitTier).toBe("extended")
    })

    it("should return Qwen 3.7 Max capabilities for Together AI", () => {
      const caps = getModelCapabilities("qwen-3-7-max", "togetherai")
      expect(caps.contextWindow).toBe(1_000_000)
      expect(caps.thinking).toBe("supported")
      expect(caps.preserveThinking).toBe("experimental")
      expect(caps.promptCache).toBe("experimental")
      expect(caps.rateLimitTier).toBe("standard")
    })

    it("should return Qwen 3.7 Max capabilities for gateway routes", () => {
      const caps = getModelCapabilities("qwen-3-7-max", "llmgateway")
      expect(caps.contextWindow).toBe(1_000_000)
      expect(caps.thinking).toBe("experimental")
      expect(caps.preserveThinking).toBe("experimental")
      expect(caps.promptCache).toBe("blocked")
      expect(caps.toolCalling).toBe("experimental")
    })

    it("should return Qwen 3.7 Plus capabilities for Alibaba Cloud", () => {
      const caps = getModelCapabilities("qwen-3-7-plus", "alibaba-coding-plan")
      expect(caps.contextWindow).toBe(1_000_000)
      expect(caps.thinking).toBe("supported")
      expect(caps.preserveThinking).toBe("supported")
      expect(caps.promptCache).toBe("supported")
      expect(caps.toolCalling).toBe("supported")
      expect(caps.webOrBuiltInTools).toBe("blocked")
      expect(caps.rateLimitTier).toBe("extended")
    })

    it("should return Qwen 3.7 Plus capabilities for Together AI", () => {
      const caps = getModelCapabilities("qwen3.7-plus", "togetherai")
      expect(caps.contextWindow).toBe(1_000_000)
      expect(caps.thinking).toBe("supported")
      expect(caps.preserveThinking).toBe("experimental")
      expect(caps.promptCache).toBe("experimental")
    })

    it("should return Qwen 3.7 Plus capabilities for gateway routes", () => {
      const caps = getModelCapabilities("qwen3.7-plus", "vercel")
      expect(caps.contextWindow).toBe(1_000_000)
      expect(caps.thinking).toBe("experimental")
      expect(caps.preserveThinking).toBe("experimental")
      expect(caps.promptCache).toBe("blocked")
    })

    it("should return Qwen 3.7 Plus fallback capabilities on unknown provider", () => {
      const caps = getModelCapabilities("qwen3.7-plus", "some-unknown")
      expect(caps.contextWindow).toBe(1_000_000)
      expect(caps.thinking).toBe("supported")
      expect(caps.preserveThinking).toBe("experimental")
      expect(caps.promptCache).toBe("experimental")
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

      expect(caps1.contextWindow).toBe(1_000_000)
      expect(caps2.contextWindow).toBe(1_000_000)
      expect(caps3.contextWindow).toBe(1_000_000)
    })

    it("should handle Plus model ID variations", () => {
      const caps1 = getModelCapabilities("qwen3.7-plus")
      const caps2 = getModelCapabilities("qwen3_7_plus")
      const caps3 = getModelCapabilities("Qwen3-7-Plus")

      expect(caps1.contextWindow).toBe(1_000_000)
      expect(caps2.contextWindow).toBe(1_000_000)
      expect(caps3.contextWindow).toBe(1_000_000)
    })

    it("should handle Ollama models with unlimited rate limit", () => {
      const caps = getModelCapabilities("llama3", "ollama")
      expect(caps.rateLimitTier).toBe("unlimited")
      expect(caps.contextWindow).toBe(32_000)
    })

    it("should return GLM 5.x capabilities (1M context, reasoning) for Z.AI providers", () => {
      for (const providerID of ["zai", "zai-coding-plan", "zhipuai", "zhipuai-coding-plan"]) {
        const caps = getModelCapabilities("glm-5.2", providerID)
        expect(caps.contextWindow).toBe(1_000_000)
        expect(caps.thinking).toBe("supported")
        expect(caps.preserveThinking).toBe("experimental")
        expect(caps.promptCache).toBe("experimental")
        expect(caps.toolCalling).toBe("supported")
        expect(caps.structuredOutput).toBe("supported")
        expect(caps.webOrBuiltInTools).toBe("blocked")
        expect(caps.rateLimitTier).toBe("standard")
      }
    })

    it("should fall back to the GLM entry on an unknown provider (not DEFAULT_CAPABILITIES)", () => {
      const caps = getModelCapabilities("glm-5.2", "some-gateway")
      expect(caps.contextWindow).toBe(1_000_000)
      expect(caps.thinking).toBe("supported")
    })

    it("should match GLM 5.x id variations (glm-5, glm_5_2, glm5.2, [1m] suffix)", () => {
      for (const id of ["glm-5", "glm_5_2", "glm5.2", "glm-5.2[1m]", "GLM-5.2"]) {
        const caps = getModelCapabilities(id, "zai-coding-plan")
        expect(caps.contextWindow).toBe(1_000_000)
      }
    })

    it("should not match GLM 4.x (collapses to DEFAULT_CAPABILITIES)", () => {
      const caps = getModelCapabilities("glm-4.7-flash", "ax-engine")
      expect(caps.contextWindow).toBe(32_000)
      expect(caps.thinking).toBe("blocked")
    })

    it("returns explicit Ornith 35B capabilities for AX Engine ids", () => {
      for (const id of ["ornith-35b-axq-6bit", "AX-Ornith-1.0-35B-MLX-AXQ-6bit"]) {
        const caps = getModelCapabilities(id, "ax-engine")
        expect(caps.contextWindow).toBe(262_144)
        expect(caps.thinking).toBe("supported")
        expect(caps.preserveThinking).toBe("supported")
        expect(caps.promptCache).toBe("experimental")
        expect(caps.toolCalling).toBe("supported")
        expect(caps.structuredOutput).toBe("supported")
        expect(caps.rateLimitTier).toBe("unlimited")
      }
    })

    it("returns explicit Ornith 397B-FP8 capabilities for Alibaba PAI ids", () => {
      for (const id of ["Ornith-1.0-397B-FP8", "ornith-397b", "Ornith-397B"]) {
        const caps = getModelCapabilities(id, "alibaba-pai")
        expect(caps.contextWindow).toBe(262_144)
        expect(caps.thinking).toBe("supported")
        expect(caps.preserveThinking).toBe("supported")
        expect(caps.promptCache).toBe("supported")
        expect(caps.toolCalling).toBe("supported")
        expect(caps.structuredOutput).toBe("supported")
        expect(caps.rateLimitTier).toBe("unlimited")
      }
    })

    it("registers MiniMax M2/M2.x/M3 on first-party routes with snapshot context windows", () => {
      for (const providerID of ["minimax", "minimax-coding-plan", "minimax-cn", "minimax-cn-coding-plan"]) {
        expect(getModelCapabilities("MiniMax-M2", providerID).contextWindow).toBe(196_608)
        expect(getModelCapabilities("MiniMax-M2.5", providerID).contextWindow).toBe(204_800)
        expect(getModelCapabilities("minimax-m2.7-highspeed", providerID).contextWindow).toBe(204_800)
        expect(getModelCapabilities("MiniMax-M3", providerID).contextWindow).toBe(1_000_000)

        const caps = getModelCapabilities("MiniMax-M3", providerID)
        expect(caps.thinking).toBe("supported")
        expect(caps.preserveThinking).toBe("experimental")
        expect(caps.promptCache).toBe("experimental")
        expect(caps.toolCalling).toBe("supported")
        expect(caps.structuredOutput).toBe("supported")
        expect(caps.webOrBuiltInTools).toBe("blocked")
        expect(caps.rateLimitTier).toBe("standard")
      }
    })

    it("does not register MiniMax-M1 (non-reasoning SKU)", () => {
      const caps = getModelCapabilities("MiniMax-M1", "minimax")
      expect(caps.contextWindow).toBe(32_000)
      expect(caps.thinking).toBe("blocked")
    })

    it("keeps the dedicated private-GPU catch-all authoritative for MiniMax on alibaba-pai", () => {
      const caps = getModelCapabilities("MiniMax-M3", "alibaba-pai")
      expect(caps.contextWindow).toBe(1_048_576)
      expect(caps.rateLimitTier).toBe("unlimited")
    })

    it("keeps the Ollama catch-all authoritative for MiniMax on ollama", () => {
      const caps = getModelCapabilities("MiniMax-M3", "ollama")
      expect(caps.contextWindow).toBe(32_000)
      expect(caps.rateLimitTier).toBe("unlimited")
    })

    it("falls back to MiniMax capabilities on unknown gateway providers", () => {
      expect(getModelCapabilities("minimax-m2.5", "some-gateway").contextWindow).toBe(204_800)
      expect(getModelCapabilities("MiniMax-M3", "some-gateway").contextWindow).toBe(1_000_000)
    })
  })

  describe("supportsLongAgent", () => {
    it("should return true for Qwen 3.7 Max on Alibaba", () => {
      expect(supportsLongAgent("qwen-3-7-max", "alibaba-coding-plan")).toBe(true)
    })

    // Forward-compat (Super-Long audit 2026-07-25): a new flagship minor on
    // Alibaba's first-party routes must inherit the family capabilities —
    // a version-pinned pattern silently collapsed future models to
    // DEFAULT_CAPABILITIES, disabling Super-Long's model-default and the
    // long-agent profile exactly where they matter most.
    it("covers future Qwen 3.8/3.9 Max and Plus on Alibaba first-party routes", () => {
      expect(supportsLongAgent("qwen3.8-max", "alibaba-token-plan")).toBe(true)
      expect(supportsLongAgent("qwen3.9-max", "alibaba-coding-plan")).toBe(true)
      expect(supportsLongAgent("qwen3.8-plus", "alibaba-coding-plan-cn")).toBe(true)
    })

    it("does not over-claim below 3.7 or for gateway routes", () => {
      // 3.6 ships different capabilities — family-wide matching stops at 3.7.
      expect(supportsLongAgent("qwen3.6-max-preview", "alibaba-token-plan")).toBe(false)
      // Gateways stay version-pinned: their support genuinely varies.
      expect(supportsLongAgent("qwen3.8-max", "llmgateway")).toBe(false)
    })

    it("covers GLM 5.2 on zai routes, including the [1m] variant", () => {
      expect(supportsLongAgent("glm-5.2", "zai-coding-plan")).toBe(true)
      expect(supportsLongAgent("glm-5.2[1m]", "zai-coding-plan")).toBe(true)
    })

    it("should return true for Qwen 3.7 Max on Together AI", () => {
      expect(supportsLongAgent("qwen-3-7-max", "togetherai")).toBe(true)
    })

    it("should return true for Qwen 3.7 Max on unknown providers (fallback)", () => {
      expect(supportsLongAgent("qwen-3-7-max", "unknown-provider")).toBe(true)
    })

    it("should return true for Qwen 3.7 Plus on Alibaba", () => {
      expect(supportsLongAgent("qwen3.7-plus", "alibaba-coding-plan")).toBe(true)
    })

    it("should return true for Qwen 3.7 Plus on Together AI", () => {
      expect(supportsLongAgent("qwen3.7-plus", "togetherai")).toBe(true)
    })

    it("should return true for Qwen 3.7 Plus on unknown providers (fallback)", () => {
      expect(supportsLongAgent("qwen3.7-plus", "unknown-provider")).toBe(true)
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

    it("should return true for GLM 5.x on Z.AI providers", () => {
      expect(supportsLongAgent("glm-5.2", "zai-coding-plan")).toBe(true)
      expect(supportsLongAgent("glm-5.2[1m]", "zai")).toBe(true)
    })

    it("should return true for GLM 5.x on an unknown provider (fallback entry)", () => {
      expect(supportsLongAgent("glm-5.2", "some-gateway")).toBe(true)
    })

    it("supports the long-agent profile for local Ornith 35B", () => {
      expect(supportsLongAgent("ornith-35b-axq-6bit", "ax-engine")).toBe(true)
    })

    it("supports the long-agent profile for cloud Ornith 397B on Alibaba PAI", () => {
      expect(supportsLongAgent("Ornith-1.0-397B-FP8", "alibaba-pai")).toBe(true)
      expect(supportsLongAgent("ornith-397b", "alibaba-pai")).toBe(true)
    })

    it("supports the long-agent profile for MiniMax M2.x/M3 on first-party routes", () => {
      expect(supportsLongAgent("MiniMax-M3", "minimax")).toBe(true)
      expect(supportsLongAgent("minimax-m2.5", "minimax-cn-coding-plan")).toBe(true)
      // M1 is not registered — it must keep the narrow default profile.
      expect(supportsLongAgent("MiniMax-M1", "minimax")).toBe(false)
    })
  })

  describe("getContextPackBudget", () => {
    it("should return 128k for Qwen 3.7 Max", () => {
      expect(getContextPackBudget("qwen-3-7-max", "alibaba-coding-plan")).toBe(128_000)
    })

    it("should return 128k for Qwen 3.7 Plus", () => {
      expect(getContextPackBudget("qwen3.7-plus", "alibaba-coding-plan")).toBe(128_000)
    })

    it("should return 128k for Claude 3.7 Sonnet", () => {
      expect(getContextPackBudget("claude-3-7-sonnet", "anthropic")).toBe(128_000)
    })

    it("should return 128k for GPT-5", () => {
      expect(getContextPackBudget("gpt-5", "openai")).toBe(128_000)
    })

    it("should return 128k for dedicated Alibaba PAI-EAS models", () => {
      expect(getContextPackBudget("GLM-5.2-FP8", "alibaba-pai")).toBe(128_000)
      expect(getContextPackBudget("MiniMax-M3-MXFP8", "alibaba-pai")).toBe(128_000)
      expect(getContextPackBudget("custom-deploy", "runpod")).toBe(128_000)
      expect(getContextPackBudget("custom-deploy", "huggingface-endpoints")).toBe(128_000)
    })

    it("should return 8k for unknown models", () => {
      expect(getContextPackBudget("unknown-model")).toBe(8_000)
    })

    it("should return 128k for GLM 5.x", () => {
      expect(getContextPackBudget("glm-5.2", "zai-coding-plan")).toBe(128_000)
    })

    it("should return 128k for local Ornith 35B", () => {
      expect(getContextPackBudget("ornith-35b-axq-6bit", "ax-engine")).toBe(128_000)
    })

    it("should return 128k for cloud Ornith 397B on Alibaba PAI", () => {
      expect(getContextPackBudget("Ornith-1.0-397B-FP8", "alibaba-pai")).toBe(128_000)
      expect(getContextPackBudget("ornith-397b", "alibaba-pai")).toBe(128_000)
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

    it("should not detect Qwen 3.7 Plus", () => {
      expect(isQwen37MaxModel("qwen3.7-plus")).toBe(false)
    })
  })

  describe("isQwen37PlusModel", () => {
    it("should detect Qwen 3.7 Plus with hyphens", () => {
      expect(isQwen37PlusModel("qwen-3-7-plus")).toBe(true)
    })

    it("should detect Qwen 3.7 Plus with dots", () => {
      expect(isQwen37PlusModel("qwen3.7-plus")).toBe(true)
    })

    it("should detect Qwen 3.7 Plus case-insensitive", () => {
      expect(isQwen37PlusModel("Qwen3.7-Plus")).toBe(true)
    })

    it("should not detect Qwen 3.7 Max", () => {
      expect(isQwen37PlusModel("qwen3.7-max")).toBe(false)
    })
  })

  describe("isQwen37MaxOrPlusModel", () => {
    it("should detect both Max and Plus", () => {
      expect(isQwen37MaxOrPlusModel("qwen3.7-max")).toBe(true)
      expect(isQwen37MaxOrPlusModel("qwen3.7-plus")).toBe(true)
    })

    it("should not detect other models", () => {
      expect(isQwen37MaxOrPlusModel("qwen3.6-plus")).toBe(false)
      expect(isQwen37MaxOrPlusModel("claude-3-7-sonnet")).toBe(false)
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
