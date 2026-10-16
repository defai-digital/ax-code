import { describe, expect, test } from "vitest"
import { SupervisedContinuationPrompt } from "../../src/session/prompt/prompt-supervised-continuations"

describe("SupervisedContinuationPrompt.truncatedTurnRecovery", () => {
  test("tells the model to continue exactly where it stopped without repeating", () => {
    const text = SupervisedContinuationPrompt.truncatedTurnRecovery({ attempt: 2, maxAttempts: 3 })

    expect(text).toContain("output-token limit")
    expect(text).toContain("finish=length")
    expect(text).toContain("exact point where the text stopped")
    expect(text).toContain("resume mid-sentence")
    expect(text).toContain("Do not repeat")
    expect(text).toContain("continuation attempt 2/3")
  })

  test("never uses autonomous-mode wording for a supervised turn", () => {
    const text = SupervisedContinuationPrompt.truncatedTurnRecovery({ attempt: 1, maxAttempts: 3 })

    expect(text).not.toMatch(/autonomous/i)
    expect(text).not.toContain("tools")
  })
})
