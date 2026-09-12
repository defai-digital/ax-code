import type { ScheduledTaskListResponse, ScheduledTaskListRunsResponse } from "@ax-code/sdk/v2"
import { Locale } from "@/util/locale"

// Pure view-model for the /schedule dialog (PRD-2026-09-12): all formatting and
// ordering decisions for scheduled tasks and their runs live here so they can
// be unit-tested without rendering the TUI.

export type ScheduledTaskInfo = ScheduledTaskListResponse[number]
export type ScheduledTaskRunInfo = ScheduledTaskListRunsResponse[number]

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

export function scheduleSummary(schedule: ScheduledTaskInfo["schedule"]): string {
  switch (schedule.type) {
    case "once":
      return `once · ${Locale.todayTimeOrDateTime(schedule.runAt)}`
    case "daily":
      return `daily ${schedule.time}${schedule.timezone ? ` (${schedule.timezone})` : ""}`
    case "weekly":
      return `weekly ${DAY_NAMES[schedule.day] ?? `day ${schedule.day}`} ${schedule.time}${schedule.timezone ? ` (${schedule.timezone})` : ""}`
    case "cron":
      return `cron "${schedule.expression}"${schedule.timezone ? ` (${schedule.timezone})` : ""}`
  }
}

export type TaskStatusTone = "active" | "paused" | "disabled"

export function taskStatusLabel(task: ScheduledTaskInfo): string {
  switch (task.status) {
    case "active":
      return "Active"
    case "paused":
      return "Paused"
    case "disabled":
      return "Done"
  }
}

// One summary line under the task title: when it runs next, when it last ran,
// and the last error if any. An active one-shot with no next run is currently
// executing (its next run is only re-armed on failure).
export function taskDescription(task: ScheduledTaskInfo): string {
  const parts = [scheduleSummary(task.schedule)]
  if (task.status === "disabled") {
    parts.push(task.lastRunAt ? `finished ${Locale.todayTimeOrDateTime(task.lastRunAt)}` : "finished")
  } else if (task.nextRunAt !== undefined) {
    parts.push(`next ${Locale.todayTimeOrDateTime(task.nextRunAt)}`)
  } else if (task.lastRunAt !== undefined) {
    parts.push("running now")
  }
  if (task.error) parts.push(`error: ${task.error}`)
  return parts.join(" · ")
}

// Active tasks first by next run (tasks without a next run last within their
// group), then paused, then disabled — each group newest first.
export function sortTasks(tasks: readonly ScheduledTaskInfo[]): ScheduledTaskInfo[] {
  const rank = (task: ScheduledTaskInfo) => (task.status === "active" ? 0 : task.status === "paused" ? 1 : 2)
  return tasks.toSorted((a, b) => {
    const byStatus = rank(a) - rank(b)
    if (byStatus !== 0) return byStatus
    if (a.status === "active") {
      const aNext = a.nextRunAt ?? Number.POSITIVE_INFINITY
      const bNext = b.nextRunAt ?? Number.POSITIVE_INFINITY
      if (aNext !== bNext) return aNext - bNext
    }
    return b.time.created - a.time.created
  })
}

const RUN_STATUS_LABEL: Record<ScheduledTaskRunInfo["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  timeout: "Timed out",
  skipped_overlap: "Skipped (overlap)",
  missed_skip: "Skipped (missed)",
}

export function runTitle(run: ScheduledTaskRunInfo): string {
  const trigger = run.triggerType === "manual" ? "manual" : "scheduled"
  return `${RUN_STATUS_LABEL[run.status]} · ${trigger}`
}

export function runDescription(run: ScheduledTaskRunInfo): string {
  const parts: string[] = []
  if (run.timeStarted !== undefined) parts.push(`started ${Locale.todayTimeOrDateTime(run.timeStarted)}`)
  else parts.push(`recorded ${Locale.todayTimeOrDateTime(run.time.created)}`)
  if (run.timeStarted !== undefined && run.timeCompleted !== undefined) {
    parts.push(`took ${Locale.duration(run.timeCompleted - run.timeStarted)}`)
  }
  if (run.coalescedCount > 1) parts.push(`covers ${run.coalescedCount} missed occurrences`)
  if (run.error) parts.push(`error: ${run.error}`)
  return parts.join(" · ")
}
