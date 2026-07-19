import { describe, expect, test } from "vitest"
import type { MessageV2 } from "../../src/session/message-v2"
import {
  handlePromptLoopTruncatedTurn,
  isRepeatedTruncatedModelOutput,
  truncatedModelOutputPrefix,
} from "../../src/session/prompt-loop-truncated-turn"
import { MessageID, SessionID } from "../../src/session/schema"

function assistant(id = MessageID.ascending()) {
  return { id } as MessageV2.Assistant
}

describe("prompt loop truncated model turn", () => {
  test("detects only repeated substantial normalized output prefixes", () => {
    const repeated = "The Journal of Modern African Studies has additional publication details. ".repeat(8)

    expect(
      isRepeatedTruncatedModelOutput({
        previousOutputPrefix: truncatedModelOutputPrefix(repeated),
        currentOutputPrefix: truncatedModelOutputPrefix(repeated.replaceAll(" ", "\n\t")),
      }),
    ).toBe(true)
    expect(
      isRepeatedTruncatedModelOutput({
        previousOutputPrefix: truncatedModelOutputPrefix(repeated),
        currentOutputPrefix: truncatedModelOutputPrefix(`Different response from the provider. ${repeated}`),
      }),
    ).toBe(false)
    expect(
      isRepeatedTruncatedModelOutput({
        previousOutputPrefix: truncatedModelOutputPrefix("short repeated output"),
        currentOutputPrefix: truncatedModelOutputPrefix("short repeated output"),
      }),
    ).toBe(false)
  })

  test("resets retry state when the model turn is not truncated", async () => {
    const warnings: unknown[] = []
    const failures: unknown[] = []

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID: SessionID.descending(),
        assistant: assistant(),
        truncatedModelTurn: false,
        truncatedModelTurnRetries: 1,
        maxTruncatedModelTurnRetries: 1,
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
      truncatedModelTurnRetries: 0,
    })
    expect(warnings).toEqual([])
    expect(failures).toEqual([])
  })

  test("returns retry text and logs recovery for the first truncated model turn", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const sessionID = SessionID.descending()

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: assistant(),
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 0,
        maxTruncatedModelTurnRetries: 1,
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
    expect(result.truncatedModelTurnRetries).toBe(1)
    expect(result.text).toContain("truncated-turn recovery 1/1")
    expect(warnings).toEqual([
      {
        message: "autonomous truncated model turn recovery",
        fields: {
          command: "session.prompt.loop",
          status: "retry",
          errorCode: "TRUNCATED_MODEL_TURN",
          sessionID,
          attempt: 1,
          maxAttempts: 1,
          pendingCount: 3,
        },
      },
    ])
  })

  test("publishes failure and stops when truncated model turn retries are exhausted", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()
    const message = assistant()

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: message,
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 1,
        maxTruncatedModelTurnRetries: 1,
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
      truncatedModelTurnRetries: 1,
    })
    expect(warnings).toEqual([
      {
        message: "autonomous stopped after repeated truncated model turn",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "TRUNCATED_MODEL_TURN",
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
    expect(failures[0]?.message).toContain("truncated model turn")
  })

  test("publishes a provider-state diagnostic and stops a repeated truncation retry early", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()
    const message = assistant()
    const repeated = "The Journal of Modern African Studies has additional publication details. ".repeat(8)

    const result = await handlePromptLoopTruncatedTurn(
      {
        sessionID,
        assistant: message,
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 1,
        maxTruncatedModelTurnRetries: 3,
        pendingCount: 0,
        previousOutputPrefix: truncatedModelOutputPrefix(repeated),
        currentOutputPrefix: truncatedModelOutputPrefix(repeated),
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
      truncatedModelTurnRetries: 1,
    })
    expect(warnings).toEqual([
      {
        message: "autonomous stopped after repeated truncated model output",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "REPEATED_TRUNCATED_MODEL_TURN",
          sessionID,
          attempts: 1,
          maxAttempts: 3,
          pendingCount: 0,
        },
      },
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.assistant).toBe(message)
    expect(failures[0]?.message).toContain("stale provider or local model runtime state")
  })
})
