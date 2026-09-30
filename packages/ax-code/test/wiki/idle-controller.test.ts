import { afterEach, describe, expect, test, vi } from "vitest"
import { createWikiIdleController } from "../../src/wiki/idle-controller"

afterEach(() => vi.useRealTimers())
function setup(overrides: Partial<Parameters<typeof createWikiIdleController>[0]> = {}) {
  vi.useFakeTimers()
  const idle = vi.fn(async () => true)
  const policy = vi.fn(async () => ({ enabled: true, automatic: true, writable: true, git: true }))
  const build = vi.fn(async (_signal: AbortSignal) => {})
  return { idle, policy, build, controller: createWikiIdleController({ idle, policy, build, ...overrides }) }
}
describe("default idle Wiki maintenance", () => {
  test("foreground activity during an asynchronous idle check invalidates that check", async () => {
    let resolveIdle!: (idle: boolean) => void
    const s = setup({
      idle: () =>
        new Promise<boolean>((resolve) => {
          resolveIdle = resolve
        }),
    })
    s.controller.request()
    await vi.advanceTimersByTimeAsync(0)
    s.controller.activity()
    resolveIdle(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.build).not.toHaveBeenCalled()
    await s.controller.dispose()
  })
  test("a fresh Wiki returns to ready after foreground activity without another build", async () => {
    const s = setup()
    await vi.advanceTimersByTimeAsync(30_000)
    s.idle.mockResolvedValue(false)
    s.controller.activity()
    await vi.advanceTimersByTimeAsync(5000)
    expect(s.controller.status().reason).toBe("busy")
    s.idle.mockResolvedValue(true)
    s.controller.activity()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.controller.status().phase).toBe("ready")
    expect(s.build).toHaveBeenCalledTimes(1)
    await s.controller.dispose()
  })
  test("default quiet window starts one build and source changes schedule incremental work", async () => {
    const s = setup()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(s.build).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(s.build).toHaveBeenCalledTimes(1)
    expect(s.controller.status().phase).toBe("ready")
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.build).toHaveBeenCalledTimes(1)
    s.controller.changed()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.build).toHaveBeenCalledTimes(2)
    await s.controller.dispose()
  })
  test.each(["disabled", "readonly", "non-git", "auto-off"])(
    "does not automatically compile %s projects",
    async (mode) => {
      const s = setup({
        policy: async () => ({
          enabled: mode !== "disabled",
          automatic: mode !== "auto-off",
          writable: mode !== "readonly",
          git: mode !== "non-git",
        }),
      })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(s.build).not.toHaveBeenCalled()
      expect(s.controller.status().phase).toBe("disabled")
      if (mode === "non-git" || mode === "auto-off") {
        s.controller.request()
        await vi.advanceTimersByTimeAsync(0)
        expect(s.build).toHaveBeenCalledTimes(1)
      }
      await s.controller.dispose()
    },
  )
  test("explicit requests skip debounce, coalesce and wait for foreground work", async () => {
    const s = setup()
    s.idle.mockResolvedValue(false)
    s.controller.request()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.controller.status().reason).toBe("busy")
    expect(s.build).not.toHaveBeenCalled()
    s.idle.mockResolvedValue(true)
    s.controller.activity()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.build).toHaveBeenCalledTimes(1)
    await s.controller.dispose()
  })
  test("foreground work and disposal abort an active model job", async () => {
    const s = setup()
    s.build.mockImplementation(
      async (signal) =>
        new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    )
    s.controller.request()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.controller.status().phase).toBe("running")
    s.controller.request()
    expect(s.build).toHaveBeenCalledTimes(1)
    s.controller.activity()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.controller.status().phase).toBe("queued")
    await s.controller.dispose()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(s.build).toHaveBeenCalledTimes(1)
  })
  test("failure retries back off and stop after three automatic attempts", async () => {
    const s = setup({ retryMs: 1000, idleMs: 0, pollMs: 100 })
    s.build.mockRejectedValue(new Error("Fixture provider unavailable"))
    await vi.advanceTimersByTimeAsync(0)
    expect(s.controller.status().phase).toBe("failed")
    await vi.advanceTimersByTimeAsync(999)
    expect(s.build).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2001)
    expect(s.build).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(s.build).toHaveBeenCalledTimes(3)
    s.controller.request()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.build).toHaveBeenCalledTimes(4)
    await s.controller.dispose()
  })
  test("a stuck job ends at the configured deadline", async () => {
    const s = setup({ idleMs: 0, deadlineMs: 1000 })
    s.build.mockImplementation(
      async (signal) =>
        new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.controller.status().phase).toBe("failed")
    await s.controller.dispose()
  })
})
