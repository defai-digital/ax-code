import { describe, expect, test } from "vitest"
import type { Event, Message, Part } from "@ax-code/sdk/v2/client"
import type { Session } from "@ax-code/sdk/v2"
import { ChildStoreManager } from "./child-store"
import { INITIAL_STATE, type State } from "./types"
import {
  createEventRoutingIndex,
  findSessionInChildStores,
  getMessageIdFromPayload,
  getSessionIdFromPayload,
  ingestDirectoryStateIntoRoutingIndex,
  normalizeEventDirectory,
  resolveDirectoryFromRoutingIndex,
  setIndexedSessionDirectory,
  setIndexedSessionMessages,
  updateRoutingIndexFromEvent,
} from "./event-routing"

function createEvent(type: string, properties?: unknown): Event {
  return { type, properties } as unknown as Event
}

function createSession(id: string): Session {
  return { id, title: id, time: { created: 1, updated: 1 }, version: "1" } as Session
}

function createMessage(id: string, sessionID: string): Message {
  return { id, sessionID, role: "user", time: { created: 1 } } as unknown as Message
}

function createState(overrides: Partial<State> = {}): State {
  return { ...INITIAL_STATE, ...overrides }
}

function createManagerWithStore(directory: string, state: Partial<State> = {}): ChildStoreManager {
  const manager = new ChildStoreManager()
  const store = manager.ensureChild(directory, { bootstrap: false })
  store.setState(state)
  return manager
}

describe("normalizeEventDirectory", () => {
  test("passes through empty and global directories", () => {
    expect(normalizeEventDirectory("")).toBe("")
    expect(normalizeEventDirectory("global")).toBe("global")
  })

  test("converts backslashes and uppercases the drive letter", () => {
    expect(normalizeEventDirectory("c:\\repo\\src")).toBe("C:/repo/src")
    expect(normalizeEventDirectory("D:\\Repo")).toBe("D:/Repo")
  })

  test("strips trailing slashes but keeps a lone slash", () => {
    expect(normalizeEventDirectory("/repo/")).toBe("/repo")
    expect(normalizeEventDirectory("/repo//")).toBe("/repo")
    expect(normalizeEventDirectory("/")).toBe("/")
  })

  test("leaves an already normalized directory unchanged", () => {
    expect(normalizeEventDirectory("/repo/src")).toBe("/repo/src")
  })
})

describe("getSessionIdFromPayload", () => {
  test("extracts message.updated session from info.sessionID", () => {
    expect(getSessionIdFromPayload(createEvent("message.updated", { info: { sessionID: "s1" } }))).toBe("s1")
    expect(getSessionIdFromPayload(createEvent("message.updated", {}))).toBeNull()
    expect(getSessionIdFromPayload(createEvent("message.updated", { info: { sessionID: "" } }))).toBeNull()
  })

  test("extracts session-scoped events from properties.sessionID", () => {
    for (const type of [
      "message.removed",
      "session.status",
      "todo.updated",
      "permission.asked",
      "permission.replied",
      "question.asked",
      "question.replied",
      "question.rejected",
      "session.deleted",
    ]) {
      expect(getSessionIdFromPayload(createEvent(type, { sessionID: "s2" }))).toBe("s2")
    }
    expect(getSessionIdFromPayload(createEvent("session.status", { sessionID: 42 }))).toBeNull()
  })

  test("extracts message.part.updated session from part.sessionID", () => {
    expect(getSessionIdFromPayload(createEvent("message.part.updated", { part: { sessionID: "s3" } }))).toBe("s3")
    expect(getSessionIdFromPayload(createEvent("message.part.updated", { part: null }))).toBeNull()
  })

  test("extracts session.created/updated session from info.id", () => {
    expect(getSessionIdFromPayload(createEvent("session.created", { info: { id: "s4" } }))).toBe("s4")
    expect(getSessionIdFromPayload(createEvent("session.updated", { info: { id: "s5" } }))).toBe("s5")
    expect(getSessionIdFromPayload(createEvent("session.created", { info: {} }))).toBeNull()
  })

  test("returns null for unrouted event types and missing properties", () => {
    expect(getSessionIdFromPayload(createEvent("server.connected", { sessionID: "s6" }))).toBeNull()
    expect(getSessionIdFromPayload(createEvent("session.status"))).toBeNull()
  })
})

describe("getMessageIdFromPayload", () => {
  test("extracts message.updated message from info.id", () => {
    expect(getMessageIdFromPayload(createEvent("message.updated", { info: { id: "m1" } }))).toBe("m1")
    expect(getMessageIdFromPayload(createEvent("message.updated", { info: {} }))).toBeNull()
  })

  test("extracts message-scoped events from properties.messageID", () => {
    for (const type of ["message.removed", "message.part.delta", "message.part.removed"]) {
      expect(getMessageIdFromPayload(createEvent(type, { messageID: "m2" }))).toBe("m2")
    }
    expect(getMessageIdFromPayload(createEvent("message.removed", { messageID: "" }))).toBeNull()
  })

  test("extracts message.part.updated message from part.messageID", () => {
    expect(getMessageIdFromPayload(createEvent("message.part.updated", { part: { messageID: "m3" } }))).toBe("m3")
  })

  test("returns null for session-only events and missing properties", () => {
    expect(getMessageIdFromPayload(createEvent("session.status", { sessionID: "s1" }))).toBeNull()
    expect(getMessageIdFromPayload(createEvent("message.removed"))).toBeNull()
  })
})

describe("routing index maintenance", () => {
  test("setIndexedSessionDirectory skips empty and global directories", () => {
    const index = createEventRoutingIndex()
    setIndexedSessionDirectory(index, "s1", "")
    setIndexedSessionDirectory(index, "s1", "global")
    setIndexedSessionDirectory(index, "", "/repo")
    expect(index.sessionDirectoryById.size).toBe(0)

    setIndexedSessionDirectory(index, "s1", "/repo")
    expect(index.sessionDirectoryById.get("s1")).toBe("/repo")
  })

  test("setIndexedSessionMessages indexes messages and prunes stale ones", () => {
    const index = createEventRoutingIndex()
    setIndexedSessionMessages(index, "s1", "/repo", [createMessage("m1", "s1"), createMessage("m2", "s1")])
    expect(index.messageSessionById.get("m1")).toBe("s1")
    expect(index.messageSessionById.get("m2")).toBe("s1")

    setIndexedSessionMessages(index, "s1", "/repo", [createMessage("m2", "s1")])
    expect(index.messageSessionById.get("m1")).toBeUndefined()
    expect(index.messageSessionById.get("m2")).toBe("s1")
    expect(index.sessionMessageIdsById.get("s1")).toEqual(new Set(["m2"]))
  })

  test("ingestDirectoryStateIntoRoutingIndex indexes state and evicts stale sessions for that directory only", () => {
    const index = createEventRoutingIndex()
    setIndexedSessionDirectory(index, "stale", "/repo")
    setIndexedSessionDirectory(index, "other", "/other")

    ingestDirectoryStateIntoRoutingIndex(
      index,
      "/repo",
      createState({
        session: [createSession("s1")],
        message: { s2: [createMessage("m1", "s2")] },
      }),
    )

    expect(index.sessionDirectoryById.get("s1")).toBe("/repo")
    expect(index.sessionDirectoryById.get("s2")).toBe("/repo")
    expect(index.messageSessionById.get("m1")).toBe("s2")
    expect(index.sessionDirectoryById.has("stale")).toBe(false)
    expect(index.sessionDirectoryById.get("other")).toBe("/other")
  })
})

describe("findSessionInChildStores", () => {
  test("finds a session via session list, messages, or status and self-heals the index", () => {
    const manager = createManagerWithStore("/repo", {
      session: [createSession("s1")],
      message: { s2: [] },
      session_status: { s3: { type: "busy" } },
    })
    const index = createEventRoutingIndex()

    expect(findSessionInChildStores("s1", manager, index)).toBe("/repo")
    expect(findSessionInChildStores("s2", manager, index)).toBe("/repo")
    expect(findSessionInChildStores("s3", manager, index)).toBe("/repo")
    expect(index.sessionDirectoryById.get("s3")).toBe("/repo")
    expect(findSessionInChildStores("missing", manager, index)).toBeNull()
  })
})

describe("resolveDirectoryFromRoutingIndex", () => {
  test("prefers the normalized directory when the child store already has the session", () => {
    const manager = createManagerWithStore("/repo", { session: [createSession("s1")] })
    const index = createEventRoutingIndex()

    const resolved = resolveDirectoryFromRoutingIndex(
      index,
      "/repo/",
      createEvent("session.status", { sessionID: "s1" }),
      manager,
    )
    expect(resolved).toBe("/repo")
    expect(index.sessionDirectoryById.get("s1")).toBe("/repo")
  })

  test("falls back to the routing index when the event directory is empty", () => {
    const manager = createManagerWithStore("/repo", { session: [createSession("s1")] })
    const index = createEventRoutingIndex()
    setIndexedSessionDirectory(index, "s1", "/repo")

    expect(
      resolveDirectoryFromRoutingIndex(index, "", createEvent("session.status", { sessionID: "s1" }), manager),
    ).toBe("/repo")
  })

  test("scans child stores on an index miss", () => {
    const manager = createManagerWithStore("/repo", { message: { s2: [] } })
    const index = createEventRoutingIndex()

    expect(
      resolveDirectoryFromRoutingIndex(index, "", createEvent("session.status", { sessionID: "s2" }), manager),
    ).toBe("/repo")
  })

  test("routes message events through the message → session → directory chain", () => {
    const manager = createManagerWithStore("/repo", { session: [createSession("s1")] })
    const index = createEventRoutingIndex()
    setIndexedSessionMessages(index, "s1", "/repo", [createMessage("m1", "s1")])

    expect(
      resolveDirectoryFromRoutingIndex(index, "", createEvent("message.removed", { messageID: "m1" }), manager),
    ).toBe("/repo")
  })

  test("routes message events to the store that has parts for the message", () => {
    const manager = createManagerWithStore("/repo", {
      part: { m1: [{ id: "p1", messageID: "m1" } as Part] },
    })
    const index = createEventRoutingIndex()

    expect(
      resolveDirectoryFromRoutingIndex(index, "", createEvent("message.part.delta", { messageID: "m1" }), manager),
    ).toBe("/repo")
  })

  test("uses the single-store fallback for directory-less events", () => {
    const manager = createManagerWithStore("/only")
    const index = createEventRoutingIndex()

    expect(
      resolveDirectoryFromRoutingIndex(index, "global", createEvent("session.status", { sessionID: "sx" }), manager),
    ).toBe("/only")
  })

  test("returns the normalized directory when nothing matches", () => {
    const manager = createManagerWithStore("/repo")
    const index = createEventRoutingIndex()

    expect(
      resolveDirectoryFromRoutingIndex(index, "/nowhere/", createEvent("session.status", { sessionID: "sx" }), manager),
    ).toBe("/nowhere")
  })
})

describe("updateRoutingIndexFromEvent", () => {
  test("ignores empty and global directories", () => {
    const index = createEventRoutingIndex()
    updateRoutingIndexFromEvent(index, "global", createEvent("session.updated", { info: { id: "s1" } }))
    updateRoutingIndexFromEvent(index, "", createEvent("session.updated", { info: { id: "s1" } }))
    expect(index.sessionDirectoryById.size).toBe(0)
  })

  test("indexes sessions and messages from their events", () => {
    const index = createEventRoutingIndex()
    updateRoutingIndexFromEvent(index, "/repo", createEvent("session.updated", { info: { id: "s1" } }))
    updateRoutingIndexFromEvent(index, "/repo", createEvent("message.updated", { info: { id: "m1", sessionID: "s1" } }))
    updateRoutingIndexFromEvent(
      index,
      "/repo",
      createEvent("message.part.updated", { part: { messageID: "m2", sessionID: "s1" } }),
    )

    expect(index.sessionDirectoryById.get("s1")).toBe("/repo")
    expect(index.messageSessionById.get("m1")).toBe("s1")
    expect(index.messageSessionById.get("m2")).toBe("s1")
  })

  test("session.deleted removes the session and its messages from the index", () => {
    const index = createEventRoutingIndex()
    updateRoutingIndexFromEvent(index, "/repo", createEvent("session.updated", { info: { id: "s1" } }))
    updateRoutingIndexFromEvent(index, "/repo", createEvent("message.updated", { info: { id: "m1", sessionID: "s1" } }))
    updateRoutingIndexFromEvent(index, "/repo", createEvent("session.deleted", { sessionID: "s1" }))

    expect(index.sessionDirectoryById.has("s1")).toBe(false)
    expect(index.messageSessionById.has("m1")).toBe(false)
    expect(index.sessionMessageIdsById.has("s1")).toBe(false)
  })

  test("message.removed removes the message using the session hint", () => {
    const index = createEventRoutingIndex()
    updateRoutingIndexFromEvent(index, "/repo", createEvent("message.updated", { info: { id: "m1", sessionID: "s1" } }))
    updateRoutingIndexFromEvent(index, "/repo", createEvent("message.removed", { sessionID: "s1", messageID: "m1" }))

    expect(index.messageSessionById.has("m1")).toBe(false)
    expect(index.sessionMessageIdsById.has("s1")).toBe(false)
  })
})
