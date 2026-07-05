import { beforeEach, describe, expect, test } from "vitest"
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
      hasLoaded: false,
      status: "idle",
    })
  })

  test("updates an existing session when the share URL changes", () => {
    useGlobalSessionsStore.getState().upsertSession(buildSession("https://share.example/a"))
    useGlobalSessionsStore.getState().upsertSession(buildSession("https://share.example/b"))

    expect(useGlobalSessionsStore.getState().activeSessions[0]?.share?.url).toBe("https://share.example/b")
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
})
