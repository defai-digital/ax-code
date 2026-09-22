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
  if (task.error) parts.push(`error: ${formatScheduleError(task.error)}`)
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
  if (run.error) parts.push(`error: ${formatScheduleError(run.error)}`)
  return parts.join(" · ")
}

export const SCHEDULED_TASK_EVENTS = [
  "scheduled.task.created",
  "scheduled.task.updated",
  "scheduled.task.deleted",
  "scheduled.task.fired",
  "scheduled.task.succeeded",
  "scheduled.task.failed",
  "scheduled.task.skipped",
  "scheduled.task.failed_persistently",
] as const

export type ScheduleChromeTone = "muted" | "success" | "warning" | "error"

export type ScheduleChrome = {
  compact: string
  detail: string
  tone: ScheduleChromeTone
}

export function formatScheduleError(error: string) {
  const trimmed = error.trim()
  if (/\babort(ed|error)?\b/i.test(trimmed)) return "interrupted"
  if (/\btimed?\s+out\b/i.test(trimmed)) return "timed out"
  const cut = trimmed.search(/[.\n]/)
  return (cut > 0 ? trimmed.slice(0, cut) : trimmed).slice(0, 48)
}

/** Compact chrome for the navigation rail / top bar. Hidden when nothing is scheduled. */
export function scheduleChrome(tasks: readonly ScheduledTaskInfo[], now = Date.now()): ScheduleChrome | undefined {
  const live = tasks.filter((task) => task.status !== "disabled")
  if (live.length === 0) return undefined
  const failed = live.filter((task) => Boolean(task.error))
  const upcoming = live
    .filter((task) => task.status === "active" && task.nextRunAt !== undefined)
    .toSorted((a, b) => (a.nextRunAt ?? now) - (b.nextRunAt ?? now))
  if (failed[0]?.error) {
    const count = failed.length
    const nextAt = failed[0].nextRunAt ?? upcoming[0]?.nextRunAt
    const when = nextAt !== undefined ? Locale.todayTimeOrDateTime(nextAt) : undefined
    const err = formatScheduleError(failed[0].error)
    return {
      compact: count === 1 ? "Sched error" : `Sched ${count} errors`,
      detail: when ? `error: ${err} · next ${when}` : `error: ${err}`,
      tone: "error",
    }
  }
  const running = live.filter((task) => task.status === "active" && task.nextRunAt === undefined && task.lastRunAt)
  if (running[0]) {
    const count = running.length
    return {
      compact: count === 1 ? "Sched running" : `Sched ${count} running`,
      detail: count === 1 ? `running now · ${running[0].title}` : `${count} running`,
      tone: "success",
    }
  }
  const next = upcoming[0]
  if (next?.nextRunAt !== undefined) {
    const when = Locale.todayTimeOrDateTime(next.nextRunAt)
    const active = live.filter((task) => task.status === "active").length
    return {
      compact: active === 1 ? `Next ${when}` : `Sched ${active}`,
      detail: active === 1 ? `next ${when}` : `${active} active · next ${when}`,
      tone: "muted",
    }
  }
  const paused = live.filter((task) => task.status === "paused")
  if (paused[0]) {
    return {
      compact: paused.length === 1 ? "Sched paused" : `Sched ${paused.length} paused`,
      detail: paused.length === 1 ? `paused · ${paused[0].title}` : `${paused.length} paused`,
      tone: "warning",
    }
  }
  return undefined
}

export type ScheduleLoadState = "loading" | "error" | "ready"

/**
 * Status for the always-visible schedule entry in the navigation rail.
 * Unlike scheduleChrome, this also covers loading, error, disconnected, and
 * empty states.
 */
export type ScheduleRailStatus =
  | ({ kind: "summary"; disconnected: boolean } & ScheduleChrome)
  | { kind: "status"; status: "loading" | "error" | "offline" | "empty" | "inactive"; tone: ScheduleChromeTone }

export function scheduleStatus(input: {
  tasks: readonly ScheduledTaskInfo[]
  loadState: ScheduleLoadState
  connected: boolean
  now?: number
}): ScheduleRailStatus {
  const now = input.now ?? Date.now()
  if (!input.connected && input.loadState !== "ready") return { kind: "status", status: "offline", tone: "muted" }
  if (input.loadState === "loading") return { kind: "status", status: "loading", tone: "muted" }
  if (input.loadState === "error") return { kind: "status", status: "error", tone: "error" }
  const chrome = scheduleChrome(input.tasks, now)
  if (chrome) {
    return {
      kind: "summary",
      compact: chrome.compact,
      detail: chrome.detail,
      tone: chrome.tone,
      disconnected: !input.connected,
    }
  }
  if (!input.connected) return { kind: "status", status: "offline", tone: "muted" }
  if (input.tasks.length > 0) return { kind: "status", status: "inactive", tone: "muted" }
  return { kind: "status", status: "empty", tone: "muted" }
}
