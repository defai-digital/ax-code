export const EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE =
  `Autonomous mode received an empty model turn: the provider returned finish=other with zero input, ` +
  `output, and reasoning tokens. The session is stopped, but the work should not be treated as complete.`

export type EmptyModelTurnDecision =
  | {
      action: "ignore"
      emptyModelTurnRetries: number
      todoRetries: number
    }
  | {
      action: "recover"
      emptyModelTurnRetries: number
      todoRetries: number
      attempt: number
      maxAttempts: number
    }
  | {
      action: "stop"
      emptyModelTurnRetries: number
      todoRetries: number
      reason: "stalled"
      errorCode: "EMPTY_MODEL_TURN"
      message: string
      attempts: number
      maxAttempts: number
    }

export function emptyModelTurnDecision(input: {
  emptyModelTurn: boolean
  emptyModelTurnRetries: number
  maxEmptyModelTurnRetries: number
  todoRetries: number
}): EmptyModelTurnDecision {
  if (!input.emptyModelTurn) {
    return {
      action: "ignore",
      emptyModelTurnRetries: 0,
      todoRetries: input.todoRetries,
    }
  }

  if (input.emptyModelTurnRetries >= input.maxEmptyModelTurnRetries) {
    return {
      action: "stop",
      emptyModelTurnRetries: input.emptyModelTurnRetries,
      todoRetries: input.todoRetries,
      reason: "stalled",
      errorCode: "EMPTY_MODEL_TURN",
      message: EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE,
      attempts: input.emptyModelTurnRetries,
      maxAttempts: input.maxEmptyModelTurnRetries,
    }
  }

  const nextEmptyModelTurnRetries = input.emptyModelTurnRetries + 1
  return {
    action: "recover",
    emptyModelTurnRetries: nextEmptyModelTurnRetries,
    todoRetries: input.todoRetries + 1,
    attempt: nextEmptyModelTurnRetries,
    maxAttempts: input.maxEmptyModelTurnRetries,
  }
}
