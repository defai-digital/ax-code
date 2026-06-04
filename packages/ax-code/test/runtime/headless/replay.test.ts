import { describe, expect, test } from "bun:test"
import { replayHeadlessEventLogLines, replayHeadlessEvents } from "../../../src/runtime/headless"

type Session = { id: string; title?: string }
type Todo = { id: string }
type Diff = { path: string }
type Status = { type: "idle" | "busy" }
type Message = { id: string; sessionID: string }
type Part = { id: string; messageID: string; type?: string; text?: string }

describe("headless replay", () => {
  test("clones replayed event objects before applying projection state", async () => {
    const sessionInfo = {
      id: "ses_1",
      title: "Original",
    }
    const event = {
      type: "session.updated",
      properties: {
        info: sessionInfo,
      },
    } as const

    const state = await replayHeadlessEvents<Session, Todo, Diff, Status, Message, Part>({
      events: [event],
    })

    sessionInfo.title = "Mutated after replay"

    expect(state.session).toEqual([{ id: "ses_1", title: "Original" }])
  })

  test("rebuilds projection state from raw event records", async () => {
    const state = await replayHeadlessEvents<Session, Todo, Diff, Status, Message, Part>({
      events: [
        {
          details: {
            type: "session.updated",
            properties: {
              info: {
                id: "ses_1",
                title: "Headless",
              },
            },
          },
        },
        {
          details: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg_1",
                sessionID: "ses_1",
              },
            },
          },
        },
      ],
    })

    expect(state.session).toEqual([{ id: "ses_1", title: "Headless" }])
    expect(state.message).toEqual({
      ses_1: [{ id: "msg_1", sessionID: "ses_1" }],
    })
  })

  test("keeps session-scoped projection data consistent when replay deletes a session", async () => {
    const lines = [
      {
        type: "session.updated",
        properties: {
          info: {
            id: "ses_1",
          },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "ses_1",
          status: {
            type: "idle",
          },
        },
      },
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_1",
            sessionID: "ses_1",
          },
        },
      },
      {
        type: "session.deleted",
        properties: {
          info: {
            id: "ses_1",
          },
        },
      },
    ].map((event) => JSON.stringify({ details: event }))

    const state = await replayHeadlessEventLogLines<Session, Todo, Diff, Status, Message, Part>({ lines })

    expect(state.session).toEqual([])
    expect(state.session_status).toEqual({})
    expect(state.message).toEqual({})
  })
})
