import { afterEach, describe, expect, test, vi } from "vitest"
import { registerShutdownSignals } from "../../src/util/signals"

const SIGNALS: NodeJS.Signals[] = ["SIGUSR2"]

describe("registerShutdownSignals", () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    vi.restoreAllMocks()
  })

  test("runs the callback once for repeated signals", () => {
    const callback = vi.fn()
    const baseline = process.listenerCount("SIGUSR2")
    cleanups.push(registerShutdownSignals(callback, { signals: SIGNALS }))
    process.emit("SIGUSR2", "SIGUSR2")
    process.emit("SIGUSR2", "SIGUSR2")
    expect(callback).toHaveBeenCalledTimes(1)
    expect(process.listenerCount("SIGUSR2")).toBe(baseline + 1)
  })

  test("restores the default disposition after a rejected shutdown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const baseline = process.listenerCount("SIGUSR2")
    cleanups.push(registerShutdownSignals(() => Promise.reject(new Error("dispose failed")), { signals: SIGNALS }))
    process.emit("SIGUSR2", "SIGUSR2")
    await new Promise((resolve) => setImmediate(resolve))
    expect(process.listenerCount("SIGUSR2")).toBe(baseline)
  })

  test("restores the default disposition after a throwing shutdown", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const baseline = process.listenerCount("SIGUSR2")
    cleanups.push(
      registerShutdownSignals(
        () => {
          throw new Error("boom")
        },
        { signals: SIGNALS },
      ),
    )
    process.emit("SIGUSR2", "SIGUSR2")
    expect(process.listenerCount("SIGUSR2")).toBe(baseline)
  })
})
