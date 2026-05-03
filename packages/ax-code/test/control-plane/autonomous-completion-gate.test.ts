import { describe, expect, test } from "bun:test"

import { AutonomousCompletionGate } from "../../src/control-plane/autonomous-completion-gate"

describe("AutonomousCompletionGate", () => {
  test("blocks completion when the latest task result is empty", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_1",
              state: {
                status: "completed",
                input: { description: "review the session" },
                output: "Subagent completed without a final response.",
                metadata: { emptyResult: true, sessionId: "ses_child" },
              },
            },
          ],
        },
      ],
    })

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "empty_subagent_result",
      emptyResult: {
        callID: "call_1",
        taskID: "ses_child",
        description: "review the session",
      },
    })
  })

  test("allows completion after a later non-empty task result", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_1",
              state: {
                status: "completed",
                output: "Subagent completed without a final response.",
                metadata: { emptyResult: true, sessionId: "ses_empty" },
              },
            },
            {
              type: "tool",
              tool: "task",
              callID: "call_2",
              state: {
                status: "completed",
                output: "The child session found and fixed the issue.",
                metadata: { emptyResult: false, sessionId: "ses_ok" },
              },
            },
          ],
        },
      ],
    })

    expect(decision).toEqual({ status: "allow" })
  })

  test("blocks recovered subagent results that still need review", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_recovered",
              state: {
                status: "completed",
                input: { description: "review benchmark code" },
                output: "Evidence remains incomplete and needs validation.",
                metadata: {
                  emptyResult: false,
                  finalizeAttempted: true,
                  recoveredFromEmpty: true,
                  recoveredResultNeedsReview: true,
                  sessionId: "ses_recovered",
                },
              },
            },
          ],
        },
      ],
    })

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "empty_subagent_result",
      emptyResult: {
        callID: "call_recovered",
        taskID: "ses_recovered",
        description: "review benchmark code",
        recoveredResultNeedsReview: true,
      },
    })
    if (decision.status !== "blocked") throw new Error("unexpected allow")
    expect(decision.message).toContain("returned recovered evidence that still needs review")
  })

  test("blocks completion when todos are unfinished", () => {
    const decision = AutonomousCompletionGate.evaluate({
      messages: [],
      pendingTodos: [{ content: "Write bug report", status: "in_progress", priority: "high" }],
    })

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "unfinished_todos",
      pendingTodos: [{ content: "Write bug report", status: "in_progress", priority: "high" }],
    })
  })

  test("blocked decision includes a signature and message", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_99",
              state: {
                status: "completed",
                input: { description: "analyze logs" },
                output: "Subagent completed without a final response.",
                metadata: { emptyResult: true, sessionId: "ses_abc" },
              },
            },
          ],
        },
      ],
    })

    expect(decision).toMatchObject({ status: "blocked" })
    if (decision.status !== "blocked") throw new Error("unexpected allow")
    expect(decision.signature).toContain("call_99")
    expect(decision.signature).toContain("ses_abc")
    expect(decision.message).toContain("ses_abc")
  })

  test("allows completion when no messages and no todos", () => {
    expect(AutonomousCompletionGate.evaluate({ messages: [], pendingTodos: [] })).toEqual({ status: "allow" })
  })

  test("allows completion when message has no parts", () => {
    expect(AutonomousCompletionGate.evaluate({ messages: [{}], pendingTodos: [] })).toEqual({ status: "allow" })
  })

  test("ignores non-task tool calls when checking empty subagent results", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "write",
              callID: "call_write",
              state: {
                status: "completed",
                output: "Subagent completed without a final response.",
                metadata: { emptyResult: true },
              },
            },
          ],
        },
      ],
    })

    expect(decision).toEqual({ status: "allow" })
  })

  test("ignores task calls that are not yet completed", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_1",
              state: {
                status: "running",
                output: "Subagent completed without a final response.",
                metadata: { emptyResult: true, sessionId: "ses_running" },
              },
            },
          ],
        },
      ],
    })

    expect(decision).toEqual({ status: "allow" })
  })

  test("clears empty result state across multiple messages when a good result follows", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_1",
              state: {
                status: "completed",
                output: "Subagent completed without a final response.",
                metadata: { emptyResult: true, sessionId: "ses_empty" },
              },
            },
          ],
        },
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_2",
              state: {
                status: "completed",
                output: "All issues resolved successfully.",
                metadata: { emptyResult: false, sessionId: "ses_ok" },
              },
            },
          ],
        },
      ],
    })

    expect(decision).toEqual({ status: "allow" })
  })

  test("handles empty results without taskID or description gracefully", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_anon",
              state: {
                status: "completed",
                output: "Subagent completed without a final response.",
                metadata: {},
              },
            },
          ],
        },
      ],
    })

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "empty_subagent_result",
      emptyResult: { callID: "call_anon" },
    })
    if (decision.status !== "blocked") throw new Error("unexpected allow")
    expect(decision.emptyResult.taskID).toBeUndefined()
    expect(decision.emptyResult.description).toBeUndefined()
  })

  test("blocks completion for pending-status todos as well as in_progress", () => {
    const decision = AutonomousCompletionGate.evaluate({
      messages: [],
      pendingTodos: [
        { content: "Review PR", status: "pending", priority: "medium" },
        { content: "Deploy to staging", status: "in_progress", priority: "high" },
      ],
    })

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "unfinished_todos",
    })
    if (decision.status !== "blocked") throw new Error("unexpected allow")
    expect(decision.pendingTodos).toHaveLength(2)
  })

  test("ignores completed and cancelled todos when deciding to allow", () => {
    const decision = AutonomousCompletionGate.evaluate({
      messages: [],
      pendingTodos: [
        { content: "Old task", status: "completed", priority: "low" },
        { content: "Cancelled task", status: "cancelled", priority: "low" },
      ],
    })

    expect(decision).toEqual({ status: "allow" })
  })

  test("todo signature encodes status and content for deduplication", () => {
    const decision = AutonomousCompletionGate.evaluate({
      messages: [],
      pendingTodos: [{ content: "run tests", status: "in_progress", priority: "high" }],
    })

    expect(decision).toMatchObject({ status: "blocked" })
    if (decision.status !== "blocked") throw new Error("unexpected allow")
    expect(decision.signature).toContain("in_progress:run tests")
  })
})
