import { describe, expect, test } from "bun:test"
import { handlePromptLoopTodoConvergence } from "../../src/session/prompt-loop-todo-convergence"
import { pendingTodoSignature, type PromptTodo } from "../../src/session/prompt-todo-continuation"
import { SessionID } from "../../src/session/schema"

const reportTodo: PromptTodo = {
  content: "write .internal/bugs report for suspected issue",
  status: "pending",
  priority: "high",
}

const implementationTodo: PromptTodo = {
  content: "finish implementation",
  status: "in_progress",
  priority: "medium",
}

describe("prompt loop todo convergence", () => {
  test("continues for report-style todos when context is large", () => {
    const sessionID = SessionID.descending()
    const info: { message: string; fields: Record<string, unknown> }[] = []

    const result = handlePromptLoopTodoConvergence(
      {
        sessionID,
        pendingTodos: [reportTodo],
        inputTokens: 50_000,
        modelFinished: false,
        remainingAgentSteps: 20,
        maxSteps: 30,
        lastTodoContextSignature: undefined,
        lastTodoDeadlineSignature: undefined,
      },
      {
        info(message, fields) {
          info.push({ message, fields })
        },
      },
    )

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.lastTodoContextSignature).toBe(pendingTodoSignature([reportTodo]))
    expect(result.lastTodoDeadlineSignature).toBeUndefined()
    expect(result.text).toContain(".internal/bugs report now")
    expect(info).toEqual([
      {
        message: "autonomous todo context convergence",
        fields: {
          command: "session.prompt.loop",
          status: "ok",
          sessionID,
          pendingCount: 1,
          inputTokens: 50_000,
          threshold: 50_000,
        },
      },
    ])
  })

  test("deduplicates context convergence by pending-todo signature", () => {
    const signature = pendingTodoSignature([reportTodo])
    const info: unknown[] = []

    const result = handlePromptLoopTodoConvergence(
      {
        sessionID: SessionID.descending(),
        pendingTodos: [reportTodo],
        inputTokens: 50_000,
        modelFinished: false,
        remainingAgentSteps: Infinity,
        maxSteps: Infinity,
        lastTodoContextSignature: signature,
        lastTodoDeadlineSignature: undefined,
      },
      {
        info(message, fields) {
          info.push({ message, fields })
        },
      },
    )

    expect(result).toEqual({
      action: "ignore",
      lastTodoContextSignature: signature,
      lastTodoDeadlineSignature: undefined,
    })
    expect(info).toEqual([])
  })

  test("continues near the agent deadline and records the deadline signature", () => {
    const sessionID = SessionID.descending()
    const info: { message: string; fields: Record<string, unknown> }[] = []

    const result = handlePromptLoopTodoConvergence(
      {
        sessionID,
        pendingTodos: [implementationTodo],
        inputTokens: 1_000,
        modelFinished: false,
        remainingAgentSteps: 2,
        maxSteps: 12,
        lastTodoContextSignature: undefined,
        lastTodoDeadlineSignature: undefined,
      },
      {
        info(message, fields) {
          info.push({ message, fields })
        },
      },
    )

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.lastTodoContextSignature).toBeUndefined()
    expect(result.lastTodoDeadlineSignature).toBe(pendingTodoSignature([implementationTodo]))
    expect(result.text).toContain("2 steps remaining")
    expect(result.text).toContain("finish implementation")
    expect(info).toEqual([
      {
        message: "autonomous todo deadline convergence",
        fields: {
          command: "session.prompt.loop",
          status: "ok",
          sessionID,
          pendingCount: 1,
          remainingAgentSteps: 2,
          maxSteps: 12,
        },
      },
    ])
  })
})
