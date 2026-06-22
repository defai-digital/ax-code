import { describe, expect, test } from "vitest"
import type {
  Event,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "@ax-code/sdk/v2/client"
import { applyDirectoryEvent } from "../event-reducer"
import { INITIAL_STATE, type State } from "../types"

function state(overrides: Partial<State> = {}): State {
  return {
    ...INITIAL_STATE,
    message: {},
    part: {},
    session_status: {},
    ...overrides,
  }
}

function deltaEvent(): Event {
  return {
    type: "message.part.delta",
    properties: {
      messageID: "msg_1",
      partID: "prt_1",
      field: "text",
      delta: "hello",
    },
  } as Event
}

function partUpdatedEvent(): Event {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: "prt_1",
        messageID: "msg_1",
        sessionID: "ses_1",
        type: "text",
        text: "hello",
      },
    },
  } as Event
}

function session(id: string, title: string): Session {
  return {
    id,
    title,
    time: { created: 1, updated: 1 },
    version: "1",
  } as Session
}

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    sessionID: "ses_1",
    role: "assistant",
    parentID: "msg_user_1",
    providerID: "anthropic",
    modelID: "claude",
    mode: "build",
    agent: "coder",
    path: { cwd: "/repo", root: "/repo" },
    time: { created: 1, completed: 2 },
    tokens: {
      input: 1,
      output: 2,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...overrides,
  } as Message
}

describe("applyDirectoryEvent", () => {
  test("returns typed materialization when delta arrives before parts", () => {
    const result = applyDirectoryEvent(state(), deltaEvent())

    expect(result).toEqual({
      changed: false,
      materialization: { type: "incomplete-session-snapshot", messageID: "msg_1", partID: "prt_1" },
    })
  })

  test("returns typed materialization when delta part is missing", () => {
    const result = applyDirectoryEvent(
      state({ part: { msg_1: [{ id: "prt_2", messageID: "msg_1", type: "text", text: "" } as Part] } }),
      deltaEvent(),
    )

    expect(result).toEqual({
      changed: false,
      materialization: { type: "incomplete-session-snapshot", messageID: "msg_1", partID: "prt_1" },
    })
  })

  test("applies part update and requests materialization when owning message is absent", () => {
    const draft = state()
    const result = applyDirectoryEvent(draft, partUpdatedEvent())

    expect(draft.part.msg_1.map((item) => item.id)).toEqual(["prt_1"])
    expect(result).toEqual({
      changed: true,
      materialization: {
        type: "incomplete-session-snapshot",
        sessionID: "ses_1",
        messageID: "msg_1",
        partID: "prt_1",
      },
    })
  })

  test("applies part update without materialization when owning message exists", () => {
    const draft = state({
      message: { ses_1: [{ id: "msg_1", sessionID: "ses_1", role: "assistant", time: { created: 1 } } as never] },
    })
    const result = applyDirectoryEvent(draft, partUpdatedEvent())

    expect(draft.part.msg_1.map((item) => item.id)).toEqual(["prt_1"])
    expect(result).toBe(true)
  })

  test("updates existing session metadata such as generated title", () => {
    const draft = state({
      session: [session("ses_1", "New session")],
      sessionTotal: 1,
    })

    const result = applyDirectoryEvent(draft, {
      type: "session.updated",
      properties: { info: session("ses_1", "Generated title") },
    } as Event)

    expect(result).toBe(true)
    expect(draft.session).toHaveLength(1)
    expect(draft.session[0].title).toBe("Generated title")
    expect(draft.sessionTotal).toBe(1)
  })

  test("merges late assistant message metadata", () => {
    const initial = assistantMessage()
    const draft = state({
      message: { ses_1: [initial] },
    })
    const next = assistantMessage({
      tokens: {
        total: 10,
        input: 3,
        output: 7,
        reasoning: 1,
        cache: { read: 2, write: 0 },
      },
      variant: "thinking",
    })

    const result = applyDirectoryEvent(draft, {
      type: "message.updated",
      properties: { info: next },
    } as Event)

    expect(result).toBe(true)
    expect(draft.message.ses_1[0]).not.toBe(initial)
    expect((draft.message.ses_1[0] as Extract<Message, { role: "assistant" }>).tokens.total).toBe(10)
    expect((draft.message.ses_1[0] as Extract<Message, { role: "assistant" }>).variant).toBe("thinking")
  })

  test("preserves message reference for duplicate message updates", () => {
    const initial = assistantMessage()
    const draft = state({
      message: { ses_1: [initial] },
    })

    const result = applyDirectoryEvent(draft, {
      type: "message.updated",
      properties: { info: assistantMessage() },
    } as Event)

    expect(result).toBe(false)
    expect(draft.message.ses_1[0]).toBe(initial)
  })

  test("detects assistant message finish changes without deep serialization", () => {
    const initial = assistantMessage()
    const draft = state({
      message: { ses_1: [initial] },
    })

    const result = applyDirectoryEvent(draft, {
      type: "message.updated",
      properties: { info: assistantMessage({ finish: "stop" }) },
    } as Event)

    expect(result).toBe(true)
    expect(draft.message.ses_1[0]).not.toBe(initial)
    expect((draft.message.ses_1[0] as Extract<Message, { role: "assistant" }>).finish).toBe("stop")
  })

  test("dedupes long delta overlaps after long accumulated text", () => {
    const draft = state()
    const longPrefix = "x".repeat(50_000)
    const longOverlap = "abcdef".repeat(300)

    applyDirectoryEvent(draft, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_long",
          messageID: "msg_long",
          sessionID: "ses_1",
          type: "text",
          text: longPrefix,
        },
      },
    } as Event)

    applyDirectoryEvent(draft, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_long",
          messageID: "msg_long",
          sessionID: "ses_1",
          type: "text",
          text: `${longPrefix}${longOverlap}`,
        },
      },
    } as Event)

    applyDirectoryEvent(draft, {
      type: "message.part.delta",
      properties: {
        messageID: "msg_long",
        partID: "prt_long",
        field: "text",
        delta: `${longOverlap}ghi`,
      },
    } as Event)

    expect((draft.part.msg_long?.[0] as Extract<Part, { type: "text" }> | undefined)?.text).toBe(
      `${longPrefix}${longOverlap}ghi`,
    )
  })

  test("skips duplicate session status events", () => {
    const draft = state()
    const busyStatus = { type: "busy" } as SessionStatus
    const event = {
      type: "session.status",
      properties: { sessionID: "ses_1", status: busyStatus },
    } as Event

    expect(applyDirectoryEvent(draft, event)).toBe(true)
    const statusRef = draft.session_status.ses_1

    expect(applyDirectoryEvent(draft, event)).toBe(false)
    expect(draft.session_status.ses_1).toBe(statusRef)
  })

  test("skips duplicate session idle events", () => {
    const draft = state()
    const event = {
      type: "session.idle",
      properties: { sessionID: "ses_1" },
    } as Event

    expect(applyDirectoryEvent(draft, event)).toBe(true)
    const statusRef = draft.session_status.ses_1

    expect(applyDirectoryEvent(draft, event)).toBe(false)
    expect(draft.session_status.ses_1).toBe(statusRef)
  })

  test("skips duplicate session error idle-state events", () => {
    const draft = state()
    const event = {
      type: "session.error",
      properties: { sessionID: "ses_1" },
    } as Event

    expect(applyDirectoryEvent(draft, event)).toBe(true)
    const statusRef = draft.session_status.ses_1

    expect(applyDirectoryEvent(draft, event)).toBe(false)
    expect(draft.session_status.ses_1).toBe(statusRef)
  })

  test("detects retry status metadata changes", () => {
    const draft = state({
      session_status: {
        ses_1: { type: "retry", attempt: 1, message: "rate limited", next: 10 } as SessionStatus,
      },
    })

    const event = {
      type: "session.status",
      properties: {
        sessionID: "ses_1",
        status: { type: "retry", attempt: 2, message: "rate limited", next: 20 } as SessionStatus,
      },
    } as Event

    expect(applyDirectoryEvent(draft, event)).toBe(true)
    expect((draft.session_status.ses_1 as Extract<SessionStatus, { type: "retry" }>).attempt).toBe(2)
  })

  test("updates permission request arrays immutably", () => {
    const initialPermissions = [{ id: "perm_1", sessionID: "ses_1" } as PermissionRequest]
    const draft = state({ permission: { ses_1: initialPermissions } })

    applyDirectoryEvent(draft, {
      type: "permission.asked",
      properties: { id: "perm_2", sessionID: "ses_1" } as PermissionRequest,
    } as Event)

    expect(draft.permission.ses_1).not.toBe(initialPermissions)
    expect(draft.permission.ses_1.map((item) => item.id)).toEqual(["perm_1", "perm_2"])

    const afterAsk = draft.permission.ses_1
    applyDirectoryEvent(draft, {
      type: "permission.replied",
      properties: { sessionID: "ses_1", requestID: "perm_1" },
    } as Event)

    expect(draft.permission.ses_1).not.toBe(afterAsk)
    expect(draft.permission.ses_1.map((item) => item.id)).toEqual(["perm_2"])
  })

  test("updates question request arrays immutably", () => {
    const initialQuestions = [{ id: "ques_1", sessionID: "ses_1" } as QuestionRequest]
    const draft = state({ question: { ses_1: initialQuestions } })

    applyDirectoryEvent(draft, {
      type: "question.asked",
      properties: { id: "ques_2", sessionID: "ses_1" } as QuestionRequest,
    } as Event)

    expect(draft.question.ses_1).not.toBe(initialQuestions)
    expect(draft.question.ses_1.map((item) => item.id)).toEqual(["ques_1", "ques_2"])

    const afterAsk = draft.question.ses_1
    applyDirectoryEvent(draft, {
      type: "question.replied",
      properties: { sessionID: "ses_1", requestID: "ques_1" },
    } as Event)

    expect(draft.question.ses_1).not.toBe(afterAsk)
    expect(draft.question.ses_1.map((item) => item.id)).toEqual(["ques_2"])

    const afterReply = draft.question.ses_1
    applyDirectoryEvent(draft, {
      type: "question.rejected",
      properties: { sessionID: "ses_1", requestID: "ques_2" },
    } as Event)

    expect(draft.question.ses_1).not.toBe(afterReply)
    expect(draft.question.ses_1).toEqual([])
  })

  test("does not evict a session with a pending question when trimming", () => {
    const draft = state({
      limit: 2,
      session: [session("ses_1", "first"), session("ses_2", "second")],
      question: { ses_1: [{ id: "ques_1", sessionID: "ses_1" } as QuestionRequest] },
    })

    applyDirectoryEvent(draft, {
      type: "session.created",
      properties: { info: session("ses_3", "third") },
    } as Event)

    // ses_1 is the oldest (would be evicted first) but has a pending question,
    // so trimming must stop and keep it visible.
    const ids = draft.session.map((s) => s.id)
    expect(ids).toContain("ses_1")
    expect(ids).toContain("ses_3")
  })

  test("evicts the oldest session when trimming and none are protected", () => {
    const draft = state({
      limit: 2,
      session: [session("ses_1", "first"), session("ses_2", "second")],
    })

    applyDirectoryEvent(draft, {
      type: "session.created",
      properties: { info: session("ses_3", "third") },
    } as Event)

    expect(draft.session.map((s) => s.id)).toEqual(["ses_2", "ses_3"])
  })
})
