import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskQueueID } from "../../src/session/schema"
import { SessionSteering } from "../../src/session/steering"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueSteer } from "../../src/session/task-queue-steer"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

function followUpPayload(text: string, parts?: unknown[]) {
  // Mirrors the composer snapshot every queued follow-up carries: agent,
  // model, and variant are always present and must not be steering barriers.
  return {
    kind: "prompt",
    body: {
      parts: parts ?? [{ type: "text", text }],
      agent: "build",
      model: { providerID: "test-provider", modelID: "test-model" },
      variant: "default",
    },
  }
}

async function enqueueFollowUp(sessionID: string, text: string, parts?: unknown[]) {
  return TaskQueue.enqueue({
    sessionID,
    kind: "followup",
    title: text.slice(0, 40) || "Follow-up",
    payload: followUpPayload(text, parts),
  })
}

function steerRequest(app: ReturnType<typeof Server.Default>, directory: string, id: string) {
  return app.request(`/task-queue/${id}/steer?directory=${encodeURIComponent(directory)}`, { method: "POST" })
}

test("steering a queued follow-up admits the text and cancels the row with an audit trail", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const generation = SessionSteering.view(session.id).generation!
      const item = await enqueueFollowUp(session.id, "use the other config file")

      const response = await steerRequest(app, tmp.path, item.id)
      expect(response.status).toBe(200)
      const result = TaskQueueSteer.Result.parse(await response.json())
      expect(result.receipt?.status).toBe("accepted")
      expect(result.receipt?.clientID).toMatch(/^tq_/)
      expect(result.item.status).toBe("cancelled")
      expect(result.item.payload.steeredInto).toBe(generation)
      expect(typeof result.item.payload.steeredAt).toBe("number")
      // The admission itself stamps the first owner heartbeat so restart
      // recovery stays away from the moment the row is cancelled.
      expect(typeof result.item.payload.steeredHeartbeatAt).toBe("number")

      const persisted = await TaskQueue.get(item.id)
      expect(persisted.status).toBe("cancelled")
      expect(persisted.payload.steeredInto).toBe(generation)
      const receipts = SessionSteering.view(session.id).receipts
      expect(receipts).toHaveLength(1)
      expect(receipts[0]!.status).toBe("accepted")
    },
  })
})

test("without an active generation the row is left untouched with reason generation_not_active", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const item = await enqueueFollowUp(session.id, "queued while idle")

      const response = await steerRequest(app, tmp.path, item.id)
      expect(response.status).toBe(200)
      const result = TaskQueueSteer.Result.parse(await response.json())
      expect(result.receipt).toBeNull()
      expect(result.reason).toBe("generation_not_active")
      expect(result.item.status).toBe("queued")
      expect((await TaskQueue.get(item.id)).status).toBe("queued")
    },
  })
})

test("a turn ending between the generation check and admission restores the row", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const item = await enqueueFollowUp(session.id, "too late for this turn")
      SessionSteering.finish(session.id)

      const response = await steerRequest(app, tmp.path, item.id)
      expect(response.status).toBe(200)
      const result = TaskQueueSteer.Result.parse(await response.json())
      expect(result.receipt).toBeNull()
      expect(result.reason).toBe("generation_not_active")
      expect((await TaskQueue.get(item.id)).status).toBe("queued")
    },
  })
})

test("a paused follow-up steers as an explicit per-row gesture", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const item = await enqueueFollowUp(session.id, "parked but send it now")
      await TaskQueue.pause(item.id)

      const response = await steerRequest(app, tmp.path, item.id)
      expect(response.status).toBe(200)
      const result = TaskQueueSteer.Result.parse(await response.json())
      expect(result.receipt?.status).toBe("accepted")
      expect(result.item.status).toBe("cancelled")
    },
  })
})

test("non-text follow-ups, wrong kinds, and oversize text are rejected with 400", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)

      const withAttachment = await enqueueFollowUp(session.id, "see this file", [
        { type: "text", text: "see this file" },
        { type: "file", url: "file:///tmp/a.ts" },
      ])
      expect((await steerRequest(app, tmp.path, withAttachment.id)).status).toBe(400)
      expect((await TaskQueue.get(withAttachment.id)).status).toBe("queued")

      const oversize = await enqueueFollowUp(session.id, "x".repeat(16_001))
      expect((await steerRequest(app, tmp.path, oversize.id)).status).toBe(400)

      const prompt = await TaskQueue.enqueue({ sessionID: session.id, kind: "prompt", title: "Not a follow-up" })
      expect((await steerRequest(app, tmp.path, prompt.id)).status).toBe(400)

      const running = await enqueueFollowUp(session.id, "already settled")
      await TaskQueue.cancel(running.id)
      expect((await steerRequest(app, tmp.path, running.id)).status).toBe(400)
    },
  })
})

test("a row retried after a steer can be steered again in a later generation", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const item = await enqueueFollowUp(session.id, "same text, later turn")
      expect((await steerRequest(app, tmp.path, item.id)).status).toBe(200)
      // An interrupted end parks the never-applied steer as paused, which is
      // still steerable by an explicit gesture; wait for the recovery instead
      // of racing it with a manual retry, then the next turn starts.
      SessionSteering.finish(session.id, { interrupted: true })
      const deadline = Date.now() + 5000
      while ((await TaskQueue.get(item.id)).status === "cancelled" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect((await TaskQueue.get(item.id)).status).toBe("paused")
      SessionSteering.begin(session.id, new AbortController().signal)
      const generation = SessionSteering.view(session.id).generation!

      const again = await steerRequest(app, tmp.path, item.id)
      expect(again.status).toBe(200)
      const result = TaskQueueSteer.Result.parse(await again.json())
      expect(result.receipt?.status).toBe("accepted")
      expect(result.receipt?.generation).toBe(generation)
      expect(result.item.payload.steeredInto).toBe(generation)
    },
  })
})

test("a steer admitted but never applied returns the row to the queue when the generation ends", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const item = await enqueueFollowUp(session.id, "do not lose me")
      const response = await steerRequest(app, tmp.path, item.id)
      expect(response.status).toBe(200)
      expect((await TaskQueue.get(item.id)).status).toBe("cancelled")

      // The turn ends (interrupt, provider error) before the next step boundary.
      SessionSteering.finish(session.id)

      const deadline = Date.now() + 5000
      let row = await TaskQueue.get(item.id)
      while (row.status === "cancelled" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        row = await TaskQueue.get(item.id)
      }
      expect(row.status).not.toBe("cancelled")
      expect(["queued", "waiting_for_idle", "running"]).toContain(row.status)
    },
  })
})

test("an apply before queue cancellation is stamped before the steer returns", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const controller = new AbortController()
      SessionSteering.begin(session.id, controller.signal)
      const item = await enqueueFollowUp(session.id, "apply while the queue row is held")
      const cancelSteered = TaskQueue.cancelSteered.bind(TaskQueue)
      vi.spyOn(TaskQueueSteer, "markSteeredApplied").mockResolvedValue(undefined)
      vi.spyOn(TaskQueue, "cancelSteered").mockImplementation(async (id, audit) => {
        const applied = await SessionSteering.drain(
          session.id,
          controller.signal,
          async ({ beforeCommit, afterCommit }) => {
            beforeCommit()
            afterCommit()
          },
        )
        expect(applied).toBe(true)
        return cancelSteered(id, audit)
      })

      const result = await TaskQueueSteer.steer(item.id)
      expect(result.receipt?.status).toBe("applied")
      const row = await TaskQueue.get(item.id)
      expect(row.status).toBe("cancelled")
      expect(row.payload["steeredAppliedAt"]).toBeTypeOf("number")
      const recovered = await TaskQueue.recoverInterrupted({ now: Date.now() + 120_000, livenessMs: 0 })
      expect(recovered.requeued.some((candidate) => candidate.id === item.id)).toBe(false)
    },
  })
})

test("an already applied steer is stamped in the cancellation write", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const controller = new AbortController()
      SessionSteering.begin(session.id, controller.signal)
      const item = await enqueueFollowUp(session.id, "already applied before cancellation")
      const submit = SessionPrompt.steer.bind(SessionPrompt)
      vi.spyOn(SessionPrompt, "steer").mockImplementation(async (sessionID, input) => {
        const receipt = await submit(sessionID, input)
        expect(
          await SessionSteering.drain(sessionID, controller.signal, async ({ beforeCommit, afterCommit }) => {
            beforeCommit()
            afterCommit()
          }),
        ).toBe(true)
        return receipt
      })
      const cancelSteered = TaskQueue.cancelSteered.bind(TaskQueue)
      const cancel = vi.spyOn(TaskQueue, "cancelSteered").mockImplementation(async (id, audit) => {
        expect(audit.steeredAppliedAt).toBeTypeOf("number")
        return cancelSteered(id, audit)
      })

      const result = await TaskQueueSteer.steer(item.id)
      expect(result.receipt?.status).toBe("applied")
      expect(cancel).toHaveBeenCalledOnce()
      expect((await TaskQueue.get(item.id)).payload["steeredAppliedAt"]).toBeTypeOf("number")
    },
  })
})

test("a generation ending before queue cancellation restores the held follow-up", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const item = await enqueueFollowUp(session.id, "return this after the turn ends")
      const cancelSteered = TaskQueue.cancelSteered.bind(TaskQueue)
      vi.spyOn(TaskQueue, "cancelSteered").mockImplementation(async (id, audit) => {
        SessionSteering.finish(session.id, { interrupted: true })
        return cancelSteered(id, audit)
      })

      const result = await TaskQueueSteer.steer(item.id)
      expect(result.receipt?.status).toBe("rejected")
      const row = await TaskQueue.get(item.id)
      expect(row.status).toBe("paused")
      expect(row.payload["steeredInto"]).toBeUndefined()
    },
  })
})

test("a steer whose apply fails mid-drain returns the row to the queue", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const controller = new AbortController()
      SessionSteering.begin(session.id, controller.signal)
      const item = await enqueueFollowUp(session.id, "apply failed, keep me")
      expect((await steerRequest(app, tmp.path, item.id)).status).toBe(200)
      expect((await TaskQueue.get(item.id)).status).toBe("cancelled")

      // The drain's apply throws before commit (e.g. the user-message write
      // fails), producing an application_rejected receipt; the admission
      // already cancelled the row, so the follow-up must be restored.
      const applied = await SessionSteering.drain(session.id, controller.signal, async () => {
        throw new Error("user message write failed")
      })
      expect(applied).toBe(false)

      const deadline = Date.now() + 5000
      let row = await TaskQueue.get(item.id)
      while (row.status === "cancelled" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        row = await TaskQueue.get(item.id)
      }
      expect(row.status).not.toBe("cancelled")
      expect(["queued", "waiting_for_idle", "running", "paused"]).toContain(row.status)
    },
  })
})

test("an interrupted generation parks the recovered follow-up instead of auto-starting it", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const controller = new AbortController()
      SessionSteering.begin(session.id, controller.signal)
      const item = await enqueueFollowUp(session.id, "park me on interrupt")
      expect((await steerRequest(app, tmp.path, item.id)).status).toBe(200)
      expect((await TaskQueue.get(item.id)).status).toBe("cancelled")

      // Production order: the run state finishes with the interrupt intent
      // before it aborts the controller, so the signal is still live here.
      expect(controller.signal.aborted).toBe(false)
      SessionSteering.finish(session.id, { interrupted: true })
      controller.abort()

      const deadline = Date.now() + 5000
      let row = await TaskQueue.get(item.id)
      while (row.status === "cancelled" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        row = await TaskQueue.get(item.id)
      }
      expect(row.status).toBe("paused")
    },
  })
})

test("steering an unknown or re-steered row fails cleanly", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)

      const missing = await steerRequest(app, tmp.path, TaskQueueID.ascending())
      expect(missing.status).toBe(404)

      const item = await enqueueFollowUp(session.id, "first steer wins")
      expect((await steerRequest(app, tmp.path, item.id)).status).toBe(200)
      const again = await steerRequest(app, tmp.path, item.id)
      expect(again.status).toBe(400)
      // The second attempt did not admit new content into the generation.
      expect(SessionSteering.view(session.id).receipts).toHaveLength(1)
    },
  })
})

test("a row paused between the steerable check and the hold still steers", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const item = await enqueueFollowUp(session.id, "paused mid-flight")

      // An interrupt sweep lands between the steer's initial read and its
      // hold: the first read still shows queued while the row is already
      // paused. The hold must tolerate the raced pause instead of failing
      // with a contradictory 409.
      const realGet = TaskQueue.get.bind(TaskQueue)
      let raced = false
      vi.spyOn(TaskQueue, "get").mockImplementation(async (id: TaskQueueID) => {
        const row = await realGet(id)
        if (!raced && row.id === item.id) {
          raced = true
          await TaskQueue.pause(id)
          return { ...row, status: "queued" as const }
        }
        return row
      })

      const response = await steerRequest(app, tmp.path, item.id)
      expect(response.status).toBe(200)
      const result = TaskQueueSteer.Result.parse(await response.json())
      expect(result.receipt?.status).toBe("accepted")
      expect(result.item.status).toBe("cancelled")
      expect((await TaskQueue.get(item.id)).status).toBe("cancelled")
    },
  })
})

test("a row paused between the steerable check and the hold stays paused when admission rejects it", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const generation = SessionSteering.view(session.id).generation!
      const item = await enqueueFollowUp(session.id, "paused mid-flight, then rejected")

      // An interrupt sweep lands between the steer's initial read and its
      // hold, exactly like the accepted-steer race above — but this time
      // admission rejects the text. The hold did not perform the pause, so
      // the rejection must leave the row paused: restore() resuming it would
      // un-pause and start work the steer never parked (ADR-106: interrupt
      // pauses remaining follow-ups).
      const realGet = TaskQueue.get.bind(TaskQueue)
      let raced = false
      vi.spyOn(TaskQueue, "get").mockImplementation(async (id: TaskQueueID) => {
        const row = await realGet(id)
        if (!raced && row.id === item.id) {
          raced = true
          await TaskQueue.pause(id)
          return { ...row, status: "queued" as const }
        }
        return row
      })
      vi.spyOn(SessionPrompt, "steer").mockResolvedValue({
        sessionID: session.id,
        generation,
        clientID: `tq_${item.id}_${generation.slice(0, 8)}_0`.slice(0, 100),
        status: "rejected",
        reason: "admission_rejected",
      })

      const result = await TaskQueueSteer.steer(item.id)
      expect(result.receipt?.status).toBe("rejected")
      // The raced pause owns the row's state; the rejected steer must not
      // have resumed or started it.
      const row = await TaskQueue.get(item.id)
      expect(row.status).toBe("paused")
    },
  })
})

test("the steering drain refreshes a steered follow-up's owner heartbeat at the step boundary", async () => {
  await using tmp = await tmpdir({ git: true })
  const app = Server.Default()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const controller = new AbortController()
      SessionSteering.begin(session.id, controller.signal)
      const item = await enqueueFollowUp(session.id, "heartbeat while pending")
      expect((await steerRequest(app, tmp.path, item.id)).status).toBe(200)
      expect((await TaskQueue.get(item.id)).status).toBe("cancelled")

      // At the step boundary the drain refreshes the cancelled row's owner
      // heartbeat while the steer is pending; the apply then stamps it
      // applied. Both writes are lazy, so poll for them.
      const applied = await SessionSteering.drain(session.id, controller.signal, async (steering) => {
        steering.beforeCommit()
        steering.afterCommit()
      })
      expect(applied).toBe(true)

      const deadline = Date.now() + 5000
      let row = await TaskQueue.get(item.id)
      while (
        (row.payload["steeredHeartbeatAt"] === undefined || row.payload["steeredAppliedAt"] === undefined) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        row = await TaskQueue.get(item.id)
      }
      expect(typeof row.payload["steeredHeartbeatAt"]).toBe("number")
      expect(typeof row.payload["steeredAppliedAt"]).toBe("number")
    },
  })
})

test("admission starts an owner-heartbeat interval that refreshes until the apply lands, then clears itself", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const controller = new AbortController()
      SessionSteering.begin(session.id, controller.signal)
      const generation = SessionSteering.view(session.id).generation!
      const item = await enqueueFollowUp(session.id, "heartbeat until applied")
      vi.spyOn(SessionPrompt, "steer").mockResolvedValue({
        sessionID: session.id,
        generation,
        clientID: "tq_probe",
        status: "accepted",
      })

      vi.useFakeTimers()
      try {
        const tick = vi.spyOn(TaskQueue, "steerHeartbeatTick")
        const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
        const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")

        const result = await TaskQueueSteer.steer(item.id)
        expect(result.receipt?.status).toBe("accepted")
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000)

        // Admission stamps the first owner heartbeat alongside the audit trail.
        const admitted = await TaskQueue.get(item.id)
        expect(admitted.status).toBe("cancelled")
        expect(typeof admitted.payload["steeredHeartbeatAt"]).toBe("number")
        const admissionBeat = admitted.payload["steeredHeartbeatAt"] as number

        // Each beat refreshes the cancelled row's heartbeat: the row's
        // admission is by now far older than the restart-recovery liveness
        // window, so only the beats keep recovery from requeueing it.
        await vi.advanceTimersByTimeAsync(30_000)
        expect(tick).toHaveBeenCalledTimes(1)
        const beat = await TaskQueue.get(item.id)
        expect(beat.payload["steeredHeartbeatAt"]).toBeGreaterThan(admissionBeat)

        // Once the apply lands, the next tick reports stop and the interval
        // clears itself without stamping again.
        await TaskQueue.markSteeredApplied(item.id, generation)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(tick).toHaveBeenCalledTimes(2)
        expect(clearIntervalSpy).toHaveBeenCalled()
        expect((await TaskQueue.get(item.id)).payload["steeredHeartbeatAt"]).toBe(beat.payload["steeredHeartbeatAt"])
      } finally {
        vi.useRealTimers()
      }
    },
  })
})

test("restoring a discarded steer clears its owner-heartbeat interval", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      SessionSteering.begin(session.id, new AbortController().signal)
      const generation = SessionSteering.view(session.id).generation!
      const item = await enqueueFollowUp(session.id, "restored after discard")
      vi.spyOn(SessionPrompt, "steer").mockResolvedValue({
        sessionID: session.id,
        generation,
        clientID: "tq_probe",
        status: "accepted",
      })
      expect((await TaskQueueSteer.steer(item.id)).receipt?.status).toBe("accepted")

      vi.useFakeTimers()
      try {
        const tick = vi.spyOn(TaskQueue, "steerHeartbeatTick")
        const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")

        // The generation ends (interrupt) before the apply: the discarded
        // receipt returns the row to the queue parked as paused, and the
        // restore takes the owner-heartbeat interval down with it.
        await TaskQueueSteer.reconcileDiscarded(
          session.id,
          [
            {
              sessionID: session.id,
              generation,
              clientID: `tq_${item.id}_${generation.slice(0, 8)}_abcdef123456`,
              status: "rejected",
              reason: "generation_ended_before_application",
            },
          ],
          { aborted: true },
        )
        expect((await TaskQueue.get(item.id)).status).toBe("paused")

        await vi.advanceTimersByTimeAsync(31_000)
        expect(tick).not.toHaveBeenCalled()
        expect(clearIntervalSpy).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    },
  })
})
