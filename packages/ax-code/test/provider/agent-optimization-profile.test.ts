import { describe, expect, test } from "bun:test"
import {
  classifyTaskForModelRoute,
  defaultLongAgentProfile,
  longAgentProfileForModel,
  qwen37MaxLongAgentProfile,
} from "../../src/provider/agent-optimization-profile"

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
    for (const input of [
      {},
      { fileCount: 2 },
      { isHighRiskRefactor: true },
    ]) {
      expect(classifyTaskForModelRoute(input).reason.length).toBeGreaterThan(0)
    }
  })
})

describe("qwen37MaxLongAgentProfile", () => {
  test("uses wide context packing budget", () => {
    expect(qwen37MaxLongAgentProfile().contextPackingBudget).toBe("wide")
  })

  test("enables thinking", () => {
    expect(qwen37MaxLongAgentProfile().thinkingEnabled).toBe(true)
  })

  test("enables preserve-thinking eligibility", () => {
    expect(qwen37MaxLongAgentProfile().preserveThinkingEligible).toBe(true)
  })

  test("enables prompt cache eligibility", () => {
    expect(qwen37MaxLongAgentProfile().promptCacheEligible).toBe(true)
  })

  test("enables verification loop", () => {
    expect(qwen37MaxLongAgentProfile().verificationLoopEnabled).toBe(true)
  })

  test("enables strict repeated-failure detection", () => {
    expect(qwen37MaxLongAgentProfile().strictRepeatedFailureDetection).toBe(true)
  })
})

describe("defaultLongAgentProfile", () => {
  test("uses narrow context packing budget", () => {
    expect(defaultLongAgentProfile().contextPackingBudget).toBe("narrow")
  })

  test("disables all premium features", () => {
    const profile = defaultLongAgentProfile()
    expect(profile.thinkingEnabled).toBe(false)
    expect(profile.preserveThinkingEligible).toBe(false)
    expect(profile.promptCacheEligible).toBe(false)
    expect(profile.verificationLoopEnabled).toBe(false)
    expect(profile.strictRepeatedFailureDetection).toBe(false)
  })
})

describe("longAgentProfileForModel", () => {
  test("returns qwen37Max profile for qwen3.7-max", () => {
    const profile = longAgentProfileForModel("qwen3.7-max")
    expect(profile.contextPackingBudget).toBe("wide")
    expect(profile.thinkingEnabled).toBe(true)
  })

  test("returns qwen37Max profile for qwen37-max variant", () => {
    expect(longAgentProfileForModel("qwen37-max").thinkingEnabled).toBe(true)
  })

  test("is case-insensitive", () => {
    expect(longAgentProfileForModel("Qwen3.7-Max").thinkingEnabled).toBe(true)
  })

  test("returns default profile for non-qwen models", () => {
    const profile = longAgentProfileForModel("claude-opus-4")
    expect(profile.contextPackingBudget).toBe("narrow")
    expect(profile.thinkingEnabled).toBe(false)
  })
})
