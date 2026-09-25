import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionSteering } from "../../src/session/steering"
import { TaskQueue } from "../../src/session/task-queue"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

/** Poll until the row reaches a state, so async reconciliation can settle. */
async function waitForRow(id: string, predicate: (row: TaskQueue.Info) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = await TaskQueue.get(id as never)
    if (predicate(row)) return row
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`row ${id} never reached the expected state`)
}

async function draftSession() {
  const session = await Session.create({})
  const controller = new AbortController()
  SessionSteering.begin(session.id, controller.signal)
  const generation = SessionSteering.view(session.id).generation
  if (!generation) throw new Error("expected an active generation")
  return { session, generation, controller }
}

test("an accepted draft steer owns a durable row without changing the receipt", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation } = await draftSession()
      const receipt = await SessionPrompt.steer(session.id, {
        expectedGeneration: generation,
        clientID: "draft_1",
        text: "use the other config file",
      })

      expect(receipt.status).toBe("accepted")
      // The caller's identity is preserved: the durable row is an internal detail.
      expect(receipt.clientID).toBe("draft_1")

      const rows = await TaskQueue.list({ sessionID: session.id })
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(row.kind).toBe("followup")
      expect(row.status).toBe("cancelled")
      expect(row.payload["steeredInto"]).toBe(generation)
      expect(row.payload["steeredHeartbeatAt"]).toBeTypeOf("number")
    },
  })
})

test("a rejected draft steer leaves nothing behind", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const before = await TaskQueue.list({ sessionID: session.id })
      const receipt = await SessionPrompt.steer(session.id, {
        expectedGeneration: "00000000-0000-4000-8000-000000000000",
        clientID: "draft_2",
        text: "no generation is running",
      })
      expect(receipt.status).toBe("rejected")
      expect(await TaskQueue.list({ sessionID: session.id })).toHaveLength(before.length)
    },
  })
})

test("a generation that ends before the apply returns the text to the queue", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation } = await draftSession()
      await SessionPrompt.steer(session.id, {
        expectedGeneration: generation,
        clientID: "draft_3",
        text: "keep going with the migration",
      })
      const held = (await TaskQueue.list({ sessionID: session.id }))[0]!
      expect(held.status).toBe("cancelled")

      // The turn ends without draining the steer: the row must not stay
      // cancelled forever, or the accepted text would be lost.
      SessionSteering.finish(session.id, { interrupted: false })
      const recovered = await waitForRow(held.id, (row) => row.status !== "cancelled")
      // The row returns to the plain queue and is started for the next turn
      // (the generation that would have applied it is gone).
      expect(["queued", "waiting_for_idle", "running"]).toContain(recovered.status)
      expect(recovered.payload["steeredInto"]).toBeUndefined()
    },
  })
})

test("an applied draft steer is stamped so recovery cannot replay it", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation, controller } = await draftSession()
      await SessionPrompt.steer(session.id, {
        expectedGeneration: generation,
        clientID: "draft_4",
        text: "apply this at the step boundary",
      })
      const held = (await TaskQueue.list({ sessionID: session.id }))[0]!

      const applied = await SessionSteering.drain(
        session.id,
        controller.signal,
        async ({ text, beforeCommit, afterCommit }) => {
          expect(text).toBe("apply this at the step boundary")
          beforeCommit()
          afterCommit()
        },
      )
      expect(applied).toBe(true)

      const row = await waitForRow(held.id, (candidate) => candidate.payload["steeredAppliedAt"] !== undefined)
      expect(row.status).toBe("cancelled")
      expect(row.payload["steeredInto"]).toBe(generation)
    },
  })
})

test("retrying the same client id does not create a second row", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation } = await draftSession()
      const input = {
        expectedGeneration: generation,
        clientID: "draft_retry",
        text: "one row for this text",
      }
      await SessionPrompt.steer(session.id, input)
      await SessionPrompt.steer(session.id, input)
      expect(await TaskQueue.list({ sessionID: session.id })).toHaveLength(1)
    },
  })
})

test("a generation that ends while the row is being written still restores the text", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation } = await draftSession()
      // Race the exact window Grok found: the turn finishes after the row is
      // enqueued but before the durable identity is attached, so finish()'s own
      // reconciliation cannot see the row.
      const real = TaskQueue.cancelSteered.bind(TaskQueue)
      const spy = vi.spyOn(TaskQueue, "cancelSteered").mockImplementation(async (id, options) => {
        SessionSteering.finish(session.id, { interrupted: false })
        return real(id as never, options as never)
      })
      try {
        await SessionPrompt.steer(session.id, {
          expectedGeneration: generation,
          clientID: "draft_race",
          text: "text admitted right as the turn ended",
        })
      } finally {
        spy.mockRestore()
      }

      const rows = await TaskQueue.list({ sessionID: session.id })
      expect(rows).toHaveLength(1)
      const recovered = await waitForRow(rows[0]!.id, (row) => row.status !== "cancelled")
      expect(["queued", "waiting_for_idle", "running"]).toContain(recovered.status)
    },
  })
})

test("an apply that lands before the row exists leaves no awaiting record", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation, controller } = await draftSession()
      // Race the window MiniMax found: the drain applies the text before the
      // durable row is written. A cancelled awaiting row here would be restored
      // by restart recovery and deliver the same text twice.
      const real = TaskQueue.enqueueIdempotent.bind(TaskQueue)
      const spy = vi.spyOn(TaskQueue, "enqueueIdempotent").mockImplementation(async (input) => {
        await SessionSteering.drain(session.id, controller.signal, async ({ afterCommit }) => {
          afterCommit()
        })
        return real(input as never)
      })
      try {
        await SessionPrompt.steer(session.id, {
          expectedGeneration: generation,
          clientID: "draft_applied_first",
          text: "already applied before the row",
        })
      } finally {
        spy.mockRestore()
      }

      expect(await TaskQueue.list({ sessionID: session.id })).toHaveLength(0)
    },
  })
})

test("a steer discarded while the row is written stays queued for the next turn", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation } = await draftSession()
      const real = TaskQueue.enqueueIdempotent.bind(TaskQueue)
      const spy = vi.spyOn(TaskQueue, "enqueueIdempotent").mockImplementation(async (input) => {
        SessionSteering.finish(session.id, { interrupted: false })
        return real(input as never)
      })
      try {
        await SessionPrompt.steer(session.id, {
          expectedGeneration: generation,
          clientID: "draft_discarded_first",
          text: "the turn ended before this could apply",
        })
      } finally {
        spy.mockRestore()
      }

      const rows = await TaskQueue.list({ sessionID: session.id })
      expect(rows).toHaveLength(1)
      // Never cancelled into an awaiting state: the text has no other home, so
      // the next turn runs it.
      expect(rows[0]!.status).not.toBe("cancelled")
    },
  })
})

test("the applied stamp commits with the message, not on a later async pass", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation, controller } = await draftSession()
      await SessionPrompt.steer(session.id, {
        expectedGeneration: generation,
        clientID: "draft_atomic",
        text: "stamp me with the message",
      })
      const held = (await TaskQueue.list({ sessionID: session.id }))[0]!

      // The asynchronous belt (which also stops the heartbeat) must not be what
      // makes this durable: with it disabled the row is still stamped, which is
      // what closes the crash window between the commit and that pass.
      const { TaskQueueSteer } = await import("../../src/session/task-queue-steer")
      const belt = vi.spyOn(TaskQueueSteer, "markSteeredApplied").mockResolvedValue(undefined)
      try {
        // Mirror the production apply, which calls beforeCommit from inside the
        // message transaction and afterCommit once it is durable.
        await SessionSteering.drain(session.id, controller.signal, async ({ beforeCommit, afterCommit }) => {
          beforeCommit()
          afterCommit()
        })
      } finally {
        belt.mockRestore()
      }

      const row = await TaskQueue.get(held.id)
      expect(row.payload["steeredAppliedAt"]).toBeTypeOf("number")
    },
  })
})

test("an apply the transaction aborts leaves no applied stamp", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { session, generation, controller } = await draftSession()
      await SessionPrompt.steer(session.id, {
        expectedGeneration: generation,
        clientID: "draft_rollback",
        text: "this one must not be stamped",
      })
      const held = (await TaskQueue.list({ sessionID: session.id }))[0]!

      // End the generation inside the transaction: beforeCommit throws, so the
      // message roll back and the stamp must roll back with it. Recovery still
      // owns the text.
      await SessionSteering.drain(session.id, controller.signal, async ({ beforeCommit }) => {
        SessionSteering.finish(session.id, { interrupted: false })
        beforeCommit()
      })

      const row = await TaskQueue.get(held.id)
      expect(row.payload["steeredAppliedAt"]).toBeUndefined()
      const recovered = await waitForRow(held.id, (candidate) => candidate.status !== "cancelled")
      expect(["queued", "waiting_for_idle", "running"]).toContain(recovered.status)
    },
  })
})
