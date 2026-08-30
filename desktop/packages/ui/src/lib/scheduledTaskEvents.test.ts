import { describe, expect, test, vi } from "vitest"

import {
  ingestScheduledTaskRuntimeEvent,
  isScheduledTaskRuntimeEventType,
  subscribeScheduledTaskEvents,
  type ScheduledTaskEvent,
} from "./scheduledTaskEvents"

describe("isScheduledTaskRuntimeEventType", () => {
  test("recognizes the runtime scheduled-task event family", () => {
    expect(isScheduledTaskRuntimeEventType("scheduled.task.fired")).toBe(true)
    expect(isScheduledTaskRuntimeEventType("scheduled.task.failed_persistently")).toBe(true)
    expect(isScheduledTaskRuntimeEventType("scheduled.task.updated")).toBe(true)
    expect(isScheduledTaskRuntimeEventType("session.status")).toBe(false)
    expect(isScheduledTaskRuntimeEventType("scheduled.task.unknown_extra")).toBe(false)
    expect(isScheduledTaskRuntimeEventType(undefined)).toBe(false)
  })
})

describe("ingestScheduledTaskRuntimeEvent", () => {
  test("maps runtime event types to display statuses", () => {
    const received: ScheduledTaskEvent[] = []
    const unsubscribe = subscribeScheduledTaskEvents((event) => received.push(event))
    try {
      const task = { id: "st_1", directory: "/work/alpha" }
      ingestScheduledTaskRuntimeEvent({ type: "scheduled.task.fired", properties: { task, run: {} } })
      ingestScheduledTaskRuntimeEvent({ type: "scheduled.task.succeeded", properties: { task, run: {} } })
      ingestScheduledTaskRuntimeEvent({ type: "scheduled.task.failed", properties: { task, run: {} } })
      ingestScheduledTaskRuntimeEvent({ type: "scheduled.task.failed_persistently", properties: { task } })
      ingestScheduledTaskRuntimeEvent({ type: "scheduled.task.updated", properties: { task } })
    } finally {
      unsubscribe()
    }
    expect(received.map((event) => event.status)).toEqual(["running", "success", "error", "error", "changed"])
    expect(received[0]).toMatchObject({ directory: "/work/alpha", taskId: "st_1" })
  })

  test("handles deleted payloads (no task object) and ignores unrelated events", () => {
    const received: ScheduledTaskEvent[] = []
    const unsubscribe = subscribeScheduledTaskEvents((event) => received.push(event))
    try {
      ingestScheduledTaskRuntimeEvent({ type: "scheduled.task.deleted", properties: { id: "st_9", projectID: "p" } })
      ingestScheduledTaskRuntimeEvent({ type: "session.status", properties: {} })
    } finally {
      unsubscribe()
    }
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ type: "scheduled.task.deleted", status: "changed", taskId: "st_9" })
    expect(received[0].directory).toBeUndefined()
  })

  test("unsubscribed listeners stop receiving events and listener errors are isolated", () => {
    const received: ScheduledTaskEvent[] = []
    const throwing = vi.fn(() => {
      throw new Error("boom")
    })
    const unsubscribeThrowing = subscribeScheduledTaskEvents(throwing)
    const unsubscribe = subscribeScheduledTaskEvents((event) => received.push(event))
    ingestScheduledTaskRuntimeEvent({
      type: "scheduled.task.fired",
      properties: { task: { id: "st_1", directory: "/work/a" } },
    })
    unsubscribe()
    unsubscribeThrowing()
    ingestScheduledTaskRuntimeEvent({
      type: "scheduled.task.fired",
      properties: { task: { id: "st_1", directory: "/work/a" } },
    })
    expect(received).toHaveLength(1)
    expect(throwing).toHaveBeenCalledTimes(1)
  })
})
