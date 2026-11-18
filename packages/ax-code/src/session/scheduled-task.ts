import z from "zod"
import { HTTPException } from "hono/http-exception"
import { NamedError } from "@ax-code/util/error"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { ProjectID } from "@/project/schema"
import {
  NotFoundError,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  notInArray,
  or,
  sql,
} from "@/storage/db"
import type { Database } from "@/storage/db"
import { NotificationEvent } from "@/notification/events"
import { toErrorMessage } from "@/util/error-message"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { JsonBoolean, JsonNumber } from "@/util/schema"
import { ScheduledTaskID, ScheduledTaskRunID, TaskQueueID, type SessionID } from "./schema"
import { ScheduledTaskTable, ScheduledTaskRunTable, TaskQueueTable } from "./session.sql"
import { SessionShard } from "./shard"
import { TaskQueue } from "./task-queue"
import { WorkflowRun as WorkflowRunState, type WorkflowRunDetail, type WorkflowRunID } from "@/workflow/state"
import { WorkflowRunTable } from "@/workflow/workflow.sql"
import {
  MS_PER_DAY,
  MS_PER_MINUTE,
  isValidCronExpression,
  isValidTimeZone,
  nextCronRun,
  nextDailyRun,
  nextWeeklyRun,
  parseTimeOfDay,
} from "./scheduled-task-schedule"

type WorkflowTemplateID = import("@/workflow/template").WorkflowTemplate.ID

export namespace ScheduledTask {
  const log = Log.create({ service: "session.scheduled-task" })
  const MISSED_RUN_GRACE_MS = 5 * 60 * 1_000

  // ADR-059 tuning. Run history is bounded per task; overlap / backoff state is
  // DERIVED from history rather than stored on `scheduled_task` (shards have no
  // ALTER path, so all new scheduler state lives in the new `scheduled_task_run`
  // table).
  export const RUN_HISTORY_LIMIT = 50
  /** Roll to a fresh automation session after this many fires in one session. */
  export const SESSION_REUSE_LIMIT = 24
  const RUN_HISTORY_GC_THRESHOLD = RUN_HISTORY_LIMIT * 2
  export const MAX_CONSECUTIVE_FAILURES = 5
  const FAILURE_BACKOFF_BASE_MS = 60 * 1_000
  const FAILURE_BACKOFF_MAX_MS = 60 * 60 * 1_000
  export const MAX_PROJECT_ACTIVE_TASKS = 100
  const MAX_COALESCE_ITERATIONS = 10_000
  const DEFAULT_RUN_DEADLINE_MS = 30 * 60 * 1_000
  const ORPHAN_GRACE_MS = 10 * 60 * 1_000
  // Marker for run rows failed by the orphan sweep (reconcileOrphanRuns) rather
  // than by the task itself. Infrastructure failures must not feed the
  // consecutive-failure auto-pause counter.
  const ORPHAN_RUN_ERROR_PREFIX = "orphaned:"
  const ONESHOT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
  const JITTER_MAX_FRACTION = 0.1
  // Capped below MISSED_RUN_GRACE_MS (minus poll latency) so a jitter-delayed
  // on-time fire can never be misclassified as missed.
  const JITTER_MAX_MS = 3 * 60 * 1_000
  const TOAST_DURATION_MS = 8 * 1_000
  // After an overlap skip, a one-time task re-arms for the next poll instead of
  // being disabled: it is disabled only by successful completion (PRD-2026-09-12).
  const ONESHOT_OVERLAP_RETRY_MS = MS_PER_MINUTE

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
    // Carries the directory so a client can route the event to its project
    // without a loaded copy of the task; the rest of the task (its prompt
    // included) is gone and is not re-published.
    Deleted: BusEvent.define(
      "scheduled.task.deleted",
      z.object({
        id: ScheduledTaskID.zod,
        projectID: ProjectID.zod,
        directory: z.string(),
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

  // Lifecycle toasts are the primary user-facing signal that durable automation
  // is doing something (PRD-2026-09-12): the scheduled.task.* bus events were
  // previously never surfaced by any client, so a fire looked identical to
  // nothing happening. A toast publish must never break scheduling — failures
  // are logged and swallowed.
  function toast(input: { title: string; message: string; variant: "info" | "success" | "warning" | "error" }) {
    try {
      Bus.publishDetached(NotificationEvent.ToastShow, { ...input, duration: TOAST_DURATION_MS })
    } catch (error) {
      log.warn("scheduled task toast publish failed", { error: toErrorMessage(error) })
    }
  }

  function publishCreated(task: Info) {
    Bus.publishDetached(Event.Created, { task })
    const when = task.nextRunAt !== undefined ? new Date(task.nextRunAt).toLocaleString() : undefined
    toast({
      title: "Scheduled task created",
      message: when ? `${task.title} · next ${when} · /schedule` : `${task.title} · /schedule`,
      variant: "info",
    })
  }

  function publishUpdated(task: Info) {
    Bus.publishDetached(Event.Updated, { task })
  }

  function publishDeleted(task: Pick<Info, "id" | "projectID" | "directory">) {
    Bus.publishDetached(Event.Deleted, { id: task.id, projectID: task.projectID, directory: task.directory })
  }

  function publishFired(task: Info, run: RunInfo) {
    Bus.publishDetached(Event.Fired, { task, run })
    // Manual run-now already gives the caller immediate feedback; toast only
    // fires the user did not trigger by hand.
    if (run.triggerType !== "scheduled") return
    toast({
      title: "Scheduled task started",
      message: run.coalescedCount > 1 ? `${task.title} (covers ${run.coalescedCount} missed occurrences)` : task.title,
      variant: "info",
    })
  }

  function publishSucceeded(task: Info, run: RunInfo) {
    Bus.publishDetached(Event.Succeeded, { task, run })
    toast({ title: "Scheduled task completed", message: task.title, variant: "success" })
  }

  function publishFailed(task: Info, run: RunInfo) {
    Bus.publishDetached(Event.Failed, { task, run })
    toast({
      title: run.status === "timeout" ? "Scheduled task timed out" : "Scheduled task failed",
      message: run.error ? `${task.title}: ${run.error}` : task.title,
      variant: "error",
    })
  }

  function publishSkipped(task: Info, run: RunInfo) {
    Bus.publishDetached(Event.Skipped, { task, run })
    toast({
      title: "Scheduled task skipped",
      message:
        run.status === "skipped_overlap"
          ? `${task.title}: previous run still in progress`
          : `${task.title}: ${run.coalescedCount} missed occurrence(s) skipped after downtime`,
      variant: "warning",
    })
  }

  function publishFailedPersistently(task: Info) {
    Bus.publishDetached(Event.FailedPersistently, { task })
    toast({
      title: "Scheduled task paused",
      message: `${task.title}: paused after repeated failures — review it with /schedule`,
      variant: "error",
    })
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

  /** Newest prior run's queue session, if any. Does not use last_queue_id (claim already points at the current item). */
  export async function previousAutomationSessionID(
    taskID: ScheduledTaskID,
    currentQueueID?: TaskQueueID,
  ): Promise<SessionID | undefined> {
    const runs = await listRuns({ taskID, limit: RUN_HISTORY_LIMIT })
    for (const run of runs) {
      if (!run.queueID || run.queueID === currentQueueID) continue
      const item = await TaskQueue.get(TaskQueueID.make(run.queueID)).catch(() => undefined)
      if (item?.sessionID) return item.sessionID
    }
    return undefined
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
    // targeted message instead. A request that also supplies a NEW schedule is
    // validated against that schedule below, so the stale-runAt guard must not
    // fire on the old one.
    if (
      parsed.schedule === undefined &&
      parsed.status === "active" &&
      current.status !== "active" &&
      current.schedule.type === "once" &&
      current.schedule.runAt <= now
    ) {
      throw new InvalidSchedule({
        resource: "status",
        // A paused one-time task was not delivered. One the failure policy
        // paused exhausted its retries, so resume points at the retry path;
        // one the user paused simply saw its run time pass, so resume points
        // at a new schedule. Neither "already ran".
        message:
          current.status === "paused"
            ? current.error?.startsWith("auto-paused")
              ? `This one-time task was paused after repeated failures; trigger it with run-now to retry, or delete it and create a new task.`
              : `This one-time task's run time passed while it was paused; give it a new schedule to run it, or delete it.`
            : `This one-time task already ran${current.lastRunAt ? ` at ${new Date(current.lastRunAt).toISOString()}` : ""}; create a new task instead of resuming it.`,
      })
    }
    // A finished one-time task has nothing to pause: it is not running and will
    // not run again without a new schedule. A paused row would later be resumed
    // as if the failure policy had paused it. Re-scheduling it paused stays legal.
    if (parsed.status === "paused" && current.status === "disabled" && parsed.schedule === undefined) {
      throw new InvalidSchedule({
        resource: "status",
        message: "This one-time task already finished and cannot be paused; give it a new schedule or delete it.",
      })
    }
    // A finished one-time task (`disabled`) is re-armed by a new schedule: nothing
    // else can run it again, and a request that carried only the schedule left the
    // row disabled with a future next_run_at — it looked scheduled, runDue (which
    // lists active tasks only) never fired it, and retention pruned it. An explicit
    // status in the same request still wins, so a client can re-schedule it paused.
    // A recurring task a client disabled stays disabled until the status says so:
    // a client that echoes the schedule on every save must not switch it back on.
    const nextStatus =
      parsed.status === undefined &&
      parsed.schedule !== undefined &&
      current.status === "disabled" &&
      current.schedule.type === "once"
        ? ("active" as const)
        : parsed.status
    const nextSchedule = parsed.schedule ?? current.schedule
    if (parsed.schedule !== undefined || (nextStatus === "active" && current.status !== "active")) {
      validateSchedule(nextSchedule, now)
    }
    // Overlap/orphan accounting derives a run's staleness from the task's
    // CURRENT deadline, while the executing run still enforces the deadline
    // captured at claim. Changing it mid-run would let the orphan sweep
    // mislabel a live run as abandoned and admit a second concurrent run.
    const nextDeadline = Object.hasOwn(parsed, "maxRunDurationMs")
      ? (parsed.maxRunDurationMs ?? undefined)
      : current.maxRunDurationMs
    if (
      nextDeadline !== current.maxRunDurationMs &&
      hasOpenRun(parsed.id, now, current.maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS)
    ) {
      throw new HTTPException(409, {
        message: `Scheduled task ${parsed.id} has a run in progress; maxRunDurationMs cannot be changed until it finishes.`,
      })
    }
    const updates: Partial<typeof ScheduledTaskTable.$inferInsert> = {
      time_updated: now,
    }
    if (parsed.title !== undefined) updates.title = parsed.title
    if (parsed.prompt !== undefined) updates.prompt = parsed.prompt
    if (parsed.schedule !== undefined) {
      updates.schedule = parsed.schedule
      updates.next_run_at = nextRunAt(parsed.schedule, now) ?? null
    } else if (nextStatus === "active" && current.status !== "active") {
      updates.next_run_at = nextRunAt(nextSchedule, now) ?? null
    }
    if (nextStatus !== undefined) updates.status = nextStatus
    if (nextStatus === "active" && current.status !== "active") {
      // Resume clears the failure that paused the task (SPEC §7) so the UI stops
      // showing a recovered task as failed until its next claim.
      updates.error = null
    }
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
    const projectID = task.projectID
    const dispatches = SessionShard.storeForProject(projectID).use((db) => readLiveDispatches(db, task))
    for (const queueID of dispatches.queueIDs) {
      await TaskQueue.stop(TaskQueueID.make(queueID)).catch((error) => {
        log.warn("scheduled task in-flight run stop failed during delete", { taskID: id, queueID, error })
      })
    }
    if (dispatches.workflowRunIDs.length > 0) {
      const { WorkflowScheduler } = await import("@/workflow/scheduler")
      for (const workflowRunID of dispatches.workflowRunIDs) {
        await WorkflowScheduler.cancel(workflowRunID as WorkflowRunID).catch((error) => {
          log.warn("scheduled task in-flight workflow cancel failed during delete", {
            taskID: id,
            workflowRunID,
            error,
          })
        })
      }
    }
    const deleted = SessionShard.storeForProject(projectID, { write: true }).transaction((db) => {
      const row = db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).get()
      if (!row) return undefined
      const current = fromRow(row)
      assertProjectTask(current)
      // The stop can race an outcome, a retry, or a new dispatch. Check the
      // actual carriers atomically with deletion, under the same write lock
      // used to claim a run.
      const live = readLiveDispatches(db, current)
      if (live.queueIDs.length > 0 || live.workflowRunIDs.length > 0) {
        throw new HTTPException(409, { message: `Cannot delete scheduled task ${id} while a run is active.` })
      }
      db.delete(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)).run()
      return current
    })
    if (deleted) publishDeleted(deleted)
    return true
  }

  // Keep admission conflicts out of execution history.
  class RunNowClaimRejected extends HTTPException {
    constructor(message: string) {
      super(409, { message })
    }
  }

  function assertRunNowAvailable(task: Info, isRunOpen: () => boolean): void {
    if (task.status === "disabled") throw new RunNowClaimRejected(`Scheduled task ${task.id} is disabled.`)
    if (isRunOpen()) {
      throw new RunNowClaimRejected(`Scheduled task ${task.id} already has a run in progress; wait for it to finish.`)
    }
  }

  function readRunNowTask(db: Database.TxOrDb, requested: Info, now: number): Info {
    const row = db
      .select()
      .from(ScheduledTaskTable)
      .where(and(eq(ScheduledTaskTable.id, requested.id), eq(ScheduledTaskTable.project_id, requested.projectID)))
      .get()
    if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${requested.id}` })
    const current = fromRow(row)
    assertRunNowAvailable(current, () =>
      hasOpenRunIn(db, current.id, now, current.maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS),
    )
    if (current.directory !== requested.directory || current.workflowTemplateID !== requested.workflowTemplateID) {
      throw new RunNowClaimRejected(`Scheduled task ${current.id} changed while preparing to run. Try again.`)
    }
    return current
  }

  // Marks a workflow dispatch failure whose run row and task state were
  // already finalized inside runWorkflowNow; runNow's catch unwraps and
  // rethrows it without double-recording.
  class WorkflowDispatchRecorded extends Error {
    constructor(readonly original: unknown) {
      super(toErrorMessage(original))
    }
  }

  /** Scheduled dispatch can be triggered from any checkout of the same project. */
  export async function runInWorkspace<T>(
    task: Pick<Info, "projectID" | "directory">,
    run: () => Promise<T>,
  ): Promise<T> {
    if (!(await Filesystem.isDir(task.directory))) {
      throw new HTTPException(409, { message: "The scheduled task's workspace is unavailable." })
    }
    return Instance.provide({
      directory: task.directory,
      fn: () => {
        if (Instance.project.id !== task.projectID) {
          throw new HTTPException(409, { message: "The scheduled task's workspace now belongs to another project." })
        }
        return run()
      },
    })
  }

  type ClaimedQueueRun = { task: Info; run: RunInfo; queueItem: TaskQueue.Info }

  export async function runNow(id: ScheduledTaskID): Promise<RunNowResult> {
    const current = await get(id)
    const now = Date.now()
    const deadlineMs = current.maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS
    // Recheck eligibility inside the claim transaction after workflow
    // preparation. A tick or another process can change the task in between.
    assertRunNowAvailable(current, () => {
      reconcileOrphanRuns(id, now, deadlineMs)
      return hasOpenRun(id, now, deadlineMs)
    })
    let claimed: ClaimedQueueRun
    try {
      if (current.workflowTemplateID) return await runInWorkspace(current, () => runWorkflowNow(current))
      claimed = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
        const task = readRunNowTask(db, current, now)
        const queuedItem = TaskQueue.enqueueInTransaction(db, scheduledQueueInput(task, now, "manual"), {
          now,
          directory: task.directory,
        })
        const runRow = insertRunRow(db, {
          taskID: id,
          triggerType: "manual",
          status: "running",
          occurrenceAt: now,
          coalescedCount: 1,
          queueID: queuedItem.id,
          now,
        })
        const row = db
          .update(ScheduledTaskTable)
          .set({
            last_queue_id: queuedItem.id,
            last_run_at: now,
            error: null,
            time_updated: now,
          })
          .where(eq(ScheduledTaskTable.id, id))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${id}` })
        return { task: fromRow(row), run: runRow, queueItem: queuedItem }
      })
    } catch (error) {
      if (error instanceof RunNowClaimRejected) throw error
      if (error instanceof WorkflowDispatchRecorded) {
        // runWorkflowNow already finalized the run row and task state;
        // surface the original dispatch error without double-recording.
        throw error.original
      }
      await recordRunFailure(id, error).catch((recordError) => {
        log.warn("scheduled task failure record failed", { taskID: id, error: recordError })
      })
      throw error
    }
    return dispatchClaimedRun(claimed)
  }

  async function dispatchClaimedRun({ task, run, queueItem }: ClaimedQueueRun): Promise<RunNowResult> {
    try {
      await TaskQueue.publishEnqueued(queueItem)
      publishUpdated(task)
      publishFired(task, run)
      const { TaskQueueExecutor } = await import("./task-queue-executor")
      return { task, queueItem: await TaskQueueExecutor.start(queueItem) }
    } catch (error) {
      try {
        // Only an unclaimed item from this dispatch can be failed here.
        // An executor that claimed the item owns the run outcome.
        if (await TaskQueue.failPendingDispatch(queueItem, toErrorMessage(error))) {
          await recordQueueOutcome(task.id, "failed", error, queueItem.id)
        }
      } catch (recordError) {
        log.warn("scheduled task dispatch failure record failed", { taskID: task.id, error: recordError })
      }
      throw error
    }
  }

  async function runWorkflowNow(current: Info): Promise<RunNowResult> {
    const { WorkflowTemplate } = await import("@/workflow/template")
    const { WorkflowScheduler } = await import("@/workflow/scheduler")
    // Create the inert (not-yet-started) workflow record BEFORE the claim so
    // the open-run guard is authoritative: if the guard aborts, nothing
    // observable ever starts. Starting first and claiming after would let a
    // due tick claim the same occurrence in the gap and double-fire the
    // workflow (same check-then-act class as the queue path, 2026-09-14).
    const run = await WorkflowTemplate.createRun({
      templateID: WorkflowTemplateIDSchema.parse(current.workflowTemplateID) as WorkflowTemplateID,
      sourceTaskID: current.id,
    })
    const now = Date.now()
    let claimed: { task: Info; run: RunInfo }
    try {
      claimed = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
        readRunNowTask(db, current, now)
        const runRow = insertRunRow(db, {
          taskID: current.id,
          triggerType: "manual",
          status: "running",
          occurrenceAt: now,
          coalescedCount: 1,
          workflowRunID: run.id,
          now,
        })
        const row = db
          .update(ScheduledTaskTable)
          .set({
            last_workflow_run_id: run.id,
            last_run_at: now,
            error: null,
            time_updated: now,
          })
          .where(eq(ScheduledTaskTable.id, current.id))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${current.id}` })
        return { task: fromRow(row), run: runRow }
      })
    } catch (error) {
      // The claim rolled back, so the pre-created run can never start: cancel
      // it instead of leaving a never-started queued run behind (same cleanup
      // the dispatch timeout path applies to a pre-created run).
      await WorkflowScheduler.cancelUnstarted(run.id).catch((cancelError) => {
        log.warn("failed to cancel a run-now workflow run after an aborted claim", {
          taskID: current.id,
          runID: run.id,
          error: cancelError,
        })
      })
      throw error
    }
    const { task, run: runRow } = claimed
    publishUpdated(task)
    publishFired(task, runRow)
    try {
      const workflowRun = await WorkflowScheduler.start(run.id, task.workflowStartOptions ?? {})
      return { task, workflowRun }
    } catch (error) {
      // start() can throw before it flips the run to `running` (the runtime
      // disabled guard, an unsupported merge strategy). The pre-created run is
      // then `queued` and nothing will ever start it, so cancel it — the same
      // cleanup the aborted-claim branch above does. Otherwise the run list
      // keeps a phantom attempt that no sweep repairs.
      await WorkflowScheduler.cancelUnstarted(run.id).catch((cancelError) => {
        log.warn("failed to cancel a scheduled workflow run after a start failure", {
          taskID: current.id,
          runID: run.id,
          error: cancelError,
        })
      })
      // The run row is claimed and `running`: finalize it through the
      // workflow outcome path so a start failure cannot wedge overlap
      // protection until orphan reconciliation or bypass the failure policy.
      await recordWorkflowOutcome(current.id, "failed", error, run.id).catch((recordError) => {
        log.warn("scheduled workflow dispatch failure record failed", { taskID: current.id, error: recordError })
      })
      throw new WorkflowDispatchRecorded(error)
    }
  }

  // A run-now that failed before it could claim a run row (the claim
  // transaction or a workflow lookup threw). The attempt still gets a terminal
  // `failed` row in the same write as the task summary — the task's error and
  // last_run_at alone left the run history empty for a failure the row was
  // reporting — and the failure policy judges a dispatch failure like any
  // other, as the claimed path already does through recordQueueOutcome.
  async function recordRunFailure(id: ScheduledTaskID, error: unknown): Promise<Info> {
    const now = Date.now()
    const message = toErrorMessage(error)
    const outcome = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
      const row = db
        .update(ScheduledTaskTable)
        .set({
          error: message,
          last_run_at: now,
          time_updated: now,
        })
        .where(eq(ScheduledTaskTable.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Scheduled task not found: ${id}` })
      const runRow = insertRunRow(db, {
        taskID: id,
        triggerType: "manual",
        status: "failed",
        occurrenceAt: now,
        coalescedCount: 1,
        error: message,
        now,
      })
      return { run: runRow, ...applyFailurePolicy(db, row, now) }
    })
    return publishOutcome(id, outcome)
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
        const skipped = recordSkippedOccurrence(task, next, "skipped_overlap", now, 1, undefined, {
          collapseRepeat: task.schedule.type === "once",
        })
        if (skipped) {
          publishUpdated(skipped.task)
          if (skipped.run) publishSkipped(skipped.task, skipped.run)
          log.info("skipped overlapping scheduled task occurrence", { taskID: task.id })
        }
        continue
      }
      // Missed detection is based on the NOMINAL schedule so jitter can never
      // corrupt catch-up accounting (council: grace/coalescing use nominal times).
      // A one-shot whose stored next_run_at no longer equals the nominal runAt
      // is a failure-policy retry (or an overlap re-arm), not a missed calendar
      // occurrence — the skip catch-up policy must not disable it for being
      // late, or a single failed fire plus a short backend outage would
      // silently kill the reminder the failure policy was meant to retry.
      const oneShotRetry = task.schedule.type === "once" && task.nextRunAt !== task.schedule.runAt
      const missed = !oneShotRetry && now - task.nextRunAt > MISSED_RUN_GRACE_MS
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
          if (skipped.run) publishSkipped(skipped.task, skipped.run)
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
      try {
        results.push(await dispatchClaimedRun(claimed))
      } catch (error) {
        log.warn("scheduled task dispatch failed", { taskID: task.id, error })
      }
    }
    return results
  }

  function claimDueTask(
    task: Info,
    next: number | undefined,
    now: number,
    coalescedCount: number,
  ): ClaimedQueueRun | undefined {
    return SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
      // Authoritative overlap guard: a manual run-now can insert its
      // `running` row between this caller's hasOpenRun read and this
      // transaction, and the next_run_at CAS alone does not see it (run-now
      // never advances next_run_at). Aborting returns undefined so the tick
      // skips this occurrence; the next poll records it as skipped_overlap.
      if (hasOpenRunIn(db, task.id, now, task.maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS)) return undefined
      const claimed = db
        .update(ScheduledTaskTable)
        .set({
          // A one-time task is NOT disabled at claim: it stays active with a
          // null next_run_at (never due again) while the run executes, and is
          // disabled only when a run completes successfully — a failed one-time
          // reminder is retried under the failure policy instead of vanishing
          // silently (PRD-2026-09-12).
          next_run_at: next ?? null,
          time_updated: now,
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
        // Pass the PRE-claim lastRunAt: the claim above already stamped
        // last_run_at=now, which must not leak into the coalesce envelope.
        scheduledQueueInput(claimedTask, task.nextRunAt!, "scheduled", coalescedCount, task.lastRunAt),
        { now, directory: claimedTask.directory },
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
  // undefined when another poller won the claim race. With collapseRepeat, a
  // repeat skip of the same open occurrence re-arms without recording a row:
  // the one-time overlap re-arm otherwise fires this path on every poll,
  // flooding the bounded run history and toasting once per minute for a single
  // blocked occurrence.
  function recordSkippedOccurrence(
    task: Info,
    next: number | undefined,
    status: Extract<RunStatus, "skipped_overlap" | "missed_skip">,
    now: number,
    coalescedCount: number,
    occurrenceAt?: number,
    options?: { collapseRepeat?: boolean },
  ): { task: Info; run: RunInfo | undefined } | undefined {
    return SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
      const claimed = db
        .update(ScheduledTaskTable)
        .set({
          // A one-time occurrence skipped by the catch-up policy (missed_skip)
          // is done: disable it rather than leave an active row with a null
          // next_run_at (a zombie that never fires). Stamp last_run_at so the
          // finished row stays inside pruneFinishedOneShots' retention clock
          // (a null last_run_at is never lte the cutoff and would leak).
          // An overlap skip only means another run is currently delivering the
          // task, so re-arm the next poll instead — if that run fails, the
          // failure policy still applies (PRD-2026-09-12).
          next_run_at:
            task.schedule.type === "once" && status === "skipped_overlap"
              ? now + ONESHOT_OVERLAP_RETRY_MS
              : (next ?? null),
          time_updated: now,
          ...(task.schedule.type === "once" && status === "missed_skip"
            ? { status: "disabled" as const, last_run_at: now }
            : {}),
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
      if (options?.collapseRepeat) {
        const last = db
          .select({ status: ScheduledTaskRunTable.status })
          .from(ScheduledTaskRunTable)
          .where(eq(ScheduledTaskRunTable.task_id, task.id))
          .orderBy(desc(ScheduledTaskRunTable.time_created), desc(ScheduledTaskRunTable.id))
          .limit(1)
          .get()
        if (last?.status === status) return { task: fromRow(claimed), run: undefined }
      }
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
    return SessionShard.storeForProject(Instance.project.id).use((db) => hasOpenRunIn(db, taskID, now, deadlineMs))
  }

  function readOpenRuns(db: Database.TxOrDb, taskID: ScheduledTaskID) {
    return db
      .select({
        timeStarted: ScheduledTaskRunTable.time_started,
        queueID: ScheduledTaskRunTable.queue_id,
        workflowRunID: ScheduledTaskRunTable.workflow_run_id,
      })
      .from(ScheduledTaskRunTable)
      .where(and(eq(ScheduledTaskRunTable.task_id, taskID), eq(ScheduledTaskRunTable.status, "running")))
      .all()
  }

  function readLiveDispatches(
    db: Database.TxOrDb,
    task: Pick<Info, "id" | "lastQueueID" | "lastWorkflowRunID">,
  ): { queueIDs: string[]; workflowRunIDs: string[] } {
    const runs = readOpenRuns(db, task.id)
    // The last dispatch can be retried even after its history row has
    // recorded a terminal outcome.
    const queueIDs = new Set([task.lastQueueID, ...runs.map((run) => run.queueID)])
    const workflowRunIDs = new Set([task.lastWorkflowRunID, ...runs.map((run) => run.workflowRunID)])
    return {
      queueIDs: [...queueIDs].filter((id): id is string => !!id && isTaskQueueRunLive(db, id)),
      workflowRunIDs: [...workflowRunIDs].filter(
        (id): id is string => !!id && isWorkflowRunLive(db, id, { includeQueued: true }),
      ),
    }
  }

  // Transaction-local variant. Callers that insert a new `running` row must run
  // this authoritative check inside the SAME synchronous transaction as the
  // insert: the standalone hasOpenRun read can be overtaken by a concurrent
  // claim across an await boundary (check-then-act).
  function hasOpenRunIn(db: Database.TxOrDb, taskID: ScheduledTaskID, now: number, deadlineMs: number): boolean {
    const staleBefore = now - (deadlineMs + ORPHAN_GRACE_MS)
    for (const row of readOpenRuns(db, taskID)) {
      if (row.timeStarted !== null && row.timeStarted > staleBefore) return true
      // The execution deadline starts when the queue executor claims an item,
      // not when the scheduler enqueues it. A stale run can therefore still
      // have work waiting in the durable queue; keep overlap protection until
      // that queue item reaches a terminal state.
      if (isTaskQueueRunLive(db, row.queueID)) return true
      // A workflow dispatch row stays `running` for the workflow's whole
      // lifetime; the queue-path deadline cannot bound it. While the workflow
      // is still executing the row stays open even past deadline+grace —
      // otherwise the next occurrence would double-fire and the live
      // workflow's outcome would find no row.
      if (row.workflowRunID && isWorkflowRunLive(db, row.workflowRunID)) return true
    }
    return false
  }

  // A dispatch row is backed by a live workflow while the workflow is
  // executing (running / blocked / paused). A gone or terminal workflow is a
  // genuine orphan; a `queued` run stale past deadline+grace is abandoned too
  // (the scheduler never started it — restart recovery only sweeps running
  // runs), so it must not hold the task's overlap lock forever.
  function isWorkflowRunLive(
    db: Database.TxOrDb,
    workflowRunID: string,
    options: { includeQueued?: boolean } = {},
  ): boolean {
    const workflowRun = db
      .select({ status: WorkflowRunTable.status })
      .from(WorkflowRunTable)
      .where(eq(WorkflowRunTable.id, workflowRunID as WorkflowRunID))
      .get()
    return (
      workflowRun !== undefined &&
      (workflowRun.status === "running" ||
        workflowRun.status === "blocked" ||
        workflowRun.status === "paused" ||
        (options.includeQueued === true && workflowRun.status === "queued"))
    )
  }

  function isTaskQueueRunLive(db: Database.TxOrDb, queueID: string | null | undefined): boolean {
    if (!queueID) return false
    const row = db
      .select({ status: TaskQueueTable.status })
      .from(TaskQueueTable)
      .where(eq(TaskQueueTable.id, queueID as TaskQueueID))
      .get()
    const status = TaskQueue.Status.safeParse(row?.status)
    return status.success && !TaskQueue.isTerminalStatus(status.data)
  }

  function reconcileOrphanRuns(taskID: ScheduledTaskID, now: number, deadlineMs: number): number {
    const staleBefore = now - (deadlineMs + ORPHAN_GRACE_MS)
    return SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      let closed = 0
      const candidates = db
        .select({
          id: ScheduledTaskRunTable.id,
          queueID: ScheduledTaskRunTable.queue_id,
          workflowRunID: ScheduledTaskRunTable.workflow_run_id,
        })
        .from(ScheduledTaskRunTable)
        .where(
          and(
            eq(ScheduledTaskRunTable.task_id, taskID),
            eq(ScheduledTaskRunTable.status, "running"),
            lte(ScheduledTaskRunTable.time_started, staleBefore),
          ),
        )
        .all()
      for (const candidate of candidates) {
        if (isTaskQueueRunLive(db, candidate.queueID)) continue
        // A workflow dispatch keeps the run row `running` for the workflow's
        // whole lifetime, so an old row is an orphan only when its workflow is
        // gone or terminal. Failing a row whose workflow is still executing
        // would mislabel a live execution as orphaned, and the late outcome
        // would lose its row.
        if (candidate.workflowRunID && isWorkflowRunLive(db, candidate.workflowRunID)) continue
        db.update(ScheduledTaskRunTable)
          .set({
            status: "failed",
            error: `${ORPHAN_RUN_ERROR_PREFIX} no outcome was recorded (backend likely restarted)`,
            time_completed: now,
            time_updated: now,
          })
          .where(
            and(
              eq(ScheduledTaskRunTable.id, candidate.id),
              // The candidate selection is not a transaction with this write:
              // an outcome landing in the gap must not be overwritten. Keep
              // the atomic filter the pre-loop single UPDATE had.
              eq(ScheduledTaskRunTable.status, "running"),
              lte(ScheduledTaskRunTable.time_started, staleBefore),
            ),
          )
          .run()
        closed += 1
      }
      return closed
    })
  }

  // Orphan reconciliation otherwise happens only for due tasks and on run-now,
  // so a run abandoned by a restart stayed `running` for as long as its task
  // was paused or its claim had already cleared next_run_at (a one-shot), or
  // when its queue item reached a terminal state without an outcome, which
  // the queue's own restart recovery does not see. Every scheduler tick sweeps
  // the tasks that have an open run — one query when none does — and announces
  // the closed rows, since nothing else tells a client that "running" ended.
  export async function reconcileAllOrphanRuns(now = Date.now()): Promise<void> {
    await reconcilePersistedOutcomes(now)
    const open = SessionShard.storeForProject(Instance.project.id).use((db) =>
      db
        .select({ taskID: ScheduledTaskRunTable.task_id })
        .from(ScheduledTaskRunTable)
        .where(
          and(eq(ScheduledTaskRunTable.project_id, Instance.project.id), eq(ScheduledTaskRunTable.status, "running")),
        )
        .groupBy(ScheduledTaskRunTable.task_id)
        .all(),
    )
    for (const { taskID } of open) {
      const task = await get(taskID).catch(() => undefined)
      if (!task) continue
      const closed = reconcileOrphanRuns(task.id, now, task.maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS)
      if (closed > 0) publishUpdated(await get(task.id))
    }
  }

  // Count trailing failed/timeout runs since the last completed run. Skipped
  // occurrences do not participate (they are not execution outcomes), and
  // neither do orphaned runs: a backend restart abandoning an in-flight run
  // is infrastructure noise, not a task failure — counting it lets repeated
  // deploys auto-pause a healthy schedule.
  function consecutiveFailures(db: Database.TxOrDb, taskID: ScheduledTaskID): number {
    const rows = db
      .select({ status: ScheduledTaskRunTable.status, error: ScheduledTaskRunTable.error })
      .from(ScheduledTaskRunTable)
      .where(eq(ScheduledTaskRunTable.task_id, taskID))
      .orderBy(desc(ScheduledTaskRunTable.time_created), desc(ScheduledTaskRunTable.id))
      .limit(RUN_HISTORY_LIMIT)
      .all()
    let count = 0
    for (const row of rows) {
      if (row.status === "failed" || row.status === "timeout") {
        if (row.error?.startsWith(ORPHAN_RUN_ERROR_PREFIX)) continue
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
    envelopeLastRunAt?: number,
  ): TaskQueue.EnqueueInput {
    // The coalesce envelope reports when the task PREVIOUSLY ran. Callers that
    // stamp last_run_at before building the payload (the claim path) must pass
    // the pre-claim value, otherwise the envelope echoes the current fire time.
    const lastRunAt = envelopeLastRunAt ?? task.lastRunAt
    const prompt =
      coalescedCount > 1 ? withCoalesceEnvelope(task.prompt, coalescedCount, occurrenceAt, lastRunAt) : task.prompt
    return {
      kind: "automation",
      title: task.title,
      agent: task.agent,
      model: task.model,
      sourceTaskID: task.id,
      // The executor's own fallback timeout (72h) is the global queue default;
      // scheduled runs must enforce the same deadline the overlap/orphan
      // accounting uses. Otherwise a still-executing run past deadline+grace is
      // mislabeled orphaned and the next occurrence double-fires while the
      // late outcome can no longer find its run row.
      executionTimeoutMs: task.maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS,
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

  type OutcomeSource = { queueID: TaskQueueID } | { workflowRunID?: string }
  type OutcomeStatus = "completed" | "failed" | "timeout"
  type Outcome = { status: OutcomeStatus; error?: string }
  const terminalDispatchStatuses = ["completed", "failed", "cancelled"] as const
  type TerminalDispatchStatus = (typeof terminalDispatchStatuses)[number]
  type TaskRow = typeof ScheduledTaskTable.$inferSelect
  type RecordedOutcome = { run: RunInfo; row?: TaskRow; pausedAfter?: number }

  export async function recordQueueOutcome(
    id: ScheduledTaskID,
    status: "completed" | "failed",
    error: unknown,
    queueID: TaskQueueID,
  ): Promise<Info> {
    return recordOutcome(id, { queueID }, queueOutcome(status, error))
  }

  function queueOutcome(status: "completed" | "failed", error: unknown): Outcome {
    const message = status === "failed" ? toErrorMessage(error) : undefined
    return { status: message?.toLowerCase().includes("timed out") ? "timeout" : status, error: message }
  }

  async function recordOutcome(id: ScheduledTaskID, source: OutcomeSource, result: Outcome): Promise<Info> {
    const now = Date.now()
    const outcome = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) =>
      recordOutcomeIn(db, id, source, result, now),
    )
    return publishOutcome(id, outcome)
  }

  function recordOutcomeIn(
    db: Database.TxOrDb,
    id: ScheduledTaskID,
    source: OutcomeSource,
    { status, error }: Outcome,
    now: number,
  ): RecordedOutcome | undefined {
    const projectID = Instance.project.id
    let run: RunInfo | undefined
    if ("queueID" in source) {
      const row = db
        .update(ScheduledTaskRunTable)
        .set({ status, error: error ?? null, time_completed: now, time_updated: now })
        .where(
          and(
            eq(ScheduledTaskRunTable.task_id, id),
            eq(ScheduledTaskRunTable.project_id, projectID),
            eq(ScheduledTaskRunTable.queue_id, source.queueID),
            unrecordedOutcome(),
          ),
        )
        .returning()
        .get()
      if (row) run = runFromRow(row)
    } else {
      run = claimWorkflowOutcomeRun(db, id, status, error, source.workflowRunID, now)
    }
    // Only the callback that settles the run may update the schedule.
    if (!run) return undefined

    // A superseded callback can close its own run. Its retry policy and
    // summary belong to the schedule only while it is the latest run.
    const conditions = [eq(ScheduledTaskTable.id, id), eq(ScheduledTaskTable.project_id, projectID)]
    if ("queueID" in source) conditions.push(eq(ScheduledTaskTable.last_queue_id, source.queueID))
    else if (source.workflowRunID) conditions.push(eq(ScheduledTaskTable.last_workflow_run_id, source.workflowRunID))

    const current = db
      .select({ schedule: ScheduledTaskTable.schedule, status: ScheduledTaskTable.status })
      .from(ScheduledTaskTable)
      .where(and(...conditions))
      .get()
    if (!current) return { run }
    const schedule = Schedule.safeParse(current.schedule)
    const disableOneShot =
      status === "completed" && current.status !== "disabled" && schedule.success && schedule.data.type === "once"
    const row = db
      .update(ScheduledTaskTable)
      .set({
        error: error ?? null,
        time_updated: now,
        ...(disableOneShot ? { status: "disabled" as const, next_run_at: null } : {}),
      })
      .where(and(...conditions))
      .returning()
      .get()

    // Keep run history, the summary, and backoff in the same transaction.
    // A failed write must leave the outcome available for another callback.
    return row && status !== "completed" ? { run, ...applyFailurePolicy(db, row, now) } : { run, row }
  }

  async function publishOutcome(id: ScheduledTaskID, outcome?: RecordedOutcome): Promise<Info> {
    const task = outcome?.row ? fromRow(outcome.row) : await get(id)
    if (!outcome) return task
    if (outcome.pausedAfter !== undefined) {
      log.warn("scheduled task auto-paused after repeated failures", { taskID: id, failures: outcome.pausedAfter })
      publishFailedPersistently(task)
    }
    if (outcome.row) publishUpdated(task)
    if (outcome.run.status === "completed") publishSucceeded(task, outcome.run)
    else publishFailed(task, outcome.run)
    return task
  }

  // Bounded exponential cooldown on consecutive failures, then auto-pause.
  function applyFailurePolicy(db: Database.TxOrDb, row: TaskRow, now: number): { row: TaskRow; pausedAfter?: number } {
    if (row.status !== "active") return { row }
    const failures = consecutiveFailures(db, row.id)
    const pause = failures >= MAX_CONSECUTIVE_FAILURES
    const backoff = Math.min(FAILURE_BACKOFF_BASE_MS * 2 ** (failures - 1), FAILURE_BACKOFF_MAX_MS)
    const updated = db
      .update(ScheduledTaskTable)
      .set(
        pause
          ? {
              status: "paused",
              error: `auto-paused after ${failures} consecutive failures: ${row.error ?? "unknown error"}`,
            }
          : { next_run_at: sql`max(coalesce(${ScheduledTaskTable.next_run_at}, 0), ${now + backoff})` },
      )
      .where(eq(ScheduledTaskTable.id, row.id))
      .returning()
      .get()
    return updated ? { row: updated, pausedAfter: pause ? failures : undefined } : { row }
  }

  export async function recordWorkflowRun(id: ScheduledTaskID, workflowRunID: string): Promise<Info> {
    const now = Date.now()
    const task = SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      // A scheduler tick stamps its dispatch row at claim time, before the
      // workflow exists, so that row carries no workflow id. Link it here, where
      // the executor reports the run it just created. hasOpenRunIn and
      // reconcileOrphanRuns read the ROW (not the task) to keep a still-executing
      // workflow open past deadline+grace; without the link the next occurrence
      // double-fires and the live outcome loses its row. A manual run-now stamps
      // the row at claim and never reaches this path.
      db.update(ScheduledTaskRunTable)
        .set({ workflow_run_id: workflowRunID, time_updated: now })
        .where(and(eq(ScheduledTaskRunTable.task_id, id), eq(ScheduledTaskRunTable.status, "running")))
        .run()
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

  // Claim the terminal transition for a workflow outcome. Returns the run row
  // only when this call is the first to record the current run's outcome:
  // either the open `running` row (the run inserted at claim/dispatch), or the
  // row the orphan sweep finalized. reconcileOrphanRuns deliberately does not
  // apply the failure policy, so a real outcome arriving after it still owes
  // the task summary and retry policy — but an outcome already recorded here
  // must leave the row untouched, because the workflow bridge re-reports a
  // terminal run on every later sibling sync and each repeat would push
  // next_run_at further out under the failure policy.
  function claimWorkflowOutcomeRun(
    db: Database.TxOrDb,
    taskID: ScheduledTaskID,
    status: OutcomeStatus,
    error: string | undefined,
    workflowRunID: string | undefined,
    now: number,
  ): RunInfo | undefined {
    // Bind the claim to the reporting workflow when known. An older
    // workflow must not terminate the row of a newer occurrence.
    const conditions = [
      eq(ScheduledTaskRunTable.task_id, taskID),
      eq(ScheduledTaskRunTable.project_id, Instance.project.id),
    ]
    if (workflowRunID) conditions.push(eq(ScheduledTaskRunTable.workflow_run_id, workflowRunID))
    const open = db
      .update(ScheduledTaskRunTable)
      .set({ status, error: error ?? null, time_completed: now, time_updated: now })
      .where(and(...conditions, eq(ScheduledTaskRunTable.status, "running")))
      .returning()
      .get()
    if (open) return runFromRow(open)

    const latest = db
      .select({ id: ScheduledTaskRunTable.id })
      .from(ScheduledTaskRunTable)
      .where(and(...conditions))
      .orderBy(desc(ScheduledTaskRunTable.time_created), desc(ScheduledTaskRunTable.id))
      .limit(1)
      .get()
    if (!latest) return undefined
    const adopted = db
      .update(ScheduledTaskRunTable)
      .set({ status, error: error ?? null, time_updated: now })
      .where(
        and(
          eq(ScheduledTaskRunTable.id, latest.id),
          eq(ScheduledTaskRunTable.status, "failed"),
          like(ScheduledTaskRunTable.error, `${ORPHAN_RUN_ERROR_PREFIX}%`),
        ),
      )
      .returning()
      .get()
    return adopted ? runFromRow(adopted) : undefined
  }

  export async function recordWorkflowOutcome(
    id: ScheduledTaskID,
    status: TerminalDispatchStatus,
    error?: unknown,
    workflowRunID?: string,
  ): Promise<Info> {
    return recordOutcome(id, { workflowRunID }, workflowOutcome(status, error))
  }

  function workflowOutcome(status: TerminalDispatchStatus, error?: unknown): Outcome {
    if (status === "completed") return { status }
    const fallback = status === "cancelled" ? "Scheduled workflow was cancelled." : "Scheduled workflow failed."
    return { status: "failed", error: toErrorMessage(error ?? fallback) }
  }

  function unrecordedOutcome() {
    return or(
      eq(ScheduledTaskRunTable.status, "running"),
      and(eq(ScheduledTaskRunTable.status, "failed"), like(ScheduledTaskRunTable.error, `${ORPHAN_RUN_ERROR_PREFIX}%`)),
    )
  }

  function persistedOutcomes(db: Database.TxOrDb, id?: ScheduledTaskRunID) {
    return db
      .select({
        id: ScheduledTaskRunTable.id,
        taskID: ScheduledTaskRunTable.task_id,
        queue: {
          id: TaskQueueTable.id,
          kind: TaskQueueTable.kind,
          payload: TaskQueueTable.payload,
          status: TaskQueueTable.status,
          error: TaskQueueTable.error,
        },
        workflow: {
          id: WorkflowRunTable.id,
          status: WorkflowRunTable.status,
          error: WorkflowRunTable.error,
        },
      })
      .from(ScheduledTaskRunTable)
      .leftJoin(
        TaskQueueTable,
        and(
          eq(TaskQueueTable.id, ScheduledTaskRunTable.queue_id),
          eq(TaskQueueTable.project_id, ScheduledTaskRunTable.project_id),
          isNull(ScheduledTaskRunTable.workflow_run_id),
          inArray(TaskQueueTable.status, terminalDispatchStatuses),
        ),
      )
      .leftJoin(
        WorkflowRunTable,
        and(
          eq(WorkflowRunTable.id, ScheduledTaskRunTable.workflow_run_id),
          eq(WorkflowRunTable.project_id, ScheduledTaskRunTable.project_id),
          inArray(WorkflowRunTable.status, terminalDispatchStatuses),
        ),
      )
      .where(
        and(
          eq(ScheduledTaskRunTable.project_id, Instance.project.id),
          id ? eq(ScheduledTaskRunTable.id, id) : undefined,
          unrecordedOutcome(),
          or(isNotNull(TaskQueueTable.id), isNotNull(WorkflowRunTable.id)),
        ),
      )
  }

  async function reconcilePersistedOutcomes(now: number): Promise<void> {
    const store = SessionShard.storeForProject(Instance.project.id)
    const candidates = store.use((db) => persistedOutcomes(db).all())
    for (const { id } of candidates) {
      try {
        const outcome = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
          // Re-read inside the write transaction: a queue or workflow retry
          // can change the persisted state after candidate discovery.
          const run = persistedOutcomes(db, id).get()
          if (!run) return undefined
          const { queue, workflow, taskID } = run
          if (workflow) {
            const { status, error } = workflow
            if (status !== "completed" && status !== "failed" && status !== "cancelled") return undefined
            return recordOutcomeIn(db, taskID, { workflowRunID: workflow.id }, workflowOutcome(status, error), now)
          }
          if (!queue) return undefined
          const automation = TaskQueue.readScheduledAutomation(queue)
          if (automation?.taskID !== taskID) return undefined
          // A successful workflow dispatch only starts its workflow.
          if (queue.status === "completed" && automation.workflowTemplateID) return undefined
          const status = queue.status === "completed" ? "completed" : "failed"
          const result = queueOutcome(status, queue.error ?? `Task ended with status ${queue.status}.`)
          return recordOutcomeIn(db, taskID, { queueID: queue.id }, result, now)
        })
        if (outcome) await publishOutcome(outcome.run.taskID, outcome)
      } catch (error) {
        log.warn("failed to reconcile persisted scheduled task outcome", { runID: id, error: toErrorMessage(error) })
      }
    }
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
      void reconcileAllOrphanRuns()
        .catch((error) => {
          log.warn("scheduled task orphan sweep failed", { error })
        })
        .then(() => runDue())
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
