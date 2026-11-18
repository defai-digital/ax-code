import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { JsonNumber } from "@/util/schema"

// Full-cron search horizon. Day-skipping keeps this cheap; schedules with no
// occurrence inside the window (e.g. `0 0 29 2 *` checked right after a leap
// year) are rejected up front instead of persisting active-never-fires rows.
const CRON_SEARCH_DAYS = 4 * 366
const MS_PER_DAY = 24 * 60 * 60 * 1_000
export const MS_PER_MINUTE = 60 * 1_000

const MAX_COALESCE_ITERATIONS = 10_000
const JITTER_MAX_FRACTION = 0.1
// Capped below MISSED_RUN_GRACE_MS (minus poll latency) so a jitter-delayed
// on-time fire can never be misclassified as missed.
const JITTER_MAX_MS = 3 * 60 * 1_000

// Thrown when a schedule is syntactically shaped but semantically unusable
// (bad time-of-day, unparseable cron, invalid timezone, or a one-time run
// that is already in the past). Mapped to a 400 by the server error mapper
// so clients can correct their input.
export const InvalidSchedule = NamedError.create(
  "ScheduledTaskInvalidSchedule",
  z.object({ resource: z.string(), message: z.string() }),
)

const TimeOfDay = z.string().regex(/^\d{2}:\d{2}$/)
export const Schedule = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("once"),
    runAt: JsonNumber(z.number().int().positive()),
  }),
  z.object({
    type: z.literal("daily"),
    time: TimeOfDay,
    timezone: z.string().optional(),
  }),
  z.object({
    type: z.literal("weekly"),
    day: JsonNumber(z.number().int().min(0).max(6)),
    time: TimeOfDay,
    timezone: z.string().optional(),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().trim().min(1).max(120),
    timezone: z.string().optional(),
  }),
])
export type Schedule = z.infer<typeof Schedule>

// Reject schedules that parse structurally but can never produce a run, so the
// API does not create "active" tasks that silently never fire.
export function validateSchedule(schedule: Schedule, from = Date.now()): void {
  const timezone = "timezone" in schedule ? schedule.timezone : undefined
  if (timezone !== undefined && !isValidTimeZone(timezone)) {
    throw new InvalidSchedule({ resource: "schedule.timezone", message: `Invalid timezone: ${timezone}` })
  }
  switch (schedule.type) {
    case "once":
      // nextRunAt() only returns future timestamps, so a past one-time run
      // would persist as an active task that silently never fires.
      if (schedule.runAt <= from) {
        throw new InvalidSchedule({
          resource: "schedule.runAt",
          message: `One-time run timestamp is not in the future: ${schedule.runAt}`,
        })
      }
      break
    case "daily":
    case "weekly":
      if (!parseTimeOfDay(schedule.time)) {
        throw new InvalidSchedule({ resource: "schedule.time", message: `Invalid time of day: ${schedule.time}` })
      }
      break
    case "cron": {
      const next = makeCronSearch(schedule.expression, schedule.timezone)
      if (!next) {
        throw new InvalidSchedule({
          resource: "schedule.cron",
          message: `Invalid or unsupported cron expression: ${schedule.expression}`,
        })
      }
      if (next(from) === undefined) {
        throw new InvalidSchedule({
          resource: "schedule.cron",
          message: `Cron expression has no occurrence within the search window: ${schedule.expression}`,
        })
      }
      break
    }
  }
}

export function nextRunAt(schedule: Schedule, from = Date.now()): number | undefined {
  switch (schedule.type) {
    case "once":
      return schedule.runAt > from ? schedule.runAt : undefined
    case "daily":
      return nextCalendarRun(schedule.time, from, schedule.timezone)
    case "weekly":
      return nextCalendarRun(schedule.time, from, schedule.timezone, schedule.day)
    case "cron":
      return makeCronSearch(schedule.expression, schedule.timezone)?.(from)
  }
}

// Use the gap following the stored due occurrence. An uneven cron cadence
// must not switch to a different gap just because the polling clock advanced.
export function jitterOffsetMs(task: { id: string; schedule: Schedule }, occurrenceAt?: number): number {
  if (task.schedule.type === "once") return 0
  const first = occurrenceAt ?? nextRunAt(task.schedule)
  const period = first === undefined ? 0 : (nextRunAt(task.schedule, first) ?? first) - first
  const interval = Number.isFinite(period) && period > 0 ? period : MS_PER_DAY
  const cap = Math.min(interval * JITTER_MAX_FRACTION, JITTER_MAX_MS)
  return Math.floor(cap * fractionFromId(task.id))
}

function fractionFromId(id: string): number {
  let hash = 5381
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0
  }
  return (hash >>> 0) / 0x1_0000_0000
}

export function formatCoalescedCount(count: number): string {
  return count >= MAX_COALESCE_ITERATIONS ? `${count}+` : String(count)
}

// Count occurrences being coalesced into a single run: iterate forward from the
// stored due occurrence while still <= now, bounded to avoid pathological loops.
export function countCoalesced(
  schedule: Schedule,
  firstOccurrence: number,
  now: number,
): { count: number; lastOccurrence: number } {
  const next =
    schedule.type === "cron"
      ? makeCronSearch(schedule.expression, schedule.timezone)
      : (from: number) => nextRunAt(schedule, from)
  let count = 1
  let last = firstOccurrence
  while (next && count < MAX_COALESCE_ITERATIONS) {
    const occurrence = next(last)
    if (occurrence === undefined || occurrence > now) break
    count++
    last = occurrence
  }
  return { count, lastOccurrence: last }
}

function isValidTimeZone(timezone: string): boolean {
  if (!timezone.trim()) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

// Full 5-field cron support (minute hour day-of-month month day-of-week). When
// both day-of-month and day-of-week are restricted the match is OR (POSIX/Vixie);
// otherwise both must match. A field is unrestricted when it begins with "*"
// (so "*" and "*/step" both qualify). Month always ANDs.
interface ParsedCron {
  minutes: Set<number>
  hours: Set<number>
  doms: Set<number>
  months: Set<number>
  dows: Set<number>
  domRestricted: boolean
  dowRestricted: boolean
}

function parseCronExpressionFull(expression: string): ParsedCron | undefined {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const minutes = parseCronField(fields[0]!, 0, 59)
  const hours = parseCronField(fields[1]!, 0, 23)
  const doms = parseCronField(fields[2]!, 1, 31)
  const months = parseCronField(fields[3]!, 1, 12)
  const dows = parseCronDowField(fields[4]!)
  if (!minutes || !hours || !doms || !months || !dows) return undefined
  return {
    minutes,
    hours,
    doms,
    months,
    dows,
    // Vixie sets DOM_STAR/DOW_STAR when the field *begins* with '*', so a
    // stepped field such as "*/2" is unrestricted rather than restricted.
    domRestricted: !fields[2].startsWith("*"),
    dowRestricted: !fields[4].startsWith("*"),
  }
}

function parseCronDowField(value: string): Set<number> | undefined {
  const set = parseCronField(value, 0, 7)
  if (!set) return undefined
  // cron allows 7 as an alias for Sunday (0)
  if (set.has(7)) {
    set.delete(7)
    set.add(0)
  }
  return set
}

function cronDayMatches(
  day: number,
  weekday: number,
  parsed: Pick<ParsedCron, "doms" | "dows" | "domRestricted" | "dowRestricted">,
): boolean {
  const domMatch = parsed.doms.has(day)
  const dowMatch = parsed.dows.has(weekday)
  if (parsed.domRestricted && parsed.dowRestricted) return domMatch || dowMatch
  return domMatch && dowMatch
}

function makeTzFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
}

const TZ_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function tzComponents(ms: number, fmt: Intl.DateTimeFormat) {
  const parts = fmt.formatToParts(new Date(ms)).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value
    return acc
  }, {})
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: TZ_WEEKDAYS.indexOf(parts.weekday!),
  }
}

type TzComponents = ReturnType<typeof tzComponents>

function tzDateKey(value: TzComponents) {
  return `${value.year}-${value.month}-${value.day}`
}

// During a DST fall-back, a wall-clock minute can occur twice. Daily and
// weekly schedules represent calendar occurrences, so once the requested
// minute has happened on the current local date, ignore its repeated copy.
function tzOccurrenceAlreadyPassed(from: number, fmt: Intl.DateTimeFormat, match: (value: TzComponents) => boolean) {
  const currentDate = tzDateKey(tzComponents(from, fmt))
  let ms = from - (from % 60_000)
  for (let i = 0; i < 26 * 60; i++, ms -= 60_000) {
    const value = tzComponents(ms, fmt)
    if (tzDateKey(value) !== currentDate) return false
    if (match(value)) return true
  }
  return false
}

function nextLocalCalendarRun(parts: { hour: number; minute: number }, from: number, weekday?: number) {
  const start = new Date(from)
  for (let offset = 0; offset < (weekday === undefined ? 3 : 15); offset++) {
    // Construct each calendar occurrence independently. Date normalizes a DST
    // gap forward; reject that shifted time rather than carrying it to later days.
    const candidate = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + offset,
      parts.hour,
      parts.minute,
    )
    if (candidate.getHours() !== parts.hour || candidate.getMinutes() !== parts.minute) continue
    if (weekday !== undefined && candidate.getDay() !== weekday) continue
    if (candidate.getTime() > from) return candidate.getTime()
  }
  return undefined
}

function nextCalendarRun(time: string, from: number, timezone?: string, weekday?: number): number | undefined {
  const parts = parseTimeOfDay(time)
  if (!parts) return undefined
  if (!timezone) return nextLocalCalendarRun(parts, from, weekday)

  const fmt = makeTzFormatter(timezone)
  const currentDate = tzDateKey(tzComponents(from, fmt))
  const matches = (value: TzComponents) =>
    value.hour === parts.hour && value.minute === parts.minute && (weekday === undefined || value.weekday === weekday)
  const alreadyPassed = tzOccurrenceAlreadyPassed(from, fmt, matches)
  // A missing spring-forward occurrence can put the next weekly run nearly
  // fourteen days away.
  const days = weekday === undefined ? 2 : 15
  let ms = from - (from % MS_PER_MINUTE) + MS_PER_MINUTE
  for (let i = 0; i < days * 24 * 60; i++, ms += MS_PER_MINUTE) {
    const candidate = tzComponents(ms, fmt)
    if (!matches(candidate)) continue
    if (alreadyPassed && tzDateKey(candidate) === currentDate) continue
    return ms
  }
  return undefined
}

function makeCronSearch(expression: string, timezone?: string): ((from: number) => number | undefined) | undefined {
  const parsed = parseCronExpressionFull(expression)
  if (!parsed) return undefined
  const formatter = timezone ? makeTzFormatter(timezone) : undefined
  return (from) => nextCronRun(parsed, from, formatter)
}

// Full-cron next occurrence. Day-skipping keeps the search cheap across the
// multi-year horizon: non-matching month/day jumps forward (to the next local
// midnight without a timezone, or a coarse 6h step with one) and only matching
// days are minute-scanned. The tz branch backs up to the local day start after a
// coarse skip so early-in-day occurrences are never missed.
function nextCronRun(parsed: ParsedCron, from: number, fmt?: Intl.DateTimeFormat): number | undefined {
  const horizonMs = CRON_SEARCH_DAYS * MS_PER_DAY
  const endMs = from + horizonMs
  const startMs = from - (from % MS_PER_MINUTE) + MS_PER_MINUTE
  let ms = startMs

  if (!fmt) {
    while (ms < endMs) {
      const d = new Date(ms)
      const monthMatch = parsed.months.has(d.getMonth() + 1)
      const dayMatch = cronDayMatches(d.getDate(), d.getDay(), parsed)
      if (!monthMatch || !dayMatch) {
        ms = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
        continue
      }
      const dayKey = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
      while (ms < endMs) {
        const dd = new Date(ms)
        const dk = dd.getFullYear() * 10000 + (dd.getMonth() + 1) * 100 + dd.getDate()
        if (dk !== dayKey) break
        if (parsed.minutes.has(dd.getMinutes()) && parsed.hours.has(dd.getHours()) && !isLocalRepeatedWallMinute(ms))
          return ms
        ms += 60_000
      }
    }
    return undefined
  }

  while (ms < endMs) {
    const c = tzComponents(ms, fmt)
    if (!parsed.months.has(c.month) || !cronDayMatches(c.day, c.weekday, parsed)) {
      ms += 6 * 60 * 60 * 1000
      continue
    }
    const dateKey = tzDateKey(c)
    // Back up to the start of this local day (a coarse skip may have landed
    // mid-day); bounded by the maximum possible day length (~25h, DST fall-back).
    let scan = ms
    for (let i = 0; i < 26 * 60 && scan > startMs; i++) {
      const prev = scan - MS_PER_MINUTE
      if (tzDateKey(tzComponents(prev, fmt)) !== dateKey) break
      scan = prev
    }
    let cursor = scan
    let advanced = false
    for (let i = 0; i < 26 * 60 && cursor < endMs; i++, cursor += 60_000) {
      const cc = tzComponents(cursor, fmt)
      if (tzDateKey(cc) !== dateKey) {
        advanced = true
        break
      }
      if (parsed.minutes.has(cc.minute) && parsed.hours.has(cc.hour) && !isTzRepeatedWallMinute(cursor, fmt, cc))
        return cursor
    }
    ms = advanced ? cursor : cursor + 60_000
  }
  return undefined
}

// During a DST fall-back the same wall-clock minute occurs twice. Cron shares
// the calendar-occurrence semantics of daily/weekly schedules: fire on the
// first occurrence only, so a candidate whose identical wall minute already
// happened earlier on the same local date is the repeated copy and is skipped.
// A repeat is only possible when the zone offset decreased within the last few
// hours (every IANA fall-back shift is well under three), which gates the
// precise backward scan off the common path.
const FALLBACK_REPEAT_WINDOW_MS = 3 * 60 * 60 * 1_000
const FALLBACK_REPEAT_WINDOW_MINUTES = FALLBACK_REPEAT_WINDOW_MS / MS_PER_MINUTE

function localOffsetMs(ms: number): number {
  const base = ms - (ms % MS_PER_MINUTE)
  const d = new Date(base)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - base
}

function isLocalRepeatedWallMinute(ms: number): boolean {
  if (localOffsetMs(ms - FALLBACK_REPEAT_WINDOW_MS) <= localOffsetMs(ms)) return false
  const target = new Date(ms)
  const targetDay = target.getFullYear() * 10000 + (target.getMonth() + 1) * 100 + target.getDate()
  for (let back = 1; back <= FALLBACK_REPEAT_WINDOW_MINUTES; back++) {
    const c = new Date(ms - back * MS_PER_MINUTE)
    const day = c.getFullYear() * 10000 + (c.getMonth() + 1) * 100 + c.getDate()
    if (day !== targetDay) return false
    if (c.getHours() === target.getHours() && c.getMinutes() === target.getMinutes()) return true
  }
  return false
}

function tzOffsetMs(ms: number, fmt: Intl.DateTimeFormat): number {
  const base = ms - (ms % MS_PER_MINUTE)
  const c = tzComponents(base, fmt)
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) - base
}

function isTzRepeatedWallMinute(ms: number, fmt: Intl.DateTimeFormat, target: TzComponents): boolean {
  if (tzOffsetMs(ms - FALLBACK_REPEAT_WINDOW_MS, fmt) <= tzOffsetMs(ms, fmt)) return false
  const key = tzDateKey(target)
  for (let back = 1; back <= FALLBACK_REPEAT_WINDOW_MINUTES; back++) {
    const c = tzComponents(ms - back * MS_PER_MINUTE, fmt)
    if (tzDateKey(c) !== key) return false
    if (c.hour === target.hour && c.minute === target.minute) return true
  }
  return false
}

function parseCronField(value: string, min: number, max: number): Set<number> | undefined {
  if (value === "*") return rangeSet(min, max)
  const result = new Set<number>()
  for (const part of value.split(",")) {
    if (part === "") return undefined
    const stepMatch = /^(\*|(\d+)-(\d+))\/(\d+)$/.exec(part)
    if (stepMatch) {
      const lo = stepMatch[1] === "*" ? min : Number(stepMatch[2])
      const hi = stepMatch[1] === "*" ? max : Number(stepMatch[3])
      const step = Number(stepMatch[4])
      if (!Number.isInteger(step) || step < 1 || lo < min || hi > max || lo > hi) return undefined
      for (let v = lo; v <= hi; v += step) result.add(v)
      continue
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part)
    if (rangeMatch) {
      const lo = Number(rangeMatch[1])
      const hi = Number(rangeMatch[2])
      if (lo < min || hi > max || lo > hi) return undefined
      for (let v = lo; v <= hi; v++) result.add(v)
      continue
    }
    // A bare field must be decimal digits. Number() alone would accept
    // "1e1", "0x10" and "+5" as valid cron values.
    if (!/^\d+$/.test(part)) return undefined
    const number = Number(part)
    if (number < min || number > max) return undefined
    result.add(number)
  }
  return result.size > 0 ? result : undefined
}

function rangeSet(min: number, max: number) {
  const result = new Set<number>()
  for (let value = min; value <= max; value++) result.add(value)
  return result
}

function parseTimeOfDay(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return { hour, minute }
}
