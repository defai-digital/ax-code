import { describe, expect, test } from "vitest"
import type { MessageV2 } from "../../src/session/message-v2"
import { handlePromptLoopTodoContinuation } from "../../src/session/prompt-loop-todo-continuation"
import { pendingTodoProgressSignature, type PromptTodo } from "../../src/session/prompt-todo-continuation"
import { MessageID, SessionID } from "../../src/session/schema"

function assistant(id = MessageID.ascending()) {
  return { id } as MessageV2.Assistant
}

const todo: PromptTodo = {
  content: "finish task",
  status: "pending",
  priority: "high",
}

describe("prompt loop todo continuation", () => {
  test("publishes failure and stops at the agent step limit", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const failures: { sessionID: SessionID; assistant: MessageV2.Assistant; message: string }[] = []
    const sessionID = SessionID.descending()
    const message = assistant()

    const result = await handlePromptLoopTodoContinuation(
      {
        sessionID,
        assistant: message,
        isLastStep: true,
        todoRetries: 1,
        maxTodoRetries: 3,
        pendingTodos: [todo],
        lastPendingTodoSignature: undefined,
        stagnantTodoRetries: 0,
        maxSteps: 10,
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
        message: "autonomous todo continuation stopped at agent step limit",
        fields: {
          command: "session.prompt.loop",
          status: "stopped",
          errorCode: "STEP_LIMIT",
          sessionID,
          pendingCount: 1,
          attempts: 1,
          maxAttempts: 3,
          maxSteps: 10,
        },
      },
    ])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.sessionID).toBe(sessionID)
    expect(failures[0]?.assistant).toBe(message)
    expect(failures[0]?.message).toContain("agent step limit")
  })

  test("publishes failure and stops when todo retries are exhausted", async () => {
    const failures: { message: string }[] = []

    const result = await handlePromptLoopTodoContinuation(
      {
        sessionID: SessionID.descending(),
        assistant: assistant(),
        isLastStep: false,
        todoRetries: 3,
        maxTodoRetries: 3,
        pendingTodos: [todo],
        lastPendingTodoSignature: undefined,
        stagnantTodoRetries: 0,
        maxSteps: 10,
      },
      {
        async publishFailure(input) {
          failures.push({ message: input.message })
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "stalled" })
    expect(failures).toHaveLength(1)
    expect(failures[0]?.message).toContain("remaining todos are not complete")
  })

  test("returns retry state and continuation text for unfinished todos", async () => {
    const info: { message: string; fields: Record<string, unknown> }[] = []
    const signature = pendingTodoProgressSignature([todo])
    const sessionID = SessionID.descending()

    const result = await handlePromptLoopTodoContinuation(
      {
        sessionID,
        assistant: assistant(),
        isLastStep: false,
        todoRetries: 1,
        maxTodoRetries: 4,
        pendingTodos: [todo],
        lastPendingTodoSignature: pendingTodoProgressSignature([{ content: "some completed task" }]),
        stagnantTodoRetries: 1,
        maxSteps: 10,
      },
      {
        info(message, fields) {
          info.push({ message, fields })
        },
      },
    )

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    // The pending-content set changed since the last continuation, so the
    // retry budget refreshes before incrementing.
    expect(result.todoRetries).toBe(1)
    expect(result.lastPendingTodoSignature).toBe(signature)
    expect(result.stagnantTodoRetries).toBe(0)
    expect(result.text).toContain("finish task")
    expect(info).toEqual([
      {
        message: "autonomous todo continuation",
        fields: {
          command: "session.prompt.loop",
          status: "ok",
          sessionID,
          pendingCount: 1,
          attempt: 1,
          maxAttempts: 4,
          stagnantAttempts: 0,
        },
      },
    ])
  })

  test("logs stagnant retries while continuing unfinished todos", async () => {
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const signature = pendingTodoProgressSignature([todo])
    const sessionID = SessionID.descending()

    const result = await handlePromptLoopTodoContinuation(
      {
        sessionID,
        assistant: assistant(),
        isLastStep: false,
        todoRetries: 1,
        maxTodoRetries: 4,
        pendingTodos: [todo],
        lastPendingTodoSignature: signature,
        stagnantTodoRetries: 1,
        maxSteps: 10,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
      },
    )

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.stagnantTodoRetries).toBe(2)
    expect(result.text).toContain("not changed for 2 retries")
    expect(result.text).toContain("Complete a concrete todo")
    expect(warnings).toEqual([
      {
        message: "autonomous todo continuation is stagnant",
        fields: {
          command: "session.prompt.loop",
          status: "retry",
          sessionID,
          pendingCount: 1,
          attempts: 2,
          stagnantAttempts: 2,
          maxStagnantAttempts: 2,
        },
      },
    ])
  })
})
