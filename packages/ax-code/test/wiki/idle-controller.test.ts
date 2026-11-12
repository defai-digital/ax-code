import { afterEach, describe, expect, test, vi } from "vitest"
import { createWikiIdleController, type WikiBuildShortfall } from "../../src/wiki/idle-controller"

afterEach(() => vi.useRealTimers())
function setup(overrides: Partial<Parameters<typeof createWikiIdleController>[0]> = {}) {
  vi.useFakeTimers()
  const idle = vi.fn(async () => true)
  const policy = vi.fn(async () => ({ enabled: true, automatic: true, writable: true, git: true }))
  const build = vi.fn(
    async (
      _signal: AbortSignal,
      _progress?: unknown,
      _options?: { explicit: boolean },
    ): Promise<void | WikiBuildShortfall> => {},
  )
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
  test.each(["non-git", "auto-off"])("foreground work preserves an explicit refresh for %s projects", async (mode) => {
    const s = setup({
      idleMs: 1000,
      pollMs: 100,
      policy: async () => ({ enabled: true, writable: true, automatic: mode !== "auto-off", git: mode !== "non-git" }),
    })
    s.build.mockImplementationOnce(
      async (signal) =>
        new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    )
    s.controller.request()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.build).toHaveBeenCalledTimes(1)
    s.idle.mockResolvedValue(false)
    s.controller.activity()
    await vi.advanceTimersByTimeAsync(100)
    expect(s.build).toHaveBeenCalledTimes(1)
    expect(s.controller.status().reason).toBe("busy")
    s.idle.mockResolvedValue(true)
    s.controller.activity()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.build).toHaveBeenCalledTimes(2)
    expect(s.build.mock.calls[1]?.[2]).toEqual({ explicit: true })
    expect(s.controller.status().phase).toBe("ready")
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.build).toHaveBeenCalledTimes(2)
    await s.controller.dispose()
  })
  test.each(["disabled", "readonly"])("a paused explicit refresh still respects %s policy", async (mode) => {
    const s = setup({ pollMs: 100 })
    s.build.mockImplementationOnce(
      async (signal) =>
        new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    )
    s.controller.request()
    await vi.advanceTimersByTimeAsync(0)
    s.policy.mockResolvedValue({
      enabled: mode !== "disabled",
      writable: mode !== "readonly",
      automatic: false,
      git: false,
    })
    s.controller.activity()
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.build).toHaveBeenCalledTimes(1)
    expect(s.controller.status()).toMatchObject({
      phase: "disabled",
      reason: mode === "disabled" ? "disabled" : "permissions",
    })
    await s.controller.dispose()
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
  test("an explicit request during a failing build still reruns after it settles", async () => {
    const s = setup({ idleMs: 0, pollMs: 100, retryMs: 60_000 })
    let reject!: (error: Error) => void
    s.build.mockImplementationOnce(
      () =>
        new Promise<void>((_, rej) => {
          reject = rej
        }),
    )
    s.controller.request()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.build).toHaveBeenCalledTimes(1)
    // The user asks again while the first build is still in flight. Dropping
    // the request here would leave the follow-up check non-explicit, so the
    // fresh failure backoff (retryMs) would suppress the requested rebuild.
    s.controller.request()
    reject(new Error("deterministic failure"))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(s.build).toHaveBeenCalledTimes(2)
    await s.controller.dispose()
  })
  test("a build suppressed by a failure cooldown reports failed, not ready", async () => {
    const onError = vi.fn()
    const s = setup({ idleMs: 0, pollMs: 100, onError })
    s.build.mockImplementation(async () => ({ failed: "suppressed", retryAt: Date.now() + 10_000 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(s.controller.status()).toMatchObject({ phase: "failed", reason: "failed", revision: 0 })
    // Later polls must not repaint the status as ready or re-run the build
    // before the recorded cooldown ends.
    await vi.advanceTimersByTimeAsync(9_900)
    expect(s.controller.status()).toMatchObject({ phase: "failed", reason: "failed", revision: 0 })
    expect(s.build).toHaveBeenCalledTimes(1)
    s.build.mockImplementation(async () => {})
    await vi.advanceTimersByTimeAsync(200)
    expect(s.build).toHaveBeenCalledTimes(2)
    expect(s.controller.status()).toMatchObject({ phase: "ready", reason: "complete", revision: 1 })
    // The suppressed pass already has a recorded failure; it is not a new one.
    expect(onError).not.toHaveBeenCalled()
    await s.controller.dispose()
  })
  test("a suppressed build without a cooldown end waits the shortfall interval", async () => {
    const s = setup({ idleMs: 0, pollMs: 100, shortfallMs: 1_000 })
    s.build.mockImplementation(async () => ({ failed: "suppressed" }))
    await vi.advanceTimersByTimeAsync(900)
    expect(s.build).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(s.build).toHaveBeenCalledTimes(2)
    expect(s.controller.status().phase).toBe("failed")
    await s.controller.dispose()
  })
  test("a partial build reports failed with a new revision for the pages it published", async () => {
    const s = setup({ idleMs: 0, pollMs: 100 })
    s.build.mockImplementation(async () => ({ failed: "partial" }))
    await vi.advanceTimersByTimeAsync(0)
    expect(s.controller.status()).toMatchObject({ phase: "failed", reason: "failed", revision: 1 })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(s.controller.status()).toMatchObject({ phase: "failed", reason: "failed", revision: 1 })
    expect(s.build).toHaveBeenCalledTimes(1)
    await s.controller.dispose()
  })
  test("an explicit request reruns a suppressed build without waiting out the cooldown", async () => {
    const s = setup({ idleMs: 0, pollMs: 100 })
    s.build.mockImplementationOnce(async () => ({ failed: "suppressed", retryAt: Date.now() + 600_000 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(s.controller.status().phase).toBe("failed")
    s.controller.request()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.build).toHaveBeenCalledTimes(2)
    expect(s.build.mock.calls[1]?.[2]).toEqual({ explicit: true })
    expect(s.controller.status()).toMatchObject({ phase: "ready", reason: "complete" })
    await s.controller.dispose()
  })
  test("a stuck job ends at the configured deadline", async () => {
    const onError = vi.fn()
    const s = setup({ idleMs: 0, deadlineMs: 1000, onError })
    s.build.mockImplementation(
      async (signal) =>
        new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.controller.status().phase).toBe("failed")
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: "TimeoutError" }))
    await s.controller.dispose()
  })
})

test("concurrent page indices do not overstate or move progress backwards", async () => {
  let finish!: () => void
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  const s = setup({
    build: async (_signal, progress) => {
      progress({ type: "plan", pageCount: 3 })
      progress({ type: "page_start", path: "quickstart.md", index: 1, total: 3, completed: 0 })
      progress({ type: "page_start", path: "architecture.md", index: 2, total: 3, completed: 0 })
      expect(s.controller.status().completed).toBe(0)
      progress({ type: "page_complete", path: "architecture.md", index: 2, total: 3, completed: 1 })
      expect(s.controller.status().completed).toBe(1)
      progress({ type: "page_start", path: "development.md", index: 3, total: 3, completed: 1 })
      expect(s.controller.status().completed).toBe(1)
      progress({ type: "page_failed", path: "development.md", index: 3, total: 3, completed: 2 })
      progress({ type: "page_complete", path: "quickstart.md", index: 1, total: 3, completed: 3 })
      expect(s.controller.status().completed).toBe(3)
      await done
    },
  })
  await vi.advanceTimersByTimeAsync(30_000)
  expect(s.controller.status().completed).toBe(3)
  finish()
  await vi.advanceTimersByTimeAsync(0)
  await s.controller.dispose()
})
