import { describe, expect, test } from "vitest"
import type { SessionStatus } from "@ax-code/sdk/v2/client"
import type { Session } from "@ax-code/sdk/v2"
import { haveEquivalentSyncSnapshots } from "./snapshot-equality"

function createSession(id: string, overrides: Record<string, unknown> = {}): Session {
  return {
    id,
    title: id,
    time: { created: 1, updated: 1 },
    version: "1",
    ...overrides,
  } as Session
}

describe("haveEquivalentSyncSnapshots", () => {
  test("returns true for the same reference", () => {
    const value = { anything: true }
    expect(haveEquivalentSyncSnapshots(value, value)).toBe(true)
  })

  test("returns false for values that are neither status nor session snapshots", () => {
    expect(haveEquivalentSyncSnapshots({ a: 1 }, { a: 1 })).toBe(false)
    expect(haveEquivalentSyncSnapshots(undefined, undefined)).toBe(true)
    expect(haveEquivalentSyncSnapshots(null, { type: "idle" })).toBe(false)
  })

  describe("session status snapshots", () => {
    test("idle statuses are equivalent", () => {
      expect(
        haveEquivalentSyncSnapshots({ type: "idle" } as SessionStatus, { type: "idle" } as SessionStatus),
      ).toBe(true)
    })

    test("different status types are not equivalent", () => {
      expect(
        haveEquivalentSyncSnapshots({ type: "idle" } as SessionStatus, { type: "busy" } as SessionStatus),
      ).toBe(false)
    })

    test("retry statuses compare attempt, message, and next", () => {
      const base = { type: "retry", attempt: 2, message: "boom", next: 1000 } as SessionStatus
      expect(haveEquivalentSyncSnapshots(base, { type: "retry", attempt: 2, message: "boom", next: 1000 })).toBe(true)
      expect(haveEquivalentSyncSnapshots(base, { type: "retry", attempt: 3, message: "boom", next: 1000 })).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, { type: "retry", attempt: 2, message: "other", next: 1000 })).toBe(
        false,
      )
      expect(haveEquivalentSyncSnapshots(base, { type: "retry", attempt: 2, message: "boom", next: 2000 })).toBe(false)
    })

    test("busy statuses compare all progress fields", () => {
      const base = {
        type: "busy",
        step: 1,
        maxSteps: 5,
        startedAt: 10,
        lastActivityAt: 20,
        activeTool: "bash",
        toolCallID: "call-1",
        waitState: undefined,
      } as SessionStatus
      expect(haveEquivalentSyncSnapshots(base, { ...base })).toBe(true)
      expect(haveEquivalentSyncSnapshots(base, { ...base, step: 2 })).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, { ...base, maxSteps: 6 })).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, { ...base, startedAt: 11 })).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, { ...base, lastActivityAt: 21 })).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, { ...base, activeTool: "edit" })).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, { ...base, toolCallID: "call-2" })).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, { ...base, waitState: "permission" })).toBe(false)
    })

    test("an object with an unrecognized type is not a status snapshot", () => {
      expect(haveEquivalentSyncSnapshots({ type: "queued" }, { type: "queued" })).toBe(false)
    })
  })

  describe("session snapshots", () => {
    test("equivalent sessions compare equal", () => {
      expect(haveEquivalentSyncSnapshots(createSession("s"), createSession("s"))).toBe(true)
    })

    test("scalar field differences are detected", () => {
      const base = createSession("s")
      expect(haveEquivalentSyncSnapshots(base, createSession("other"))).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, createSession("s", { title: "renamed" }))).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, createSession("s", { version: "2" }))).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, createSession("s", { parentID: "p" }))).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, createSession("s", { directory: "/repo" }))).toBe(false)
    })

    test("time fields compare created/updated/compacting/archived", () => {
      const base = createSession("s")
      expect(haveEquivalentSyncSnapshots(base, createSession("s", { time: { created: 1, updated: 2 } }))).toBe(false)
      expect(
        haveEquivalentSyncSnapshots(base, createSession("s", { time: { created: 1, updated: 1, archived: 5 } })),
      ).toBe(false)
      expect(
        haveEquivalentSyncSnapshots(base, createSession("s", { time: { created: 1, updated: 1, compacting: 7 } })),
      ).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, createSession("s", { time: undefined }))).toBe(false)
    })

    test("summary and share compare structurally", () => {
      const withSummary = createSession("s", { summary: { additions: 1, deletions: 2, files: 3 } })
      expect(
        haveEquivalentSyncSnapshots(withSummary, createSession("s", { summary: { additions: 1, deletions: 2, files: 3 } })),
      ).toBe(true)
      expect(
        haveEquivalentSyncSnapshots(withSummary, createSession("s", { summary: { additions: 9, deletions: 2, files: 3 } })),
      ).toBe(false)
      expect(haveEquivalentSyncSnapshots(withSummary, createSession("s"))).toBe(false)

      const shared = createSession("s", { share: { url: "https://share" } })
      expect(haveEquivalentSyncSnapshots(shared, createSession("s", { share: { url: "https://share" } }))).toBe(true)
      expect(haveEquivalentSyncSnapshots(shared, createSession("s", { share: { url: "https://other" } }))).toBe(false)
      expect(haveEquivalentSyncSnapshots(shared, createSession("s"))).toBe(false)
    })

    test("revert and metadata compare structurally", () => {
      const reverted = createSession("s", { revert: { messageID: "m-1" } })
      expect(haveEquivalentSyncSnapshots(reverted, createSession("s", { revert: { messageID: "m-1" } }))).toBe(true)
      expect(haveEquivalentSyncSnapshots(reverted, createSession("s", { revert: { messageID: "m-2" } }))).toBe(false)
      expect(haveEquivalentSyncSnapshots(reverted, createSession("s"))).toBe(false)

      const withMeta = createSession("s", { metadata: { origin: "tui" } })
      expect(haveEquivalentSyncSnapshots(withMeta, createSession("s", { metadata: { origin: "tui" } }))).toBe(true)
      expect(haveEquivalentSyncSnapshots(withMeta, createSession("s", { metadata: { origin: "web" } }))).toBe(false)
      expect(
        haveEquivalentSyncSnapshots(withMeta, createSession("s", { metadata: { origin: "tui", extra: 1 } })),
      ).toBe(false)
      expect(haveEquivalentSyncSnapshots(withMeta, createSession("s"))).toBe(false)
    })

    test("unknown keys outside the snapshot key set must match", () => {
      const base = createSession("s", { custom: 1 })
      expect(haveEquivalentSyncSnapshots(base, createSession("s", { custom: 1 }))).toBe(true)
      expect(haveEquivalentSyncSnapshots(base, createSession("s", { custom: 2 }))).toBe(false)
      expect(haveEquivalentSyncSnapshots(base, createSession("s"))).toBe(false)
      expect(haveEquivalentSyncSnapshots(createSession("s"), createSession("s", { custom: 1 }))).toBe(false)
    })

    test("a value without an id/time is not a session snapshot", () => {
      expect(haveEquivalentSyncSnapshots({ id: "s" }, { id: "s" })).toBe(false)
    })
  })
})
