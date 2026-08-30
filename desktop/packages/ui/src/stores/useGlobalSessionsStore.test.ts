import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Session } from "@ax-code/sdk/v2"

import { resolveGlobalSessionDirectory, useGlobalSessionsStore } from "./useGlobalSessionsStore"

type SessionOverrides = Partial<Session> & {
  directory?: string | null
  project?: { worktree?: string | null } | null
}

const buildSession = (shareUrl: string): Session =>
  ({
    id: "ses_1",
    title: "Shared session",
    time: { created: 1, updated: 2 },
    share: { url: shareUrl },
  }) as Session

const makeSession = (id: string, overrides: SessionOverrides = {}): Session =>
  ({
    id,
    title: `Session ${id}`,
    time: { created: 1, updated: 2 },
    ...overrides,
  }) as Session

describe("useGlobalSessionsStore", () => {
  beforeEach(() => {
    useGlobalSessionsStore.setState({
      activeSessions: [],
      archivedSessions: [],
      sessionsByDirectory: new Map(),
      pendingRemoval: new Map(),
      deleteTombstones: new Map(),
      hasLoaded: false,
      status: "idle",
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("updates an existing session when the share URL changes", () => {
    useGlobalSessionsStore.getState().upsertSession(buildSession("https://share.example/a"))
    useGlobalSessionsStore.getState().upsertSession(buildSession("https://share.example/b"))

    expect(useGlobalSessionsStore.getState().activeSessions[0]?.share?.url).toBe("https://share.example/b")
  })

  test("a no-op upsert keeps every list reference stable in both directions", () => {
    const active = makeSession("ses_a", { directory: "/repo" })
    const archived = makeSession("ses_b", { directory: "/repo", time: { created: 1, updated: 2, archived: 3 } })
    useGlobalSessionsStore.getState().upsertSession(active)
    useGlobalSessionsStore.getState().upsertSession(archived)
    const before = useGlobalSessionsStore.getState()

    // Identical active upsert: the archived bucket must not get a new array.
    useGlobalSessionsStore.getState().upsertSession(makeSession("ses_a", { directory: "/repo" }))
    // Identical archived upsert: the active bucket must not get a new array.
    useGlobalSessionsStore
      .getState()
      .upsertSession(makeSession("ses_b", { directory: "/repo", time: { created: 1, updated: 2, archived: 3 } }))

    const after = useGlobalSessionsStore.getState()
    expect(after.activeSessions).toBe(before.activeSessions)
    expect(after.archivedSessions).toBe(before.archivedSessions)
    expect(after.sessionsByDirectory).toBe(before.sessionsByDirectory)
  })

  test("does not let an older active snapshot overwrite a newer live session update", () => {
    const staleSnapshot = makeSession("ses_a", {
      title: "Older title",
      time: { created: 1, updated: 10 },
    })
    const liveUpdate = makeSession("ses_a", {
      title: "Newer title",
      time: { created: 1, updated: 20 },
    })

    useGlobalSessionsStore.getState().upsertSession(liveUpdate)
    useGlobalSessionsStore.getState().applySnapshot([staleSnapshot], [])

    expect(useGlobalSessionsStore.getState().activeSessions[0]).toMatchObject({
      id: "ses_a",
      title: "Newer title",
      time: { updated: 20 },
    })
  })

  describe("resolveGlobalSessionDirectory", () => {
    test("normalizes the session directory before falling back to project worktree", () => {
      expect(
        resolveGlobalSessionDirectory(
          makeSession("ses_a", {
            directory: " c:\\Users\\Alice\\Project\\ ",
            project: { worktree: "/fallback/worktree" },
          }),
        ),
      ).toBe("C:/Users/Alice/Project")
    })

    test("uses the project worktree when the session directory is empty", () => {
      expect(
        resolveGlobalSessionDirectory(
          makeSession("ses_a", {
            directory: " ",
            project: { worktree: "/repo/worktree///" },
          }),
        ),
      ).toBe("/repo/worktree")
    })
  })

  describe("pending removal", () => {
    test("markPendingRemoval hides the session from active and archived lists", () => {
      const active = makeSession("ses_a")
      const archived = makeSession("ses_b", { time: { created: 1, updated: 2, archived: 3 } })
      useGlobalSessionsStore.getState().upsertSession(active)
      useGlobalSessionsStore.getState().upsertSession(archived)

      useGlobalSessionsStore.getState().markPendingRemoval([
        { session: active, kind: "archive" },
        { session: archived, kind: "delete" },
      ])

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions).toHaveLength(0)
      expect(state.archivedSessions).toHaveLength(0)
      expect(state.pendingRemoval.size).toBe(2)
    })

    test("undoPendingRemoval restores sessions to their original lists", () => {
      const active = makeSession("ses_a")
      const archived = makeSession("ses_b", { time: { created: 1, updated: 2, archived: 3 } })
      useGlobalSessionsStore.getState().markPendingRemoval([
        { session: active, kind: "archive" },
        { session: archived, kind: "delete" },
      ])

      useGlobalSessionsStore.getState().undoPendingRemoval(["ses_a", "ses_b"])

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions.map((s) => s.id)).toEqual(["ses_a"])
      expect(state.archivedSessions.map((s) => s.id)).toEqual(["ses_b"])
      expect(state.pendingRemoval.size).toBe(0)
    })

    test("commitPendingRemoval clears the entry without restoring the session", () => {
      const active = makeSession("ses_a")
      useGlobalSessionsStore.getState().upsertSession(active)
      useGlobalSessionsStore.getState().markPendingRemoval([{ session: active, kind: "archive" }])

      useGlobalSessionsStore.getState().commitPendingRemoval(["ses_a"])

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions).toHaveLength(0)
      expect(state.pendingRemoval.size).toBe(0)
    })

    test("upsertSession does not resurrect a session during the undo window", () => {
      const active = makeSession("ses_a")
      useGlobalSessionsStore.getState().markPendingRemoval([{ session: active, kind: "archive" }])

      useGlobalSessionsStore.getState().upsertSession(makeSession("ses_a", { time: { created: 1, updated: 9 } }))

      expect(useGlobalSessionsStore.getState().activeSessions).toHaveLength(0)
    })

    test("applySnapshot filters sessions awaiting removal", () => {
      const active = makeSession("ses_a")
      useGlobalSessionsStore.getState().markPendingRemoval([{ session: active, kind: "delete" }])

      useGlobalSessionsStore.getState().applySnapshot([active, makeSession("ses_c")], [])

      expect(useGlobalSessionsStore.getState().activeSessions.map((s) => s.id)).toEqual(["ses_c"])
    })
  })

  describe("applySessionEvent", () => {
    const sessionEvent = (type: string, session: Session) => ({ type, properties: { info: session } })

    test("session.created adds a session for a known directory", () => {
      const existing = makeSession("ses_a", { directory: "/repo" })
      useGlobalSessionsStore.getState().upsertSession(existing)

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(sessionEvent("session.created", makeSession("ses_b", { directory: "/repo" })))

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions.map((s) => s.id).sort()).toEqual(["ses_a", "ses_b"])
      expect(
        state.sessionsByDirectory
          .get("/repo")
          ?.map((s) => s.id)
          .sort(),
      ).toEqual(["ses_a", "ses_b"])
    })

    test("session.created adds a session for a directory no child store ever opened", () => {
      useGlobalSessionsStore
        .getState()
        .applySessionEvent(sessionEvent("session.created", makeSession("ses_x", { directory: "/unopened" })))

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions.map((s) => s.id)).toEqual(["ses_x"])
      expect(state.sessionsByDirectory.get("/unopened")?.map((s) => s.id)).toEqual(["ses_x"])
    })

    test("session.updated replaces the existing entry", () => {
      useGlobalSessionsStore
        .getState()
        .upsertSession(makeSession("ses_a", { directory: "/repo", time: { created: 1, updated: 2 } }))

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(
          sessionEvent(
            "session.updated",
            makeSession("ses_a", { title: "Renamed", directory: "/repo", time: { created: 1, updated: 3 } }),
          ),
        )

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions).toHaveLength(1)
      expect(state.activeSessions[0]?.title).toBe("Renamed")
    })

    test("session.updated with time.archived moves the session to the archived bucket", () => {
      useGlobalSessionsStore.getState().upsertSession(makeSession("ses_a", { directory: "/repo" }))

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(
          sessionEvent(
            "session.updated",
            makeSession("ses_a", { directory: "/repo", time: { created: 1, updated: 2, archived: 5 } }),
          ),
        )

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions).toHaveLength(0)
      expect(state.archivedSessions.map((s) => s.id)).toEqual(["ses_a"])
      expect(state.sessionsByDirectory.has("/repo")).toBe(false)
    })

    test("session.updated without time.archived un-archives the session", () => {
      useGlobalSessionsStore
        .getState()
        .upsertSession(makeSession("ses_a", { directory: "/repo", time: { created: 1, updated: 2, archived: 5 } }))

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(
          sessionEvent(
            "session.updated",
            makeSession("ses_a", { directory: "/repo", time: { created: 1, updated: 6 } }),
          ),
        )

      const state = useGlobalSessionsStore.getState()
      expect(state.archivedSessions).toHaveLength(0)
      expect(state.activeSessions.map((s) => s.id)).toEqual(["ses_a"])
      expect(state.sessionsByDirectory.get("/repo")?.map((s) => s.id)).toEqual(["ses_a"])
    })

    test("session.deleted removes the session from both lists and the directory map", () => {
      useGlobalSessionsStore.getState().upsertSession(makeSession("ses_a", { directory: "/repo" }))
      useGlobalSessionsStore
        .getState()
        .upsertSession(makeSession("ses_b", { directory: "/repo", time: { created: 1, updated: 2, archived: 3 } }))

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(sessionEvent("session.deleted", makeSession("ses_a", { directory: "/repo" })))
      useGlobalSessionsStore
        .getState()
        .applySessionEvent(sessionEvent("session.deleted", makeSession("ses_b", { directory: "/repo" })))

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions).toHaveLength(0)
      expect(state.archivedSessions).toHaveLength(0)
      expect(state.sessionsByDirectory.has("/repo")).toBe(false)
    })

    test("a repeated identical event keeps every list reference stable", () => {
      const event = sessionEvent("session.created", makeSession("ses_a", { directory: "/repo" }))
      useGlobalSessionsStore.getState().applySessionEvent(event)
      const before = useGlobalSessionsStore.getState()

      useGlobalSessionsStore.getState().applySessionEvent(event)

      const after = useGlobalSessionsStore.getState()
      expect(after.activeSessions).toBe(before.activeSessions)
      expect(after.archivedSessions).toBe(before.archivedSessions)
      expect(after.sessionsByDirectory).toBe(before.sessionsByDirectory)
    })

    test("events do not resurrect a session inside its pendingRemoval window", () => {
      const pending = makeSession("ses_a", { directory: "/repo" })
      useGlobalSessionsStore.getState().markPendingRemoval([{ session: pending, kind: "delete" }])
      const before = useGlobalSessionsStore.getState()

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(
          sessionEvent(
            "session.updated",
            makeSession("ses_a", { directory: "/repo", time: { created: 1, updated: 9 } }),
          ),
        )
      useGlobalSessionsStore
        .getState()
        .applySessionEvent(sessionEvent("session.created", makeSession("ses_a", { directory: "/repo" })))

      const after = useGlobalSessionsStore.getState()
      expect(after.activeSessions).toHaveLength(0)
      expect(after.archivedSessions).toHaveLength(0)
      expect(after.activeSessions).toBe(before.activeSessions)
      expect(after.pendingRemoval.has("ses_a")).toBe(true)
    })

    test("session.deleted during the pendingRemoval window keeps the undo entry", () => {
      const pending = makeSession("ses_a", { directory: "/repo" })
      useGlobalSessionsStore.getState().markPendingRemoval([{ session: pending, kind: "delete" }])

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(sessionEvent("session.deleted", makeSession("ses_a", { directory: "/repo" })))

      const state = useGlobalSessionsStore.getState()
      expect(state.pendingRemoval.has("ses_a")).toBe(true)
      // Undo still restores the session the user chose to keep.
      useGlobalSessionsStore.getState().undoPendingRemoval(["ses_a"])
      expect(useGlobalSessionsStore.getState().activeSessions.map((s) => s.id)).toEqual(["ses_a"])
    })

    test("an out-of-order older event does not overwrite newer local data", () => {
      useGlobalSessionsStore
        .getState()
        .applySessionEvent(
          sessionEvent(
            "session.updated",
            makeSession("ses_a", { title: "Newer", directory: "/repo", time: { created: 1, updated: 20 } }),
          ),
        )

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(
          sessionEvent(
            "session.updated",
            makeSession("ses_a", { title: "Older", directory: "/repo", time: { created: 1, updated: 10 } }),
          ),
        )

      expect(useGlobalSessionsStore.getState().activeSessions[0]?.title).toBe("Newer")
    })

    test("a reconnect snapshot does not overwrite newer event-fed data", () => {
      useGlobalSessionsStore
        .getState()
        .applySessionEvent(
          sessionEvent(
            "session.updated",
            makeSession("ses_a", { title: "Event title", directory: "/repo", time: { created: 1, updated: 20 } }),
          ),
        )

      useGlobalSessionsStore
        .getState()
        .applySnapshot(
          [makeSession("ses_a", { title: "Snapshot title", directory: "/repo", time: { created: 1, updated: 10 } })],
          [],
        )

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions[0]?.title).toBe("Event title")
    })

    test("a stale reconnect snapshot does not resurrect a session deleted by event", () => {
      const deleted = makeSession("ses_a", { directory: "/repo" })
      useGlobalSessionsStore.getState().upsertSession(deleted)

      useGlobalSessionsStore
        .getState()
        .applySessionEvent(sessionEvent("session.deleted", makeSession("ses_a", { directory: "/repo" })))
      expect(useGlobalSessionsStore.getState().activeSessions).toHaveLength(0)

      // A snapshot built before the delete reached the server still contains
      // the session; the delete tombstone must filter it back out.
      useGlobalSessionsStore.getState().applySnapshot([deleted], [deleted])

      const state = useGlobalSessionsStore.getState()
      expect(state.activeSessions).toHaveLength(0)
      expect(state.archivedSessions).toHaveLength(0)
      expect(state.deleteTombstones.has("ses_a")).toBe(true)
    })

    test("an expired delete tombstone allows the session to reappear from a snapshot", () => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000_000)
      useGlobalSessionsStore.getState().upsertSession(makeSession("ses_a", { directory: "/repo" }))
      useGlobalSessionsStore
        .getState()
        .applySessionEvent(sessionEvent("session.deleted", makeSession("ses_a", { directory: "/repo" })))

      // Past the 15-minute tombstone TTL the snapshot is authoritative again:
      // if the server still lists the session, it comes back.
      vi.setSystemTime(1_000_000 + 16 * 60 * 1000)
      useGlobalSessionsStore.getState().applySnapshot([makeSession("ses_a", { directory: "/repo" })], [])

      expect(useGlobalSessionsStore.getState().activeSessions.map((s) => s.id)).toEqual(["ses_a"])
    })

    test("malformed payloads and unrelated event types are a no-op", () => {
      const before = useGlobalSessionsStore.getState()

      expect(() => {
        useGlobalSessionsStore.getState().applySessionEvent(null)
        useGlobalSessionsStore.getState().applySessionEvent({ type: "session.updated" })
        useGlobalSessionsStore.getState().applySessionEvent({ type: "session.updated", properties: { info: {} } })
        useGlobalSessionsStore
          .getState()
          .applySessionEvent({ type: "session.updated", properties: { info: { id: "ses_a" } } })
        useGlobalSessionsStore
          .getState()
          .applySessionEvent({ type: "message.updated", properties: { info: makeSession("ses_a") } })
      }).not.toThrow()

      const after = useGlobalSessionsStore.getState()
      expect(after.activeSessions).toBe(before.activeSessions)
      expect(after.archivedSessions).toBe(before.archivedSessions)
    })
  })
})
