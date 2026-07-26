import { describe, expect, test, vi, beforeEach, afterEach } from "vitest"
import { createToastStore } from "../../../src/cli/cmd/tui/ui/toast"

describe("toast store", async () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("shows immediately, queues a different toast, advances after the duration", async () => {
    const toast = createToastStore()
    toast.show({ variant: "info", message: "one" })
    toast.show({ variant: "info", message: "two" })
    expect(toast.currentToast?.message).toBe("one")
    await vi.advanceTimersByTimeAsync(5000)
    expect(toast.currentToast?.message).toBe("two")
    await vi.advanceTimersByTimeAsync(5000)
    expect(toast.currentToast).toBeNull()
  })

  test("collapses consecutive duplicates of the visible toast into a repeat counter", async () => {
    const toast = createToastStore()
    toast.show({ variant: "error", message: "boom" })
    toast.show({ variant: "error", message: "boom" })
    toast.show({ variant: "error", message: "boom" })
    expect(toast.currentRepeat).toBe(3)
    await vi.advanceTimersByTimeAsync(5000)
    expect(toast.currentToast).toBeNull()
  })

  test("collapses duplicates queued back-to-back", async () => {
    const toast = createToastStore()
    toast.show({ variant: "info", message: "first" })
    toast.show({ variant: "error", message: "boom" })
    toast.show({ variant: "error", message: "boom" })
    await vi.advanceTimersByTimeAsync(5000)
    expect(toast.currentToast?.message).toBe("boom")
    expect(toast.currentRepeat).toBe(2)
  })

  test("a new error flushes queued info toasts", async () => {
    const toast = createToastStore()
    toast.show({ variant: "info", message: "showing" })
    toast.show({ variant: "info", message: "stale 1" })
    toast.show({ variant: "info", message: "stale 2" })
    toast.show({ variant: "error", message: "boom" })
    await vi.advanceTimersByTimeAsync(5000)
    expect(toast.currentToast?.message).toBe("boom")
    await vi.advanceTimersByTimeAsync(5000)
    // The stale info toasts were dropped — nothing follows the error.
    expect(toast.currentToast).toBeNull()
  })

  test("caps the queue, dropping the oldest entries first", async () => {
    const toast = createToastStore()
    toast.show({ variant: "info", message: "showing" })
    for (let i = 1; i <= 8; i++) toast.show({ variant: "info", message: `q${i}` })
    await vi.advanceTimersByTimeAsync(5000)
    // The queue kept only the last 5 entries (q4..q8).
    expect(toast.currentToast?.message).toBe("q4")
  })

  test("invalid options fall back to a plain error toast instead of throwing", async () => {
    const toast = createToastStore()
    expect(() => toast.show({ nope: true } as any)).not.toThrow()
    expect(toast.currentToast?.variant).toBe("error")
  })
})
