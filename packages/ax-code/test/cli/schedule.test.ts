import { describe, expect, test } from "vitest"
import { formatScheduleList, formatScheduleRunList, formatScheduleShow } from "../../src/cli/cmd/schedule"

describe("cli.schedule formatters", () => {
  test("formatScheduleList renders an empty placeholder", () => {
    expect(formatScheduleList([])).toBe("No scheduled tasks found.\n")
  })

  test("formatScheduleList renders aligned columns with schedule summaries", () => {
    const output = formatScheduleList([
      {
        id: "sch_one",
        projectID: "prj_1",
        directory: "/tmp",
        title: "Remind me",
        prompt: "Check the deployment",
        schedule: { type: "daily", time: "09:00", timezone: "Asia/Taipei" },
        status: "active",
        catchUpPolicy: "run_once",
        nextRunAt: 1_800_000_000_000,
        time: { created: 1_700_000_000_000 },
      } as never,
      {
        id: "sch_two",
        projectID: "prj_1",
        directory: "/tmp",
        title: "Summarize CI",
        prompt: "Summarize failures",
        schedule: { type: "cron", expression: "0 9 * * 1" },
        status: "paused",
        catchUpPolicy: "skip",
        time: { created: 1_700_000_000_000 },
      } as never,
    ])
    expect(output).toContain("status")
    expect(output).toContain("next_run")
    expect(output).toContain("schedule")
    expect(output).toContain("sch_one")
    expect(output).toContain("Remind me")
    expect(output).toContain("daily 09:00 (Asia/Taipei)")
    expect(output).toContain('cron "0 9 * * 1"')
    expect(output).toContain("paused")
  })

  test("formatScheduleRunList renders aligned columns with coverage and errors", () => {
    expect(formatScheduleRunList([])).toBe("No runs found.\n")
    const output = formatScheduleRunList([
      {
        id: "schrun_one",
        taskID: "sch_one",
        projectID: "prj_1",
        triggerType: "scheduled",
        status: "completed",
        coalescedCount: 12,
        timeStarted: 1_700_000_000_100,
        timeCompleted: 1_700_000_000_200,
        time: { created: 1_700_000_000_300 },
      } as never,
      {
        id: "schrun_two",
        taskID: "sch_one",
        projectID: "prj_1",
        triggerType: "manual",
        status: "failed",
        coalescedCount: 1,
        error: "provider timed out",
        timeStarted: 1_700_000_001_100,
        timeCompleted: 1_700_000_001_200,
        time: { created: 1_700_000_001_300 },
      } as never,
    ])
    expect(output).toContain("status")
    expect(output).toContain("trigger")
    expect(output).toContain("started")
    expect(output).toContain("completed")
    expect(output).toContain("covered")
    expect(output).toContain("scheduled")
    expect(output).toContain("manual")
    expect(output).toContain("completed")
    expect(output).toContain("failed")
    expect(output).toContain("12")
    expect(output).toContain("provider timed out")
  })

  test("formatScheduleShow lists fields and a recent runs section", () => {
    const output = formatScheduleShow(
      {
        id: "sch_one",
        projectID: "prj_1",
        directory: "/tmp",
        title: "Remind me",
        prompt: "Check the deployment",
        schedule: { type: "weekly", day: 1, time: "09:00" },
        status: "active",
        agent: "general",
        catchUpPolicy: "run_once",
        maxRunDurationMs: 3_600_000,
        nextRunAt: 1_800_000_000_000,
        lastRunAt: 1_700_000_000_000,
        error: "last run failed",
        time: { created: 1_600_000_000_000 },
      } as never,
      [
        {
          id: "schrun_one",
          taskID: "sch_one",
          projectID: "prj_1",
          triggerType: "manual",
          status: "completed",
          coalescedCount: 1,
          timeStarted: 1_700_000_000_100,
          timeCompleted: 1_700_000_000_200,
          time: { created: 1_700_000_000_300 },
        } as never,
      ],
    )
    expect(output).toContain("Scheduled task sch_one")
    expect(output).toContain("title: Remind me")
    expect(output).toContain("status: active")
    expect(output).toContain("schedule: weekly Mon 09:00")
    expect(output).toContain("catchUpPolicy: run_once")
    expect(output).toContain("maxRunDurationMs: 3600000")
    expect(output).toContain("agent: general")
    expect(output).toContain("error: last run failed")
    expect(output).toContain("Recent runs:")
    expect(output).toContain("completed")
  })
})
