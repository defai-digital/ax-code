import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { createServerRestartPolicy } = require("./server-restart-policy.js")

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
