import { describe, expect, test } from "vitest"
import { pendingScheduledTaskNotice } from "../../src/cli/cmd/run-schedule-notice"

describe("pendingScheduledTaskNotice", () => {
  test("returns undefined when there are no tasks", () => {
    expect(pendingScheduledTaskNotice([])).toBeUndefined()
  })

  test("returns undefined when no task has a pending next run", () => {
    expect(pendingScheduledTaskNotice([{ nextRunAt: undefined }])).toBeUndefined()
  })

  test("returns a notice counting a single pending task", () => {
    expect(pendingScheduledTaskNotice([{ nextRunAt: Date.now() + 60_000 }])).toBe(
      "Note: 1 scheduled task(s) for this project fire only while an ax-code backend is running; " +
        "this process is exiting. Start one with: ax-code runtime start",
    )
  })

  test("counts only pending tasks when mixed with a task firing now", () => {
    const notice = pendingScheduledTaskNotice([
      { nextRunAt: Date.now() + 60_000 },
      { nextRunAt: Date.now() + 3_600_000 },
      { nextRunAt: undefined },
    ])
    expect(notice).toBe(
      "Note: 2 scheduled task(s) for this project fire only while an ax-code backend is running; " +
        "this process is exiting. Start one with: ax-code runtime start",
    )
  })
})
