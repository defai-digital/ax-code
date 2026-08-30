/**
 * S2.6 (SPEC-2026-08-29-desktop-process-model-collapse §2 D6): shared shapes
 * and the client-side fan-out from the editor's multi-time/multi-weekday draft
 * into ax-code runtime `/scheduled-task` payloads.
 *
 * KEEP IN SYNC: the migration-side transform
 * desktop/packages/web/server/lib/scheduled-task-convergence/transform.js
 * implements the same naming and schedule-mapping rules. Any change to
 * fan-out order, name suffixes, or schedule mapping must land in both places.
 */

export type RuntimeSchedule =
  | { type: "once"; runAt: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; day: number; time: string; timezone?: string }
  | { type: "cron"; expression: string; timezone?: string }

export type RuntimeTaskStatus = "active" | "paused" | "disabled"
export type CatchUpPolicy = "run_once" | "skip"

export type RuntimeModelRef = {
  providerID: string
  modelID: string
}

export type RuntimeTaskPayload = {
  title: string
  prompt: string
  schedule: RuntimeSchedule
  agent?: string
  model?: RuntimeModelRef
  catchUpPolicy: CatchUpPolicy
}

export type ScheduledTaskDraftInput = {
  name: string
  prompt: string
  agent?: string
  model?: RuntimeModelRef
  catchUpPolicy: CatchUpPolicy
  schedule:
    | { kind: "daily"; times: string[]; timezone: string }
    | { kind: "weekly"; weekdays: number[]; times: string[]; timezone: string }
    | { kind: "once"; date: string; time: string; timezone: string }
}

const MAX_RUNTIME_TITLE_LENGTH = 200

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

const normalizeTimes = (times: string[]): string[] =>
  Array.from(new Set(times.filter((value) => TIME_PATTERN.test(value)))).sort((a, b) => a.localeCompare(b))

const normalizeWeekdays = (weekdays: number[]): number[] =>
  Array.from(new Set(weekdays.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))).sort(
    (a, b) => a - b,
  )

// Convert a wall-clock date+time in an IANA timezone to an epoch timestamp
// without a tz database dependency: guess the UTC instant, read back the wall
// clock in the target zone, and iterate the offset correction to a fixpoint.
// DST-gap inputs land on the nearest representable instant, which the runtime
// schedule validator then accepts or rejects like any other timestamp.
const TZ_FORMATTERS = new Map<string, Intl.DateTimeFormat>()

const tzFormatter = (timezone: string): Intl.DateTimeFormat => {
  const cached = TZ_FORMATTERS.get(timezone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  TZ_FORMATTERS.set(timezone, formatter)
  return formatter
}

const wallClockAsUtcMs = (ms: number, timezone: string): number => {
  const parts = tzFormatter(timezone)
    .formatToParts(new Date(ms))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value
      return acc
    }, {})
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  )
}

export const zonedTimeToEpochMs = (date: string, time: string, timezone: string): number | null => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) return null
  const target = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  )
  if (Number.isNaN(target)) return null
  let candidate = target
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const offset = wallClockAsUtcMs(candidate, timezone) - candidate
      const next = target - offset
      if (next === candidate) break
      candidate = next
    }
  } catch {
    return null
  }
  return candidate
}

const FAN_OUT_SUFFIX_PATTERN = / \(\d+\/\d+\)$/

// Editing one fan-out part shows its base name again, so re-saving does not
// stack suffixes ("Foo (2/3) (1/2)").
export const stripFanOutSuffix = (name: string): string => name.replace(FAN_OUT_SUFFIX_PATTERN, "")

const slotTitle = (name: string, index: number, total: number): string => {
  const base = total > 1 ? `${name} (${index + 1}/${total})` : name
  return base.length > MAX_RUNTIME_TITLE_LENGTH ? base.slice(0, MAX_RUNTIME_TITLE_LENGTH) : base
}

/**
 * Expand a draft into the runtime create payloads: the runtime scheduler
 * supports a single time (daily) or weekday+time (weekly) per task, so a
 * multi-time/multi-weekday draft becomes N tasks named "<name> (i/N)".
 * Returns null when the schedule yields no valid slot.
 */
export const buildRuntimeScheduledTaskPayloads = (draft: ScheduledTaskDraftInput): RuntimeTaskPayload[] | null => {
  const name = stripFanOutSuffix(draft.name.trim())
  if (!name || !draft.prompt.trim()) return null

  let schedules: RuntimeSchedule[]
  if (draft.schedule.kind === "daily") {
    const times = normalizeTimes(draft.schedule.times)
    if (times.length === 0) return null
    schedules = times.map((time) => ({ type: "daily", time, timezone: draft.schedule.timezone }))
  } else if (draft.schedule.kind === "weekly") {
    const times = normalizeTimes(draft.schedule.times)
    const weekdays = normalizeWeekdays(draft.schedule.weekdays)
    if (times.length === 0 || weekdays.length === 0) return null
    schedules = []
    for (const day of weekdays) {
      for (const time of times) {
        schedules.push({ type: "weekly", day, time, timezone: draft.schedule.timezone })
      }
    }
  } else {
    const runAt = zonedTimeToEpochMs(draft.schedule.date, draft.schedule.time, draft.schedule.timezone)
    if (runAt === null) return null
    schedules = [{ type: "once", runAt }]
  }

  return schedules.map((schedule, index) => ({
    title: slotTitle(name, index, schedules.length),
    prompt: draft.prompt,
    schedule,
    ...(draft.agent?.trim() ? { agent: draft.agent.trim() } : {}),
    ...(draft.model ? { model: draft.model } : {}),
    catchUpPolicy: draft.catchUpPolicy,
  }))
}
