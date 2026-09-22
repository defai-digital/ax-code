import { describe, expect, test } from "vitest"
import type { Session, TaskQueueGetResponse } from "@ax-code/sdk/v2"
import type { ScheduledTaskInfo } from "../../../src/cli/tui/component/dialog-scheduled-task-view-model"
import {
  scheduledSessionBuckets,
  scheduledSessionKey,
  scheduledSessionLinks,
} from "../../../src/cli/tui/component/scheduled-session-navigation"

function task(id: string, queueID: string | undefined, lastRunAt: number): ScheduledTaskInfo {
  return { id, title: `Task ${id}`, lastQueueID: queueID, lastRunAt } as ScheduledTaskInfo
}

function item(sessionID: string | undefined): TaskQueueGetResponse {
  return { sessionID } as TaskQueueGetResponse
}

function session(id: string): Session {
  return { id } as Session
}

describe("scheduled session navigation", () => {
  test("orders recent scheduled work and deduplicates reused sessions", () => {
    const links = scheduledSessionLinks(
      [task("old", "q1", 10), task("new", "q2", 30), task("same", "q3", 20)],
      new Map([
        ["q1", item("s1")],
        ["q2", item("s2")],
        ["q3", item("s2")],
      ]),
      [session("s1"), session("s2")],
    )
    expect(links.map((link) => [link.taskID, link.sessionID])).toEqual([
      ["new", "s2"],
      ["old", "s1"],
    ])
  })

  test("does not render pending or removed sessions as links", () => {
    const links = scheduledSessionLinks(
      [task("pending", "q1", 30), task("removed", "q2", 20), task("workflow", undefined, 10)],
      new Map([
        ["q1", item(undefined)],
        ["q2", item("deleted")],
      ]),
      [session("live")],
    )
    expect(links).toEqual([])
  })

  test("a later run in a reused session returns to New after Finished is cleaned", () => {
    const first = { taskID: "task", taskTitle: "Task", sessionID: "session", lastRunAt: 10 }
    const next = { ...first, lastRunAt: 20 }
    const seen = new Set([scheduledSessionKey(first)])
    const cleaned = new Set([scheduledSessionKey(first)])
    expect(scheduledSessionBuckets([first, next], seen, cleaned)).toEqual({ new: [next], finished: [] })
  })
})
