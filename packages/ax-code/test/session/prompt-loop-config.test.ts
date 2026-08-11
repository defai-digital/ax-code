import { describe, expect, test } from "vitest"
import { GLOBAL_STEP_LIMIT, GOAL_TOTAL_STEP_HEADROOM, SUPER_LONG_TOTAL_STEP_HEADROOM } from "../../src/constants/session"
import {
  MAX_EMPTY_MODEL_TURN_RETRIES,
  MAX_TRUNCATED_MODEL_TURN_RETRIES,
  effectivePacingMaxSteps,
  promptLoopLimits,
} from "../../src/session/prompt-loop-config"

describe("promptLoopLimits", () => {
  test("uses prompt loop defaults when session config is absent", () => {
    const limits = promptLoopLimits({ session: undefined } as any)
    expect(limits).toMatchObject({
      sessionStepLimit: GLOBAL_STEP_LIMIT,
      maxContinuations: 3,
      maxTotalSteps: GLOBAL_STEP_LIMIT * 4,
      maxTotalStepsSuperLong: GLOBAL_STEP_LIMIT * SUPER_LONG_TOTAL_STEP_HEADROOM,
      maxTotalStepsGoal: GLOBAL_STEP_LIMIT * GOAL_TOTAL_STEP_HEADROOM,
      maxTodoRetries: 10,
      maxCompletionGateRetries: 2,
      maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
      maxTruncatedModelTurnRetries: MAX_TRUNCATED_MODEL_TURN_RETRIES,
    })
    expect(limits.autonomy.profile).toBe("standard")
    expect(limits.autonomy.toolCallRate.count).toBe(30)
  })

  test("derives completion gate retries from todo retry config", () => {
    const limits = promptLoopLimits({
      session: {
        max_steps: 42,
        max_continuations: 5,
        max_todo_retries: 1,
      },
    } as any)
    expect(limits).toMatchObject({
      sessionStepLimit: 42,
      maxContinuations: 5,
      // Cumulative ceiling defaults to step limit × (continuations + 1).
      maxTotalSteps: 42 * 6,
      maxTotalStepsSuperLong: 42 * SUPER_LONG_TOTAL_STEP_HEADROOM,
      // Active goals get the long-run backstop, not the plain-autonomous one.
      maxTotalStepsGoal: 42 * GOAL_TOTAL_STEP_HEADROOM,
      maxTodoRetries: 1,
      maxCompletionGateRetries: 1,
      maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
      maxTruncatedModelTurnRetries: MAX_TRUNCATED_MODEL_TURN_RETRIES,
    })
  })

  test("an explicit max_total_steps overrides all derived ceilings", () => {
    const limits = promptLoopLimits({
      session: {
        max_total_steps: 777,
      },
    } as any)
    expect(limits.maxTotalSteps).toBe(777)
    expect(limits.maxTotalStepsSuperLong).toBe(777)
    expect(limits.maxTotalStepsGoal).toBe(777)
  })
})

describe("effectivePacingMaxSteps (ADR-051)", () => {
  test("unbounded agent uses the session step limit", () => {
    expect(effectivePacingMaxSteps({ agentSteps: Infinity, sessionStepLimit: 500 })).toBe(500)
  })

  test("finite agent cap is the chip denominator when below session limit", () => {
    expect(effectivePacingMaxSteps({ agentSteps: 30, sessionStepLimit: 500 })).toBe(30)
  })

  test("session limit wins when tighter than the agent cap", () => {
    expect(effectivePacingMaxSteps({ agentSteps: 200, sessionStepLimit: 50 })).toBe(50)
  })

  test("non-positive agent steps fall back to session limit", () => {
    expect(effectivePacingMaxSteps({ agentSteps: 0, sessionStepLimit: 100 })).toBe(100)
  })
})
