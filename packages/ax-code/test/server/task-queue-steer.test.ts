import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
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
