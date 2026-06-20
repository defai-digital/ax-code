import { describe, expect, test } from "vitest"
import { handlePromptLoopGlobalStepLimit } from "../../src/session/prompt-loop-step-limit"
import { SessionID } from "../../src/session/schema"

describe("prompt loop global step limit", () => {
  test("ignores prompts below the configured global step limit", () => {
    const sideEffects: unknown[] = []

    const result = handlePromptLoopGlobalStepLimit(
      {
        sessionID: SessionID.descending(),
        step: 9,
        stepLimit: 10,
        autonomous: true,
        continuations: 0,
        maxContinuations: 3,
      },
      {
        warn(message, fields) {
          sideEffects.push({ message, fields })
        },
        publishError(input) {
          sideEffects.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "ignore" })
    expect(sideEffects).toEqual([])
  })

  test("returns the autonomous continuation prompt while continuation budget remains", () => {
    const result = handlePromptLoopGlobalStepLimit({
      sessionID: SessionID.descending(),
      step: 10,
      stepLimit: 10,
      autonomous: true,
      continuations: 1,
      maxContinuations: 3,
    })

    expect(result.action).toBe("continue_autonomous")
    if (result.action !== "continue_autonomous") throw new Error("expected autonomous continuation")
    expect(result.text).toContain("10 steps")
    expect(result.text).toContain("auto-continuation 2/3")
  })

  test("keeps continuing past the configured cap when Super-Long lifts it to Infinity", () => {
    const result = handlePromptLoopGlobalStepLimit({
      sessionID: SessionID.descending(),
      step: 10,
      stepLimit: 10,
      autonomous: true,
      continuations: 250,
      maxContinuations: Number.POSITIVE_INFINITY,
    })

    expect(result.action).toBe("continue_autonomous")
    if (result.action !== "continue_autonomous") throw new Error("expected autonomous continuation")
    expect(result.text).toContain("auto-continuation 251 (Super-Long mode: no continuation cap)")
  })

  test("logs and publishes a user-facing error when the global step limit stops the loop", () => {
    const sessionID = SessionID.descending()
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const published: { sessionID: SessionID; message: string }[] = []

    const result = handlePromptLoopGlobalStepLimit(
      {
        sessionID,
        step: 10,
        stepLimit: 10,
        autonomous: true,
        continuations: 3,
        maxContinuations: 3,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "step_limit" })
    expect(warnings).toEqual([
      {
        message: "global step limit reached",
        fields: {
          command: "session.prompt.loop",
          status: "error",
          errorCode: "STEP_LIMIT",
          step: 10,
          sessionID,
          continuations: 3,
        },
      },
    ])
    expect(published).toHaveLength(1)
    expect(published[0]?.sessionID).toBe(sessionID)
    expect(published[0]?.message).toContain("10 steps")
    expect(published[0]?.message).toContain("after 3 auto-continuations")
  })
})
