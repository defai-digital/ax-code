import { describe, expect, test } from "vitest"
import type { MessageV2 } from "../../src/session/message-v2"
import { handlePromptLoopCompletionGateRetry } from "../../src/session/prompt-loop-completion-gate-retry"
import { MessageID, SessionID } from "../../src/session/schema"

function assistant(id = MessageID.ascending()) {
  return { id } as MessageV2.Assistant
}

function emptySubagentGate(signature = "empty-subagent:call:task:inspect") {
  return {
    status: "blocked",
    reason: "empty_subagent_result",
    signature,
    message: 'A subagent for "inspect" completed without a usable final response.',
    emptyResult: {
      callID: "call",
      taskID: "task",
      description: "inspect",
    },
  } as const
}

describe("prompt loop completion gate retry", () => {
  test("returns retry state and continuation text for recoverable empty subagent results", async () => {
    const info: { message: string; fields: Record<string, unknown> }[] = []
    const sessionID = SessionID.descending()
    const gate = emptySubagentGate("new")

    const result = await handlePromptLoopCompletionGateRetry(
      {
        sessionID,
        assistant: assistant(),
        gate,
        previousSignature: "old",
        retries: 2,
        maxRetries: 3,
        isLastStep: false,
      },
      {
        info(message, fields) {
          info.push({ message, fields })
        },
      },
    )

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.signature).toBe("new")
    expect(result.retries).toBe(1)
    expect(result.text).toContain("completion-gate auto-continuation 1/3")
    expect(result.text).toContain(gate.message)
    expect(info).toEqual([
      {
        message: "autonomous completion gate continuation",
        fields: {
          command: "session.prompt.loop",
          status: "ok",
          sessionID,
          reason: "empty_subagent_result",
          message: gate.message,
          attempt: 1,
          maxAttempts: 3,
        },
      },
    ])
  })

  test("publishes failure and stops at the agent step limit", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()
    const message = assistant()
    const gate = emptySubagentGate("same")

    const result = await handlePromptLoopCompletionGateRetry(
      {
        sessionID,
        assistant: message,
        gate,
        previousSignature: "same",
        retries: 0,
        maxRetries: 2,
        isLastStep: true,
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

    expect(result).toEqual({ action: "stop", reason: "step_limit" })
    expect(warnings).toEqual([
      {
        message: "autonomous completion gate stopped session",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "STEP_LIMIT",
          sessionID,
          reason: "empty_subagent_result",
          message: gate.message,
          attempts: 0,
          maxAttempts: 2,
        },
      },
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.sessionID).toBe(sessionID)
    expect(failures[0]?.assistant).toBe(message)
    expect(failures[0]?.message).toContain("completion gate")
    expect(failures[0]?.message).toContain("should not be treated as complete")
  })

  test("publishes failure and stops after retry budget exhaustion", async () => {
    const failures: { message: string }[] = []

    const result = await handlePromptLoopCompletionGateRetry(
      {
        sessionID: SessionID.descending(),
        assistant: assistant(),
        gate: emptySubagentGate("same"),
        previousSignature: "same",
        retries: 2,
        maxRetries: 2,
        isLastStep: false,
      },
      {
        async publishFailure(input) {
          failures.push({ message: input.message })
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "stalled" })
    expect(failures).toHaveLength(1)
    expect(failures[0]?.message).toContain("completion gate")
    expect(failures[0]?.message).toContain("incomplete subagent evidence")
  })
})
