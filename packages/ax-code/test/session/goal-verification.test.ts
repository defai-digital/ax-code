import { describe, expect, test } from "bun:test"
import { GoalVerification } from "../../src/session/goal-verification"

function toolPart(tool: string, status: "completed" | "error" = "completed") {
  return { type: "tool", tool, state: { status } }
}

function bashPart(command: string, exit: number) {
  return { type: "tool", tool: "bash", state: { status: "completed", input: { command }, metadata: { exit } } }
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

  test("a bash run with a non-zero exit code does not count as verification", () => {
    const decision = GoalVerification.decide({
      messages: [assistant(toolPart("edit")), assistant(bashPart("bun test", 1))],
      pendingTodos: [],
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected rejection")
    expect(decision.reason).toBe("unverified_changes")
  })

  test("trivial commands do not count as verification", () => {
    for (const command of ["echo done", "true", "sleep 5", "echo a && echo b", "CI=1 echo ok"]) {
      const decision = GoalVerification.decide({
        messages: [assistant(toolPart("edit")), assistant(bashPart(command, 0))],
        pendingTodos: [],
      })
      expect(decision.ok).toBe(false)
    }
  })

  test("a passing real command counts as verification", () => {
    for (const command of ["bun test", "echo start && bun run typecheck", "CI=1 bun test --timeout 30000"]) {
      expect(
        GoalVerification.decide({
          messages: [assistant(toolPart("edit")), assistant(bashPart(command, 0))],
          pendingTodos: [],
        }),
      ).toEqual({ ok: true })
    }
  })

  test("legacy bash parts without exit metadata still count as verification", () => {
    expect(
      GoalVerification.decide({
        messages: [assistant(toolPart("edit")), assistant(toolPart("bash"))],
        pendingTodos: [],
      }),
    ).toEqual({ ok: true })
  })
})
