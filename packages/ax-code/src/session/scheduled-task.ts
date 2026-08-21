import z from "zod"
import { HTTPException } from "hono/http-exception"
import { NamedError } from "@ax-code/util/error"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { ProjectID } from "@/project/schema"
import { NotFoundError, and, asc, desc, eq, gt, lte, notInArray, sql } from "@/storage/db"
import type { Database } from "@/storage/db"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import { JsonBoolean, JsonNumber } from "@/util/schema"
import { ScheduledTaskID, ScheduledTaskRunID, type TaskQueueID } from "./schema"
import { ScheduledTaskTable, ScheduledTaskRunTable } from "./session.sql"
import { SessionShard } from "./shard"
import { TaskQueue } from "./task-queue"
import { WorkflowRun as WorkflowRunState, type WorkflowRunDetail } from "@/workflow/state"

type WorkflowTemplateID = import("@/workflow/template").WorkflowTemplate.ID
type WorkflowStartOptions = import("@/workflow/scheduler").WorkflowScheduler.StartOptions

export namespace ScheduledTask {
  const log = Log.create({ service: "session.scheduled-task" })
  const MISSED_RUN_GRACE_MS = 5 * 60 * 1_000

  // ADR-059 tuning. Run history is bounded per task; overlap / backoff state is
  // DERIVED from history rather than stored on `scheduled_task` (shards have no
  // ALTER path, so all new scheduler state lives in the new `scheduled_task_run`
  // table).
  export const RUN_HISTORY_LIMIT = 50
  const RUN_HISTORY_GC_THRESHOLD = RUN_HISTORY_LIMIT * 2
  export const MAX_CONSECUTIVE_FAILURES = 5
  const FAILURE_BACKOFF_BASE_MS = 60 * 1_000
  const FAILURE_BACKOFF_MAX_MS = 60 * 60 * 1_000
  export const MAX_PROJECT_ACTIVE_TASKS = 100
  const MAX_COALESCE_ITERATIONS = 10_000
  // Full-cron search horizon. Day-skipping keeps this cheap; schedules with no
  // occurrence inside the window (e.g. `0 0 29 2 *` checked right after a leap
  // year) are rejected up front instead of persisting active-never-fires rows.
  const CRON_SEARCH_DAYS = 4 * 366
  const DEFAULT_RUN_DEADLINE_MS = 30 * 60 * 1_000
  const ORPHAN_GRACE_MS = 10 * 60 * 1_000
  const ONESHOT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
  const JITTER_MAX_FRACTION = 0.1
  // Capped below MISSED_RUN_GRACE_MS (minus poll latency) so a jitter-delayed
  // on-time fire can never be misclassified as missed.
  const JITTER_MAX_MS = 3 * 60 * 1_000
  const MS_PER_DAY = 24 * 60 * 60 * 1_000
  const MS_PER_MINUTE = 60 * 1_000

  export const Status = z.enum(["active", "paused", "disabled"])
  export type Status = z.infer<typeof Status>
  export const CatchUpPolicy = z.enum(["skip", "run_once"])
  export type CatchUpPolicy = z.infer<typeof CatchUpPolicy>

  export const RunStatus = z.enum(["running", "completed", "failed", "timeout", "skipped_overlap", "missed_skip"])
  export type RunStatus = z.infer<typeof RunStatus>
  export const RunTrigger = z.enum(["scheduled", "manual"])
  export type RunTrigger = z.infer<typeof RunTrigger>

  // Thrown when a schedule is syntactically shaped but semantically unusable
  // (bad time-of-day, unparseable cron, invalid timezone, or a one-time run
  // that is already in the past). Mapped to a 400 by the server error mapper
  // so clients can correct their input.
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

  export const RunInfo = z.object({
    id: ScheduledTaskRunID.zod,
    taskID: ScheduledTaskID.zod,
    projectID: ProjectID.zod,
    triggerType: RunTrigger,
    status: RunStatus,
    occurrenceAt: z.number().optional(),
    coalescedCount: z.number().int().min(1),
    queueID: z.string().optional(),
    workflowRunID: z.string().optional(),
    error: z.string().optional(),
    timeStarted: z.number().optional(),
    timeCompleted: z.number().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number().optional(),
    }),
  })
  export type RunInfo = z.infer<typeof RunInfo>

  export const RunListInput = z.object({
    taskID: ScheduledTaskID.zod,
    limit: z.number().int().positive().max(500).optional(),
  })
  export type RunListInput = z.infer<typeof RunListInput>

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
    Fired: BusEvent.define("scheduled.task.fired", z.object({ task: Info, run: RunInfo })),
    Succeeded: BusEvent.define("scheduled.task.succeeded", z.object({ task: Info, run: RunInfo })),
    Failed: BusEvent.define("scheduled.task.failed", z.object({ task: Info, run: RunInfo })),
    Skipped: BusEvent.define("scheduled.task.skipped", z.object({ task: Info, run: RunInfo })),
    FailedPersistently: BusEvent.define("scheduled.task.failed_persistently", z.object({ task: Info })),
  }

  const schedulerState = Instance.state(
    () => ({
      initialized: false,
      running: false,
      lastRetentionAt: 0,
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

  function runFromRow(row: typeof ScheduledTaskRunTable.$inferSelect): RunInfo {
    return RunInfo.parse({
      id: row.id,
      taskID: row.task_id,
      projectID: row.project_id,
      triggerType: row.trigger_type,
      status: row.status,
      occurrenceAt: row.occurrence_at ?? undefined,
      coalescedCount: row.coalesced_count,
      queueID: row.queue_id ?? undefined,
      workflowRunID: row.workflow_run_id ?? undefined,
      error: row.error ?? undefined,
      timeStarted: row.time_started ?? undefined,
      timeCompleted: row.time_completed ?? undefined,
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

  function publishFired(task: Info, run: RunInfo) {
    Bus.publishDetached(Event.Fired, { task, run })
  }

  function publishSucceeded(task: Info, run: RunInfo) {
    Bus.publishDetached(Event.Succeeded, { task, run })
  }

  function publishFailed(task: Info, run: RunInfo) {
    Bus.publishDetached(Event.Failed, { task, run })
  }

  function publishSkipped(task: Info, run: RunInfo) {
    Bus.publishDetached(Event.Skipped, { task, run })
  }

  function publishFailedPersistently(task: Info) {
    Bus.publishDetached(Event.FailedPersistently, { task })
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

  export async function listRuns(input: RunListInput): Promise<RunInfo[]> {
    const parsed = RunListInput.parse(input)
    // Asserts existence + project ownership before reading history.
    await get(parsed.taskID)
    return SessionShard.storeForProject(Instance.project.id).use((db) => {
      return db
        .select()
        .from(ScheduledTaskRunTable)
        .where(eq(ScheduledTaskRunTable.task_id, parsed.taskID))
        .orderBy(desc(ScheduledTaskRunTable.time_created), desc(ScheduledTaskRunTable.id))
        .limit(parsed.limit ?? RUN_HISTORY_LIMIT)
        .all()
        .flatMap((row) => {
          const result = RunInfo.safeParse(runFromRow(row))
          if (result.success) return [result.data]
          return []
        })
    })
  }

  export async function create(input: CreateInput): Promise<Info> {
    const parsed = CreateInput.parse(input)
    const now = Date.now()
    validateSchedule(parsed.schedule, now)
    assertWithinTaskCap()
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

  function assertWithinTaskCap() {
    const count = SessionShard.storeForProject(Instance.project.id).use((db) => {
      const row = db
        .select({ value: sql<number>`count(*)` })
        .from(ScheduledTaskTable)
        .where(
          and(
            eq(ScheduledTaskTable.project_id, Instance.project.id),
            notInArray(ScheduledTaskTable.status, ["disabled"]),
          ),
        )
        .get()
      return Number(row?.value ?? 0)
    })
    if (count >= MAX_PROJECT_ACTIVE_TASKS) {
      throw new HTTPException(409, {
        message: `This project already has ${count} scheduled tasks (limit ${MAX_PROJECT_ACTIVE_TASKS}). Delete or disable one before creating another.`,
      })
    }
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
    const current = await get(parsed.id)
    const now = Date.now()
    // Resuming an already-fired one-time task would re-run validateSchedule with
    // a now-past runAt and surface a confusing "not in the future" error. Give a
    // targeted message instead.
    if (
      parsed.status === "active" &&
      current.status !== "active" &&
      current.schedule.type === "once" &&
      current.schedule.runAt <= now
    ) {
      throw new InvalidSchedule({
        resource: "status",
        message: `This one-time task already ran${current.lastRunAt ? ` at ${new Date(current.lastRunAt).toISOString()}` : ""}; create a new task instead of resuming it.`,
      })
    }
    const nextSchedule = parsed.schedule ?? current.schedule
    if (parsed.schedule !== undefined || (parsed.status === "active" && current.status !== "active")) {
      validateSchedule(nextSchedule, now)
    }
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
    const now = Date.now()
    const deadlineMs = current.maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS
    reconcileOrphanRuns(id, now, deadlineMs)
    // Run-now honors overlap protection: it must not bypass the one-open-run rule.
    if (hasOpenRun(id, now, deadlineMs)) {
      throw new HTTPException(409, {
        message: `Scheduled task ${id} already has a run in progress; wait for it to finish.`,
      })
    }
    try {
      if (current.workflowTemplateID) return await runWorkflowNow(current)
      const queued = await TaskQueue.enqueue(scheduledQueueInput(current, now, "manual"))
      const { task, run } = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
        const runRow = insertRunRow(db, {
          taskID: id,
          triggerType: "manual",
          status: "running",
          occurrenceAt: now,
          coalescedCount: 1,
          queueID: queued.id,
          now,
        })
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
        return { task: fromRow(row), run: runRow }
      })
      publishUpdated(task)
      publishFired(task, run)
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
    const { task, run: runRow } = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction(
      (db) => {
        const runRow = insertRunRow(db, {
          taskID: current.id,
          triggerType: "manual",
          status: "running",
          occurrenceAt: now,
          coalescedCount: 1,
          workflowRunID: workflowRun.id,
          now,
        })
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
        return { task: fromRow(row), run: runRow }
      },
    )
    publishUpdated(task)
    publishFired(task, runRow)
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
      const deadlineMs = task.maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS
      reconcileOrphanRuns(task.id, now, deadlineMs)
      // Overlap protection: one open run per task. A still-running occurrence
      // skips this fire and records it, rather than double-executing.
      if (hasOpenRun(task.id, now, deadlineMs)) {
        const next = nextRunAt(task.schedule, now)
        const skipped = recordSkippedOccurrence(task, next, "skipped_overlap", now, 1)
        if (skipped) {
          publishUpdated(skipped.task)
          publishSkipped(skipped.task, skipped.run)
          log.info("skipped overlapping scheduled task occurrence", { taskID: task.id })
        }
        continue
      }
      // Missed detection is based on the NOMINAL schedule so jitter can never
      // corrupt catch-up accounting (council: grace/coalescing use nominal times).
      const missed = now - task.nextRunAt > MISSED_RUN_GRACE_MS
      // Deterministic anti-herd spread applies only to on-time fires and is capped
      // below the grace window, so a jitter-delayed task is never misread as missed.
      if (!missed && now < task.nextRunAt + jitterOffsetMs(task)) continue
      const coalesced = countCoalesced(task.schedule, task.nextRunAt, now)
      const skip = task.catchUpPolicy === "skip" && missed
      if (skip) {
        const next = nextRunAt(task.schedule, coalesced.lastOccurrence)
        const skipped = recordSkippedOccurrence(task, next, "missed_skip", now, coalesced.count, task.nextRunAt)
        if (skipped) {
          publishUpdated(skipped.task)
          publishSkipped(skipped.task, skipped.run)
          log.info("skipped missed scheduled task occurrence", {
            taskID: task.id,
            occurrenceAt: task.nextRunAt,
            coalescedCount: coalesced.count,
            nextRunAt: next,
          })
        }
        continue
      }
      const next = nextRunAt(task.schedule, coalesced.lastOccurrence)
      const claimed = claimDueTask(task, next, now, coalesced.count)
      if (!claimed) continue
      publishUpdated(claimed.task)
      publishFired(claimed.task, claimed.run)
      if (!claimed.queueItem) continue
      TaskQueue.publishEnqueued(claimed.queueItem)
      try {
        const { TaskQueueExecutor } = await import("./task-queue-executor")
        const queueItem = await TaskQueueExecutor.start(claimed.queueItem)
        results.push({ task: claimed.task, queueItem })
      } catch (error) {
        await recordQueueOutcome(task.id, "failed", error, claimed.queueItem.id).catch((recordError) => {
          log.warn("scheduled task dispatch failure record failed", { taskID: task.id, error: recordError })
        })
        log.warn("scheduled task dispatch failed", { taskID: task.id, error })
      }
    }
    return results
  }

  function claimDueTask(task: Info, next: number | undefined, now: number, coalescedCount: number) {
    return SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
      const claimed = db
        .update(ScheduledTaskTable)
        .set({
          next_run_at: next ?? null,
          time_updated: now,
          ...(task.schedule.type === "once" ? { status: "disabled" } : {}),
          last_run_at: now,
          error: null,
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

      // Claim freshness: build the queue payload from the row we just claimed
      // (RETURNING), not the pre-claim list read, so a concurrent edit to the
      // prompt/model/agent cannot be silently executed from a stale snapshot.
      const claimedTask = fromRow(claimed)
      const queueItem = TaskQueue.enqueueInTransaction(
        db,
        scheduledQueueInput(claimedTask, task.nextRunAt!, "scheduled", coalescedCount),
        { now },
      )
      const run = insertRunRow(db, {
        taskID: task.id,
        triggerType: "scheduled",
        status: "running",
        occurrenceAt: task.nextRunAt,
        coalescedCount,
        queueID: queueItem.id,
        now,
      })
      const row = db
        .update(ScheduledTaskTable)
        .set({ last_queue_id: queueItem.id, time_updated: now })
        .where(eq(ScheduledTaskTable.id, task.id))
        .returning()
        .get()
      if (!row) throw new Error(`Scheduled task disappeared during queue handoff: ${task.id}`)
      return { task: fromRow(row), queueItem, run }
    })
  }

  // CAS-advance a task whose occurrence is being skipped (overlap or missed-skip),
  // recording the skip as a terminal run row in the same transaction. Returns
  // undefined when another poller won the claim race.
  function recordSkippedOccurrence(
    task: Info,
    next: number | undefined,
    status: Extract<RunStatus, "skipped_overlap" | "missed_skip">,
    now: number,
    coalescedCount: number,
    occurrenceAt?: number,
  ): { task: Info; run: RunInfo } | undefined {
    return SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
      const claimed = db
        .update(ScheduledTaskTable)
        .set({ next_run_at: next ?? null, time_updated: now })
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
      const run = insertRunRow(db, {
        taskID: task.id,
        triggerType: "scheduled",
        status,
        occurrenceAt: occurrenceAt ?? task.nextRunAt,
        coalescedCount,
        now,
      })
      return { task: fromRow(claimed), run }
    })
  }

  function insertRunRow(
    db: Database.TxOrDb,
    input: {
      taskID: ScheduledTaskID
      triggerType: RunTrigger
      status: RunStatus
      occurrenceAt?: number
      coalescedCount: number
      queueID?: TaskQueueID
      workflowRunID?: string
      error?: string
      now: number
    },
  ): RunInfo {
    const terminal = input.status !== "running"
    const row = db
      .insert(ScheduledTaskRunTable)
      .values({
        id: ScheduledTaskRunID.ascending(),
        task_id: input.taskID,
        project_id: Instance.project.id,
        trigger_type: input.triggerType,
        status: input.status,
        occurrence_at: input.occurrenceAt,
        coalesced_count: input.coalescedCount,
        queue_id: input.queueID,
        workflow_run_id: input.workflowRunID,
        error: input.error,
        time_started: input.status === "running" ? input.now : undefined,
        time_completed: terminal ? input.now : undefined,
        time_created: input.now,
        time_updated: input.now,
      })
      .returning()
      .get()
    pruneRuns(db, input.taskID)
    return runFromRow(row)
  }

  // Bound per-task history. Only GC when clearly over the threshold to avoid
  // write amplification on hot tasks.
  function pruneRuns(db: any, taskID: ScheduledTaskID) {
    const countRow = db
      .select({ value: sql<number>`count(*)` })
      .from(ScheduledTaskRunTable)
      .where(eq(ScheduledTaskRunTable.task_id, taskID))
      .get()
    const count = Number(countRow?.value ?? 0)
    if (count <= RUN_HISTORY_GC_THRESHOLD) return
    const keepIDs = db
      .select({ id: ScheduledTaskRunTable.id })
      .from(ScheduledTaskRunTable)
      .where(eq(ScheduledTaskRunTable.task_id, taskID))
      .orderBy(desc(ScheduledTaskRunTable.time_created), desc(ScheduledTaskRunTable.id))
      .limit(RUN_HISTORY_LIMIT)
      .all()
      .map((row: { id: ScheduledTaskRunID }) => row.id)
    db.delete(ScheduledTaskRunTable)
      .where(and(eq(ScheduledTaskRunTable.task_id, taskID), notInArray(ScheduledTaskRunTable.id, keepIDs)))
      .run()
  }

  // True when the task has a non-terminal run that is not stale. A `running` row
  // older than the run deadline + grace is treated as orphaned (crash between
  // claim and outcome) and must not wedge the task forever.
  export function hasOpenRun(taskID: ScheduledTaskID, now: number, deadlineMs: number): boolean {
    const staleBefore = now - (deadlineMs + ORPHAN_GRACE_MS)
    return SessionShard.storeForProject(Instance.project.id).use((db) => {
      const row = db
        .select({ id: ScheduledTaskRunTable.id })
        .from(ScheduledTaskRunTable)
        .where(
          and(
            eq(ScheduledTaskRunTable.task_id, taskID),
            eq(ScheduledTaskRunTable.status, "running"),
            gt(ScheduledTaskRunTable.time_started, staleBefore),
          ),
        )
        .limit(1)
        .get()
      return row !== undefined
    })
  }

  function reconcileOrphanRuns(taskID: ScheduledTaskID, now: number, deadlineMs: number): void {
    const staleBefore = now - (deadlineMs + ORPHAN_GRACE_MS)
    SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      db.update(ScheduledTaskRunTable)
        .set({
          status: "failed",
          error: "orphaned: no outcome was recorded (backend likely restarted)",
          time_completed: now,
          time_updated: now,
        })
        .where(
          and(
            eq(ScheduledTaskRunTable.task_id, taskID),
            eq(ScheduledTaskRunTable.status, "running"),
            lte(ScheduledTaskRunTable.time_started, staleBefore),
          ),
        )
        .run()
    })
  }

  // Count trailing failed/timeout runs since the last completed run. Skipped
  // occurrences do not participate (they are not execution outcomes).
  function consecutiveFailures(taskID: ScheduledTaskID): number {
    const rows = SessionShard.storeForProject(Instance.project.id).use((db) => {
      return db
        .select({ status: ScheduledTaskRunTable.status })
        .from(ScheduledTaskRunTable)
        .where(eq(ScheduledTaskRunTable.task_id, taskID))
        .orderBy(desc(ScheduledTaskRunTable.time_created), desc(ScheduledTaskRunTable.id))
        .limit(RUN_HISTORY_LIMIT)
        .all()
    })
    let count = 0
    for (const row of rows) {
      if (row.status === "failed" || row.status === "timeout") {
        count++
        continue
      }
      if (row.status === "completed") break
      // running / skipped rows: keep scanning backward for a terminal outcome
    }
    return count
  }

  function scheduledQueueInput(
    task: Info,
    occurrenceAt: number,
    reason: "manual" | "scheduled",
    coalescedCount = 1,
  ): TaskQueue.EnqueueInput {
    const prompt =
      coalescedCount > 1 ? withCoalesceEnvelope(task.prompt, coalescedCount, occurrenceAt, task.lastRunAt) : task.prompt
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
        scheduledCoalescedCount: coalescedCount,
        prompt,
        schedule: task.schedule,
        workflowTemplateID: task.workflowTemplateID,
        workflowStartOptions: task.workflowStartOptions,
      },
    }
  }

  function withCoalesceEnvelope(prompt: string, count: number, occurrenceAt: number, lastRunAt?: number): string {
    const since = new Date(occurrenceAt).toISOString()
    const lastExec = lastRunAt ? new Date(lastRunAt).toISOString() : "never"
    return (
      `[scheduled task] This run covers ${count} scheduled occurrences missed since ${since} ` +
      `(last executed ${lastExec}). Process it once; do not repeat the work for each occurrence.\n\n${prompt}`
    )
  }

  export async function recordQueueOutcome(
    id: ScheduledTaskID,
    status: "completed" | "failed",
    error?: unknown,
    queueID?: TaskQueueID,
  ): Promise<Info> {
    const now = Date.now()
    const runStatus: RunStatus = status === "completed" ? "completed" : isTimeoutError(error) ? "timeout" : "failed"
    const errorMessage = status === "failed" ? toErrorMessage(error) : undefined

    // Idempotent, supersede-safe terminal transition: only a still-running row
    // keyed by this queue id moves to terminal. Duplicate or late callbacks no-op.
    let run: RunInfo | undefined
    if (queueID) {
      run = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
        const row = db
          .update(ScheduledTaskRunTable)
          .set({ status: runStatus, error: errorMessage, time_completed: now, time_updated: now })
          .where(and(eq(ScheduledTaskRunTable.queue_id, queueID), eq(ScheduledTaskRunTable.status, "running")))
          .returning()
          .get()
        return row ? runFromRow(row) : undefined
      })
    }

    // Guarded summary write: only update the task row if this queue id is still
    // the most recent one, so a late outcome from a superseded run cannot
    // overwrite a newer run's state.
    const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      const conditions = [eq(ScheduledTaskTable.id, id)]
      if (queueID) conditions.push(eq(ScheduledTaskTable.last_queue_id, queueID))
      const row = db
        .update(ScheduledTaskTable)
        .set({
          error: status === "failed" ? errorMessage : null,
          time_updated: now,
        })
        .where(and(...conditions))
        .returning()
        .get()
      return row ? fromRow(row) : undefined
    })

    if (!task) {
      // Superseded or vanished — nothing to update; keep the run row as the record.
      if (run) emitRunEvents(id, runStatus, run, errorMessage)
      throw new NotFoundError({ message: `Scheduled task not found: ${id}` })
    }

    if (status === "failed" && task.status === "active") {
      await applyFailurePolicy(task, now)
    }

    publishUpdated(task)
    if (run) emitRunEvents(id, runStatus, run, errorMessage)
    return task
  }

  function emitRunEvents(id: ScheduledTaskID, runStatus: RunStatus, run: RunInfo, errorMessage?: string) {
    get(id)
      .then((task) => {
        if (runStatus === "completed") publishSucceeded(task, run)
        else if (runStatus === "failed" || runStatus === "timeout") publishFailed(task, { ...run, error: errorMessage })
      })
      .catch(() => {})
  }

  function isTimeoutError(error: unknown): boolean {
    return toErrorMessage(error).toLowerCase().includes("timed out")
  }

  // Bounded exponential cooldown on consecutive failures, then auto-pause. The
  // counter is derived from run history (shards have no ALTER path for a column).
  async function applyFailurePolicy(task: Info, now: number): Promise<void> {
    const failures = consecutiveFailures(task.id)
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      const paused = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
        const row = db
          .update(ScheduledTaskTable)
          .set({
            status: "paused",
            error: `auto-paused after ${failures} consecutive failures: ${task.error ?? "unknown error"}`,
            time_updated: now,
          })
          .where(and(eq(ScheduledTaskTable.id, task.id), eq(ScheduledTaskTable.status, "active")))
          .returning()
          .get()
        return row ? fromRow(row) : undefined
      })
      if (paused) {
        log.warn("scheduled task auto-paused after repeated failures", { taskID: task.id, failures })
        publishFailedPersistently(paused)
      }
      return
    }
    const backoff = Math.min(FAILURE_BACKOFF_BASE_MS * 2 ** (failures - 1), FAILURE_BACKOFF_MAX_MS)
    SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      db.update(ScheduledTaskTable)
        .set({
          next_run_at: sql`max(coalesce(${ScheduledTaskTable.next_run_at}, 0), ${now + backoff})`,
          time_updated: now,
        })
        .where(and(eq(ScheduledTaskTable.id, task.id), eq(ScheduledTaskTable.status, "active")))
        .run()
    })
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
      // Opportunistic retention, throttled to ~hourly so the 60s tick does not
      // scan for stale one-shots on every poll.
      const now = Date.now()
      if (now - state.lastRetentionAt >= 60 * 60 * 1_000) {
        state.lastRetentionAt = now
        try {
          pruneFinishedOneShots(now)
        } catch (error) {
          log.warn("scheduled task retention prune failed", { error })
        }
      }
    })
    state.interval = setInterval(tick, pollMs)
    // Preserve the historical default for callers that run a scheduler only
    // as part of a short-lived command. Long-running servers opt in from the
    // project bootstrap so scheduled work can keep their process alive.
    if (input.keepAlive !== true) state.interval.unref?.()
    tick()
  }

  // Opportunistic retention: fired one-time tasks (status=disabled) accumulate
  // forever otherwise. Never touches active/paused or recurring rows.
  export function pruneFinishedOneShots(now = Date.now()): number {
    return SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      const rows = db
        .select({ id: ScheduledTaskTable.id, schedule: ScheduledTaskTable.schedule })
        .from(ScheduledTaskTable)
        .where(
          and(
            eq(ScheduledTaskTable.project_id, Instance.project.id),
            eq(ScheduledTaskTable.status, "disabled"),
            lte(ScheduledTaskTable.last_run_at, now - ONESHOT_RETENTION_MS),
          ),
        )
        .all()
      let removed = 0
      for (const row of rows) {
        const schedule = Schedule.safeParse(row.schedule)
        if (!schedule.success || schedule.data.type !== "once") continue
        db.delete(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, row.id)).run()
        removed++
      }
      return removed
    })
  }

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
      case "cron":
        if (!isValidCronExpression(schedule.expression)) {
          throw new InvalidSchedule({
            resource: "schedule.cron",
            message: `Invalid or unsupported cron expression: ${schedule.expression}`,
          })
        }
        if (nextCronRun(schedule.expression, from, schedule.timezone) === undefined) {
          throw new InvalidSchedule({
            resource: "schedule.cron",
            message: `Cron expression has no occurrence within the search window: ${schedule.expression}`,
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

  // Deterministic anti-herd offset derived from the task id (kimi-style), applied
  // at eligibility time only — never persisted, so `next_run_at` stays the
  // canonical nominal schedule. One-time runs are never jittered.
  export function jitterOffsetMs(task: Pick<Info, "id" | "schedule">): number {
    if (task.schedule.type === "once") return 0
    let period = cronPeriodMs(task.schedule)
    if (!period || !Number.isFinite(period) || period <= 0) {
      period = task.schedule.type === "weekly" ? 7 * MS_PER_DAY : MS_PER_DAY
    }
    const cap = Math.min(period * JITTER_MAX_FRACTION, JITTER_MAX_MS)
    if (!(cap > 0)) return 0
    return Math.floor(cap * fractionFromId(task.id))
  }

  function cronPeriodMs(schedule: Schedule): number | undefined {
    const base = Date.now()
    const a = nextRunAt(schedule, base)
    if (a === undefined) return undefined
    const b = nextRunAt(schedule, a)
    if (b === undefined) return undefined
    return b - a
  }

  function fractionFromId(id: string): number {
    let hash = 5381
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0
    }
    return (hash >>> 0) / 0x1_0000_0000
  }

  // Count occurrences being coalesced into a single run: iterate forward from the
  // stored due occurrence while still <= now, bounded to avoid pathological loops.
  export function countCoalesced(
    schedule: Schedule,
    firstOccurrence: number,
    now: number,
  ): { count: number; lastOccurrence: number } {
    let count = 1
    let cursor = firstOccurrence
    let last = firstOccurrence
    while (count < MAX_COALESCE_ITERATIONS) {
      const next = nextRunAt(schedule, cursor)
      if (next === undefined || next > now) break
      count++
      cursor = next
      last = next
    }
    return { count, lastOccurrence: last }
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

// Full 5-field cron support (minute hour day-of-month month day-of-week). When
// both day-of-month and day-of-week are restricted the match is OR (POSIX/Vixie);
// otherwise both must match, with "*" matching everything. Month always ANDs.
function isValidCronExpression(expression: string): boolean {
  return parseCronExpressionFull(expression) !== undefined
}

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
    domRestricted: fields[2] !== "*",
    dowRestricted: fields[4] !== "*",
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
  const currentDate = tzDateKey(tzComponents(from, fmt))
  const alreadyPassed = tzOccurrenceAlreadyPassed(
    from,
    fmt,
    (value) => value.hour === parts.hour && value.minute === parts.minute,
  )
  let ms = from - (from % 60_000) + 60_000
  for (let i = 0; i < 2 * 24 * 60; i++, ms += 60_000) {
    const c = tzComponents(ms, fmt)
    if (c.hour !== parts.hour || c.minute !== parts.minute) continue
    if (alreadyPassed && tzDateKey(c) === currentDate) continue
    return ms
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
  const currentDate = tzDateKey(tzComponents(from, fmt))
  const alreadyPassed = tzOccurrenceAlreadyPassed(
    from,
    fmt,
    (value) => value.weekday === day && value.hour === parts.hour && value.minute === parts.minute,
  )
  let ms = from - (from % 60_000) + 60_000
  for (let i = 0; i < 8 * 24 * 60; i++, ms += 60_000) {
    const c = tzComponents(ms, fmt)
    if (c.weekday !== day || c.hour !== parts.hour || c.minute !== parts.minute) continue
    if (alreadyPassed && tzDateKey(c) === currentDate) continue
    return ms
  }
  return undefined
}

// Full-cron next occurrence. Day-skipping keeps the search cheap across the
// multi-year horizon: non-matching month/day jumps forward (to the next local
// midnight without a timezone, or a coarse 6h step with one) and only matching
// days are minute-scanned. The tz branch backs up to the local day start after a
// coarse skip so early-in-day occurrences are never missed.
function nextCronRun(expression: string, from: number, timezone?: string): number | undefined {
  const parsed = parseCronExpressionFull(expression)
  if (!parsed) return undefined
  const horizonMs = 4 * 366 * 24 * 60 * 60 * 1000
  const endMs = from + horizonMs
  const startMs = from - (from % 60_000) + 60_000
  let ms = startMs

  if (!timezone) {
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
        if (parsed.minutes.has(dd.getMinutes()) && parsed.hours.has(dd.getHours())) return ms
        ms += 60_000
      }
    }
    return undefined
  }

  const fmt = makeTzFormatter(timezone)
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
    for (let i = 0; i < 26 * 60; i++) {
      const prev = scan - 60_000
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
      if (cursor >= startMs && parsed.minutes.has(cc.minute) && parsed.hours.has(cc.hour)) return cursor
    }
    ms = advanced ? cursor : cursor + 60_000
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
