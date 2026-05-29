import { describe, expect, test } from "bun:test"
import { runLiveBackendQa } from "../src/performance/live-backend-qa"

describe("live backend QA harness", () => {
  test("validates bootstrap and event-stream window against an attached backend client", async () => {
    const result = await runLiveBackendQa({
      mode: "attach",
      baseUrl: "http://127.0.0.1:4096/",
      authHeader: "Bearer test",
      directory: "/workspace/ax-code",
      eventWindowMs: 100,
      client: {
        client: {
          session: {
            list: async () => ({
              data: [
                {
                  id: "ses_live_qa",
                  title: "Live QA session",
                  project: "ax-code",
                  updatedAt: 1,
                },
              ],
            }),
          },
        },
        taskQueue: {
          list: async () => [
            {
              id: "queue_live_qa",
              projectID: "ax-code",
              directory: "/workspace/ax-code",
              sessionID: "ses_live_qa",
              kind: "prompt",
              status: "queued",
              priority: 0,
              position: 0,
              title: "Live QA queued work",
              payload: {},
              time: { created: 1 },
            },
          ],
        },
        scheduledTask: {
          list: async () => [],
        },
        subscribe: async function* () {
          yield {
            type: "task.queue.updated",
            properties: {
              item: {
                id: "queue_live_qa",
                projectID: "ax-code",
                directory: "/workspace/ax-code",
                sessionID: "ses_live_qa",
                kind: "prompt",
                status: "running",
                priority: 0,
                position: 0,
                title: "Live QA queued work",
                payload: {},
                time: { created: 1 },
              },
            },
          }
        },
      },
    })

    expect(result).toMatchObject({
      mode: "attach",
      baseUrl: "http://127.0.0.1:4096",
      startedSidecar: false,
      bootstrap: {
        sessions: 1,
        queueItems: 1,
        visibleQueueItems: 1,
      },
      eventStream: {
        attempts: 1,
        appliedEvents: 1,
        statuses: ["connecting", "connected"],
      },
      diagnostics: {
        connected: true,
        streamObserved: true,
        withinRendererWindows: true,
      },
      withinBudget: true,
    })
  })

  test("reports an actionable error when attach mode cannot reach the backend", async () => {
    const failingFetch = (async () => {
      throw new Error("connection refused")
    }) as unknown as typeof fetch

    await expect(
      runLiveBackendQa({
        mode: "attach",
        baseUrl: "http://127.0.0.1:4096",
        eventWindowMs: 100,
        fetch: failingFetch,
      }),
    ).rejects.toThrow("Live backend QA could not reach http://127.0.0.1:4096. Start a loopback AX Code backend first")
  })

  test("starts and closes a sidecar when directory mode is requested", async () => {
    let closed = false
    let requestedPort: number | undefined
    const result = await runLiveBackendQa({
      mode: "start",
      directory: "/workspace/ax-code",
      eventWindowMs: 100,
      startBackend: async (options = {}) => {
        requestedPort = options.port
        return {
          url: `http://${options.hostname ?? "127.0.0.1"}:${options.port ?? 18456}`,
          headers: { Authorization: "Basic generated" },
          close: async () => {
            closed = true
          },
        }
      },
      client: {
        client: {
          session: {
            list: async () => ({ data: [] }),
          },
        },
        taskQueue: {
          list: async () => [],
        },
        scheduledTask: {
          list: async () => [],
        },
        subscribe: async function* () {
          return
        },
      },
    })

    expect(result.startedSidecar).toBe(true)
    expect(result.mode).toBe("start")
    expect(result.withinBudget).toBe(true)
    expect(requestedPort).toBeUndefined()
    expect(closed).toBe(true)
  })

  test("enforces representative live coverage thresholds when requested", async () => {
    const client = representativeClient({ messageCount: 60, queueItems: 2, scheduledTasks: 1 })
    const result = await runLiveBackendQa({
      mode: "attach",
      baseUrl: "http://127.0.0.1:4096",
      directory: "/workspace/ax-code",
      eventWindowMs: 100,
      representative: {
        minSessions: 1,
        minQueueItems: 2,
        minVisibleMessages: 50,
        minAppliedEvents: 60,
        minScheduledTasks: 1,
      },
      client,
    })

    expect(result.representative).toMatchObject({
      required: true,
      passed: true,
      checks: {
        sessions: { actual: 1, minimum: 1, passed: true },
        queueItems: { actual: 2, minimum: 2, passed: true },
        visibleMessages: { actual: 60, minimum: 50, passed: true },
        appliedEvents: { actual: 60, minimum: 60, passed: true },
        scheduledTasks: { actual: 1, minimum: 1, passed: true },
      },
    })
    expect(result.withinBudget).toBe(true)
  })

  test("fails the budget when representative live coverage is too small", async () => {
    const result = await runLiveBackendQa({
      mode: "attach",
      baseUrl: "http://127.0.0.1:4096",
      directory: "/workspace/ax-code",
      eventWindowMs: 100,
      representative: { minVisibleMessages: 50 },
      client: representativeClient({ messageCount: 4 }),
    })

    expect(result.representative.required).toBe(true)
    expect(result.representative.passed).toBe(false)
    expect(result.representative.checks.visibleMessages).toMatchObject({
      actual: 4,
      minimum: 50,
      passed: false,
    })
    expect(result.withinBudget).toBe(false)
  })

  test("uses a longer listed session for representative history coverage", async () => {
    const result = await runLiveBackendQa({
      mode: "attach",
      baseUrl: "http://127.0.0.1:4096",
      directory: "/workspace/ax-code",
      eventWindowMs: 100,
      representative: {
        minSessions: 2,
        minVisibleMessages: 50,
        minAppliedEvents: 1,
      },
      client: representativeHistoryClient(),
    })

    expect(result.bootstrap).toMatchObject({
      sessions: 2,
      visibleMessages: 60,
    })
    expect(result.representative.checks.visibleMessages).toMatchObject({
      actual: 60,
      minimum: 50,
      passed: true,
    })
    expect(result.withinBudget).toBe(true)
  })

  test("can validate attach mode against a harness-started sidecar", async () => {
    let closed = false
    let requestedPort: number | undefined
    const result = await runLiveBackendQa({
      mode: "attach",
      attachFromDirectory: "/workspace/ax-code",
      eventWindowMs: 100,
      startBackend: async (options = {}) => {
        requestedPort = options.port
        return {
          url: `http://${options.hostname ?? "127.0.0.1"}:${options.port ?? 18456}`,
          headers: { Authorization: "Basic generated" },
          close: async () => {
            closed = true
          },
        }
      },
      client: {
        client: {
          session: {
            list: async () => ({ data: [] }),
          },
        },
        taskQueue: {
          list: async () => [],
        },
        scheduledTask: {
          list: async () => [],
        },
        subscribe: async function* () {
          return
        },
      },
    })

    expect(result.mode).toBe("attach")
    expect(result.directory).toBe("/workspace/ax-code")
    expect(result.startedSidecar).toBe(false)
    expect(result.attachHarnessStartedSidecar).toBe(true)
    expect(result.withinBudget).toBe(true)
    expect(requestedPort).toBeUndefined()
    expect(closed).toBe(true)
  })
})

function representativeClient(input: { messageCount: number; queueItems?: number; scheduledTasks?: number }) {
  const sessionID = "ses_representative_qa"
  return {
    client: {
      session: {
        list: async () => ({
          data: [
            {
              id: sessionID,
              title: "Representative QA session",
              project: "ax-code",
              updatedAt: 1,
            },
          ],
        }),
      },
    },
    taskQueue: {
      list: async () =>
        Array.from({ length: input.queueItems ?? 0 }, (_, index) => ({
          id: `queue_representative_${index}`,
          projectID: "ax-code",
          directory: "/workspace/ax-code",
          sessionID,
          kind: "prompt",
          status: "queued",
          priority: 0,
          position: index,
          title: `Representative queue item ${index}`,
          payload: {},
          time: { created: index },
        })),
    },
    scheduledTask: {
      list: async () =>
        Array.from({ length: input.scheduledTasks ?? 0 }, (_, index) => ({
          id: `scheduled_representative_${index}`,
          projectID: "ax-code",
          title: `Representative scheduled task ${index}`,
          prompt: "Review the branch",
          schedule: { type: "daily", time: "09:00" },
          status: "active",
          nextRunAt: Date.now() + index * 60_000,
        })),
    },
    subscribe: async function* () {
      for (let index = 0; index < input.messageCount; index++) {
        yield {
          type: "message.updated",
          properties: {
            info: {
              id: `representative_message_${index}`,
              sessionID,
              role: index % 2 === 0 ? "user" : "assistant",
              createdAt: index,
            },
          },
        }
      }
    },
  }
}

function representativeHistoryClient() {
  const shortSessionID = "ses_short_qa"
  const longSessionID = "ses_long_qa"
  return {
    client: {
      session: {
        list: async () => ({
          data: [
            {
              id: shortSessionID,
              title: "Latest short session",
              project: "ax-code",
              updatedAt: 2,
            },
            {
              id: longSessionID,
              title: "Representative long session",
              project: "ax-code",
              updatedAt: 1,
            },
          ],
        }),
        messages: async ({ sessionID }: { sessionID: string }) => ({
          data: Array.from({ length: sessionID === longSessionID ? 60 : 4 }, (_, index) => ({
            info: {
              id: `${sessionID}_message_${index}`,
              sessionID,
              role: index % 2 === 0 ? "user" : "assistant",
              time: { created: index },
            },
            parts: [
              {
                id: `${sessionID}_part_${index}`,
                messageID: `${sessionID}_message_${index}`,
                type: "text",
                text: `history message ${index}`,
              },
            ],
          })),
        }),
      },
    },
    taskQueue: {
      list: async () => [],
    },
    scheduledTask: {
      list: async () => [],
    },
    subscribe: async function* () {
      yield { type: "server.heartbeat", properties: {} }
    },
  }
}
