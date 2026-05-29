import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskQueue } from "../../src/session/task-queue"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("task queue routes", () => {
  test("create, list, update, and delete project-scoped queue items", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

        const createdResponse = await app.request(`/task-queue?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionID: session.id,
            kind: "prompt",
            title: "Queue a route-level task",
            payload: { prompt: "ship gui" },
          }),
        })
        expect(createdResponse.status).toBe(200)
        const created = (await createdResponse.json()) as { id: string; sessionID: string; status: string }
        expect(created.id).toStartWith("tsk_")
        expect(created.sessionID).toBe(session.id)
        expect(created.status).toBe("queued")

        const listResponse = await app.request(`/task-queue?${directoryQuery}&sessionID=${created.sessionID}`)
        expect(listResponse.status).toBe(200)
        const list = (await listResponse.json()) as Array<{ id: string }>
        expect(list.map((item) => item.id)).toEqual([created.id])

        const statusResponse = await app.request(`/task-queue/${created.id}/status?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "blocked_permission", error: "approval required" }),
        })
        expect(statusResponse.status).toBe(200)
        expect(await statusResponse.json()).toMatchObject({
          id: created.id,
          status: "blocked_permission",
          error: "approval required",
        })

        const retryResponse = await app.request(`/task-queue/${created.id}/retry?${directoryQuery}`, {
          method: "POST",
        })
        expect(retryResponse.status).toBe(200)
        expect(await retryResponse.json()).toMatchObject({ id: created.id, status: "queued" })

        const sendNowResponse = await app.request(`/task-queue/${created.id}/send-now?${directoryQuery}`, {
          method: "POST",
        })
        expect(sendNowResponse.status).toBe(200)
        expect(await sendNowResponse.json()).toMatchObject({ id: created.id, status: "queued", position: 0 })

        const deleteResponse = await app.request(`/task-queue/${created.id}?${directoryQuery}`, {
          method: "DELETE",
        })
        expect(deleteResponse.status).toBe(200)
        expect(await deleteResponse.json()).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("async command route records backend task lifecycle in the server queue", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    let releaseCommand!: () => void

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const commandSpy = spyOn(SessionPrompt, "command").mockImplementation(async () => {
          await new Promise<void>((resolve) => {
            releaseCommand = resolve
          })
          return {} as any
        })

        try {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          const accepted = await app.request(`/session/${session.id}/command_async?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              command: "debug",
              arguments: "queue lifecycle",
            }),
          })

          expect(accepted.status).toBe(202)
          const running = await waitForQueueStatus("running")
          expect(running).toMatchObject({
            sessionID: session.id,
            kind: "command",
            title: "debug queue lifecycle",
            status: "running",
          })

          releaseCommand()
          const completed = await waitForQueueStatus("completed")
          expect(completed.id).toBe(running.id)
          expect(completed.time.completed).toBeDefined()
        } finally {
          commandSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("send-now executes a manually queued prompt item through session runtime", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    const promptInputs: SessionPrompt.PromptInput[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation((async (
          input: SessionPrompt.PromptInput,
        ) => {
          promptInputs.push(input)
          return {} as any
        }) as any)

        try {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          const createdResponse = await app.request(`/task-queue?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionID: session.id,
              kind: "prompt",
              title: "Run queued GUI prompt",
              agent: "build",
              model: { providerID: "openai", modelID: "gpt-5-codex" },
              payload: {
                source: "app.composer",
                mode: "prompt",
                text: "ship the desktop queue executor",
              },
            }),
          })
          expect(createdResponse.status).toBe(200)
          const created = (await createdResponse.json()) as { id: string }

          const sendNowResponse = await app.request(`/task-queue/${created.id}/send-now?${directoryQuery}`, {
            method: "POST",
          })
          expect(sendNowResponse.status).toBe(200)
          expect(await sendNowResponse.json()).toMatchObject({ id: created.id, status: "running" })

          const completed = await waitForQueueStatus("completed")
          expect(String(completed.id)).toBe(created.id)
          expect(promptInputs).toHaveLength(1)
          expect(promptInputs[0]).toMatchObject({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-5-codex" },
            parts: [{ type: "text", text: "ship the desktop queue executor" }],
          })
        } finally {
          promptSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("async command completion drains the next queued prompt for the same session", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    let releaseCommand!: () => void
    const promptInputs: SessionPrompt.PromptInput[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const commandSpy = spyOn(SessionPrompt, "command").mockImplementation(async () => {
          await new Promise<void>((resolve) => {
            releaseCommand = resolve
          })
          return {} as any
        })
        const promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation((async (
          input: SessionPrompt.PromptInput,
        ) => {
          promptInputs.push(input)
          return {} as any
        }) as any)

        try {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          const accepted = await app.request(`/session/${session.id}/command_async?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              command: "debug",
              arguments: "queue drain",
            }),
          })

          expect(accepted.status).toBe(202)
          await waitForQueueStatus("running")

          const queuedResponse = await app.request(`/task-queue?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionID: session.id,
              kind: "prompt",
              title: "Queued follow-up",
              payload: { text: "continue after command" },
            }),
          })
          expect(queuedResponse.status).toBe(200)
          const queued = (await queuedResponse.json()) as { id: string; status: string }
          expect(queued.status).toBe("queued")

          releaseCommand()
          const completed = await waitForQueueItemStatus(queued.id, "completed")
          expect(completed.kind).toBe("prompt")
          expect(promptInputs).toHaveLength(1)
          expect(promptInputs[0]).toMatchObject({
            sessionID: session.id,
            parts: [{ type: "text", text: "continue after command" }],
          })
        } finally {
          commandSpy.mockRestore()
          promptSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("send-now waits for idle when the target session already has a running queue item", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    let releaseCommand!: () => void
    const promptInputs: SessionPrompt.PromptInput[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const commandSpy = spyOn(SessionPrompt, "command").mockImplementation(async () => {
          await new Promise<void>((resolve) => {
            releaseCommand = resolve
          })
          return {} as any
        })
        const promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation((async (
          input: SessionPrompt.PromptInput,
        ) => {
          promptInputs.push(input)
          return {} as any
        }) as any)

        try {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          const accepted = await app.request(`/session/${session.id}/command_async?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              command: "debug",
              arguments: "busy send now",
            }),
          })

          expect(accepted.status).toBe(202)
          await waitForQueueStatus("running")

          const createdResponse = await app.request(`/task-queue?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionID: session.id,
              kind: "prompt",
              title: "Send after idle",
              payload: { text: "wait until the current run settles" },
            }),
          })
          expect(createdResponse.status).toBe(200)
          const created = (await createdResponse.json()) as { id: string }

          const sendNowResponse = await app.request(`/task-queue/${created.id}/send-now?${directoryQuery}`, {
            method: "POST",
          })
          expect(sendNowResponse.status).toBe(200)
          expect(await sendNowResponse.json()).toMatchObject({ id: created.id, status: "waiting_for_idle" })
          expect(promptInputs).toHaveLength(0)

          releaseCommand()
          const completed = await waitForQueueItemStatus(created.id, "completed")
          expect(completed.kind).toBe("prompt")
          expect(promptInputs).toHaveLength(1)
        } finally {
          commandSpy.mockRestore()
          promptSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("async prompt route marks queue item failed when detached work fails", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const promptSpy = spyOn(SessionPrompt, "prompt").mockRejectedValue(new Error("model failed"))

        try {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          const accepted = await app.request(`/session/${session.id}/prompt_async?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: "please fail" }],
            }),
          })

          expect(accepted.status).toBe(202)
          const failed = await waitForQueueStatus("failed")
          expect(failed).toMatchObject({
            sessionID: session.id,
            kind: "prompt",
            title: "please fail",
            status: "failed",
            error: "model failed",
          })
        } finally {
          promptSpy.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })
})

async function waitForQueueStatus(status: TaskQueue.Status) {
  for (let i = 0; i < 20; i++) {
    const item = (await TaskQueue.list()).find((entry) => entry.status === status)
    if (item) return item
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for task queue status: ${status}`)
}

async function waitForQueueItemStatus(id: string, status: TaskQueue.Status) {
  for (let i = 0; i < 30; i++) {
    const item = (await TaskQueue.list()).find((entry) => entry.id === id)
    if (item?.status === status) return item
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for task queue item ${id} status: ${status}`)
}
