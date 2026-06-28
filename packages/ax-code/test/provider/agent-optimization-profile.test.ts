import { describe, expect, test } from "vitest"
import { classifyTaskForModelRoute, longAgentProfileForModel } from "../../src/provider/agent-optimization-profile"

describe("classifyTaskForModelRoute", () => {
  test("short single-file edit is cheap", () => {
    expect(classifyTaskForModelRoute({ fileCount: 1 }).class).toBe("cheap")
  })

  test("zero context is cheap", () => {
    expect(classifyTaskForModelRoute({}).class).toBe("cheap")
  })

  test("multi-file task is premium", () => {
    expect(classifyTaskForModelRoute({ fileCount: 2 }).class).toBe("premium")
  })

  test("tool-heavy debug is premium", () => {
    expect(classifyTaskForModelRoute({ hasToolHeavyDebug: true }).class).toBe("premium")
  })

  test("large-context task is premium", () => {
    expect(classifyTaskForModelRoute({ promptTokenEstimate: 3000 }).class).toBe("premium")
  })

  test("token estimate at threshold boundary is cheap", () => {
    expect(classifyTaskForModelRoute({ promptTokenEstimate: 2000 }).class).toBe("cheap")
  })

  test("high-risk refactor is premiumCrossCheck", () => {
    expect(classifyTaskForModelRoute({ isHighRiskRefactor: true }).class).toBe("premiumCrossCheck")
  })

  test("release-critical change is premiumCrossCheck", () => {
    expect(classifyTaskForModelRoute({ isReleaseCritical: true }).class).toBe("premiumCrossCheck")
  })

  test("security-sensitive change is premiumCrossCheck", () => {
    expect(classifyTaskForModelRoute({ isSecuritySensitive: true }).class).toBe("premiumCrossCheck")
  })

  test("premiumCrossCheck overrides premium signals", () => {
    const result = classifyTaskForModelRoute({ fileCount: 5, isReleaseCritical: true })
    expect(result.class).toBe("premiumCrossCheck")
  })

  test("all classifications include a non-empty reason", () => {
    for (const input of [{}, { fileCount: 2 }, { isHighRiskRefactor: true }]) {
      expect(classifyTaskForModelRoute(input).reason.length).toBeGreaterThan(0)
    }
  })
})

describe("longAgentProfileForModel", () => {
  describe("Qwen 3.7 Max profiles", () => {
    test("returns wide profile for qwen3.7-max on Alibaba", () => {
      const profile = longAgentProfileForModel("qwen3.7-max", "alibaba-coding-plan")
      expect(profile.contextPackingBudget).toBe("wide")
      expect(profile.contextPackTokenBudget).toBe(128_000)
      expect(profile.thinkingEnabled).toBe(true)
      expect(profile.preserveThinkingEligible).toBe(true)
      expect(profile.promptCacheEligible).toBe(true)
      expect(profile.verificationLoopEnabled).toBe(true)
      expect(profile.strictRepeatedFailureDetection).toBe(true)
    })

    test("returns wide profile for qwen37-max variant", () => {
      const profile = longAgentProfileForModel("qwen37-max", "togetherai")
      expect(profile.contextPackingBudget).toBe("wide")
      expect(profile.thinkingEnabled).toBe(true)
    })

    test("is case-insensitive", () => {
      const profile = longAgentProfileForModel("Qwen3.7-Max", "alibaba-coding-plan")
      expect(profile.thinkingEnabled).toBe(true)
    })

    test("handles model ID variations", () => {
      const profile1 = longAgentProfileForModel("qwen-3-7-max", "alibaba-coding-plan")
      const profile2 = longAgentProfileForModel("qwen3.7-max", "alibaba-coding-plan")
      const profile3 = longAgentProfileForModel("qwen3_7_max", "alibaba-coding-plan")

      expect(profile1.contextPackingBudget).toBe("wide")
      expect(profile2.contextPackingBudget).toBe("wide")
      expect(profile3.contextPackingBudget).toBe("wide")
    })
  })

  describe("Claude profiles", () => {
    test("returns wide profile for Claude 3.7 Sonnet", () => {
      const profile = longAgentProfileForModel("claude-3-7-sonnet", "anthropic")
      expect(profile.contextPackingBudget).toBe("wide")
      expect(profile.thinkingEnabled).toBe(true)
      expect(profile.preserveThinkingEligible).toBe(false) // Claude doesn't support preserve thinking
      expect(profile.promptCacheEligible).toBe(true)
    })

    test("returns narrow profile for Claude 3.5 Sonnet", () => {
      const profile = longAgentProfileForModel("claude-3-5-sonnet", "anthropic")
      expect(profile.contextPackingBudget).toBe("narrow")
      expect(profile.thinkingEnabled).toBe(false)
    })
  })

  describe("GPT profiles", () => {
    test("returns wide profile for GPT-5", () => {
      const profile = longAgentProfileForModel("gpt-5", "openai")
      expect(profile.contextPackingBudget).toBe("wide")
      expect(profile.thinkingEnabled).toBe(true)
      expect(profile.preserveThinkingEligible).toBe(false)
    })

    test("returns narrow profile for GPT-4o (no thinking support)", () => {
      const profile = longAgentProfileForModel("gpt-4o", "openai")
      expect(profile.contextPackingBudget).toBe("narrow")
      expect(profile.thinkingEnabled).toBe(false)
    })
  })

  describe("GLM 5.x profiles", () => {
    test("returns wide profile for glm-5.2 on Z.AI (1M context window)", () => {
      const profile = longAgentProfileForModel("glm-5.2", "zai-coding-plan")
      expect(profile.contextPackingBudget).toBe("wide")
      expect(profile.contextPackTokenBudget).toBe(128_000)
      expect(profile.thinkingEnabled).toBe(true)
      expect(profile.preserveThinkingEligible).toBe(true)
      expect(profile.promptCacheEligible).toBe(true)
      expect(profile.verificationLoopEnabled).toBe(true)
      expect(profile.strictRepeatedFailureDetection).toBe(true)
    })

    test("returns wide profile for the [1m] suffix variant", () => {
      const profile = longAgentProfileForModel("glm-5.2[1m]", "zai")
      expect(profile.contextPackingBudget).toBe("wide")
      expect(profile.contextPackTokenBudget).toBe(128_000)
    })

    test("returns wide profile on Zhipu providers", () => {
      const profile = longAgentProfileForModel("glm-5.2", "zhipuai-coding-plan")
      expect(profile.contextPackingBudget).toBe("wide")
    })

    test("uses the fallback entry on an unknown provider (still wide)", () => {
      const profile = longAgentProfileForModel("glm-5.2", "some-gateway")
      expect(profile.contextPackingBudget).toBe("wide")
      expect(profile.thinkingEnabled).toBe(true)
    })

    test("is case-insensitive", () => {
      const profile = longAgentProfileForModel("GLM-5.2", "zai-coding-plan")
      expect(profile.contextPackingBudget).toBe("wide")
    })
  })

  describe("Default profiles", () => {
    test("returns narrow profile for unknown models", () => {
      const profile = longAgentProfileForModel("unknown-model")
      expect(profile.contextPackingBudget).toBe("narrow")
      expect(profile.contextPackTokenBudget).toBe(8_000)
      expect(profile.thinkingEnabled).toBe(false)
      expect(profile.preserveThinkingEligible).toBe(false)
      expect(profile.promptCacheEligible).toBe(false)
      expect(profile.verificationLoopEnabled).toBe(false)
      expect(profile.strictRepeatedFailureDetection).toBe(false)
    })

    test("returns narrow profile for models without provider context", () => {
      const profile = longAgentProfileForModel("claude-3-7-sonnet") // No provider
      expect(profile.contextPackingBudget).toBe("narrow")
      expect(profile.thinkingEnabled).toBe(false)
    })
  })
})
