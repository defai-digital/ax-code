import { describe, expect, test } from "bun:test"
import { GLOBAL_STEP_LIMIT } from "../../src/constants/session"
import { MAX_EMPTY_MODEL_TURN_RETRIES, MAX_TRUNCATED_MODEL_TURN_RETRIES, promptLoopLimits } from "../../src/session/prompt-loop-config"

describe("promptLoopLimits", () => {
  test("uses prompt loop defaults when session config is absent", () => {
    expect(promptLoopLimits({ session: undefined } as any)).toEqual({
      sessionStepLimit: GLOBAL_STEP_LIMIT,
      maxContinuations: 3,
      maxTodoRetries: 10,
      maxCompletionGateRetries: 2,
      maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
      maxTruncatedModelTurnRetries: MAX_TRUNCATED_MODEL_TURN_RETRIES,
    })
  })

  test("derives completion gate retries from todo retry config", () => {
    expect(
      promptLoopLimits({
        session: {
          max_steps: 42,
          max_continuations: 5,
          max_todo_retries: 1,
        },
      } as any),
    ).toEqual({
      sessionStepLimit: 42,
      maxContinuations: 5,
      maxTodoRetries: 1,
      maxCompletionGateRetries: 1,
      maxEmptyModelTurnRetries: MAX_EMPTY_MODEL_TURN_RETRIES,
      maxTruncatedModelTurnRetries: MAX_TRUNCATED_MODEL_TURN_RETRIES,
    })
  })
})
