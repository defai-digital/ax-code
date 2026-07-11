import { describe, expect, test, vi, type Mock } from "vitest"
import { EventEmitter } from "node:events"
import { readNonTtyStdin, DEFAULT_TUI_STDIN_PIPE_QUIET_WINDOW_MS } from "../../../src/cli/cmd/tui/thread"

function fakeStdin() {
  const ee = new EventEmitter() as EventEmitter & { pause: Mock<() => void> }
  ee.pause = vi.fn<() => void>()
  return ee
}

describe("readNonTtyStdin", () => {
  test("has a sane default quiet window", () => {
    expect(DEFAULT_TUI_STDIN_PIPE_QUIET_WINDOW_MS).toBe(300)
  })

  test("reads a regular file fully and resolves on end without pausing", async () => {
    const stdin = fakeStdin()
    const p = readNonTtyStdin({ stdin, isRegularFile: true })
    stdin.emit("data", Buffer.from("hello "))
    stdin.emit("data", Buffer.from("world"))
    stdin.emit("end")
    expect(await p).toBe("hello world")
    // A regular file EOFs on its own; no pause needed.
    expect(stdin.pause).not.toHaveBeenCalled()
  })

  test("a pipe that closes resolves immediately on end", async () => {
    const stdin = fakeStdin()
    const p = readNonTtyStdin({ stdin, isRegularFile: false })
    stdin.emit("data", Buffer.from("piped"))
    stdin.emit("end")
    expect(await p).toBe("piped")
  })

  test("an open pipe resolves after the quiet window and pauses stdin", async () => {
    vi.useFakeTimers()
    try {
      const stdin = fakeStdin()
      const p = readNonTtyStdin({ stdin, isRegularFile: false, quietWindowMs: 300 })
      stdin.emit("data", Buffer.from("still open"))
      // No `end` ever arrives (e.g. `tail -f x | ax-code`).
      await vi.advanceTimersByTimeAsync(300)
      expect(await p).toBe("still open")
      expect(stdin.pause).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test("an idle open pipe resolves empty after the quiet window", async () => {
    vi.useFakeTimers()
    try {
      const stdin = fakeStdin()
      const p = readNonTtyStdin({ stdin, isRegularFile: false, quietWindowMs: 300 })
      // Neither `data` nor `end` (e.g. `ax-code < fifo` with no writer yet).
      await vi.advanceTimersByTimeAsync(300)
      expect(await p).toBe("")
      expect(stdin.pause).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test("each chunk resets the quiet window so it does not truncate a slow producer", async () => {
    vi.useFakeTimers()
    try {
      const stdin = fakeStdin()
      const resolved = vi.fn()
      const p = readNonTtyStdin({ stdin, isRegularFile: false, quietWindowMs: 300 }).then((value) => {
        resolved(value)
        return value
      })
      stdin.emit("data", Buffer.from("a"))
      await vi.advanceTimersByTimeAsync(200)
      stdin.emit("data", Buffer.from("b"))
      // 200ms after the second chunk: the original timer would have fired at
      // 300ms if it were not reset, so this proves the reset.
      await vi.advanceTimersByTimeAsync(200)
      expect(resolved).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      await p
      expect(resolved).toHaveBeenCalledWith("ab")
    } finally {
      vi.useRealTimers()
    }
  })

  test("rejects on a stdin error", async () => {
    const stdin = fakeStdin()
    const p = readNonTtyStdin({ stdin, isRegularFile: true })
    stdin.emit("error", new Error("boom"))
    await expect(p).rejects.toThrow("boom")
  })
})
