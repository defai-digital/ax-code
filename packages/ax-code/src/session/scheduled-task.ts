import z from "zod"
import { HTTPException } from "hono/http-exception"
import { NamedError } from "@ax-code/util/error"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { ProjectID } from "@/project/schema"
import { NotFoundError, and, asc, desc, eq, lte } from "@/storage/db"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import { JsonBoolean, JsonNumber } from "@/util/schema"
import { ScheduledTaskID } from "./schema"
import { ScheduledTaskTable } from "./session.sql"
import { SessionShard } from "./shard"
import { TaskQueue } from "./task-queue"
import { WorkflowRun as WorkflowRunState, type WorkflowRunDetail } from "@/workflow/state"

type WorkflowTemplateID = import("@/workflow/template").WorkflowTemplate.ID
type WorkflowStartOptions = import("@/workflow/scheduler").WorkflowScheduler.StartOptions

export namespace ScheduledTask {
  const log = Log.create({ service: "session.scheduled-task" })
  const MISSED_RUN_GRACE_MS = 5 * 60 * 1_000

  export const Status = z.enum(["active", "paused", "disabled"])
  export type Status = z.infer<typeof Status>
  export const CatchUpPolicy = z.enum(["skip", "run_once"])
  export type CatchUpPolicy = z.infer<typeof CatchUpPolicy>

  // Thrown when a schedule is syntactically shaped but semantically unusable
  // (bad time-of-day, unparseable cron, or invalid timezone). Mapped to a 400
  // by the server error mapper so clients can correct their input.
  export const InvalidSchedule = NamedError.create(
    "ScheduledTaskInvalidSchedule",
    z.object({ resource: z.string(), message: z.string() }),
  )

  const WorkflowTemplateIDSchema = z
    .string()
    .min(1)
    .max(120)
    .regex(/^(builtin|user|project):[a-z][a-z0-9-]*$/)
  const WorkflowStartOptionsSchema = z.object({
    allowScaleBeyondDefaults: JsonBoolean.optional(),
    allowWriteWorkflows: JsonBoolean.optional(),
    durableChildren: JsonBoolean.optional(),
    enqueueChildren: JsonBoolean.optional(),
  })
  const WorkflowRunSummary = z
    .object({
      id: z.string().min(1),
      status: WorkflowRunState.Status,
      sourceTemplateID: z.string().optional(),
      error: z.string().optional(),
    })
    .passthrough()

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
    workflowTemplateID: WorkflowTemplateIDSchema.optional(),
    workflowStartOptions: WorkflowStartOptionsSchema.optional(),
    lastQueueID: z.string().optional(),
    lastWorkflowRunID: z.string().optional(),
    error: z.string().optional(),
    nextRunAt: z.number().optional(),
    lastRunAt: z.number().optional(),
    catchUpPolicy: CatchUpPolicy,
    maxRunDurationMs: z
      .number()
      .int()
      .min(1_000)
      .max(72 * 60 * 60 * 1_000)
      .optional(),
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
    workflowTemplateID: WorkflowTemplateIDSchema.optional(),
    workflowStartOptions: WorkflowStartOptionsSchema.optional(),
    catchUpPolicy: CatchUpPolicy.optional().default("run_once"),
    maxRunDurationMs: JsonNumber(
      z
        .number()
        .int()
        .min(1_000)
        .max(72 * 60 * 60 * 1_000),
    ).optional(),
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
    workflowTemplateID: WorkflowTemplateIDSchema.optional(),
    workflowStartOptions: WorkflowStartOptionsSchema.optional(),
    catchUpPolicy: CatchUpPolicy.optional(),
    maxRunDurationMs: JsonNumber(
      z
        .number()
        .int()
        .min(1_000)
        .max(72 * 60 * 60 * 1_000),
    )
      .nullable()
      .optional(),
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
    queueItem: TaskQueue.Info.optional(),
    workflowRun: WorkflowRunSummary.optional(),
  })
  export type RunNowResult = Omit<z.infer<typeof RunNowResult>, "workflowRun"> & {
    workflowRun?: WorkflowRunDetail
  }

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

  function fromRowInput(row: typeof ScheduledTaskTable.$inferSelect) {
    return {
      id: row.id,
      projectID: row.project_id,
      directory: row.directory,
      title: row.title,
      prompt: row.prompt,
      schedule: row.schedule,
      status: row.status,
      agent: row.agent ?? undefined,
      model: row.model ?? undefined,
      workflowTemplateID: row.workflow_template_id ?? undefined,
      workflowStartOptions: row.workflow_start_options ?? undefined,
      lastQueueID: row.last_queue_id ?? undefined,
      lastWorkflowRunID: row.last_workflow_run_id ?? undefined,
      error: row.error ?? undefined,
      nextRunAt: row.next_run_at ?? undefined,
      lastRunAt: row.last_run_at ?? undefined,
      catchUpPolicy: row.catch_up_policy,
      maxRunDurationMs: row.max_run_duration_ms ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated ?? undefined,
      },
    }
  }

  function fromRow(row: typeof ScheduledTaskTable.$inferSelect): Info {
    return Info.parse(fromRowInput(row))
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
    return SessionShard.storeForProject(Instance.project.id).use((db) => {
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
      // A single corrupt row must not wedge the scheduler tick or 500 the list
      // endpoint — skip rows whose persisted schedule no longer parses.
      return query.all().flatMap((row) => {
        const result = Info.safeParse(fromRowInput(row))
        if (result.success) return [result.data]
        log.warn("skipping corrupt scheduled task row", { id: row.id })
        return []
      })
    })
  }

  export async function create(input: CreateInput): Promise<Info> {
    const parsed = CreateInput.parse(input)
    validateSchedule(parsed.schedule)
    const now = Date.now()
    const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
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
          workflow_template_id: parsed.workflowTemplateID,
          workflow_start_options: parsed.workflowStartOptions,
          catch_up_policy: parsed.catchUpPolicy,
          max_run_duration_ms: parsed.maxRunDurationMs,
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
    const task = SessionShard.storeForProject(Instance.project.id).use((db) => {
      const row = db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).get()
      if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${id}` })
      return fromRow(row)
    })
    assertProjectTask(task)
    return task
  }

  export async function update(input: UpdateInput): Promise<Info> {
    const parsed = UpdateInput.parse(input)
    if (parsed.schedule !== undefined) validateSchedule(parsed.schedule)
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
    if (Object.hasOwn(parsed, "workflowTemplateID")) updates.workflow_template_id = parsed.workflowTemplateID
    if (Object.hasOwn(parsed, "workflowStartOptions")) updates.workflow_start_options = parsed.workflowStartOptions
    if (parsed.catchUpPolicy !== undefined) updates.catch_up_policy = parsed.catchUpPolicy
    if (Object.hasOwn(parsed, "maxRunDurationMs")) updates.max_run_duration_ms = parsed.maxRunDurationMs

    const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
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
    SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
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
    try {
      if (current.workflowTemplateID) return await runWorkflowNow(current)
      const queued = await TaskQueue.enqueue(scheduledQueueInput(current, Date.now(), "manual"))
      const now = Date.now()
      const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
        const row = db
          .update(ScheduledTaskTable)
          .set({
            last_queue_id: queued.id,
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
      // Commit the relationship before detached execution begins. Otherwise a
      // very fast failure can record an error and then have it erased by this
      // metadata write racing behind the executor.
      const { TaskQueueExecutor } = await import("./task-queue-executor")
      const queueItem = await TaskQueueExecutor.start(queued)
      return { task, queueItem }
    } catch (error) {
      await recordRunFailure(id, error).catch((recordError) => {
        log.warn("scheduled task failure record failed", { taskID: id, error: recordError })
      })
      throw error
    }
  }

  async function runWorkflowNow(current: Info): Promise<RunNowResult> {
    const { WorkflowTemplate } = await import("@/workflow/template")
    const { WorkflowScheduler } = await import("@/workflow/scheduler")
    const startOptions = WorkflowStartOptionsSchema.parse(current.workflowStartOptions ?? {}) as WorkflowStartOptions
    const run = await WorkflowTemplate.createRun({
      templateID: WorkflowTemplateIDSchema.parse(current.workflowTemplateID) as WorkflowTemplateID,
      sourceTaskID: current.id,
    })
    const workflowRun = await WorkflowScheduler.start(run.id, startOptions)
    const now = Date.now()
    const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      const row = db
        .update(ScheduledTaskTable)
        .set({
          last_workflow_run_id: workflowRun.id,
          last_run_at: now,
          error: null,
          time_updated: now,
        })
        .where(eq(ScheduledTaskTable.id, current.id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${current.id}` })
      return fromRow(row)
    })
    publishUpdated(task)
    return { task, workflowRun }
  }

  async function recordRunFailure(id: ScheduledTaskID, error: unknown): Promise<Info> {
    const now = Date.now()
    const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      const row = db
        .update(ScheduledTaskTable)
        .set({
          error: toErrorMessage(error),
          last_run_at: now,
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

  export async function runDue(now = Date.now()): Promise<RunNowResult[]> {
    const due = await list({ status: "active", dueBefore: now, limit: 50 })
    const results: RunNowResult[] = []
    for (const task of due) {
      if (task.nextRunAt === undefined || task.nextRunAt > now) continue
      const next = nextRunAt(task.schedule, now + 1)
      const missed = now - task.nextRunAt > MISSED_RUN_GRACE_MS
      const skip = task.catchUpPolicy === "skip" && missed
      const claimed = claimDueTask(task, next, skip, now)
      if (!claimed) continue
      publishUpdated(claimed.task)
      if (skip) {
        log.info("skipped missed scheduled task occurrence", {
          taskID: task.id,
          occurrenceAt: task.nextRunAt,
          nextRunAt: next,
        })
        continue
      }
      if (!claimed.queueItem) continue
      TaskQueue.publishEnqueued(claimed.queueItem)
      try {
        const { TaskQueueExecutor } = await import("./task-queue-executor")
        const queueItem = await TaskQueueExecutor.start(claimed.queueItem)
        results.push({ task: claimed.task, queueItem })
      } catch (error) {
        await recordQueueOutcome(task.id, "failed", error).catch((recordError) => {
          log.warn("scheduled task dispatch failure record failed", { taskID: task.id, error: recordError })
        })
        log.warn("scheduled task dispatch failed", { taskID: task.id, error })
      }
    }
    return results
  }

  function claimDueTask(task: Info, next: number | undefined, skip: boolean, now: number) {
    return SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
      const claimed = db
        .update(ScheduledTaskTable)
        .set({
          next_run_at: next ?? null,
          time_updated: now,
          ...(skip ? {} : { last_run_at: now, error: null }),
        })
        .where(
          and(
            eq(ScheduledTaskTable.id, task.id),
            eq(ScheduledTaskTable.status, "active"),
            eq(ScheduledTaskTable.next_run_at, task.nextRunAt!),
          ),
        )
        .returning()
        .get()
      if (!claimed) return undefined
      if (skip) return { task: fromRow(claimed) }

      const queueItem = TaskQueue.enqueueInTransaction(db, scheduledQueueInput(task, task.nextRunAt!, "scheduled"), {
        now,
      })
      const row = db
        .update(ScheduledTaskTable)
        .set({ last_queue_id: queueItem.id, time_updated: now })
        .where(eq(ScheduledTaskTable.id, task.id))
        .returning()
        .get()
      if (!row) throw new Error(`Scheduled task disappeared during queue handoff: ${task.id}`)
      return { task: fromRow(row), queueItem }
    })
  }

  function scheduledQueueInput(
    task: Info,
    occurrenceAt: number,
    reason: "manual" | "scheduled",
  ): TaskQueue.EnqueueInput {
    return {
      kind: "automation",
      title: task.title,
      agent: task.agent,
      model: task.model,
      sourceTaskID: task.id,
      executionTimeoutMs: task.maxRunDurationMs,
      payload: {
        scheduledTaskID: task.id,
        scheduledOccurrenceAt: occurrenceAt,
        scheduledReason: reason,
        prompt: task.prompt,
        schedule: task.schedule,
        workflowTemplateID: task.workflowTemplateID,
        workflowStartOptions: task.workflowStartOptions,
      },
    }
  }

  export async function recordQueueOutcome(
    id: ScheduledTaskID,
    status: "completed" | "failed",
    error?: unknown,
  ): Promise<Info> {
    const now = Date.now()
    const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      const row = db
        .update(ScheduledTaskTable)
        .set({
          error: status === "failed" ? toErrorMessage(error) : null,
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

  export async function recordWorkflowRun(id: ScheduledTaskID, workflowRunID: string): Promise<Info> {
    const now = Date.now()
    const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      const row = db
        .update(ScheduledTaskTable)
        .set({ last_workflow_run_id: workflowRunID, time_updated: now })
        .where(eq(ScheduledTaskTable.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${id}` })
      return fromRow(row)
    })
    publishUpdated(task)
    return task
  }

  export async function recordWorkflowOutcome(
    id: ScheduledTaskID,
    status: "completed" | "failed" | "cancelled",
    error?: unknown,
  ): Promise<Info> {
    return recordQueueOutcome(
      id,
      status === "completed" ? "completed" : "failed",
      error ?? (status === "cancelled" ? "Scheduled workflow was cancelled." : "Scheduled workflow failed."),
    )
  }

  function normalizeSchedulerPollMs(value: number | undefined) {
    if (value === undefined) return 60_000
    if (!Number.isFinite(value)) return 60_000
    return Math.max(10, value)
  }

  export function initScheduler(input: { pollMs?: number; keepAlive?: boolean } = {}) {
    const state = schedulerState()
    if (state.initialized) return
    state.initialized = true
    const pollMs = normalizeSchedulerPollMs(input.pollMs)
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
    // Preserve the historical default for callers that run a scheduler only
    // as part of a short-lived command. Long-running servers opt in from the
    // project bootstrap so scheduled work can keep their process alive.
    if (input.keepAlive !== true) state.interval.unref?.()
    tick()
  }

  // Reject schedules that parse structurally but can never produce a run, so the
  // API does not create "active" tasks that silently never fire.
  export function validateSchedule(schedule: Schedule): void {
    const timezone = "timezone" in schedule ? schedule.timezone : undefined
    if (timezone !== undefined && !isValidTimeZone(timezone)) {
      throw new InvalidSchedule({ resource: "schedule.timezone", message: `Invalid timezone: ${timezone}` })
    }
    switch (schedule.type) {
      case "daily":
      case "weekly":
        if (!parseTimeOfDay(schedule.time)) {
          throw new InvalidSchedule({ resource: "schedule.time", message: `Invalid time of day: ${schedule.time}` })
        }
        break
      case "cron":
        if (!isValidCronExpression(schedule.expression)) {
          throw new InvalidSchedule({
            resource: "schedule.cron",
            message: `Invalid or unsupported cron expression: ${schedule.expression}`,
          })
        }
        break
    }
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

function isValidTimeZone(timezone: string): boolean {
  if (!timezone.trim()) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

// Mirrors the field support of nextCronRun(): 5 fields, only minute/hour/dow are
// honored, and day-of-month/month must be "*". Reject anything the engine cannot
// actually schedule so we never persist an active-but-never-firing cron task.
function isValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false
  if (!parseCronField(fields[0]!, 0, 59)) return false
  if (!parseCronField(fields[1]!, 0, 23)) return false
  if (fields[2] !== "*" || fields[3] !== "*") return false
  if (!parseCronField(fields[4]!, 0, 6)) return false
  return true
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
