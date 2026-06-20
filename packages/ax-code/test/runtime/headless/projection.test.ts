import { describe, expect, test } from "vitest"
import {
  applyHeadlessProjectionEvent,
  createHeadlessProjectionState,
  runtimeProbeKeysForEvent,
} from "../../../src/runtime/headless"

type Session = { id: string }
type Todo = { id: string }
type Diff = { path: string }
type Status = { type: "idle" | "busy" }
type Message = { id: string; sessionID: string }
type Part = { id: string; messageID: string; type?: string; text?: string }
type TaskQueueItem = { id: string; sessionID?: string; status: "queued" | "running" | "completed" }

describe("headless projection", () => {
  test("tracks stream health from control events and fixture state", () => {
    const fixture = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>({
      streamHealth: "fixture",
    })
    expect(fixture.stream_health).toBe("fixture")

    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()
    expect(state.stream_health).toBe("connecting")

    applyHeadlessProjectionEvent(state, { type: "server.connected", properties: {} })
    expect(state.stream_health).toBe("connected")

    applyHeadlessProjectionEvent(state, { type: "server.instance.disposed" })
    expect(state.stream_health).toBe("unavailable")
  })

  test("stores request prompts when autonomy is disabled and emits effects when autonomy is enabled", () => {
    const manual = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()
    const autonomous = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    const request = {
      id: "perm_1",
      sessionID: "ses_1",
      permission: "shell",
      patterns: [],
      metadata: {},
      always: [],
    }

    const manualResult = applyHeadlessProjectionEvent(
      manual,
      {
        type: "permission.asked",
        properties: request,
      },
      {
        autonomous: false,
      },
    )
    const autonomousResult = applyHeadlessProjectionEvent(
      autonomous,
      {
        type: "permission.asked",
        properties: request,
      },
      {
        autonomous: true,
      },
    )

    expect(manual.permission).toEqual({
      ses_1: [request],
    })
    expect(manualResult.effects).toEqual([])
    expect(autonomous.permission).toEqual({})
    expect(autonomousResult.effects).toEqual([
      {
        type: "permission.auto_reply",
        requestID: "perm_1",
      },
    ])
  })

  test("removes shifted message parts when session messages exceed the configured limit", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    applyHeadlessProjectionEvent(state, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_1",
          sessionID: "ses_1",
        },
      },
    })
    applyHeadlessProjectionEvent(state, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part_1",
          messageID: "msg_1",
          type: "text",
          text: "hello",
        },
      },
    })
    applyHeadlessProjectionEvent(state, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_2",
          sessionID: "ses_1",
        },
      },
    })
    applyHeadlessProjectionEvent(
      state,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_3",
            sessionID: "ses_1",
          },
        },
      },
      {
        maxSessionMessages: 2,
      },
    )

    expect(state.message).toEqual({
      ses_1: [
        {
          id: "msg_2",
          sessionID: "ses_1",
        },
        {
          id: "msg_3",
          sessionID: "ses_1",
        },
      ],
    })
    expect(state.part).toEqual({})
  })

  test("removes all overflow messages and parts when the projection cap shrinks", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    for (const id of ["1", "2", "3"]) {
      applyHeadlessProjectionEvent(state, {
        type: "message.updated",
        properties: {
          info: {
            id: `msg_${id}`,
            sessionID: "ses_1",
          },
        },
      })
      applyHeadlessProjectionEvent(state, {
        type: "message.part.updated",
        properties: {
          part: {
            id: `part_${id}`,
            messageID: `msg_${id}`,
            type: "text",
            text: id,
          },
        },
      })
    }

    applyHeadlessProjectionEvent(
      state,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_4",
            sessionID: "ses_1",
          },
        },
      },
      {
        maxSessionMessages: 1,
      },
    )

    expect(state.message.ses_1).toEqual([{ id: "msg_4", sessionID: "ses_1" }])
    expect(state.part).toEqual({})
  })

  test("maps runtime events to runtime probe keys without TUI-specific handlers", () => {
    expect(runtimeProbeKeysForEvent({ type: "mcp.tools.changed" })).toEqual(["mcp"])
    expect(runtimeProbeKeysForEvent({ type: "lsp.updated" })).toEqual(["lsp", "debug-engine"])
    expect(runtimeProbeKeysForEvent({ type: "workflow.run.updated", properties: {} })).toEqual(["workflow"])
    expect(runtimeProbeKeysForEvent({ type: "workflow.run.completed", properties: {} })).toEqual(["workflow"])
    expect(runtimeProbeKeysForEvent({ type: "workflow.budget.exceeded", properties: {} })).toEqual(["workflow"])
    expect(runtimeProbeKeysForEvent({ type: "vcs.branch.updated", properties: { branch: "main" } })).toEqual([])
  })

  test("tracks live session goal updates", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    applyHeadlessProjectionEvent(state, {
      type: "session.goal",
      properties: {
        sessionID: "ses_1",
        goal: { objective: "finish all phases", status: "active" },
      },
    })

    expect(state.session_goal.ses_1).toEqual({ objective: "finish all phases", status: "active" })
  })

  test("recovers visible state after transient reconnect", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    applyHeadlessProjectionEvent(state, { type: "server.connected", properties: {} })
    applyHeadlessProjectionEvent(state, { type: "server.instance.disposed" })
    expect(state.stream_health).toBe("unavailable")

    applyHeadlessProjectionEvent(state, { type: "server.connected", properties: {} })
    applyHeadlessProjectionEvent(state, {
      type: "session.updated",
      properties: { info: { id: "ses_1" } },
    })

    expect(state.stream_health).toBe("connected")
    expect(state.session).toEqual([{ id: "ses_1" }])
  })

  test("keeps cancellation followed by a new prompt visible as the latest session tail", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    applyHeadlessProjectionEvent(state, {
      type: "session.status",
      properties: { sessionID: "ses_1", status: { type: "busy" } },
    })
    applyHeadlessProjectionEvent(state, {
      type: "session.status",
      properties: { sessionID: "ses_1", status: { type: "idle" } },
    })
    applyHeadlessProjectionEvent(state, {
      type: "message.updated",
      properties: { info: { id: "msg_cancelled", sessionID: "ses_1" } },
    })
    applyHeadlessProjectionEvent(state, {
      type: "message.updated",
      properties: { info: { id: "msg_new_prompt", sessionID: "ses_1" } },
    })

    expect(state.session_status.ses_1).toEqual({ type: "idle" })
    expect(state.message.ses_1).toEqual([
      { id: "msg_cancelled", sessionID: "ses_1" },
      { id: "msg_new_prompt", sessionID: "ses_1" },
    ])
  })

  test("replays compacted tail history without retaining trimmed messages", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    for (const id of ["1", "2", "3"]) {
      applyHeadlessProjectionEvent(
        state,
        {
          type: "message.updated",
          properties: { info: { id: `msg_${id}`, sessionID: "ses_1" } },
        },
        { maxSessionMessages: 2 },
      )
    }

    expect(state.message.ses_1).toEqual([
      { id: "msg_2", sessionID: "ses_1" },
      { id: "msg_3", sessionID: "ses_1" },
    ])
  })

  test("review artifact arrival requests workflow projection refresh", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    const result = applyHeadlessProjectionEvent(state, {
      type: "workflow.artifact.written",
      properties: {
        id: "artifact_1",
        runID: "run_1",
        kind: "review",
      },
    })

    expect(result.effects).toEqual([{ type: "runtime.probe", key: "workflow" }])
  })

  test("deduplicates metadata updates and keeps the latest product state", () => {
    const state = createHeadlessProjectionState<
      Session & { metadata?: Record<string, unknown> },
      Todo,
      Diff,
      Status,
      Message,
      Part
    >()

    applyHeadlessProjectionEvent(state, {
      type: "session.updated",
      properties: { info: { id: "ses_1", metadata: { app: { pinned: false } } } },
    })
    applyHeadlessProjectionEvent(state, {
      type: "session.updated",
      properties: { info: { id: "ses_1", metadata: { app: { pinned: true } } } },
    })

    expect(state.session).toEqual([{ id: "ses_1", metadata: { app: { pinned: true } } }])
  })

  test("tracks queue items and clears session-scoped queue state on session delete", () => {
    const state = createHeadlessProjectionState<
      Session,
      Todo,
      Diff,
      Status,
      Message,
      Part,
      unknown,
      unknown,
      TaskQueueItem
    >()

    applyHeadlessProjectionEvent(state, {
      type: "task.queue.created",
      properties: { item: { id: "task_1", sessionID: "ses_1", status: "queued" } },
    })
    applyHeadlessProjectionEvent(state, {
      type: "task.queue.updated",
      properties: { item: { id: "task_1", sessionID: "ses_1", status: "running" } },
    })

    expect(state.task_queue).toEqual([{ id: "task_1", sessionID: "ses_1", status: "running" }])

    applyHeadlessProjectionEvent(state, {
      type: "session.deleted",
      properties: { info: { id: "ses_1" } },
    })

    expect(state.task_queue).toEqual([])
  })

  test("tracks and clears session errors", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()

    applyHeadlessProjectionEvent(state, {
      type: "session.error",
      properties: {
        sessionID: "ses_1",
        error: { message: "Provider failed" },
      },
    })

    expect(state.session_error.ses_1).toEqual({ message: "Provider failed" })

    applyHeadlessProjectionEvent(state, {
      type: "session.deleted",
      properties: {
        info: { id: "ses_1" },
      },
    })

    expect(state.session_error.ses_1).toBeUndefined()
  })
})
