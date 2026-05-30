import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { handlePromptLoopEmptyTurn } from "../../src/session/prompt-loop-empty-turn"
import { MessageID, SessionID } from "../../src/session/schema"

function assistant(id = MessageID.ascending()) {
  return { id } as MessageV2.Assistant
}

describe("prompt loop empty model turn", () => {
  test("resets retry state when the model turn is not empty", async () => {
    const warnings: unknown[] = []
    const failures: unknown[] = []

    const result = await handlePromptLoopEmptyTurn(
      {
        sessionID: SessionID.descending(),
        assistant: assistant(),
        emptyModelTurn: false,
        emptyModelTurnRetries: 1,
        maxEmptyModelTurnRetries: 1,
        todoRetries: 4,
        pendingCount: 2,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        async publishFailure(input) {
          failures.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "ignore",
      emptyModelTurnRetries: 0,
      todoRetries: 4,
    })
    expect(warnings).toEqual([])
    expect(failures).toEqual([])
  })

  test("returns retry text and logs recovery for the first empty model turn", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const sessionID = SessionID.descending()

    const result = await handlePromptLoopEmptyTurn(
      {
        sessionID,
        assistant: assistant(),
        emptyModelTurn: true,
        emptyModelTurnRetries: 0,
        maxEmptyModelTurnRetries: 1,
        todoRetries: 2,
        pendingCount: 3,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
      },
    )

    expect(result.action).toBe("recover")
    if (result.action !== "recover") throw new Error("expected recovery")
    expect(result.emptyModelTurnRetries).toBe(1)
    expect(result.todoRetries).toBe(2)
    expect(result.text).toContain("empty-turn recovery 1/1")
    expect(warnings).toEqual([
      {
        message: "autonomous empty model turn recovery",
        fields: {
          command: "session.prompt.loop",
          status: "retry",
          errorCode: "EMPTY_MODEL_TURN",
          sessionID,
          attempt: 1,
          maxAttempts: 1,
          pendingCount: 3,
        },
      },
    ])
  })

  test("publishes failure and stops when empty model turn retries are exhausted", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()
    const message = assistant()

    const result = await handlePromptLoopEmptyTurn(
      {
        sessionID,
        assistant: message,
        emptyModelTurn: true,
        emptyModelTurnRetries: 1,
        maxEmptyModelTurnRetries: 1,
        todoRetries: 3,
        pendingCount: 2,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        async publishFailure(input) {
          failures.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "stop",
      reason: "stalled",
      emptyModelTurnRetries: 1,
      todoRetries: 3,
    })
    expect(warnings).toEqual([
      {
        message: "autonomous stopped after repeated empty model turn",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "EMPTY_MODEL_TURN",
          sessionID,
          attempts: 1,
          maxAttempts: 1,
          pendingCount: 2,
        },
      },
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.sessionID).toBe(sessionID)
    expect(failures[0]?.assistant).toBe(message)
    expect(failures[0]?.message).toContain("empty model turn")
  })
})
