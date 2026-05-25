import { describe, expect, test } from "bun:test"
import { resolvePromptLoopAssistantExit } from "../../src/session/prompt-loop-exit"
import { MessageID, SessionID } from "../../src/session/schema"

describe("prompt loop assistant exit", () => {
  test("continues when the assistant has not answered the latest user turn", () => {
    const logs: string[] = []

    const result = resolvePromptLoopAssistantExit(
      {
        sessionID: SessionID.descending(),
        lastUserID: "msg_2",
        lastAssistant: { id: MessageID.make("msg_1"), finish: "stop" },
        hasPendingSubtask: false,
      },
      {
        info(message) {
          logs.push(message)
        },
        warn(message) {
          logs.push(message)
        },
      },
    )

    expect(result).toEqual({ action: "continue" })
    expect(logs).toEqual([])
  })

  test("stops and logs when the assistant completed the latest user turn", () => {
    const entries: { level: string; message: string; fields: Record<string, unknown> }[] = []
    const sessionID = SessionID.descending()

    const result = resolvePromptLoopAssistantExit(
      {
        sessionID,
        lastUserID: "msg_1",
        lastAssistant: { id: MessageID.make("msg_2"), finish: "stop" },
        hasPendingSubtask: false,
      },
      {
        info(message, fields) {
          entries.push({ level: "info", message, fields })
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "completed" })
    expect(entries).toEqual([
      {
        level: "info",
        message: "exiting loop",
        fields: {
          command: "session.prompt.loop",
          status: "ok",
          sessionID,
        },
      },
    ])
  })

  test("treats unknown finish without pending subtask as completed", () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const sessionID = SessionID.descending()

    const result = resolvePromptLoopAssistantExit(
      {
        sessionID,
        lastUserID: "msg_1",
        lastAssistant: { id: MessageID.make("msg_2"), finish: "unknown" },
        hasPendingSubtask: false,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "completed" })
    expect(warnings).toEqual([
      {
        message: "model returned unknown finish with no actionable output",
        fields: {
          command: "session.prompt.loop",
          sessionID,
        },
      },
    ])
  })

  test("keeps unknown finish active while a subtask is pending", () => {
    const result = resolvePromptLoopAssistantExit({
      sessionID: SessionID.descending(),
      lastUserID: "msg_1",
      lastAssistant: { id: MessageID.make("msg_2"), finish: "unknown" },
      hasPendingSubtask: true,
    })

    expect(result).toEqual({ action: "continue" })
  })
})
