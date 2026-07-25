import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { createServerRestartPolicy, shouldRecoverAfterServerExit } = require("./server-restart-policy.js")

describe("createServerRestartPolicy", () => {
  test("allows restarts up to the configured crash limit", () => {
    const policy = createServerRestartPolicy({ maxRestarts: 2 })

    expect(policy.shouldRestart()).toBe(true)
    expect(policy.beginRestart()).toBe(true)
    expect(policy.crashRestarts).toBe(1)
    policy.completeRestart()

    expect(policy.beginRestart()).toBe(true)
    expect(policy.crashRestarts).toBe(2)
    policy.completeRestart()

    expect(policy.shouldRestart()).toBe(false)
    expect(policy.beginRestart()).toBe(false)
    expect(policy.crashRestarts).toBe(3)
  })

  test("resets the crash counter only after a stability window", () => {
    const policy = createServerRestartPolicy({ maxRestarts: 1 })

    expect(policy.beginRestart()).toBe(true)
    policy.completeRestart()

    expect(policy.crashRestarts).toBe(1)
    expect(policy.shouldRestart()).toBe(false)
    policy.markStable()
    expect(policy.crashRestarts).toBe(0)
    expect(policy.shouldRestart()).toBe(true)
  })

  test("does not restart while quitting or already relaunching", () => {
    const policy = createServerRestartPolicy({ maxRestarts: 2 })

    expect(policy.shouldRestart({ quitting: true })).toBe(false)
    expect(policy.beginRestart()).toBe(true)
    expect(policy.relaunching).toBe(true)
    expect(policy.shouldRestart()).toBe(false)
    expect(policy.beginRestart()).toBe(false)
  })
})

describe("shouldRecoverAfterServerExit", () => {
  test("recovers only for the current, previously-ready server", () => {
    expect(shouldRecoverAfterServerExit({ becameReady: true, wasCurrent: true, quitting: false })).toBe(true)
  })

  test("a failed start attempt's exit belongs to its caller, not crash recovery", () => {
    // Launch timed out or reported an error before ready: the launch promise
    // already rejected and the recovery loop (or boot) owns the retry. The
    // exit event for that killed child must not re-enter crash recovery —
    // that path queued a pending recovery pass that forked a duplicate
    // server after a later attempt had already succeeded.
    expect(shouldRecoverAfterServerExit({ becameReady: false, wasCurrent: true, quitting: false })).toBe(false)
  })

  test("stale exits from replaced processes never trigger recovery", () => {
    expect(shouldRecoverAfterServerExit({ becameReady: true, wasCurrent: false, quitting: false })).toBe(false)
  })

  test("no recovery while the app is quitting", () => {
    expect(shouldRecoverAfterServerExit({ becameReady: true, wasCurrent: true, quitting: true })).toBe(false)
  })

  test("defaults are safe: no inputs means no recovery", () => {
    expect(shouldRecoverAfterServerExit()).toBe(false)
    expect(shouldRecoverAfterServerExit({})).toBe(false)
  })
})
