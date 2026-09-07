import { afterEach, describe, expect, test, vi } from "vitest"
import { createRecapController, type RecapSnapshot } from "../../../src/cli/cmd/tui/routes/session/recap-controller"

afterEach(() => vi.useRealTimers())

function setup() {
  vi.useFakeTimers()
  const state: RecapSnapshot = {
    sessionID: "ses_a",
    revision: "turn_1",
    status: "idle",
    hasMessages: true,
    enabled: true,
    delayMs: 5000,
    input: "",
  }
  const pending = Promise.withResolvers<{ data?: { text: string | null }; error?: unknown }>()
  const request = vi.fn().mockReturnValue(pending.promise)
  const show = vi.fn()
  const notify = vi.fn()
  const controller = createRecapController({
    snapshot: () => ({ ...state }),
    request,
    show,
    notify,
    schedule: (task, delay) => {
      const timer = setTimeout(task, delay)
      return () => clearTimeout(timer)
    },
  })
  controller.update()
  const update = (next: Partial<RecapSnapshot>) => {
    Object.assign(state, next)
    controller.update()
  }
  return { controller, request, show, notify, pending, update }
}

describe("conversation recap lifecycle", () => {
  test("manual recap works after resume with automatic recaps disabled", async () => {
    const t = setup()
    t.update({ enabled: false })
    expect(t.request).not.toHaveBeenCalled()
    const done = t.controller.manual()
    expect(t.request).toHaveBeenCalledWith(expect.objectContaining({ sessionID: "ses_a", scope: "conversation" }))
    t.pending.resolve({ data: { text: "Fixed login; tests passed." } })
    await done
    expect(t.show).toHaveBeenLastCalledWith({ text: "Fixed login; tests passed." })
    t.controller.dispose()
  })

  test("schedules only after completion and suppresses duplicate automatic requests", async () => {
    const t = setup()
    await vi.advanceTimersByTimeAsync(6000)
    expect(t.request).not.toHaveBeenCalled()
    t.update({ status: "busy" })
    t.update({ status: "idle" })
    await vi.advanceTimersByTimeAsync(4999)
    expect(t.request).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(t.request).toHaveBeenCalledWith(expect.objectContaining({ scope: "turn" }))
    t.pending.resolve({ data: { text: "Done." } })
    await vi.advanceTimersByTimeAsync(20000)
    expect(t.request).toHaveBeenCalledOnce()
    t.controller.dispose()
  })

  test.each(["navigation", "revision", "restart", "typing", "disabled", "dispose"])(
    "discards a late automatic response after %s",
    async (event) => {
      const t = setup()
      t.update({ status: "busy" })
      t.update({ status: "idle" })
      await vi.advanceTimersByTimeAsync(5000)
      const signal = t.request.mock.calls[0][0].signal as AbortSignal
      if (event === "navigation") {
        t.update({ sessionID: "ses_b" })
        t.update({ sessionID: "ses_a" })
      }
      if (event === "revision") t.update({ revision: "turn_2" })
      if (event === "restart") {
        t.update({ status: "busy" })
        t.update({ status: "idle" })
      }
      if (event === "typing") {
        t.update({ input: "next" })
        t.update({ input: "" })
      }
      if (event === "disabled") t.update({ enabled: false })
      if (event === "dispose") t.controller.dispose()
      expect(signal.aborted).toBe(true)
      t.pending.resolve({ data: { text: "Stale result" } })
      await vi.advanceTimersByTimeAsync(0)
      expect(t.show).not.toHaveBeenCalledWith({ text: "Stale result" })
      t.controller.dispose()
    },
  )

  test("typing during the idle delay cancels the pending request", async () => {
    const t = setup()
    t.update({ status: "busy" })
    t.update({ status: "idle" })
    t.update({ input: "draft" })
    await vi.advanceTimersByTimeAsync(10000)
    expect(t.request).not.toHaveBeenCalled()
    t.controller.dispose()
  })

  test("a completion update arriving after idle reschedules the pending recap", async () => {
    const t = setup()
    t.update({ status: "busy" })
    t.update({ status: "idle" })
    await vi.advanceTimersByTimeAsync(100)
    t.update({ revision: "turn_1_completed" })
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.request).toHaveBeenCalledOnce()
    t.pending.resolve({ data: { text: "Done" } })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.show).toHaveBeenLastCalledWith({ text: "Done" })
    t.controller.dispose()
  })

  test("manual recap replaces the scheduled automatic attempt and deduplicates in-flight requests", async () => {
    const t = setup()
    t.update({ status: "busy" })
    t.update({ status: "idle" })
    const done = t.controller.manual()
    await t.controller.manual()
    expect(t.notify).toHaveBeenLastCalledWith("A conversation recap is already being generated.")
    await vi.advanceTimersByTimeAsync(10000)
    expect(t.request).toHaveBeenCalledOnce()
    t.pending.resolve({ data: { text: "Done" } })
    await done
    t.controller.dispose()
  })

  test.each(["http", "throw", "empty"])("manual %s failures allow an explicit retry", async (failure) => {
    const t = setup()
    const done = t.controller.manual()
    if (failure === "throw") t.pending.reject(new Error("offline"))
    else t.pending.resolve(failure === "http" ? { error: { status: 500 } } : { data: { text: null } })
    await done
    expect(t.notify).toHaveBeenCalledOnce()
    t.request.mockResolvedValue({ data: { text: "Recovered" } })
    await t.controller.manual()
    expect(t.show).toHaveBeenLastCalledWith({ text: "Recovered" })
    expect(t.request).toHaveBeenCalledTimes(2)
    t.controller.dispose()
  })

  test("manual empty and busy states do not call the model", async () => {
    const t = setup()
    t.update({ hasMessages: false })
    await t.controller.manual()
    expect(t.notify).toHaveBeenLastCalledWith("There is no conversation history to recap.")
    t.update({ hasMessages: true, status: "busy" })
    await t.controller.manual()
    expect(t.notify).toHaveBeenLastCalledWith("Wait for the current turn to finish before requesting a recap.")
    expect(t.request).not.toHaveBeenCalled()
    t.controller.dispose()
  })

  test("disabling automatic recap does not cancel an explicit request", async () => {
    const t = setup()
    const done = t.controller.manual()
    t.update({ enabled: false })
    t.pending.resolve({ data: { text: "Requested recap" } })
    await done
    expect(t.show).toHaveBeenLastCalledWith({ text: "Requested recap" })
    t.controller.dispose()
  })
})
