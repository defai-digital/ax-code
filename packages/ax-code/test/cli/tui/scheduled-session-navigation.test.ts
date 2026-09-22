import { describe, expect, test } from "vitest"
import type { Session, TaskQueueGetResponse } from "@ax-code/sdk/v2"
import type {
  ScheduledTaskInfo,
  ScheduledTaskRunInfo,
} from "../../../src/cli/tui/component/dialog-scheduled-task-view-model"
import {
  scheduledNavigationRun,
  scheduledSessionBuckets,
  scheduledSessionKey,
  scheduledSessionLinks,
} from "../../../src/cli/tui/component/scheduled-session-navigation"

function task(overrides: Partial<ScheduledTaskInfo> = {}): ScheduledTaskInfo {
  return { id: "task", title: "Tokyo weather check", status: "active", ...overrides } as ScheduledTaskInfo
}
function item(status: TaskQueueGetResponse["status"], sessionID?: string): TaskQueueGetResponse {
  return { status, sessionID } as TaskQueueGetResponse
}
const sessions = [{ id: "session" }] as Session[]
function rows(overrides: Partial<ScheduledTaskInfo> = {}, status?: TaskQueueGetResponse["status"]) {
  return scheduledSessionLinks(
    [task(overrides)],
    status ? new Map([["q", item(status, "session")]]) : new Map(),
    sessions,
  )
}

describe("scheduled task lifetime navigation", () => {
  test.each([
    { type: "cron", expression: "*/5 * * * *" },
    { type: "daily", time: "09:00" },
    { type: "weekly", day: 1, time: "09:00" },
  ] as const)("marks $type schedules with R only in Running", (schedule) => {
    expect(rows({ schedule })[0].taskTitle).toBe("Tokyo weather check")
    const started = { schedule, lastQueueID: "q", lastRunAt: 10 }
    expect(rows(started, "running")[0].taskTitle).toBe("R Tokyo weather check")
    expect(rows(started, "completed")[0].taskTitle).toBe("R Tokyo weather check")
    expect(rows({ ...started, status: "disabled" }, "completed")[0].taskTitle).toBe("Tokyo weather check")
    expect(rows({ ...started, schedule: { type: "once", runAt: 10 } }, "running")[0].taskTitle).toBe(
      "Tokyo weather check",
    )
  })

  test("a five-minute schedule stays Running between occurrences until the schedule ends", () => {
    const start = 1_790_112_644_000
    const recurring = task({ schedule: { type: "cron", expression: "*/5 * * * *" }, nextRunAt: start })
    expect(rows(recurring)[0].phase).toBe("new")
    const fired = { ...recurring, lastQueueID: "q", lastRunAt: start, nextRunAt: start + 300_000 }
    expect(rows(fired, "running")[0]).toMatchObject({ phase: "running", detail: "running" })
    const waiting = rows(fired, "completed")
    expect(waiting).toHaveLength(1)
    expect(waiting[0]).toMatchObject({ phase: "running", detail: "Waiting for next run" })
    expect(waiting[0].scheduleDetail).toMatch(/^Next /)
    expect(scheduledSessionBuckets(waiting, new Set())).toEqual({ new: [], running: waiting, done: [] })
    const next = { ...fired, lastRunAt: start + 300_000, nextRunAt: start + 600_000 }
    expect(rows(next, "queued")[0].phase).toBe("running")
    expect(rows(next, "running")[0].phase).toBe("running")
    expect(rows(next, "completed")[0].phase).toBe("running")
    const ended = rows({ ...next, status: "disabled", nextRunAt: undefined }, "completed")
    expect(scheduledSessionBuckets(ended, new Set())).toEqual({ new: [], running: [], done: ended })
    expect(scheduledSessionBuckets(ended, new Set(ended.map(scheduledSessionKey))).done).toEqual([])
  })

  test.each([
    "queued",
    "waiting_for_idle",
    "running",
    "blocked_permission",
    "blocked_question",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ] as const)("an active started schedule stays Running with queue status %s", (status) => {
    expect(rows({ lastQueueID: "q", lastRunAt: 10 }, status)[0].phase).toBe("running")
  })

  test("paused schedules preserve whether they have ever started", () => {
    expect(rows({ status: "paused" })[0]).toMatchObject({ phase: "new", detail: "Schedule paused" })
    expect(rows({ status: "paused", lastQueueID: "q", lastRunAt: 10 }, "completed")[0]).toMatchObject({
      phase: "running",
      detail: "Schedule paused",
    })
    expect(rows({ status: "paused", lastQueueID: "q", lastRunAt: 10 }, "running")[0]).toMatchObject({
      phase: "running",
      scheduleDetail: "Schedule paused",
    })
  })

  test("disabled schedules enter Done only after an outstanding run has ended", () => {
    expect(rows({ status: "disabled", lastQueueID: "q", lastRunAt: 10 }, "running")[0].phase).toBe("running")
    expect(rows({ status: "disabled", lastQueueID: "q", lastRunAt: 10 }, "cancelled")[0].phase).toBe("done")
    expect(rows({ status: "disabled" })[0].phase).toBe("done")
    expect(rows({ status: "disabled", lastQueueID: "missing", lastRunAt: 10 })[0]).toMatchObject({
      phase: "running",
      detail: "Status unavailable",
    })
  })

  test("one-time failures awaiting retries remain Running until disabled", () => {
    const retry = { lastRunAt: 10, lastQueueID: "q", nextRunAt: 20 }
    expect(rows(retry, "failed")[0]).toMatchObject({ phase: "running", detail: "Last run: failed" })
    expect(rows({ ...retry, status: "disabled", nextRunAt: undefined }, "completed")[0].phase).toBe("done")
  })

  test("missing sessions and queue data do not hide or complete a started schedule", () => {
    const links = scheduledSessionLinks(
      [task({ lastQueueID: "q", lastRunAt: 10 })],
      new Map([["q", item("running", "removed")]]),
      sessions,
    )
    expect(links[0].sessionID).toBeUndefined()
    expect(links[0].phase).toBe("running")
    expect(rows({ lastRunAt: 10 })[0]).toMatchObject({ phase: "running", detail: "Status unavailable" })
    expect(rows()[0]).toMatchObject({ phase: "new", status: "scheduled" })
  })

  test("overlap skip history cannot replace the latest actual execution", () => {
    const running = { status: "running", time: { created: 10 } } as ScheduledTaskRunInfo
    const skipped = { status: "skipped_overlap", time: { created: 20 } } as ScheduledTaskRunInfo
    expect(scheduledNavigationRun([skipped, running])).toBe(running)
    expect(scheduledNavigationRun([skipped])).toBe(skipped)
    expect(scheduledNavigationRun([])).toBeUndefined()
    const links = scheduledSessionLinks(
      [task({ lastRunAt: 10, nextRunAt: 30 })],
      new Map(),
      [],
      new Map([["task", running]]),
    )
    expect(links[0].phase).toBe("running")
  })

  test("cleaning an ended task never hides a resumed task or a later run", () => {
    const ended = rows({ status: "disabled", lastQueueID: "q", lastRunAt: 10 }, "completed")
    const cleaned = new Set(ended.map(scheduledSessionKey))
    expect(
      scheduledSessionBuckets(rows({ lastQueueID: "q", lastRunAt: 10 }, "completed"), cleaned).running,
    ).toHaveLength(1)
    expect(
      scheduledSessionBuckets(rows({ status: "disabled", lastQueueID: "q", lastRunAt: 20 }, "completed"), cleaned).done,
    ).toHaveLength(1)
  })

  test("distinct schedules sharing a session and older active tasks remain visible", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task({ id: String(i), lastRunAt: i, lastQueueID: "q" }))
    expect(scheduledSessionLinks(tasks, new Map([["q", item("completed", "session")]]), sessions)).toHaveLength(20)
  })
})
