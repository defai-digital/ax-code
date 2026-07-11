import { describe, expect, test } from "vitest"
import {
  createSessionSyncController,
  isMissingSessionSnapshotError,
} from "../../../src/cli/cmd/tui/context/sync-session-coordinator"

describe("tui sync session coordinator", () => {
  test("applies a fetched snapshot once and skips repeated syncs until cleared or forced", async () => {
    const fetches: string[] = []
    const applied: Array<{ sessionID: string; snapshot: { id: string } }> = []
    const controller = createSessionSyncController({
      async fetchSnapshot(sessionID) {
        fetches.push(sessionID)
        return { id: `snapshot:${sessionID}` }
      },
      applySnapshot(sessionID, snapshot) {
        applied.push({ sessionID, snapshot })
      },
    })

    await controller.sync("ses_1")
    await controller.sync("ses_1")
    await controller.sync("ses_1", { force: true })
    controller.clear("ses_1")
    await controller.sync("ses_1")

    expect(fetches).toEqual(["ses_1", "ses_1", "ses_1"])
    expect(applied).toEqual([
      { sessionID: "ses_1", snapshot: { id: "snapshot:ses_1" } },
      { sessionID: "ses_1", snapshot: { id: "snapshot:ses_1" } },
      { sessionID: "ses_1", snapshot: { id: "snapshot:ses_1" } },
    ])
  })

  test("deduplicates concurrent in-flight syncs for the same session", async () => {
    const fetches: string[] = []
    const applied: string[] = []
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const controller = createSessionSyncController({
      async fetchSnapshot(sessionID) {
        fetches.push(sessionID)
        await pending
        return { id: sessionID }
      },
      applySnapshot(sessionID) {
        applied.push(sessionID)
      },
    })

    const first = controller.sync("ses_2")
    const second = controller.sync("ses_2")
    release?.()
    await Promise.all([first, second])

    expect(fetches).toEqual(["ses_2"])
    expect(applied).toEqual(["ses_2"])
  })

  test("warns on missing snapshots and does not mark the session as fully synced", async () => {
    const missing: string[] = []
    const fetches: string[] = []
    const controller = createSessionSyncController({
      async fetchSnapshot(sessionID) {
        fetches.push(sessionID)
        return undefined
      },
      applySnapshot: () => {
        throw new Error("should not apply")
      },
      onMissingSnapshot(sessionID) {
        missing.push(sessionID)
      },
    })

    await controller.sync("ses_3")
    await controller.sync("ses_3")

    expect(fetches).toEqual(["ses_3", "ses_3"])
    expect(missing).toEqual(["ses_3", "ses_3"])
  })

  test("can surface missing snapshots as explicit failures for entry-critical syncs", async () => {
    const controller = createSessionSyncController({
      async fetchSnapshot() {
        return undefined
      },
      applySnapshot: () => undefined,
    })

    const error = await controller.sync("ses_missing", { missing: "throw" }).catch((error) => error)

    expect(isMissingSessionSnapshotError(error)).toBe(true)
    expect((error as Error).message).toBe("Session snapshot unavailable: ses_missing")
  })

  test("clears in-flight state after fetch failures so a retry can run", async () => {
    let attempts = 0
    const applied: string[] = []
    const controller = createSessionSyncController({
      async fetchSnapshot(sessionID) {
        attempts++
        if (attempts === 1) throw new Error("fetch failed")
        return { id: sessionID }
      },
      applySnapshot(sessionID) {
        applied.push(sessionID)
      },
    })

    await expect(controller.sync("ses_4")).rejects.toThrow("fetch failed")
    await controller.sync("ses_4")

    expect(attempts).toBe(2)
    expect(applied).toEqual(["ses_4"])
  })

  test("reset clears fully-synced state for every session", async () => {
    const fetches: string[] = []
    const controller = createSessionSyncController({
      async fetchSnapshot(sessionID) {
        fetches.push(sessionID)
        return { id: sessionID }
      },
      applySnapshot: () => undefined,
    })

    await controller.sync("ses_5")
    await controller.sync("ses_6")
    controller.reset()
    await controller.sync("ses_5")
    await controller.sync("ses_6")

    expect(fetches).toEqual(["ses_5", "ses_6", "ses_5", "ses_6"])
  })

  test("clear during in-flight fetch skips apply and does not mark fullSynced", async () => {
    const applied: string[] = []
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const controller = createSessionSyncController({
      async fetchSnapshot(sessionID) {
        await pending
        return { id: sessionID }
      },
      applySnapshot(sessionID) {
        applied.push(sessionID)
      },
    })

    const flight = controller.sync("ses_leave")
    controller.clear("ses_leave")
    release?.()
    await flight

    expect(applied).toEqual([])
    // Without force, a fresh sync must run again because clear dropped fullSynced.
    await controller.sync("ses_leave")
    expect(applied).toEqual(["ses_leave"])
  })

  test("clear during in-flight allows a concurrent re-enter sync to apply once", async () => {
    const applied: string[] = []
    const fetches: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstFetch = true
    const controller = createSessionSyncController({
      async fetchSnapshot(sessionID) {
        fetches.push(sessionID)
        if (firstFetch) {
          firstFetch = false
          await firstPending
          return { id: "stale" }
        }
        return { id: "fresh" }
      },
      applySnapshot(sessionID, snapshot) {
        applied.push(`${sessionID}:${(snapshot as { id: string }).id}`)
      },
    })

    const staleFlight = controller.sync("ses_reenter")
    controller.clear("ses_reenter")
    const reenter = controller.sync("ses_reenter")
    releaseFirst?.()
    await Promise.all([staleFlight, reenter])

    expect(fetches).toEqual(["ses_reenter", "ses_reenter"])
    expect(applied).toEqual(["ses_reenter:fresh"])
    // Re-enter marked fullSynced; no force should not fetch again.
    await controller.sync("ses_reenter")
    expect(fetches).toEqual(["ses_reenter", "ses_reenter"])
  })
})
