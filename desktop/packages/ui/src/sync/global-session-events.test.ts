/**
 * Tests for the S4.4 global session event fan-out: session lifecycle events
 * from the pipeline land in `useGlobalSessionsStore` for any directory, and
 * the dev-mode dual-source diff logger only reports events that would
 * actually change the store entry.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Event } from "@ax-code/sdk/v2/client"
import type { Session } from "@ax-code/sdk/v2"

import { applySessionLifecycleEventToGlobalStore, describeSessionEventDiff } from "./global-session-events"
import { planSessionLifecycleEvent, useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"

const makeSession = (id: string, overrides: Partial<Session> & { directory?: string | null } = {}): Session =>
  ({
    id,
    title: `Session ${id}`,
    time: { created: 1, updated: 2 },
    ...overrides,
  }) as Session

const sessionEvent = (type: string, session: Session): Event => ({ type, properties: { info: session } }) as Event

const resetStore = () => {
  useGlobalSessionsStore.setState({
    activeSessions: [],
    archivedSessions: [],
    sessionsByDirectory: new Map(),
    pendingRemoval: new Map(),
    hasLoaded: false,
    status: "idle",
  })
}

describe("applySessionLifecycleEventToGlobalStore", () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("ignores non-lifecycle events without touching the store", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined)
    const before = useGlobalSessionsStore.getState()

    applySessionLifecycleEventToGlobalStore({
      type: "message.part.delta",
      properties: { messageID: "msg_1", partID: "prt_1", field: "text", delta: "x" },
    } as Event)

    const after = useGlobalSessionsStore.getState()
    expect(after.activeSessions).toBe(before.activeSessions)
    expect(debug).not.toHaveBeenCalled()
  })

  test("forwards session.created to the store and logs the divergence once", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined)

    applySessionLifecycleEventToGlobalStore(
      sessionEvent("session.created", makeSession("ses_a", { directory: "/repo" })),
    )

    expect(useGlobalSessionsStore.getState().activeSessions.map((s) => s.id)).toEqual(["ses_a"])
    expect(debug).toHaveBeenCalledTimes(1)
    const line = debug.mock.calls[0]?.[0] as string
    expect(line).toContain("session.created")
    expect(line).toContain("ses_a")
    expect(line).toContain("absent -> present")
    expect(line).not.toContain("\n")
  })

  test("a no-op repeat event applies silently (no diff log, stable references)", () => {
    const event = sessionEvent("session.created", makeSession("ses_a", { directory: "/repo" }))
    applySessionLifecycleEventToGlobalStore(event)
    const before = useGlobalSessionsStore.getState()
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined)

    applySessionLifecycleEventToGlobalStore(event)

    const after = useGlobalSessionsStore.getState()
    expect(after.activeSessions).toBe(before.activeSessions)
    expect(after.sessionsByDirectory).toBe(before.sessionsByDirectory)
    expect(debug).not.toHaveBeenCalled()
  })

  test("a stale out-of-order event applies silently and keeps newer data", () => {
    applySessionLifecycleEventToGlobalStore(
      sessionEvent("session.updated", makeSession("ses_a", { title: "Newer", time: { created: 1, updated: 20 } })),
    )
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined)

    applySessionLifecycleEventToGlobalStore(
      sessionEvent("session.updated", makeSession("ses_a", { title: "Older", time: { created: 1, updated: 10 } })),
    )

    expect(useGlobalSessionsStore.getState().activeSessions[0]?.title).toBe("Newer")
    expect(debug).not.toHaveBeenCalled()
  })

  test("session.updated logs the changed fields", () => {
    applySessionLifecycleEventToGlobalStore(sessionEvent("session.created", makeSession("ses_a")))
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined)

    applySessionLifecycleEventToGlobalStore(
      sessionEvent("session.updated", makeSession("ses_a", { title: "Renamed", time: { created: 1, updated: 5 } })),
    )

    expect(debug).toHaveBeenCalledTimes(1)
    const line = debug.mock.calls[0]?.[0] as string
    expect(line).toContain("session.updated")
    expect(line).toContain("title: Session ses_a -> Renamed")
    expect(line).toContain("time.updated: 2 -> 5")
  })

  test("session.deleted removes the entry and logs present -> deleted", () => {
    applySessionLifecycleEventToGlobalStore(sessionEvent("session.created", makeSession("ses_a")))
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined)

    applySessionLifecycleEventToGlobalStore(sessionEvent("session.deleted", makeSession("ses_a")))

    expect(useGlobalSessionsStore.getState().activeSessions).toHaveLength(0)
    expect(debug).toHaveBeenCalledTimes(1)
    expect(debug.mock.calls[0]?.[0]).toContain("present -> deleted")
  })

  test("malformed lifecycle payloads neither throw nor log", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined)

    expect(() => {
      applySessionLifecycleEventToGlobalStore({ type: "session.updated" } as Event)
      applySessionLifecycleEventToGlobalStore({
        type: "session.created",
        properties: { info: { id: 42 } },
      } as unknown as Event)
    }).not.toThrow()

    expect(useGlobalSessionsStore.getState().activeSessions).toHaveLength(0)
    expect(debug).not.toHaveBeenCalled()
  })
})

describe("describeSessionEventDiff", () => {
  beforeEach(() => {
    resetStore()
  })

  test("returns null for plans that do not change the store", () => {
    const state = useGlobalSessionsStore.getState()
    expect(describeSessionEventDiff({ kind: "invalid" })).toBeNull()
    expect(describeSessionEventDiff({ kind: "pending-removal", session: makeSession("ses_a") })).toBeNull()
    const current = makeSession("ses_a", { time: { created: 1, updated: 20 } })
    expect(
      describeSessionEventDiff({
        kind: "stale",
        session: makeSession("ses_a", { time: { created: 1, updated: 10 } }),
        current,
      }),
    ).toBeNull()
    expect(
      describeSessionEventDiff(planSessionLifecycleEvent(state, { type: "session.updated", properties: {} })),
    ).toBeNull()
  })
})
