import { describe, expect, test } from "bun:test"
import { GoalVerification } from "../../src/session/goal-verification"

function toolPart(tool: string, status: "completed" | "error" = "completed") {
  return { type: "tool", tool, state: { status } }
}

function assistant(...parts: unknown[]): GoalVerification.Message {
  return { info: { role: "assistant" }, parts }
}

describe("GoalVerification.decide", () => {
  test("allows completion when there are no todos and no file changes", () => {
    expect(
      GoalVerification.decide({
        messages: [assistant(toolPart("read"), toolPart("grep"))],
        pendingTodos: [],
      }),
    ).toEqual({ ok: true })
  })

  test("rejects completion while todos are pending or in progress", () => {
    const decision = GoalVerification.decide({
      messages: [],
      pendingTodos: [{ status: "pending" }, { status: "completed" }],
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected rejection")
    expect(decision.reason).toBe("pending_todos")
  })

  test("ignores todos that are completed or cancelled", () => {
    expect(
      GoalVerification.decide({
        messages: [],
        pendingTodos: [{ status: "completed" }, { status: "cancelled" }],
      }),
    ).toEqual({ ok: true })
  })

  test("rejects completion when files changed with no verification command after", () => {
    const decision = GoalVerification.decide({
      messages: [assistant(toolPart("bash"), toolPart("edit"))],
      pendingTodos: [],
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected rejection")
    expect(decision.reason).toBe("unverified_changes")
  })

  test("allows completion when a command ran after the last file change", () => {
    expect(
      GoalVerification.decide({
        messages: [assistant(toolPart("edit"), toolPart("write")), assistant(toolPart("bash"))],
        pendingTodos: [],
      }),
    ).toEqual({ ok: true })
  })

  test("a failed command does not count as verification", () => {
    const decision = GoalVerification.decide({
      messages: [assistant(toolPart("edit")), assistant(toolPart("bash", "error"))],
      pendingTodos: [],
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected rejection")
    expect(decision.reason).toBe("unverified_changes")
  })

  test("ignores tool calls on non-assistant messages", () => {
    expect(
      GoalVerification.decide({
        messages: [{ info: { role: "user" }, parts: [toolPart("edit")] }],
        pendingTodos: [],
      }),
    ).toEqual({ ok: true })
  })

  test("goals with no file mutations never require verification", () => {
    expect(
      GoalVerification.decide({
        messages: [assistant(toolPart("read"), toolPart("task"), toolPart("grep"))],
        pendingTodos: [],
      }),
    ).toEqual({ ok: true })
  })
})
