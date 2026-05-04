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

  test("allows completion after the same subagent later returns a non-empty result", () => {
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
                metadata: { emptyResult: false, sessionId: "ses_empty" },
              },
            },
          ],
        },
      ],
    })

    expect(decision).toEqual({ status: "allow" })
  })

  test("does not let a different successful task clear an unresolved empty task", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_empty",
              state: {
                status: "completed",
                input: { description: "review the session" },
                output: "Subagent completed without a final response.",
                metadata: { emptyResult: true, sessionId: "ses_empty" },
              },
            },
            {
              type: "tool",
              tool: "task",
              callID: "call_ok",
              state: {
                status: "completed",
                input: { description: "review another area" },
                output: "The child session found and fixed the issue.",
                metadata: { emptyResult: false, sessionId: "ses_ok" },
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
        callID: "call_empty",
        taskID: "ses_empty",
        description: "review the session",
      },
    })
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

  test("blocks completion when a task tool failed before returning evidence", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_failed",
              state: {
                status: "error",
                input: { description: "review bug reports" },
                errorMessage: "Subagent finalization timed out after 2 minutes",
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
        callID: "call_failed",
        description: "review bug reports",
        failed: true,
        errorMessage: "Subagent finalization timed out after 2 minutes",
      },
    })
    if (decision.status !== "blocked") throw new Error("unexpected allow")
    expect(decision.message).toContain("failed before returning usable evidence")
  })

  test("allows completion when the assistant explicitly resolves an unrecoverable failed subagent", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_failed",
              state: {
                status: "error",
                input: { description: "Catalog all database tables" },
                errorMessage: "Subagent failed before returning usable evidence.",
              },
            },
          ],
        },
        {
          info: { role: "user" },
          parts: [
            {
              type: "text",
              text:
                "Control-plane completion gate blocked completion. Retry the subagent task, resume the task_id if available, or explicitly explain why no usable result can be recovered.",
            },
          ],
        },
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "text",
              text:
                "Completion gate resolution: the failed subagent was for the Catalog all database tables task. I do not need that result to complete this document review because I verified the relevant claims directly against the repository.",
            },
          ],
        },
      ],
    })

    expect(decision).toEqual({ status: "allow" })
  })

  test("does not let the injected user continuation clear a failed subagent", () => {
    const decision = AutonomousCompletionGate.evaluate({
      pendingTodos: [],
      messages: [
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call_failed",
              state: {
                status: "error",
                input: { description: "Catalog all database tables" },
                errorMessage: "Subagent failed before returning usable evidence.",
              },
            },
          ],
        },
        {
          info: { role: "user" },
          parts: [
            {
              type: "text",
              text:
                "Control-plane completion gate blocked completion. Retry the subagent task, resume the task_id if available, or explicitly explain why no usable result can be recovered.",
            },
          ],
        },
      ],
    })

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "empty_subagent_result",
      emptyResult: {
        callID: "call_failed",
        description: "Catalog all database tables",
        failed: true,
      },
    })
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

  test("clears empty result state across multiple messages when the same subagent returns a good result", () => {
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
                metadata: { emptyResult: false, sessionId: "ses_empty" },
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
