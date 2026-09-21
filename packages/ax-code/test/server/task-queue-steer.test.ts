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
