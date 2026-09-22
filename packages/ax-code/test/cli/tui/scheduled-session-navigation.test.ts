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

function item(
  sessionID: string | undefined,
  status: TaskQueueGetResponse["status"] = "completed",
): TaskQueueGetResponse {
  return { sessionID, status } as TaskQueueGetResponse
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

  test("running and blocked sessions stay New; terminal outcomes are Finished", () => {
    const links = scheduledSessionLinks(
      [task("running", "q1", 40), task("blocked", "q2", 30), task("completed", "q3", 20), task("failed", "q4", 10)],
      new Map([
        ["q1", item("s1", "running")],
        ["q2", item("s2", "blocked_permission")],
        ["q3", item("s3", "completed")],
        ["q4", item("s4", "failed")],
      ]),
      [session("s1"), session("s2"), session("s3"), session("s4")],
    )
    const buckets = scheduledSessionBuckets(links, new Set())
    expect(buckets.new.map((link) => link.taskID)).toEqual(["running", "blocked"])
    expect(buckets.finished.map((link) => link.taskID)).toEqual(["completed", "failed"])
  })

  test("a later run in a reused session is not hidden by cleaning an earlier finished run", () => {
    const first = {
      taskID: "task",
      taskTitle: "Task",
      sessionID: "session",
      lastRunAt: 10,
      status: "completed" as const,
    }
    const next = { ...first, lastRunAt: 20, status: "running" as const }
    const cleaned = new Set([scheduledSessionKey(first)])
    expect(scheduledSessionBuckets([first, next], cleaned)).toEqual({ new: [next], finished: [] })
    const nextDone = { ...next, status: "completed" as const }
    expect(scheduledSessionBuckets([first, nextDone], cleaned)).toEqual({ new: [], finished: [nextDone] })
  })

  test("a previously cleaned running session returns to New after the tab fix", () => {
    const running = {
      taskID: "task",
      taskTitle: "Task",
      sessionID: "session",
      lastRunAt: 10,
      status: "running" as const,
    }
    expect(scheduledSessionBuckets([running], new Set([scheduledSessionKey(running)]))).toEqual({
      new: [running],
      finished: [],
    })
  })

  test("classifies every queue status by whether execution has ended", () => {
    const statuses = [
      "queued",
      "waiting_for_idle",
      "running",
      "blocked_permission",
      "blocked_question",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ] as const
    const links = statuses.map((status, index) => ({
      taskID: String(index),
      taskTitle: status,
      sessionID: `session-${index}`,
      lastRunAt: index + 1,
      status,
    }))
    const buckets = scheduledSessionBuckets(links, new Set())
    expect(buckets.new.map((link) => link.status)).toEqual(statuses.slice(0, 6))
    expect(buckets.finished.map((link) => link.status)).toEqual(statuses.slice(6))
  })
})
