import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
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
