import z from "zod"
import { HTTPException } from "hono/http-exception"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { ProjectID } from "@/project/schema"
import { Database, NotFoundError, and, asc, desc, eq, lte } from "@/storage/db"
import { Log } from "@/util/log"
import { ScheduledTaskID } from "./schema"
import { ScheduledTaskTable } from "./session.sql"
import { TaskQueue } from "./task-queue"

export namespace ScheduledTask {
  const log = Log.create({ service: "session.scheduled-task" })

  export const Status = z.enum(["active", "paused", "disabled"])
  export type Status = z.infer<typeof Status>

  const TimeOfDay = z.string().regex(/^\d{2}:\d{2}$/)
  export const Schedule = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("once"),
      runAt: z.number().int().positive(),
    }),
    z.object({
      type: z.literal("daily"),
      time: TimeOfDay,
      timezone: z.string().optional(),
    }),
    z.object({
      type: z.literal("weekly"),
      day: z.number().int().min(0).max(6),
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

  export const Info = z.object({
    id: ScheduledTaskID.zod,
    projectID: ProjectID.zod,
    directory: z.string(),
    title: z.string(),
    prompt: z.string(),
    schedule: Schedule,
    status: Status,
    agent: z.string().optional(),
    model: z.unknown().optional(),
    lastQueueID: z.string().optional(),
    error: z.string().optional(),
    nextRunAt: z.number().optional(),
    lastRunAt: z.number().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number().optional(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(20_000),
    schedule: Schedule,
    agent: z.string().optional(),
    model: z.unknown().optional(),
  })
  export type CreateInput = z.input<typeof CreateInput>

  export const UpdateInput = z.object({
    id: ScheduledTaskID.zod,
    title: z.string().trim().min(1).max(200).optional(),
    prompt: z.string().trim().min(1).max(20_000).optional(),
    schedule: Schedule.optional(),
    status: Status.optional(),
    agent: z.string().optional(),
    model: z.unknown().optional(),
  })
  export type UpdateInput = z.input<typeof UpdateInput>

  export const ListInput = z.object({
    status: Status.optional(),
    dueBefore: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  export type ListInput = z.infer<typeof ListInput>

  export const RunNowResult = z.object({
    task: Info,
    queueItem: TaskQueue.Info,
  })
  export type RunNowResult = z.infer<typeof RunNowResult>

  export const Event = {
    Created: BusEvent.define("scheduled.task.created", z.object({ task: Info })),
    Updated: BusEvent.define("scheduled.task.updated", z.object({ task: Info })),
    Deleted: BusEvent.define(
      "scheduled.task.deleted",
      z.object({
        id: ScheduledTaskID.zod,
        projectID: ProjectID.zod,
      }),
    ),
  }

  const schedulerState = Instance.state(
    () => ({
      initialized: false,
      running: false,
      interval: undefined as ReturnType<typeof setInterval> | undefined,
    }),
    async (state) => {
      if (state.interval) clearInterval(state.interval)
      state.interval = undefined
      state.initialized = false
      state.running = false
    },
  )

  function fromRow(row: typeof ScheduledTaskTable.$inferSelect): Info {
    return Info.parse({
      id: row.id,
      projectID: row.project_id,
      directory: row.directory,
      title: row.title,
      prompt: row.prompt,
      schedule: row.schedule,
      status: row.status,
      agent: row.agent ?? undefined,
      model: row.model ?? undefined,
      lastQueueID: row.last_queue_id ?? undefined,
      error: row.error ?? undefined,
      nextRunAt: row.next_run_at ?? undefined,
      lastRunAt: row.last_run_at ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated ?? undefined,
      },
    })
  }

  function publishCreated(task: Info) {
    Bus.publishDetached(Event.Created, { task })
  }

  function publishUpdated(task: Info) {
    Bus.publishDetached(Event.Updated, { task })
  }

  function publishDeleted(task: Pick<Info, "id" | "projectID">) {
    Bus.publishDetached(Event.Deleted, task)
  }

  function assertProjectTask(task: Info) {
    if (task.projectID === Instance.project.id) return
    throw new HTTPException(409, {
      message: `Scheduled task ${task.id} belongs to a different project.`,
    })
  }

  export async function list(input: Partial<ListInput> = {}): Promise<Info[]> {
    const parsed = ListInput.partial().parse(input)
    const conditions = [eq(ScheduledTaskTable.project_id, Instance.project.id)]
    if (parsed.status) conditions.push(eq(ScheduledTaskTable.status, parsed.status))
    if (parsed.dueBefore) conditions.push(lte(ScheduledTaskTable.next_run_at, parsed.dueBefore))
    return Database.use((db) => {
      let query = db
        .select()
        .from(ScheduledTaskTable)
        .where(and(...conditions))
        .orderBy(
          asc(ScheduledTaskTable.next_run_at),
          desc(ScheduledTaskTable.time_created),
          desc(ScheduledTaskTable.id),
        )
        .$dynamic()
      if (parsed.limit) query = query.limit(parsed.limit)
      return query.all().map(fromRow)
    })
  }

  export async function create(input: CreateInput): Promise<Info> {
    const parsed = CreateInput.parse(input)
    const now = Date.now()
    const task = Database.use((db) => {
      const row = db
        .insert(ScheduledTaskTable)
        .values({
          id: ScheduledTaskID.ascending(),
          project_id: Instance.project.id,
          directory: Instance.directory,
          title: parsed.title,
          prompt: parsed.prompt,
          schedule: parsed.schedule,
          status: "active",
          agent: parsed.agent,
          model: parsed.model,
          next_run_at: nextRunAt(parsed.schedule, now),
          time_created: now,
          time_updated: now,
        })
        .returning()
        .get()
      return fromRow(row)
    })
    publishCreated(task)
    return task
  }

  export async function get(id: ScheduledTaskID): Promise<Info> {
    const task = Database.use((db) => {
      const row = db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).get()
      if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${id}` })
      return fromRow(row)
    })
    assertProjectTask(task)
    return task
  }

  export async function update(input: UpdateInput): Promise<Info> {
    const parsed = UpdateInput.parse(input)
    const current = await get(parsed.id)
    const now = Date.now()
    const nextSchedule = parsed.schedule ?? current.schedule
    const updates: Partial<typeof ScheduledTaskTable.$inferInsert> = {
      time_updated: now,
    }
    if (parsed.title !== undefined) updates.title = parsed.title
    if (parsed.prompt !== undefined) updates.prompt = parsed.prompt
    if (parsed.schedule !== undefined) {
      updates.schedule = parsed.schedule
      updates.next_run_at = nextRunAt(parsed.schedule, now) ?? null
    } else if (parsed.status === "active" && current.status !== "active") {
      updates.next_run_at = nextRunAt(nextSchedule, now) ?? null
    }
    if (parsed.status !== undefined) updates.status = parsed.status
    if (Object.hasOwn(parsed, "agent")) updates.agent = parsed.agent
    if (Object.hasOwn(parsed, "model")) updates.model = parsed.model

    const task = Database.use((db) => {
      const row = db
        .update(ScheduledTaskTable)
        .set(updates)
        .where(eq(ScheduledTaskTable.id, parsed.id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${parsed.id}` })
      return fromRow(row)
    })
    assertProjectTask(task)
    publishUpdated(task)
    return task
  }

  export function pause(id: ScheduledTaskID): Promise<Info> {
    return update({ id, status: "paused" })
  }

  export function resume(id: ScheduledTaskID): Promise<Info> {
    return update({ id, status: "active" })
  }

  export async function remove(id: ScheduledTaskID): Promise<boolean> {
    const task = await get(id)
    Database.use((db) => {
      db.delete(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).run()
    })
    publishDeleted(task)
    return true
  }

  export async function runNow(id: ScheduledTaskID): Promise<RunNowResult> {
    const current = await get(id)
    if (current.status === "disabled") {
      throw new HTTPException(409, { message: `Scheduled task ${id} is disabled.` })
    }
    const queueItem = await TaskQueue.enqueue({
      kind: "automation",
      title: current.title,
      agent: current.agent,
      model: current.model,
      sourceTaskID: current.id,
      payload: {
        scheduledTaskID: current.id,
        prompt: current.prompt,
        schedule: current.schedule,
      },
    })
    const now = Date.now()
    const task = Database.use((db) => {
      const row = db
        .update(ScheduledTaskTable)
        .set({
          last_queue_id: queueItem.id,
          last_run_at: now,
          error: null,
          time_updated: now,
        })
        .where(eq(ScheduledTaskTable.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${id}` })
      return fromRow(row)
    })
    publishUpdated(task)
    return { task, queueItem }
  }

  export async function runDue(now = Date.now()): Promise<RunNowResult[]> {
    const due = await list({ status: "active", dueBefore: now, limit: 50 })
    const results: RunNowResult[] = []
    for (const task of due) {
      if (task.nextRunAt === undefined || task.nextRunAt > now) continue
      const result = await runNow(task.id)
      const next = nextRunAt(task.schedule, now + 1)
      await updateNextRunAt(task.id, next)
      results.push(result)
    }
    return results
  }

  export function initScheduler(input: { pollMs?: number } = {}) {
    const state = schedulerState()
    if (state.initialized) return
    state.initialized = true
    const pollMs = Math.max(10, input.pollMs ?? 60_000)
    // Bind the tick to the current Instance async context so that
    // runDue() can access Instance.project when the interval fires
    // outside the original provide() call.
    const tick = Instance.bind(() => {
      if (state.running) return
      state.running = true
      void runDue()
        .catch((error) => {
          log.warn("scheduled task due run failed", { error })
        })
        .finally(() => {
          state.running = false
        })
    })
    state.interval = setInterval(tick, pollMs)
    state.interval.unref?.()
    tick()
  }

  async function updateNextRunAt(id: ScheduledTaskID, next: number | undefined): Promise<Info> {
    const now = Date.now()
    const task = Database.use((db) => {
      const row = db
        .update(ScheduledTaskTable)
        .set({
          next_run_at: next ?? null,
          time_updated: now,
        })
        .where(eq(ScheduledTaskTable.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${id}` })
      return fromRow(row)
    })
    publishUpdated(task)
    return task
  }

  export function nextRunAt(schedule: Schedule, from = Date.now()): number | undefined {
    switch (schedule.type) {
      case "once":
        return schedule.runAt > from ? schedule.runAt : undefined
      case "daily":
        return nextDailyRun(schedule.time, from, schedule.timezone)
      case "weekly":
        return nextWeeklyRun(schedule.day, schedule.time, from, schedule.timezone)
      case "cron":
        return nextCronRun(schedule.expression, from, schedule.timezone)
    }
  }
}

function makeTzFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

const TZ_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function tzComponents(ms: number, fmt: Intl.DateTimeFormat) {
  const parts = fmt.formatToParts(new Date(ms)).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value
    return acc
  }, {})
  return {
    hour: Number(parts.hour) % 24, // hour12:false may emit "24" for midnight
    minute: Number(parts.minute),
    weekday: TZ_WEEKDAYS.indexOf(parts.weekday!),
  }
}

function nextDailyRun(time: string, from: number, timezone?: string) {
  const parts = parseTimeOfDay(time)
  if (!parts) return undefined
  if (!timezone) {
    const candidate = new Date(from)
    candidate.setSeconds(0, 0)
    candidate.setHours(parts.hour, parts.minute, 0, 0)
    if (candidate.getTime() <= from) candidate.setDate(candidate.getDate() + 1)
    return candidate.getTime()
  }
  const fmt = makeTzFormatter(timezone)
  let ms = from - (from % 60_000) + 60_000
  for (let i = 0; i < 2 * 24 * 60; i++, ms += 60_000) {
    const c = tzComponents(ms, fmt)
    if (c.hour === parts.hour && c.minute === parts.minute) return ms
  }
  return undefined
}

function nextWeeklyRun(day: number, time: string, from: number, timezone?: string) {
  if (!timezone) {
    const next = nextDailyRun(time, from)
    if (next === undefined) return undefined
    const candidate = new Date(next)
    const delta = (day - candidate.getDay() + 7) % 7
    candidate.setDate(candidate.getDate() + delta)
    if (candidate.getTime() <= from) candidate.setDate(candidate.getDate() + 7)
    return candidate.getTime()
  }
  const parts = parseTimeOfDay(time)
  if (!parts) return undefined
  const fmt = makeTzFormatter(timezone)
  let ms = from - (from % 60_000) + 60_000
  for (let i = 0; i < 8 * 24 * 60; i++, ms += 60_000) {
    const c = tzComponents(ms, fmt)
    if (c.weekday === day && c.hour === parts.hour && c.minute === parts.minute) return ms
  }
  return undefined
}

function nextCronRun(expression: string, from: number, timezone?: string) {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const minutes = parseCronField(fields[0]!, 0, 59)
  const hours = parseCronField(fields[1]!, 0, 23)
  const daysOfWeek = parseCronField(fields[4]!, 0, 6)
  if (!minutes || !hours || !daysOfWeek) return undefined
  if (fields[2] !== "*" || fields[3] !== "*") return undefined

  let ms = from - (from % 60_000) + 60_000
  if (!timezone) {
    for (let i = 0; i < 366 * 24 * 60; i++, ms += 60_000) {
      const d = new Date(ms)
      if (minutes.has(d.getMinutes()) && hours.has(d.getHours()) && daysOfWeek.has(d.getDay())) return ms
    }
    return undefined
  }
  const fmt = makeTzFormatter(timezone)
  for (let i = 0; i < 366 * 24 * 60; i++, ms += 60_000) {
    const c = tzComponents(ms, fmt)
    if (minutes.has(c.minute) && hours.has(c.hour) && daysOfWeek.has(c.weekday)) return ms
  }
  return undefined
}

function parseCronField(value: string, min: number, max: number): Set<number> | undefined {
  if (value === "*") return rangeSet(min, max)
  const result = new Set<number>()
  for (const part of value.split(",")) {
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
    const number = Number(part)
    if (!Number.isInteger(number) || number < min || number > max) return undefined
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
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return { hour, minute }
}
