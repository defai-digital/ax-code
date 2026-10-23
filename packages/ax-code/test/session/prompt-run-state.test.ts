import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { createPromptRunState } from "../../src/session/prompt/prompt-run-state"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

describe("prompt run state", () => {
  test.each([false, true])("cancellation aborts and rejects callbacks with silent=%s", async (silent) => {
    const { SessionStatus } = await import("../../src/session/status")
    const { LifecycleHooks } = await import("../../src/hooks/lifecycle")
    const hook = vi
      .spyOn(LifecycleHooks, "runForWorkspace")
      .mockResolvedValue({ ok: true, blocked: false, outputs: [] })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runState = createPromptRunState()
        const id = SessionID.make("ses_cancel_callbacks")
        const signal = runState.start(id)
        const reject = vi.fn()
        runState.enqueue(id, { resolve: vi.fn(), reject })
        await SessionStatus.set(id, { type: "busy" })
        await runState.cancel(id, { silent })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(signal?.aborted).toBe(true)
        expect(reject).toHaveBeenCalledWith(expect.objectContaining({ message: "Session ended" }))
        expect(runState.resume(id)).toBeUndefined()
        expect((await SessionStatus.list()).has(id)).toBe(false)
        expect(hook).toHaveBeenCalledTimes(silent ? 0 : 1)
      },
    })
  })

  test("instance disposal rejects queued callbacks instead of leaving them pending", async () => {
    await using tmp = await tmpdir({ git: true })

    let mark!: () => void
    const settled = new Promise<void>((resolve) => (mark = resolve))
    let rejected: unknown
    let resolved = false

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runState = createPromptRunState()
        const sessionID = SessionID.make("ses_dispose_callbacks")
        runState.start(sessionID)
        const enqueued = runState.enqueue(sessionID, {
          resolve: () => {
            resolved = true
            mark()
          },
          reject: (error) => {
            rejected = error
            mark()
          },
        })
        expect(enqueued).toBe(true)
        expect(runState.queuedCallbacks(sessionID)).toHaveLength(1)
      },
    })

    await Instance.disposeAll()
    await settled

    expect(resolved).toBe(false)
    expect(rejected).toBeInstanceOf(Error)
    expect((rejected as Error).message).toBe("Session ended")
  })
})
