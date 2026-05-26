import { describe, expect, test } from "bun:test"
import type { ReplayEvent } from "../../src/replay/event"
import { emitPromptLoopCompletionGateDecision } from "../../src/session/prompt-loop-completion-gate"
import { MessageID, SessionID } from "../../src/session/schema"

describe("prompt loop completion gate event emission", () => {
  test("does not emit unfinished-todo gate events before the model turn finishes", () => {
    const events: ReplayEvent[] = []

    const emitted = emitPromptLoopCompletionGateDecision(
      {
        sessionID: SessionID.descending(),
        messageID: MessageID.ascending(),
        step: 4,
        modelFinished: false,
        gate: {
          status: "blocked",
          reason: "unfinished_todos",
          signature: "todos:pending:write tests",
          message: "1 todo remains unfinished.",
          pendingTodos: [{ content: "write tests", status: "pending", priority: "medium" }],
        },
        todoRetries: 2,
        maxTodoRetries: 5,
        completionGateRetries: 1,
        maxCompletionGateRetries: 3,
      },
      {
        emit(event) {
          events.push(event)
        },
      },
    )

    expect(emitted).toBe(false)
    expect(events).toEqual([])
  })

  test("emits allowed completion gate events after a finished model turn", () => {
    const events: ReplayEvent[] = []
    const sessionID = SessionID.descending()
    const messageID = MessageID.ascending()

    const emitted = emitPromptLoopCompletionGateDecision(
      {
        sessionID,
        messageID,
        step: 3,
        modelFinished: true,
        gate: { status: "allow" },
        todoRetries: 4,
        maxTodoRetries: 10,
        completionGateRetries: 1,
        maxCompletionGateRetries: 2,
      },
      {
        emit(event) {
          events.push(event)
        },
      },
    )

    expect(emitted).toBe(true)
    expect(events).toEqual([
      {
        type: "agent.completion_gate.decided",
        sessionID,
        messageID,
        stepIndex: 3,
        status: "allow",
        reason: "none",
        message: "Completion gate passed.",
        retryCount: 1,
        maxRetries: 2,
      },
    ])
  })

  test("emits empty-subagent blocked gate events even before model finish recovery", () => {
    const events: ReplayEvent[] = []
    const sessionID = SessionID.descending()
    const messageID = MessageID.ascending()

    const emitted = emitPromptLoopCompletionGateDecision(
      {
        sessionID,
        messageID,
        step: 8,
        modelFinished: false,
        gate: {
          status: "blocked",
          reason: "empty_subagent_result",
          signature: "empty-subagent:call:task:inspect",
          message: 'A subagent for "inspect" completed without a usable final response.',
          emptyResult: {
            callID: "call",
            taskID: "task",
            description: "inspect",
          },
        },
        todoRetries: 4,
        maxTodoRetries: 10,
        completionGateRetries: 1,
        maxCompletionGateRetries: 2,
      },
      {
        emit(event) {
          events.push(event)
        },
      },
    )

    expect(emitted).toBe(true)
    expect(events).toEqual([
      {
        type: "agent.completion_gate.decided",
        sessionID,
        messageID,
        stepIndex: 8,
        status: "blocked",
        reason: "empty_subagent_result",
        message: 'A subagent for "inspect" completed without a usable final response.',
        retryCount: 1,
        maxRetries: 2,
      },
    ])
  })
})
