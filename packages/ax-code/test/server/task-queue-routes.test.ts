import { afterEach, describe, expect, test, vi } from "vitest"
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

        const emptyCreatePriorityResponse = await app.request(`/task-queue?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionID: session.id,
            kind: "automation",
            title: "Queue an empty-priority task",
            priority: "",
          }),
        })
        expect(emptyCreatePriorityResponse.status).toBe(400)

        const createdResponse = await app.request(`/task-queue?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionID: session.id,
            kind: "automation",
            title: "Queue a route-level task",
            worktree: "wt-route",
            payload: { prompt: "ship gui" },
            priority: "5",
          }),
        })
        expect(createdResponse.status).toBe(200)
        const created = (await createdResponse.json()) as {
          id: string
          sessionID: string
          status: string
          worktree?: string
          priority: number
        }
        expect(created.id).toStartWith("tsk_")
        expect(created.sessionID).toBe(session.id)
        expect(created.status).toBe("queued")
        expect(created.worktree).toBe("wt-route")
        expect(created.priority).toBe(5)

        const listResponse = await app.request(`/task-queue?${directoryQuery}&sessionID=${created.sessionID}`)
        expect(listResponse.status).toBe(200)
        const list = (await listResponse.json()) as Array<{ id: string; worktree?: string }>
        expect(list.map((item) => item.id)).toEqual([created.id])
        expect(list[0]?.worktree).toBe("wt-route")

        const editResponse = await app.request(`/task-queue/${created.id}/edit?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Edited route-level task",
            worktree: null,
            payload: { prompt: "ship edited gui" },
            priority: "3",
          }),
        })
        expect(editResponse.status).toBe(200)
        expect(await editResponse.json()).toMatchObject({
          id: created.id,
          title: "Edited route-level task",
          payload: { prompt: "ship edited gui" },
          priority: 3,
        })

        const emptyEditPriorityResponse = await app.request(`/task-queue/${created.id}/edit?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priority: "" }),
        })
        expect(emptyEditPriorityResponse.status).toBe(400)

        const externalStatusResponse = await app.request(`/task-queue/${created.id}/status?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "running" }),
        })
        expect(externalStatusResponse.status).toBe(400)

        const statusResponse = await app.request(`/task-queue/${created.id}/status?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-ax-code-internal-task-queue-lifecycle": "1" },
          body: JSON.stringify({ status: "blocked_permission", error: "approval required" }),
        })
        expect(statusResponse.status).toBe(200)
        expect(await statusResponse.json()).toMatchObject({
          id: created.id,
          status: "blocked_permission",
          error: "approval required",
        })

        const blockedRetryResponse = await app.request(`/task-queue/${created.id}/retry?${directoryQuery}`, {
          method: "POST",
        })
        expect(blockedRetryResponse.status).toBe(409)

        const failedStatusResponse = await app.request(`/task-queue/${created.id}/status?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-ax-code-internal-task-queue-lifecycle": "1" },
          body: JSON.stringify({ status: "failed", error: "model failed" }),
        })
        expect(failedStatusResponse.status).toBe(200)

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

        const reorderResponse = await app.request(`/task-queue/${created.id}/reorder?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ position: "0" }),
        })
        expect(reorderResponse.status).toBe(200)
        expect(await reorderResponse.json()).toMatchObject({ id: created.id, position: 0 })

        const emptyReorderResponse = await app.request(`/task-queue/${created.id}/reorder?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ position: "" }),
        })
        expect(emptyReorderResponse.status).toBe(400)

        const deleteResponse = await app.request(`/task-queue/${created.id}?${directoryQuery}`, {
          method: "DELETE",
        })
        expect(deleteResponse.status).toBe(200)
        expect(await deleteResponse.json()).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("recovers interrupted queue items when the backend instance restarts", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`

    const create = async (title: string) => {
      const response = await app.request(`/task-queue?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "prompt", title, payload: { prompt: title } }),
      })
      expect(response.status).toBe(200)
      return (await response.json()) as { id: string }
    }
    const setStatus = async (id: string, status: string) => {
      const response = await app.request(`/task-queue/${id}/status?${directoryQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ax-code-internal-task-queue-lifecycle": "1" },
        body: JSON.stringify({ status }),
      })
      expect(response.status).toBe(200)
    }

    const running = await create("Interrupted prompt")
    const waiting = await create("Waiting prompt")
    await setStatus(running.id, "running")
    await setStatus(waiting.id, "waiting_for_idle")

    await Instance.disposeAll()

    const listResponse = await app.request(`/task-queue?${directoryQuery}`)
    expect(listResponse.status).toBe(200)
    const list = (await listResponse.json()) as Array<{ id: string; status: string; error?: string }>
    expect(list.find((item) => item.id === running.id)).toMatchObject({
      status: "failed",
      error: "Task interrupted by backend restart; inspect output and retry when safe.",
    })
    expect(list.find((item) => item.id === waiting.id)).toMatchObject({
      status: "queued",
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
        const commandSpy = vi.spyOn(SessionPrompt, "command").mockImplementation(async () => {
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

          const release = await waitForRouteValue(() => releaseCommand)
          release()
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
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (
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
        const commandSpy = vi.spyOn(SessionPrompt, "command").mockImplementation(async () => {
          await new Promise<void>((resolve) => {
            releaseCommand = resolve
          })
          return {} as any
        })
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (
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

          const release = await waitForRouteValue(() => releaseCommand)
          release()
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

  test("async prompt route waits behind the active queue item for the same session", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    let releaseFirst!: () => void
    const promptInputs: SessionPrompt.PromptInput[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (
          input: SessionPrompt.PromptInput,
        ) => {
          promptInputs.push(input)
          if (promptInputs.length === 1) {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve
            })
          }
          return {} as any
        }) as any)

        try {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          const firstResponse = await app.request(`/session/${session.id}/prompt_async?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: "first async prompt" }],
            }),
          })
          expect(firstResponse.status).toBe(202)
          await waitForQueueTitleStatus("first async prompt", "running")

          const secondResponse = await app.request(`/session/${session.id}/prompt_async?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: "second async prompt" }],
            }),
          })
          expect(secondResponse.status).toBe(202)
          await waitForQueueTitleStatus("second async prompt", "waiting_for_idle")
          const release = await waitForRouteValue(() => releaseFirst)
          expect(promptInputs).toHaveLength(1)

          release()
          await waitForQueueTitleStatus("first async prompt", "completed")
          await waitForQueueTitleStatus("second async prompt", "completed")
          expect(promptInputs).toHaveLength(2)
          expect(promptInputs[1]).toMatchObject({
            sessionID: session.id,
            parts: [{ type: "text", text: "second async prompt" }],
          })
        } finally {
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
        const commandSpy = vi.spyOn(SessionPrompt, "command").mockImplementation(async () => {
          await new Promise<void>((resolve) => {
            releaseCommand = resolve
          })
          return {} as any
        })
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (
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

          const release = await waitForRouteValue(() => releaseCommand)
          release()
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
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockRejectedValue(new Error("model failed"))

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

async function waitForQueueTitleStatus(title: string, status: TaskQueue.Status) {
  for (let i = 0; i < 30; i++) {
    const item = (await TaskQueue.list()).find((entry) => entry.title === title)
    if (item?.status === status) return item
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for task queue item titled ${title} status: ${status}`)
}

async function waitForRouteValue<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 30; i++) {
    const value = read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for route test value")
}
