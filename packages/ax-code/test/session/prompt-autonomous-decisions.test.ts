import { describe, expect, test } from "bun:test"
import {
  EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE,
  emptyModelTurnDecision,
} from "../../src/session/prompt-autonomous-decisions"

describe("autonomous continuation decisions", () => {
  test("resets empty-model-turn retries when the turn is not empty", () => {
    expect(
      emptyModelTurnDecision({
        emptyModelTurn: false,
        emptyModelTurnRetries: 1,
        maxEmptyModelTurnRetries: 1,
        todoRetries: 4,
      }),
    ).toEqual({
      action: "ignore",
      emptyModelTurnRetries: 0,
      todoRetries: 4,
    })
  })

  test("recovers from the first empty model turn and advances retry counters", () => {
    expect(
      emptyModelTurnDecision({
        emptyModelTurn: true,
        emptyModelTurnRetries: 0,
        maxEmptyModelTurnRetries: 1,
        todoRetries: 2,
      }),
    ).toEqual({
      action: "recover",
      emptyModelTurnRetries: 1,
      todoRetries: 3,
      attempt: 1,
      maxAttempts: 1,
    })
  })

  test("stops after the empty model turn retry budget is exhausted", () => {
    expect(
      emptyModelTurnDecision({
        emptyModelTurn: true,
        emptyModelTurnRetries: 1,
        maxEmptyModelTurnRetries: 1,
        todoRetries: 3,
      }),
    ).toEqual({
      action: "stop",
      emptyModelTurnRetries: 1,
      todoRetries: 3,
      reason: "stalled",
      errorCode: "EMPTY_MODEL_TURN",
      message: EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE,
      attempts: 1,
      maxAttempts: 1,
    })
  })
})
