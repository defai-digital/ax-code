import { describe, expect, test } from "bun:test"
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

describe("headless projection", () => {
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

  test("maps runtime events to runtime probe keys without TUI-specific handlers", () => {
    expect(runtimeProbeKeysForEvent({ type: "mcp.tools.changed" })).toEqual(["mcp"])
    expect(runtimeProbeKeysForEvent({ type: "lsp.updated" })).toEqual(["lsp", "debug-engine"])
    expect(runtimeProbeKeysForEvent({ type: "vcs.branch.updated", properties: { branch: "main" } })).toEqual([])
  })
})
