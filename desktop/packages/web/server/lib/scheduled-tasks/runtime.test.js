import { describe, expect, it, vi } from "vitest"
import {
  computeNextRunAt,
  createScheduledTasksRuntime,
  formatScheduledSessionTitle,
  parseScheduledCommandPrompt,
} from "./runtime.js"

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const scheduledTask = (overrides = {}) => ({
  id: "task-1",
  name: "Nightly review",
  enabled: true,
  catchUpPolicy: "run_once",
  schedule: {
    kind: "daily",
    times: ["23:59"],
    timezone: "UTC",
  },
  execution: {
    prompt: "Review the project",
    providerID: "openai",
    modelID: "gpt-4.1",
  },
  state: {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastStatus: "idle",
  },
  ...overrides,
})

const createRuntimeHarness = ({ task = scheduledTask(), fetchImpl, failStatePatch } = {}) => {
  let currentTask = task
  const stateUpdates = []
  let settledResolve
  const settled = new Promise((resolve) => {
    settledResolve = resolve
  })
  const createSession = vi.fn(async () => ({ data: { id: "ses_desktop" } }))
  const projectConfigRuntime = {
    listScheduledTasks: vi.fn(async () => [currentTask]),
    updateScheduledTaskState: vi.fn(async (_projectID, _taskID, patch) => {
      stateUpdates.push(patch)
      if (failStatePatch?.(patch)) throw new Error("state write failed")
      const state = { ...currentTask.state, ...patch }
      for (const [key, value] of Object.entries(state)) {
        if (value === undefined) delete state[key]
      }
      currentTask = { ...currentTask, state }
      if (patch.lastStatus === "success" || patch.lastStatus === "error") settledResolve(currentTask)
      return { task: currentTask, tasks: [currentTask] }
    }),
    upsertScheduledTask: vi.fn(async (_projectID, next) => {
      currentTask = next
      return { task: currentTask, tasks: [currentTask] }
    }),
  }
  const runtime = createScheduledTasksRuntime({
    projectConfigRuntime,
    listProjects: async () => [{ id: "project-1", path: "/tmp/project-1" }],
    buildAxCodeUrl: () => "http://127.0.0.1:4096/",
    getAxCodeAuthHeaders: () => ({ authorization: "Basic test" }),
    waitForAxCodeReady: async () => {},
    emitTaskRunEvent: () => {},
    logger: { info: () => {}, warn: () => {} },
    maxRunDurationMs: 10_000,
    queuePollIntervalMs: 0,
    wait: async () => {},
    fetchImpl,
    createClient: () => ({
      session: { create: createSession },
      command: { list: async () => ({ data: [] }) },
    }),
  })
  return {
    runtime,
    projectConfigRuntime,
    createSession,
    stateUpdates,
    settled,
    getTask: () => currentTask,
  }
}

describe("scheduled-tasks runtime helpers", () => {
  it("computes next daily run in timezone", () => {
    const nowUtc = Date.UTC(2025, 0, 1, 8, 0, 0)
    const next = computeNextRunAt(
      {
        enabled: true,
        schedule: {
          kind: "daily",
          times: ["09:30"],
          timezone: "UTC",
        },
      },
      nowUtc,
    )

    expect(next).toBe(Date.UTC(2025, 0, 1, 9, 30, 0))
  })

  it("trims schedule timezone before computing and formatting", () => {
    const nowUtc = Date.UTC(2025, 0, 1, 8, 0, 0)
    const schedule = {
      kind: "daily",
      times: ["09:30"],
      timezone: " UTC ",
    }

    expect(computeNextRunAt({ enabled: true, schedule }, nowUtc)).toBe(Date.UTC(2025, 0, 1, 9, 30, 0))
    expect(formatScheduledSessionTitle({ name: " Morning Sync ", schedule }, nowUtc)).toBe(
      "Morning Sync 2025-01-01 08:00",
    )
  })

  it("computes weekly next run using weekdays", () => {
    // Monday 2025-01-06 10:00:00 UTC
    const nowUtc = Date.UTC(2025, 0, 6, 10, 0, 0)
    const next = computeNextRunAt(
      {
        enabled: true,
        schedule: {
          kind: "weekly",
          times: ["09:00"],
          weekdays: [1, 3],
          timezone: "UTC",
        },
      },
      nowUtc,
    )

    // Wednesday 2025-01-08 09:00:00 UTC
    expect(next).toBe(Date.UTC(2025, 0, 8, 9, 0, 0))
  })

  it("picks nearest time from multiple daily times", () => {
    const nowUtc = Date.UTC(2025, 0, 1, 9, 20, 0)
    const next = computeNextRunAt(
      {
        enabled: true,
        schedule: {
          kind: "daily",
          times: ["09:15", "09:45", "18:00"],
          timezone: "UTC",
        },
      },
      nowUtc,
    )

    expect(next).toBe(Date.UTC(2025, 0, 1, 9, 45, 0))
  })

  it("computes one-time next run for future date", () => {
    const nowUtc = Date.UTC(2026, 3, 15, 10, 0, 0)
    const next = computeNextRunAt(
      {
        enabled: true,
        schedule: {
          kind: "once",
          date: "2026-04-16",
          time: "13:30",
          timezone: "UTC",
        },
      },
      nowUtc,
    )

    expect(next).toBe(Date.UTC(2026, 3, 16, 13, 30, 0))
  })

  it("returns null for past one-time schedule", () => {
    const nowUtc = Date.UTC(2026, 3, 16, 14, 0, 0)
    const next = computeNextRunAt(
      {
        enabled: true,
        schedule: {
          kind: "once",
          date: "2026-04-16",
          time: "13:30",
          timezone: "UTC",
        },
      },
      nowUtc,
    )

    expect(next).toBeNull()
  })

  it("formats session title with timestamp suffix", () => {
    const title = formatScheduledSessionTitle(
      {
        name: "Morning Sync",
        schedule: { timezone: "UTC" },
      },
      Date.UTC(2025, 2, 10, 7, 5, 0),
    )

    expect(title).toBe("Morning Sync 2025-03-10 07:05")
  })

  it("parses slash command prompt for scheduled command mode", () => {
    expect(parseScheduledCommandPrompt("/review src/components")).toEqual({
      command: "review",
      arguments: "src/components",
    })
  })

  it("returns null when prompt is not a slash command", () => {
    expect(parseScheduledCommandPrompt("Summarize open issues")).toBeNull()
    expect(parseScheduledCommandPrompt("/")).toBeNull()
  })
})

describe("scheduled-tasks durable execution", () => {
  it("holds the running slot until the accepted core queue item completes", async () => {
    let finishQueue
    const terminal = new Promise((resolve) => {
      finishQueue = resolve
    })
    const fetchImpl = vi.fn(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ id: "que_desktop", status: "running", sessionID: "ses_desktop" }, 202)
      }
      await terminal
      return jsonResponse({ id: "que_desktop", status: "completed", sessionID: "ses_desktop" })
    })
    const harness = createRuntimeHarness({ fetchImpl })
    await harness.runtime.start()

    const pending = harness.runtime.runNow("project-1", "task-1")
    while (!fetchImpl.mock.calls.some(([, init]) => init?.method === "GET")) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(harness.runtime.getStatus().runningScheduledTasksCount).toBe(1)
    const acceptedUrl = new URL(fetchImpl.mock.calls.find(([, init]) => init?.method === "POST")[0])
    expect(acceptedUrl.searchParams.get("executionTimeoutMs")).toBe("10000")
    expect(acceptedUrl.searchParams.get("sourceTaskID")).toBe("desktop:task-1")
    expect(acceptedUrl.searchParams.get("resumeOnRestart")).toBe("true")

    finishQueue()
    await expect(pending).resolves.toMatchObject({ ok: true, sessionID: "ses_desktop" })
    expect(harness.runtime.getStatus().runningScheduledTasksCount).toBe(0)
    expect(harness.getTask().state.activeQueueItemId).toBeUndefined()
    harness.runtime.stop()
  })

  it("coalesces an overdue occurrence into one run on startup", async () => {
    const fetchImpl = vi.fn(async (_url, init) =>
      init?.method === "POST"
        ? jsonResponse({ id: "que_catchup", status: "running", sessionID: "ses_desktop" }, 202)
        : jsonResponse({ id: "que_catchup", status: "completed", sessionID: "ses_desktop" }),
    )
    const task = scheduledTask({
      state: {
        createdAt: Date.now() - 120_000,
        updatedAt: Date.now() - 120_000,
        lastStatus: "idle",
        nextRunAt: Date.now() - 60_000,
      },
    })
    const harness = createRuntimeHarness({ task, fetchImpl })

    await harness.runtime.start()
    await harness.settled

    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
    expect(harness.getTask().state.lastStatus).toBe("success")
    harness.runtime.stop()
  })

  it("reconciles a persisted queue handle without submitting duplicate work", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: "que_existing", status: "completed", sessionID: "ses_existing" }),
    )
    const task = scheduledTask({
      state: {
        createdAt: Date.now() - 120_000,
        updatedAt: Date.now() - 1_000,
        lastStatus: "running",
        lastSessionId: "ses_existing",
        activeQueueItemId: "que_existing",
        activeRunReason: "scheduled",
      },
    })
    const harness = createRuntimeHarness({ task, fetchImpl })

    await harness.runtime.start()
    await harness.settled

    expect(harness.createSession).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("GET")
    expect(harness.getTask().state.activeQueueItemId).toBeUndefined()
    harness.runtime.stop()
  })

  it("releases concurrency when final state persistence fails", async () => {
    const fetchImpl = vi.fn(async (_url, init) =>
      init?.method === "POST"
        ? jsonResponse({ id: "que_cleanup", status: "running", sessionID: "ses_desktop" }, 202)
        : jsonResponse({ id: "que_cleanup", status: "completed", sessionID: "ses_desktop" }),
    )
    const harness = createRuntimeHarness({
      fetchImpl,
      failStatePatch: (patch) => patch.lastStatus === "success",
    })
    await harness.runtime.start()

    await expect(harness.runtime.runNow("project-1", "task-1")).rejects.toThrow("state write failed")
    expect(harness.runtime.getStatus().runningScheduledTasksCount).toBe(0)
    harness.runtime.stop()
  })
})
