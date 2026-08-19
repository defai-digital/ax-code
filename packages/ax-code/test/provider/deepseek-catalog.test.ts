import { describe, expect, test } from "vitest"
import { isHiddenDeepseekLegacySku } from "../../src/provider/deepseek-catalog"

describe("isHiddenDeepseekLegacySku", () => {
  test("hides first-party chat and reasoner aliases", () => {
    expect(isHiddenDeepseekLegacySku("deepseek-chat", "DeepSeek Chat")).toBe(true)
    expect(isHiddenDeepseekLegacySku("deepseek-reasoner", "DeepSeek Reasoner")).toBe(true)
    expect(isHiddenDeepseekLegacySku("deepseek/deepseek-chat")).toBe(true)
  })

  test("keeps V4 and versioned chat SKUs", () => {
    expect(isHiddenDeepseekLegacySku("deepseek-v4-pro", "DeepSeek V4 Pro")).toBe(false)
    expect(isHiddenDeepseekLegacySku("deepseek-v4-flash", "DeepSeek V4 Flash")).toBe(false)
    expect(isHiddenDeepseekLegacySku("deepseek-chat-v3.1", "DeepSeek Chat V3.1")).toBe(false)
  })
})
