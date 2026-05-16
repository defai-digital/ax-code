import { describe, expect, test } from "bun:test"
import { installResizeInputGuard, resizeSignature, restoreTuiInputMode } from "../../../src/cli/cmd/tui/input-mode"

function createEmitter() {
  const listeners = new Map<string, Set<() => void>>()
  return {
    on(event: string, listener: () => void) {
      let bucket = listeners.get(event)
      if (!bucket) {
        bucket = new Set()
        listeners.set(event, bucket)
      }
      bucket.add(listener)
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener)
    },
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener()
    },
    size(event: string) {
      return listeners.get(event)?.size ?? 0
    },
  }
}

describe("restoreTuiInputMode", () => {
  test("re-enables raw mode for TTY stdin", () => {
    const calls: boolean[] = []

    restoreTuiInputMode(
      {
        isTTY: true,
        setRawMode: (mode) => {
          calls.push(mode)
        },
      },
      "darwin",
    )

    expect(calls).toEqual([true])
  })

  test("re-applies Windows console mode guard after resize", () => {
    let calls = 0

    restoreTuiInputMode(
      {
        isTTY: true,
        setRawMode: () => {},
      },
      "win32",
      () => {
        calls++
      },
    )

    expect(calls).toBe(1)
  })
})

describe("resizeSignature", () => {
  test("encodes terminal dimensions into a stable dependency key", () => {
    expect(resizeSignature({ width: 100, height: 30 })).toBe("100x30")
    expect(resizeSignature({ width: 120, height: 40 })).toBe("120x40")
  })
})

describe("installResizeInputGuard", () => {
  test("listens to SIGWINCH and stdout resize on non-Windows TTYs", () => {
    const proc = createEmitter() as ReturnType<typeof createEmitter> & { platform: string }
    proc.platform = "darwin"
    const stdout = Object.assign(createEmitter(), { isTTY: true })
    const scheduled: Array<() => void> = []
    let restoreCalls = 0

    const cleanup = installResizeInputGuard({
      stdin: { isTTY: true },
      stdout,
      process: proc,
      restore: () => {
        restoreCalls++
      },
      schedule: (listener) => {
        scheduled.push(listener)
      },
    })

    expect(proc.size("SIGWINCH")).toBe(1)
    expect(stdout.size("resize")).toBe(1)

    proc.emit("SIGWINCH")
    expect(restoreCalls).toBe(1)
    expect(scheduled).toHaveLength(1)

    scheduled.shift()?.()
    expect(restoreCalls).toBe(2)

    stdout.emit("resize")
    expect(restoreCalls).toBe(3)

    cleanup()
    expect(proc.size("SIGWINCH")).toBe(0)
    expect(stdout.size("resize")).toBe(0)
  })

  test("uses stdout resize without SIGWINCH on Windows", () => {
    const proc = createEmitter() as ReturnType<typeof createEmitter> & { platform: string }
    proc.platform = "win32"
    const stdout = Object.assign(createEmitter(), { isTTY: true })
    let restoreCalls = 0

    const cleanup = installResizeInputGuard({
      stdin: { isTTY: true },
      stdout,
      process: proc,
      restore: () => {
        restoreCalls++
      },
      schedule: () => {},
    })

    expect(proc.size("SIGWINCH")).toBe(0)
    expect(stdout.size("resize")).toBe(1)

    stdout.emit("resize")
    expect(restoreCalls).toBe(1)

    cleanup()
    expect(stdout.size("resize")).toBe(0)
  })
})
