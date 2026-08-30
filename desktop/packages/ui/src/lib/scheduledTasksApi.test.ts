import { beforeEach, describe, expect, test, vi } from "vitest"

const { getScopedApiClient, scheduledTask } = vi.hoisted(() => ({
  getScopedApiClient: vi.fn(),
  scheduledTask: {
    list: vi.fn(),
    listRuns: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    delete: vi.fn(),
    runNow: vi.fn(),
  },
}))

vi.mock("@/lib/ax-code/client", () => ({
  axCodeClient: { getScopedApiClient },
}))

import {
  createScheduledTasks,
  deleteScheduledTask,
  expandPromptSnippets,
  fetchScheduledTasks,
  runScheduledTaskNow,
  setScheduledTaskEnabled,
  updateScheduledTask,
} from "./scheduledTasksApi"

const runtimeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "st_1",
  projectID: "prj_1",
  directory: "/work/alpha",
  title: "Digest",
  prompt: "Summarize",
  schedule: { type: "daily", time: "09:00", timezone: "UTC" },
  status: "active",
  model: { providerID: "openai", modelID: "gpt-5" },
  catchUpPolicy: "run_once",
  nextRunAt: 100,
  time: { created: 1 },
  ...overrides,
})

describe("scheduledTasksApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getScopedApiClient.mockReturnValue({ scheduledTask })
  })

  test("fetchScheduledTasks scopes by directory and enriches with the latest run", async () => {
    scheduledTask.list.mockResolvedValue({ data: [runtimeTask()] })
    scheduledTask.listRuns.mockResolvedValue({
      data: [{ status: "failed", error: "model exploded", time: { created: 5 } }],
    })

    const tasks = await fetchScheduledTasks("/work/alpha")

    expect(getScopedApiClient).toHaveBeenCalledWith("/work/alpha")
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: "st_1",
      title: "Digest",
      status: "active",
      lastRunStatus: "error",
      lastError: "model exploded",
      nextRunAt: 100,
    })
  })

  test("fetchScheduledTasks degrades gracefully when run history fails", async () => {
    scheduledTask.list.mockResolvedValue({ data: [runtimeTask({ lastRunAt: 42 })] })
    scheduledTask.listRuns.mockRejectedValue(new Error("boom"))

    const tasks = await fetchScheduledTasks("/work/alpha")
    expect(tasks[0].lastRunStatus).toBe("success")
    expect(tasks[0].lastRunAt).toBe(42)
  })

  test("fetchScheduledTasks throws a readable error on list failure", async () => {
    scheduledTask.list.mockResolvedValue({ error: { message: "instance down" } })
    await expect(fetchScheduledTasks("/work/alpha")).rejects.toThrow("instance down")
  })

  test("fetchScheduledTasks requires a directory", async () => {
    await expect(fetchScheduledTasks(" ")).rejects.toThrow("directory is required")
  })

  test("createScheduledTasks creates each payload and pauses when requested", async () => {
    scheduledTask.create
      .mockResolvedValueOnce({ data: runtimeTask({ id: "st_a" }) })
      .mockResolvedValueOnce({ data: runtimeTask({ id: "st_b" }) })
    scheduledTask.pause.mockResolvedValue({ data: runtimeTask({ status: "paused" }) })

    await createScheduledTasks(
      "/work/alpha",
      [
        { title: "A", prompt: "p", schedule: { type: "daily", time: "09:00" }, catchUpPolicy: "run_once" },
        { title: "B", prompt: "p", schedule: { type: "daily", time: "18:00" }, catchUpPolicy: "run_once" },
      ],
      { pause: true },
    )

    expect(scheduledTask.create).toHaveBeenCalledTimes(2)
    expect(scheduledTask.pause).toHaveBeenCalledTimes(2)
    expect(scheduledTask.pause).toHaveBeenCalledWith({ scheduledTaskID: "st_a" })
  })

  test("updateScheduledTask forwards the patch to the runtime update route", async () => {
    scheduledTask.update.mockResolvedValue({ data: runtimeTask() })
    await updateScheduledTask("/work/alpha", "st_1", { title: "New", status: "paused" })
    expect(scheduledTask.update).toHaveBeenCalledWith({ scheduledTaskID: "st_1", title: "New", status: "paused" })
  })

  test("setScheduledTaskEnabled maps to pause/resume", async () => {
    scheduledTask.pause.mockResolvedValue({ data: runtimeTask({ status: "paused" }) })
    scheduledTask.resume.mockResolvedValue({ data: runtimeTask() })
    await setScheduledTaskEnabled("/work/alpha", "st_1", false)
    await setScheduledTaskEnabled("/work/alpha", "st_1", true)
    expect(scheduledTask.pause).toHaveBeenCalledWith({ scheduledTaskID: "st_1" })
    expect(scheduledTask.resume).toHaveBeenCalledWith({ scheduledTaskID: "st_1" })
  })

  test("deleteScheduledTask and runScheduledTaskNow surface runtime errors", async () => {
    scheduledTask.delete.mockResolvedValue({ error: { message: "not found" } })
    await expect(deleteScheduledTask("/work/alpha", "st_1")).rejects.toThrow("not found")

    scheduledTask.runNow.mockResolvedValue({ error: { message: "already running" } })
    await expect(runScheduledTaskNow("/work/alpha", "st_1")).rejects.toThrow("already running")
  })

  test("expandPromptSnippets expands #references and falls back on failure", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "expanded text" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      await expect(expandPromptSnippets("/work/alpha", "do #thing")).resolves.toBe("expanded text")
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toContain("snippets/expand")
      expect(url).toContain("directory=%2Fwork%2Falpha")
      expect((init?.headers as Record<string, string>)["x-ax-code-directory"]).toBe("/work/alpha")
    } finally {
      vi.unstubAllGlobals()
    }

    // No snippet reference: no request at all.
    const unused = vi.fn()
    vi.stubGlobal("fetch", unused)
    try {
      await expect(expandPromptSnippets("/work/alpha", "plain prompt")).resolves.toBe("plain prompt")
      expect(unused).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }

    // Endpoint failure: raw prompt preserved.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    )
    try {
      await expect(expandPromptSnippets("/work/alpha", "do #thing")).resolves.toBe("do #thing")
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
