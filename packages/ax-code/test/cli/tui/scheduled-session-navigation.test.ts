import { describe, expect, test } from "vitest"
import type { Session, TaskQueueGetResponse } from "@ax-code/sdk/v2"
import type {
  ScheduledTaskInfo,
  ScheduledTaskRunInfo,
} from "../../../src/cli/tui/component/dialog-scheduled-task-view-model"
import {
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
const buckets = (tasks: ScheduledTaskInfo[], queue = new Map<string, TaskQueueGetResponse>()) =>
  scheduledSessionBuckets(scheduledSessionLinks(tasks, queue, sessions), new Set())

describe("scheduled task navigation", () => {
  test("a newly created one-time task appears before its first queue or session exists", () => {
    const result = buckets([task({ nextRunAt: 1790112644000 })])
    expect(result.new).toHaveLength(1)
    expect(result.new[0]).toMatchObject({ taskTitle: "Tokyo weather check", status: "scheduled" })
    expect(result.new[0].sessionID).toBeUndefined()
    expect(result.running).toEqual([])
    expect(result.done).toEqual([])
  })

  test.each([
    ["queued", "new"],
    ["waiting_for_idle", "new"],
    ["running", "running"],
    ["blocked_permission", "running"],
    ["blocked_question", "running"],
    ["paused", "running"],
    ["completed", "done"],
    ["failed", "done"],
    ["cancelled", "done"],
  ] as const)("classifies %s as %s even before a session is attached", (status, phase) => {
    const result = buckets([task({ lastQueueID: "q", lastRunAt: 10 })], new Map([["q", item(status)]]))
    expect(result[phase]).toHaveLength(1)
    expect(Object.values(result).flat()).toHaveLength(1)
  })

  test("attaches a session without changing the execution phase and tolerates removed sessions", () => {
    for (const sessionID of [undefined, "session", "removed"]) {
      const result = buckets([task({ lastQueueID: "q", lastRunAt: 10 })], new Map([["q", item("running", sessionID)]]))
      expect(result.running).toHaveLength(1)
      expect(result.running[0].sessionID).toBe(sessionID === "session" ? "session" : undefined)
    }
  })

  test("recurring completion retains the next occurrence after clearing Done", () => {
    const links = scheduledSessionLinks(
      [task({ lastQueueID: "q", lastRunAt: 10, nextRunAt: 20 })],
      new Map([["q", item("completed", "session")]]),
      sessions,
    )
    const result = scheduledSessionBuckets(links, new Set())
    expect(result.new).toHaveLength(1)
    expect(result.done).toHaveLength(1)
    const cleaned = new Set(result.done.map(scheduledSessionKey))
    expect(scheduledSessionBuckets(links, cleaned)).toEqual({ new: result.new, running: [], done: [] })
    const later = scheduledSessionLinks(
      [task({ lastQueueID: "q2", lastRunAt: 20 })],
      new Map([["q2", item("completed", "session")]]),
      sessions,
    )
    expect(scheduledSessionBuckets(later, cleaned).done).toHaveLength(1)
  })

  test("paused schedules remain New and unavailable status never implies Done", () => {
    expect(buckets([task({ status: "paused" })]).new[0].detail).toBe("Schedule paused")
    const result = buckets([task({ lastQueueID: "missing", lastRunAt: 10 })])
    expect(result.new[0].detail).toBe("Status unavailable")
    expect(result.done).toEqual([])
  })

  test("workflow execution uses run history when there is no queue session", () => {
    for (const status of ["running", "completed", "failed", "timeout", "missed_skip"] as const) {
      const links = scheduledSessionLinks(
        [task({ lastRunAt: 10 })],
        new Map(),
        [],
        new Map([["task", { status } as ScheduledTaskRunInfo]]),
      )
      expect(links[0].phase).toBe(status === "running" ? "running" : "done")
    }
  })

  test("does not drop distinct tasks sharing a session or tasks beyond the previous cap", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task({ id: String(i), lastRunAt: i, lastQueueID: "q" }))
    expect(buckets(tasks, new Map([["q", item("running", "session")]])).running).toHaveLength(20)
  })
})
