import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { cancelPromptTree } from "../../src/session/prompt/prompt-cancellation"
import { createPromptRunState } from "../../src/session/prompt/prompt-run-state"
import { MessageID, PartID } from "../../src/session/schema"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test.each(["late failure", "watchdog timeout"] as const)(
  "a retired queue attempt cannot affect its replacement after %s",
  async (ending) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        vi.useFakeTimers()
        const previous = Promise.withResolvers<never>()
        const replacement = Promise.withResolvers<Awaited<ReturnType<typeof SessionPrompt.prompt>>>()
        const prompt = vi
          .spyOn(SessionPrompt, "prompt")
          .mockReturnValueOnce(previous.promise)
          .mockReturnValueOnce(replacement.promise)
        const cancel = vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined)
        const first = await TaskQueue.enqueue({
          sessionID: session.id,
          kind: "prompt",
          title: "Queue attempt",
          payload: { text: "Run offline fixture" },
          executionTimeoutMs: 45_000,
        })
        try {
          expect((await TaskQueueExecutor.start(first)).status).toBe("running")
          await vi.advanceTimersByTimeAsync(0)
          expect(prompt).toHaveBeenCalledTimes(1)

          // Make the deadlines distinct while both attempts share a task ID.
          if (ending === "watchdog timeout") await vi.advanceTimersByTimeAsync(1_000)
          await TaskQueue.setStatus({ id: first.id, status: "failed", error: "retired by recovery" })
          expect((await TaskQueueExecutor.start(await TaskQueue.retry(first.id))).status).toBe("running")
          await vi.advanceTimersByTimeAsync(1)
          expect(prompt).toHaveBeenCalledTimes(2)

          if (ending === "watchdog timeout") await vi.advanceTimersByTimeAsync(43_999)
          else {
            previous.reject(new Error("stale attempt failed"))
            await vi.advanceTimersByTimeAsync(0)
          }

          expect((await TaskQueue.get(first.id)).status).toBe("running")
          expect(cancel).not.toHaveBeenCalled()
        } finally {
          previous.reject(new Error("end fixture"))
          replacement.resolve(undefined as never)
          await vi.advanceTimersByTimeAsync(0)
        }
        expect((await TaskQueue.get(first.id)).status).toBe("completed")
      },
    })
  },
)

test("a retired claim cannot update heartbeat or delivery state on a re-claimed row", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const other = await Session.create({})
      const queued = await TaskQueue.enqueue({
        sessionID: session.id,
        kind: "subagent",
        title: "Retryable subagent",
        payload: { source: "task" },
      })
      const first = await TaskQueue.claimForExecution(queued.id)
      if (first.kind !== "claimed") throw new Error("Expected to claim the first attempt")
      const stopped = await TaskQueue.finishExecution(first.attempt, { status: "failed" })
      if (!stopped?.changed) throw new Error("Expected to settle the first attempt")
      await TaskQueue.retry(queued.id)
      const replacement = await TaskQueue.claimForExecution(queued.id)
      if (replacement.kind !== "claimed") throw new Error("Expected to claim the replacement")

      expect(TaskQueue.heartbeat(first.attempt, Date.now() + 60_000)).toBe(false)
      await expect(TaskQueue.attachSession(first.attempt, other.id)).rejects.toThrow("claim retired")
      const result = await TaskQueue.claimResultDelivery({
        id: queued.id,
        claim: { owner: "handoff", messageID: MessageID.ascending(), partID: PartID.ascending(), time: Date.now() },
        expectedTerminal: stopped.item,
      })
      expect(result.accepted).toBe(false)
      expect(await TaskQueue.get(queued.id)).toEqual(replacement.item)
    },
  })
})

test.each(["queued", "running"] as const)("operator stop preserves a replacement that is %s", async (status) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const item = await TaskQueue.enqueue({ sessionID: session.id, kind: "prompt", title: "Concurrent stop" })
      const first = await TaskQueue.claimForExecution(item.id)
      if (first.kind !== "claimed") throw new Error("Expected to claim the first attempt")
      const interrupt = vi.spyOn(SessionPrompt, "cancel").mockImplementationOnce(async () => {
        await TaskQueue.finishExecution(first.attempt, { status: "failed", error: "Original attempt settled." })
        await TaskQueue.retry(item.id)
        if (status === "running") expect((await TaskQueue.claimForExecution(item.id)).kind).toBe("claimed")
      })

      await expect(TaskQueue.stop(item.id)).rejects.toMatchObject({ status: 409 })
      expect(interrupt).toHaveBeenCalledOnce()
      expect(await TaskQueue.get(item.id)).toMatchObject({ status, error: undefined })
    },
  })
})

test("session cancellation skips a retried row even while it is queued", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const original = await TaskQueue.enqueue({ sessionID: session.id, kind: "prompt", title: "Retried task" })
      const pending = await TaskQueue.enqueue({ sessionID: session.id, kind: "prompt", title: "Pending task" })
      const targets = await TaskQueue.captureSessionCancellation(session.id)
      await TaskQueue.cancel(original.id)
      await TaskQueue.retry(original.id)

      const cancelled = await TaskQueue.cancelForSession(session.id, undefined, { targets })

      expect(cancelled.map((item) => item.id)).toEqual([pending.id])
      expect(await TaskQueue.get(original.id)).toMatchObject({ status: "queued" })
    },
  })
})

test("a turn admitted after idle survives the preceding session interrupt", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const state = createPromptRunState()
      const previous = state.start(session.id)
      const original = await TaskQueue.enqueue({ sessionID: session.id, kind: "prompt", title: "Interrupted task" })
      const followup = await TaskQueue.enqueue({ sessionID: session.id, kind: "followup", title: "Parked followup" })
      const first = await TaskQueue.claimForExecution(original.id)
      if (first.kind !== "claimed") throw new Error("Expected to claim the interrupted attempt")
      let replacement: AbortSignal | undefined
      const cancel = state.cancel
      vi.spyOn(state, "cancel").mockImplementationOnce(async (id, options) => {
        await cancel(id, options)
        await TaskQueue.finishExecution(first.attempt, { status: "failed" })
        await TaskQueue.retry(original.id)
        expect((await TaskQueue.claimForExecution(original.id)).kind).toBe("claimed")
        replacement = state.start(session.id)?.signal
      })

      expect(await cancelPromptTree(session.id, { interrupt: true }, state)).toBe(true)

      expect(previous?.signal.aborted).toBe(true)
      expect(replacement?.aborted).toBe(false)
      expect(await TaskQueue.get(original.id)).toMatchObject({ status: "running" })
      expect(await TaskQueue.get(followup.id)).toMatchObject({ status: "paused" })
    },
  })
})

test("deleting an active row preserves a retry admitted during stop publication", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const item = await TaskQueue.enqueue({ sessionID: session.id, kind: "prompt", title: "Concurrent delete" })
      expect((await TaskQueue.claimForExecution(item.id)).kind).toBe("claimed")
      vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined)
      const getSession = Session.get
      const retry = vi.spyOn(Session, "get").mockImplementationOnce(async (id) => {
        expect((await TaskQueue.get(item.id)).status).toBe("cancelled")
        await TaskQueue.retry(item.id)
        expect((await TaskQueue.claimForExecution(item.id)).kind).toBe("claimed")
        return getSession(id)
      })

      await expect(TaskQueue.remove(item.id)).rejects.toMatchObject({ status: 409 })
      expect(retry).toHaveBeenCalled()
      expect(await TaskQueue.get(item.id)).toMatchObject({ status: "running" })
    },
  })
})

test("a removed target does not interrupt cancellation of remaining queue items", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const first = await TaskQueue.enqueue({ sessionID: session.id, kind: "followup", title: "Removed task" })
      const second = await TaskQueue.enqueue({ sessionID: session.id, kind: "followup", title: "Remaining task" })
      const targets = await TaskQueue.captureSessionCancellation(session.id)
      await TaskQueue.remove(first.id)

      expect((await TaskQueue.pauseFollowupsForSession(session.id, targets)).map((item) => item.id)).toEqual([
        second.id,
      ])
      expect((await TaskQueue.cancelForSession(session.id, undefined, { targets })).map((item) => item.id)).toEqual([
        second.id,
      ])
    },
  })
})
