import { describe, expect, test } from "vitest"
import {
  createExternalSessionWatch,
  latestMessageFingerprint,
  type LatestMessageInfo,
  type LatestMessagePart,
} from "../../../src/cli/tui/context/sync-external-session-watch"

type Latest = { info: LatestMessageInfo; parts: LatestMessagePart[] }

function harness(initial: { remote?: Latest; local?: Latest } = {}) {
  const timers: Array<() => void> = []
  const state = {
    remote: initial.remote as Latest | undefined,
    local: initial.local as Latest | undefined,
    covered: false,
    failFetch: false,
    failResync: false,
  }
  const resyncs: string[] = []
  const errors: unknown[] = []
  const watch = createExternalSessionWatch({
    async fetchLatest() {
      if (state.failFetch) throw new Error("backend unreachable")
      return state.remote
    },
    localFingerprint: () => latestMessageFingerprint(state.local?.info, state.local?.parts),
    isLocallyCovered: () => state.covered,
    async resync(sessionID) {
      resyncs.push(sessionID)
      if (state.failResync) throw new Error("resync failed")
      // A resync loads the store's view into the TUI.
      state.local = state.remote
    },
    onError: (_sessionID, error) => errors.push(error),
    setTimer: (run) => {
      timers.push(run)
      return timers.length
    },
    clearTimer: () => {},
  })
  /** Runs the pending poll and waits for it to settle. */
  async function tick() {
    const run = timers.shift()
    if (!run) throw new Error("no poll scheduled")
    run()
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  return { state, watch, resyncs, errors, tick, timers }
}

const user = (id: string): Latest => ({ info: { id }, parts: [{ id: `${id}-text` }] })
const assistant = (id: string, completed?: number, parts: LatestMessagePart[] = []): Latest => ({
  info: { id, time: { completed } },
  parts,
})

describe("latestMessageFingerprint", () => {
  test("changes when a message, part, part status or completion changes", () => {
    const base = latestMessageFingerprint({ id: "m1" }, [{ id: "p1", state: { status: "running" } }])
    expect(latestMessageFingerprint({ id: "m2" }, [{ id: "p1", state: { status: "running" } }])).not.toBe(base)
    expect(latestMessageFingerprint({ id: "m1" }, [{ id: "p1", state: { status: "completed" } }])).not.toBe(base)
    expect(latestMessageFingerprint({ id: "m1" }, [{ id: "p1", state: { status: "running" } }, { id: "p2" }])).not.toBe(
      base,
    )
    expect(
      latestMessageFingerprint({ id: "m1", time: { completed: 5 } }, [{ id: "p1", state: { status: "running" } }]),
    ).not.toBe(base)
    expect(latestMessageFingerprint(undefined, undefined)).toBe("none")
  })
})

describe("external session watch", () => {
  test("a turn another process ran is loaded without reopening the session", async () => {
    const h = harness({ remote: assistant("m1", 1), local: assistant("m1", 1) })
    h.watch.watch("ses_1")

    await h.tick()
    expect(h.resyncs).toEqual([])

    // Desktop sends an instruction: the shared store gains a user message and then its answer.
    h.state.remote = user("m2")
    await h.tick()
    expect(h.resyncs).toEqual(["ses_1"])

    h.state.remote = assistant("m3", 9, [{ id: "p1" }])
    await h.tick()
    expect(h.resyncs).toEqual(["ses_1", "ses_1"])
    expect(h.state.local).toEqual(h.state.remote)
  })

  test("polls without resyncing while nothing changes", async () => {
    const h = harness({ remote: assistant("m1", 1), local: assistant("m1", 1) })
    h.watch.watch("ses_1")
    for (let i = 0; i < 5; i++) await h.tick()
    expect(h.resyncs).toEqual([])
    expect(h.timers).toHaveLength(1)
  })

  test("resyncs once per change, even when the local view can never match", async () => {
    const h = harness({ remote: assistant("m2", 1) })
    // The TUI's resync does not reproduce the store's fingerprint (for example, a part it drops).
    h.watch = createExternalSessionWatch({
      fetchLatest: async () => h.state.remote,
      localFingerprint: () => "never-matches",
      isLocallyCovered: () => false,
      resync: async (sessionID) => {
        h.resyncs.push(sessionID)
      },
      setTimer: (run) => {
        h.timers.push(run)
        return h.timers.length
      },
      clearTimer: () => {},
    })
    h.watch.watch("ses_1")
    for (let i = 0; i < 4; i++) await h.tick()
    expect(h.resyncs).toEqual(["ses_1"])
  })

  test("does not poll while this TUI's own runtime is running the turn", async () => {
    const h = harness({ remote: assistant("m1", 1), local: assistant("m1", 1) })
    h.watch.watch("ses_1")
    h.state.covered = true
    h.state.remote = user("m2")
    await h.tick()
    expect(h.resyncs).toEqual([])

    // The local event stream delivered the turn, so the views agree once the runtime is idle.
    h.state.local = h.state.remote
    h.state.covered = false
    await h.tick()
    expect(h.resyncs).toEqual([])
  })

  test("a failed resync is retried, and repeated failures are reported once", async () => {
    const h = harness({ remote: assistant("m1", 1), local: assistant("m1", 1) })
    h.watch.watch("ses_1")
    h.state.remote = user("m2")
    h.state.failResync = true
    await h.tick()
    await h.tick()
    expect(h.resyncs).toEqual(["ses_1", "ses_1"])
    expect(h.errors).toHaveLength(1)

    h.state.failResync = false
    await h.tick()
    expect(h.resyncs).toHaveLength(3)
    expect(h.state.local).toEqual(h.state.remote)

    h.state.failFetch = true
    await h.tick()
    expect(h.errors).toHaveLength(2)
  })

  test("stopping the watch ends polling for that session", async () => {
    const h = harness({ remote: assistant("m1", 1), local: assistant("m1", 1) })
    const stop = h.watch.watch("ses_1")
    stop()
    h.state.remote = user("m2")
    await h.tick()
    expect(h.resyncs).toEqual([])
    expect(h.timers).toHaveLength(0)
  })
})
