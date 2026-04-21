import { describe, expect, test } from "bun:test"
import {
  applyAskedRequest,
  applyMessageDeleteCleanup,
  applyMessageUpdateCleanup,
  applyMessageRemove,
  applyMessageUpdate,
  applyPartDelta,
  applyPartRemove,
  applyPartUpdate,
  applyResolvedRequest,
} from "../../../src/cli/cmd/tui/context/sync-event-store"

describe("tui sync event store", () => {
  test("upserts session-scoped requests into the correct bucket", () => {
    const store: Record<string, Array<{ id: string; sessionID: string; label?: string }>> = {}

    applyAskedRequest(store, { id: "req_2", sessionID: "ses_1", label: "second" })
    applyAskedRequest(store, { id: "req_1", sessionID: "ses_1", label: "first" })
    applyAskedRequest(store, { id: "req_1", sessionID: "ses_1", label: "updated" })

    expect(store).toEqual({
      ses_1: [
        { id: "req_1", sessionID: "ses_1", label: "updated" },
        { id: "req_2", sessionID: "ses_1", label: "second" },
      ],
    })
  })

  test("removes resolved requests without touching other sessions", () => {
    const store = {
      ses_1: [
        { id: "req_1", sessionID: "ses_1" },
        { id: "req_2", sessionID: "ses_1" },
      ],
      ses_2: [{ id: "req_3", sessionID: "ses_2" }],
    }

    expect(applyResolvedRequest(store, "ses_1", "req_2")).toEqual({ id: "req_2", sessionID: "ses_1" })
    expect(store).toEqual({
      ses_1: [{ id: "req_1", sessionID: "ses_1" }],
      ses_2: [{ id: "req_3", sessionID: "ses_2" }],
    })
  })

  test("ignores resolved requests when the session bucket is missing", () => {
    const store: Record<string, Array<{ id: string; sessionID: string }>> = {}

    expect(applyResolvedRequest(store, "ses_1", "req_1")).toBeUndefined()
    expect(store).toEqual({})
  })

  test("upserts bounded message lists and returns the trimmed oldest message", () => {
    const store = {
      ses_1: [{ id: "msg_1" }, { id: "msg_2" }],
    }

    expect(applyMessageUpdate(store, "ses_1", { id: "msg_3" }, 2)).toEqual({ id: "msg_1" })
    expect(store).toEqual({
      ses_1: [{ id: "msg_2" }, { id: "msg_3" }],
    })
  })

  test("creates a message bucket when an update arrives before session hydration", () => {
    const store = {
      message: {},
      part: {},
    }

    expect(applyMessageUpdateCleanup(store, "ses_1", { id: "msg_1" }, 2)).toBeUndefined()
    expect(store).toEqual({
      message: {
        ses_1: [{ id: "msg_1" }],
      },
      part: {},
    })
  })

  test("removes messages by session", () => {
    const store = {
      ses_1: [{ id: "msg_1" }, { id: "msg_2" }],
    }

    expect(applyMessageRemove(store, "ses_1", "msg_1")).toEqual({ id: "msg_1" })
    expect(store).toEqual({
      ses_1: [{ id: "msg_2" }],
    })
  })

  test("removes message part buckets when a message is deleted", () => {
    const store: {
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string }>>
    } = {
      message: {
        ses_1: [{ id: "msg_1" }, { id: "msg_2" }],
      },
      part: {
        msg_1: [{ id: "part_1" }],
        msg_2: [{ id: "part_2" }],
      },
    }

    expect(applyMessageDeleteCleanup(store, "ses_1", "msg_1")).toEqual({ id: "msg_1" })
    expect(store).toEqual({
      message: {
        ses_1: [{ id: "msg_2" }],
      },
      part: {
        msg_2: [{ id: "part_2" }],
      },
    })
  })

  test("removes message part buckets even when the message list is already missing", () => {
    const store: {
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string }>>
    } = {
      message: {},
      part: {
        msg_1: [{ id: "part_1" }],
      },
    }

    expect(applyMessageDeleteCleanup(store, "ses_1", "msg_1")).toBeUndefined()
    expect(store).toEqual({
      message: {},
      part: {},
    })
  })

  test("removes trimmed message part buckets when a bounded update overflows", () => {
    const store: {
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string }>>
    } = {
      message: {
        ses_1: [{ id: "msg_1" }, { id: "msg_2" }],
      },
      part: {
        msg_1: [{ id: "part_1" }],
        msg_2: [{ id: "part_2" }],
        msg_3: [{ id: "part_3" }],
      },
    }

    expect(applyMessageUpdateCleanup(store, "ses_1", { id: "msg_3" }, 2)).toEqual({ id: "msg_1" })
    expect(store).toEqual({
      message: {
        ses_1: [{ id: "msg_2" }, { id: "msg_3" }],
      },
      part: {
        msg_2: [{ id: "part_2" }],
        msg_3: [{ id: "part_3" }],
      },
    })
  })

  test("upserts parts, applies text deltas, and removes parts by message", () => {
    const store: Record<string, Array<{ id: string; type?: string; text?: string }>> = {}

    applyPartUpdate(store, "msg_1", { id: "part_2", type: "text", text: "world" })
    applyPartUpdate(store, "msg_1", { id: "part_1", type: "text", text: "hello" })
    applyPartUpdate(store, "msg_1", { id: "part_1", type: "text", text: "hello again" })

    expect(applyPartDelta(store, "msg_1", "part_1", "!")).toBe(true)
    expect(applyPartDelta(store, "msg_1", "part_9", "!")).toBe(false)
    expect(applyPartRemove(store, "msg_1", "part_2")).toEqual({ id: "part_2", type: "text", text: "world" })
    expect(store).toEqual({
      msg_1: [{ id: "part_1", type: "text", text: "hello again!" }],
    })
  })

  test("tolerates part delta and remove events when the part bucket is missing", () => {
    const store: Record<string, Array<{ id: string; type?: string; text?: string }>> = {}

    expect(applyPartDelta(store, "msg_1", "part_1", "!")).toBe(false)
    expect(applyPartRemove(store, "msg_1", "part_1")).toBeUndefined()
    expect(store).toEqual({})
  })
})
