import { describe, expect, test, vi } from "vitest"

import type { ScheduledTask } from "@/lib/scheduledTasksApi"
import { loadCurrentScheduledTaskList } from "./scheduledTaskListLoad"

const task: ScheduledTask = {
  id: "task-1",
  directory: "/work/alpha",
  title: "Daily summary",
  status: "active",
  schedule: {
    type: "daily",
    time: "09:00",
    timezone: "UTC",
  },
  prompt: "Summarize open work",
  model: { providerID: "openai", modelID: "gpt-5" },
  catchUpPolicy: "run_once",
  lastRunStatus: "idle",
  time: {
    created: 1,
    updated: 2,
  },
}

describe("loadCurrentScheduledTaskList", () => {
  test("returns tasks for the current request", async () => {
    await expect(
      loadCurrentScheduledTaskList({
        load: vi.fn(async () => [task]),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "loaded", tasks: [task] })
  })

  test("returns current request errors", async () => {
    const error = new Error("load failed")

    await expect(
      loadCurrentScheduledTaskList({
        load: vi.fn(async () => {
          throw error
        }),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "failed", error })
  })

  test("suppresses stale task list responses", async () => {
    await expect(
      loadCurrentScheduledTaskList({
        load: vi.fn(async () => [task]),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses errors from stale task list requests", async () => {
    await expect(
      loadCurrentScheduledTaskList({
        load: vi.fn(async () => {
          throw new Error("project changed")
        }),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
