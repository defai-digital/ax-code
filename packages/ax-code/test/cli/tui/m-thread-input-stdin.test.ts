import { describe, expect, test, vi, type Mock } from "vitest"
import { EventEmitter } from "node:events"
import { readNonTtyStdin, DEFAULT_STDIN_PIPE_QUIET_WINDOW_MS } from "../../../src/cli/stdin"

function fakeStdin() {
  const ee = new EventEmitter() as EventEmitter & { pause: Mock<() => void> }
  ee.pause = vi.fn<() => void>()
  return ee
}

describe("readNonTtyStdin", () => {
  test("explicit stdin rejects a pipe closed before EOF instead of hanging", async () => {
    const stdin = fakeStdin()
    const controller = new AbortController()
    const rejected = vi.fn()
    const pending = readNonTtyStdin({ stdin, waitForEof: true, signal: controller.signal }).catch(rejected)
    try {
      stdin.emit("data", Buffer.from("partial prompt"))
      stdin.emit("close")
      await Promise.resolve()
      expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ message: "Stdin closed before EOF" }))
      expect(stdin.listenerCount("close")).toBe(0)
    } finally {
      controller.abort()
      await pending
    }
  })

  test("explicit stdin resolves when EOF was already emitted", async () => {
    const stdin = Object.assign(fakeStdin(), { readableEnded: true })
    const controller = new AbortController()
    const resolved = vi.fn()
    const pending = readNonTtyStdin({ stdin, waitForEof: true, signal: controller.signal }).then(resolved, () => {})
    try {
      await Promise.resolve()
      expect(resolved).toHaveBeenCalledWith("")
      expect(stdin.listenerCount("data")).toBe(0)
    } finally {
      controller.abort()
      await pending
    }
  })

  test("explicit stdin waits beyond the quiet window before the first chunk and between chunks", async () => {
    vi.useFakeTimers()
    try {
      const stdin = fakeStdin()
      const resolved = vi.fn()
      const p = readNonTtyStdin({ stdin, isRegularFile: false, waitForEof: true }).then(resolved)
      await vi.advanceTimersByTimeAsync(1000)
      expect(resolved).not.toHaveBeenCalled()
      const bytes = Buffer.from("hello \u4e16\u754c")
      stdin.emit("data", bytes.subarray(0, 8))
      await vi.advanceTimersByTimeAsync(1000)
      expect(resolved).not.toHaveBeenCalled()
      stdin.emit("data", bytes.subarray(8))
      stdin.emit("end")
      await p
      expect(resolved).toHaveBeenCalledWith("hello \u4e16\u754c")
      expect(stdin.pause).not.toHaveBeenCalled()
      expect(stdin.listenerCount("data")).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([false, true])("cancellation stops an explicit stdin reader (already aborted: %s)", async (before) => {
    const stdin = fakeStdin()
    const controller = new AbortController()
    const error = new Error("cancel input")
    if (before) controller.abort(error)
    const p = readNonTtyStdin({ stdin, isRegularFile: false, waitForEof: true, signal: controller.signal })
    if (!before) {
      stdin.emit("data", Buffer.from("partial"))
      controller.abort(error)
    }
    await expect(p).rejects.toBe(error)
    expect(stdin.pause).toHaveBeenCalledTimes(1)
    for (const event of ["data", "end", "error"]) expect(stdin.listenerCount(event)).toBe(0)
  })

  test("explicit empty stdin resolves on EOF", async () => {
    const stdin = fakeStdin()
    const p = readNonTtyStdin({ stdin, isRegularFile: false, waitForEof: true })
    stdin.emit("end")
    expect(await p).toBe("")
  })

  test("has a sane default quiet window", () => {
    expect(DEFAULT_STDIN_PIPE_QUIET_WINDOW_MS).toBe(300)
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
