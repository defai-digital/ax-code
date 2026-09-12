import { describe, expect, test } from "vitest"
import type { ScheduledTaskInfo, ScheduledTaskRunInfo } from "@/cli/cmd/tui/component/dialog-scheduled-task-view-model"
import {
  runDescription,
  runTitle,
  scheduleSummary,
  sortTasks,
  taskDescription,
  taskStatusLabel,
} from "@/cli/cmd/tui/component/dialog-scheduled-task-view-model"

function task(overrides: Partial<ScheduledTaskInfo>): ScheduledTaskInfo {
  return {
    id: "sch_test",
    projectID: "prj_test",
    directory: "/tmp",
    title: "Task",
    prompt: "prompt",
    schedule: { type: "daily", time: "09:00" },
    status: "active",
    catchUpPolicy: "run_once",
    time: { created: 1_000 },
    ...overrides,
  } as ScheduledTaskInfo
}

function run(overrides: Partial<ScheduledTaskRunInfo>): ScheduledTaskRunInfo {
  return {
    id: "schrun_test",
    taskID: "sch_test",
    projectID: "prj_test",
    triggerType: "scheduled",
    status: "completed",
    coalescedCount: 1,
    time: { created: 1_000 },
    ...overrides,
  } as ScheduledTaskRunInfo
}

describe("dialog-scheduled-task view model", () => {
  test("scheduleSummary renders each schedule kind", () => {
    const runAt = new Date(2030, 0, 2, 14, 30).getTime()
    expect(scheduleSummary({ type: "once", runAt })).toContain("once ·")
    expect(scheduleSummary({ type: "daily", time: "09:00" })).toBe("daily 09:00")
    expect(scheduleSummary({ type: "daily", time: "09:00", timezone: "Asia/Taipei" })).toBe("daily 09:00 (Asia/Taipei)")
    expect(scheduleSummary({ type: "weekly", day: 1, time: "09:00" })).toBe("weekly Mon 09:00")
    expect(scheduleSummary({ type: "cron", expression: "0 9 1 * *" })).toBe('cron "0 9 1 * *"')
  })

  test("taskStatusLabel maps statuses to user-facing labels", () => {
    expect(taskStatusLabel(task({ status: "active" }))).toBe("Active")
    expect(taskStatusLabel(task({ status: "paused" }))).toBe("Paused")
    expect(taskStatusLabel(task({ status: "disabled" }))).toBe("Done")
  })

  test("taskDescription shows the next run for active tasks", () => {
    const description = taskDescription(task({ nextRunAt: Date.now() + 3_600_000 }))
    expect(description).toContain("daily 09:00")
    expect(description).toContain("next ")
    expect(description).not.toContain("error:")
  })

  test("taskDescription marks an active task without a next run as running now", () => {
    const description = taskDescription(task({ nextRunAt: undefined, lastRunAt: Date.now() }))
    expect(description).toContain("running now")
  })

  test("taskDescription marks disabled tasks as finished and surfaces errors", () => {
    const description = taskDescription(task({ status: "disabled", lastRunAt: Date.now(), error: "boom" }))
    expect(description).toContain("finished")
    expect(description).toContain("error: boom")
  })

  test("sortTasks orders active by next run, then paused, then disabled", () => {
    const now = Date.now()
    const disabled = task({ id: "sch_d", status: "disabled", time: { created: now } })
    const paused = task({ id: "sch_p", status: "paused", time: { created: now + 1 } })
    const later = task({ id: "sch_a2", nextRunAt: now + 7_200_000, time: { created: now + 2 } })
    const sooner = task({ id: "sch_a1", nextRunAt: now + 3_600_000, time: { created: now + 3 } })
    const running = task({ id: "sch_a3", nextRunAt: undefined, lastRunAt: now, time: { created: now + 4 } })

    expect(sortTasks([disabled, paused, later, sooner, running]).map((item) => item.id)).toEqual([
      "sch_a1",
      "sch_a2",
      "sch_a3",
      "sch_p",
      "sch_d",
    ])
  })

  test("runTitle and runDescription summarize a run", () => {
    const started = Date.now() - 65_000
    const value = run({
      status: "failed",
      triggerType: "manual",
      timeStarted: started,
      timeCompleted: started + 61_000,
      coalescedCount: 3,
      error: "provider timeout",
    })
    expect(runTitle(value)).toBe("Failed · manual")
    const description = runDescription(value)
    expect(description).toContain("started ")
    expect(description).toContain("took 1m 1s")
    expect(description).toContain("covers 3 missed occurrences")
    expect(description).toContain("error: provider timeout")
  })

  test("runDescription falls back to the record time for runs that never started", () => {
    expect(runDescription(run({ status: "missed_skip" }))).toContain("recorded ")
  })
})
