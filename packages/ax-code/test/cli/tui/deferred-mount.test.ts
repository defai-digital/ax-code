import { describe, expect, test } from "bun:test"
import { deferSessionMount } from "../../../src/cli/cmd/tui/routes/session/deferred-mount"

describe("session deferred mount", () => {
  test("schedules readiness on the next task instead of running synchronously", () => {
    const calls: string[] = []
    const timers: Array<{ handler: () => void; delay: number }> = []

    deferSessionMount({
      onReady: () => calls.push("ready"),
      schedule: (handler, delay) => {
        timers.push({ handler, delay })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      },
      clear: () => {},
    })

    expect(calls).toEqual([])
    expect(timers).toHaveLength(1)
    expect(timers[0]?.delay).toBe(0)

    timers[0]?.handler()

    expect(calls).toEqual(["ready"])
  })

  test("cancels the scheduled readiness callback on cleanup", () => {
    const timer = 7 as unknown as ReturnType<typeof setTimeout>
    const cleared: Array<ReturnType<typeof setTimeout>> = []

    const cleanup = deferSessionMount({
      onReady: () => {},
      schedule: () => timer,
      clear: (handle) => {
        cleared.push(handle)
      },
    })

    cleanup()

    expect(cleared).toEqual([timer])
  })
})
