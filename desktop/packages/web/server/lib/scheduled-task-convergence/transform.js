// S2.6 (SPEC-2026-08-29-desktop-process-model-collapse §2 D6): pure transform
// from the retired desktop scheduled-task shape (project JSON `scheduledTasks`)
// into ax-code runtime `/scheduled-task` create payloads.
//
// KEEP IN SYNC: the UI fan-out helper
// desktop/packages/ui/src/lib/scheduledTaskTransform.ts implements the same
// naming and schedule-mapping rules for tasks created from the editor. Any
// change to fan-out order, name suffixes, or schedule mapping must land in
// both places.

import { DateTime } from "luxon"
import { resolveScheduledTaskTimes } from "../projects/scheduled-task-time.js"

const MAX_RUNTIME_TITLE_LENGTH = 200
const MAX_RUNTIME_PROMPT_LENGTH = 20_000
const MAX_RUNTIME_CRON_LENGTH = 120
// A still-enabled one-time task whose timestamp already passed is the desktop
// catch-up case (the old engine fired missed occurrences on boot). Recreate it
// to fire shortly after migration instead of dropping it as history.
const ONESHOT_CATCH_UP_DELAY_MS = 60_000

const asNonEmptyString = (value) => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// --- Runtime cron syntax guard -------------------------------------------
// Mirror of the runtime parser (packages/ax-code/src/session/scheduled-task.ts
// parseCronField / parseCronExpressionFull): five fields, `*`, comma lists,
// numeric ranges, and steps only — no month/day names, L, W, #, or ?. Desktop
// accepted the full cron-parser grammar, so expressions outside this subset
// cannot migrate and are reported as skips.
const parseRuntimeCronField = (value, min, max) => {
  if (value === "*") {
    return true
  }
  for (const part of value.split(",")) {
    if (part === "") {
      return false
    }
    const stepMatch = /^(\*|(\d+)-(\d+))\/(\d+)$/.exec(part)
    if (stepMatch) {
      const lo = stepMatch[1] === "*" ? min : Number(stepMatch[2])
      const hi = stepMatch[1] === "*" ? max : Number(stepMatch[3])
      const step = Number(stepMatch[4])
      if (!Number.isInteger(step) || step < 1 || lo < min || hi > max || lo > hi) {
        return false
      }
      continue
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part)
    if (rangeMatch) {
      const lo = Number(rangeMatch[1])
      const hi = Number(rangeMatch[2])
      if (lo < min || hi > max || lo > hi) {
        return false
      }
      continue
    }
    const number = Number(part)
    if (!Number.isInteger(number) || number < min || number > max) {
      return false
    }
  }
  return true
}

export const isRuntimeCronExpression = (expression) => {
  const trimmed = typeof expression === "string" ? expression.trim() : ""
  if (!trimmed || trimmed.length > MAX_RUNTIME_CRON_LENGTH) {
    return false
  }
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) {
    return false
  }
  return (
    parseRuntimeCronField(fields[0], 0, 59) &&
    parseRuntimeCronField(fields[1], 0, 23) &&
    parseRuntimeCronField(fields[2], 1, 31) &&
    parseRuntimeCronField(fields[3], 1, 12) &&
    parseRuntimeCronField(fields[4], 0, 7)
  )
}

const normalizeWeekdays = (value) => {
  if (!Array.isArray(value)) {
    return []
  }
  const unique = new Set()
  for (const entry of value) {
    if (Number.isInteger(entry) && entry >= 0 && entry <= 6) {
      unique.add(entry)
    }
  }
  return Array.from(unique).sort((a, b) => a - b)
}

const resolveScheduleSlots = (task, now) => {
  const schedule = task?.schedule && typeof task.schedule === "object" ? task.schedule : {}
  const kind = asNonEmptyString(schedule.kind)
  const timezone = asNonEmptyString(schedule.timezone) || DateTime.local().zoneName || "UTC"

  if (kind === "daily") {
    const times = resolveScheduledTaskTimes(schedule)
    if (times.length === 0) {
      return { error: "daily schedule has no valid HH:mm times" }
    }
    return {
      slots: times.map((time) => ({ type: "daily", time, timezone })),
    }
  }

  if (kind === "weekly") {
    const times = resolveScheduledTaskTimes(schedule)
    if (times.length === 0) {
      return { error: "weekly schedule has no valid HH:mm times" }
    }
    const weekdays = normalizeWeekdays(schedule.weekdays)
    if (weekdays.length === 0) {
      return { error: "weekly schedule has no valid weekdays" }
    }
    const slots = []
    for (const day of weekdays) {
      for (const time of times) {
        slots.push({ type: "weekly", day, time, timezone })
      }
    }
    return { slots }
  }

  if (kind === "cron") {
    const expression = asNonEmptyString(schedule.cron)
    if (!expression) {
      return { error: "cron schedule has no expression" }
    }
    if (!isRuntimeCronExpression(expression)) {
      return {
        error: `cron expression is not supported by the runtime scheduler: ${expression}`,
      }
    }
    return {
      slots: [{ type: "cron", expression, timezone }],
    }
  }

  if (kind === "once") {
    const date = asNonEmptyString(schedule.date)
    const time = asNonEmptyString(schedule.time)
    const alreadyFired = task?.enabled === false && Number.isFinite(task?.state?.lastRunAt)
    if (alreadyFired) {
      // The desktop engine flipped enabled:false after firing a one-shot; that
      // task is history, and the runtime only tracks runs it fired itself.
      return { error: "one-time task already fired", history: true }
    }
    if (!date || !time) {
      return { error: "one-time schedule is missing date or time" }
    }
    const parsed = DateTime.fromFormat(`${date} ${time}`, "yyyy-LL-dd HH:mm", { zone: timezone })
    if (!parsed.isValid) {
      return { error: `one-time schedule date/time is invalid: ${date} ${time}` }
    }
    let runAt = parsed.toMillis()
    const warnings = []
    if (runAt <= now) {
      if (task?.enabled === false) {
        return { error: "one-time task is paused and its timestamp is in the past", history: true }
      }
      if (task?.catchUpPolicy === "skip") {
        return { error: "one-time task missed its run and catchUpPolicy is skip", history: true }
      }
      runAt = now + ONESHOT_CATCH_UP_DELAY_MS
      warnings.push("one-time run timestamp is in the past; rescheduled to fire shortly after migration")
    }
    return {
      slots: [{ type: "once", runAt }],
      warnings,
    }
  }

  return { error: `unsupported schedule kind: ${kind || "unknown"}` }
}

// Slash-command prompts (`/review ...`) were executed through the desktop
// engine's command_async path. The runtime scheduler only stores plain
// prompts, so these migrate as skips for support to re-create by hand.
export const isSlashCommandPrompt = (prompt) => typeof prompt === "string" && prompt.trim().startsWith("/")

const clampTitle = (value) =>
  value.length > MAX_RUNTIME_TITLE_LENGTH ? value.slice(0, MAX_RUNTIME_TITLE_LENGTH) : value

// Fan-out suffix: a desktop task with N schedule slots becomes N runtime
// tasks named "<name> (i/N)" (the runtime only supports a single
// time/weekday per task). Single-slot tasks keep the bare name.
export const slotTitle = (name, index, total) => {
  const base = total > 1 ? `${name} (${index + 1}/${total})` : name
  return clampTitle(base)
}

/**
 * Transform one desktop scheduled task into runtime create payloads.
 *
 * Returns one of:
 *   { status: "ready", payloads: [{ title, prompt, schedule, agent?, model?, catchUpPolicy }], pause, warnings }
 *   { status: "skip", reason, history, warnings }
 *
 * `pause` means the desktop task had enabled:false; the caller must create the
 * task(s) and then pause them (the runtime create route always starts active).
 */
export const transformDesktopScheduledTask = (task, options) => {
  const { now, expandPrompt } = options
  const warnings = []

  const name = asNonEmptyString(task?.name)
  if (!name) {
    return { status: "skip", reason: "task name is missing", history: false, warnings }
  }

  const rawPrompt = typeof task?.execution?.prompt === "string" ? task.execution.prompt : ""
  if (!rawPrompt.trim()) {
    return { status: "skip", reason: "execution.prompt is missing", history: false, warnings }
  }
  if (isSlashCommandPrompt(rawPrompt)) {
    return {
      status: "skip",
      reason: "slash-command prompts are not supported by the runtime scheduler",
      history: false,
      warnings,
    }
  }

  if (asNonEmptyString(task?.execution?.variant)) {
    // The runtime scheduler has no variant (effort) field; adding one is a
    // core change deferred out of S2.6. Dropped with a recorded warning.
    warnings.push(
      `variant "${task.execution.variant.trim()}" was dropped (runtime scheduled tasks have no variant field)`,
    )
  }

  const scheduleResult = resolveScheduleSlots(task, now)
  if (scheduleResult.error) {
    return {
      status: "skip",
      reason: scheduleResult.error,
      history: scheduleResult.history === true,
      warnings: [...warnings, ...(scheduleResult.warnings || [])],
    }
  }
  warnings.push(...(scheduleResult.warnings || []))

  // Snippets are pre-expanded at migration time: the runtime executes the
  // stored prompt verbatim and has no desktop snippet concept.
  const prompt = typeof expandPrompt === "function" ? expandPrompt(rawPrompt) : rawPrompt
  if (!prompt || !prompt.trim()) {
    return { status: "skip", reason: "prompt is empty after snippet expansion", history: false, warnings }
  }
  if (prompt.length > MAX_RUNTIME_PROMPT_LENGTH) {
    return {
      status: "skip",
      reason: `prompt exceeds the runtime limit of ${MAX_RUNTIME_PROMPT_LENGTH} characters after snippet expansion`,
      history: false,
      warnings,
    }
  }

  const agent = asNonEmptyString(task?.execution?.agent) || undefined
  const providerID = asNonEmptyString(task?.execution?.providerID)
  const modelID = asNonEmptyString(task?.execution?.modelID)
  const model = providerID && modelID ? { providerID, modelID } : undefined
  if (!model) {
    warnings.push("execution.providerID/modelID is incomplete; task will use the runtime default model")
  }

  const catchUpPolicy = task?.catchUpPolicy === "skip" ? "skip" : "run_once"
  const slots = scheduleResult.slots

  const payloads = slots.map((schedule, index) => ({
    title: slotTitle(name, index, slots.length),
    prompt,
    schedule,
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    catchUpPolicy,
  }))

  return {
    status: "ready",
    payloads,
    pause: task?.enabled === false,
    warnings,
  }
}
