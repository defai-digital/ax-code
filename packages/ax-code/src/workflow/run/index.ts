import { HTTPException } from "hono/http-exception"
import { ZodError } from "zod"
import { Instance } from "../../project/instance"
import { SessionShard } from "../../session/shard"
import { TaskQueue } from "../../session/task-queue"
import type { SessionID } from "../../session/schema"
import { type Database, type SQLWrapper, NotFoundError, and, asc, desc, eq, notInArray, sql } from "../../storage/db"
import { Log } from "../../util/log"
import { defaultWorkflowArtifactRedaction } from "../artifact"
import { addWorkflowBudgetUsage, evaluateWorkflowBudget } from "../budget"
import { WorkflowInputValidationError, resolveWorkflowInputValues } from "../spec"
import {
  EmptyWorkflowBudgetUsage,
  WorkflowArtifactID,
  WorkflowArtifactRecord,
  WorkflowChildID,
  WorkflowChildRecord,
  WorkflowPhaseID,
  WorkflowPhaseRecord,
  WorkflowRun as WorkflowRunState,
  type WorkflowRunDetail,
  WorkflowRunID,
} from "../state"
import {
  WorkflowArtifactTable,
  WorkflowBudgetLedgerTable,
  WorkflowChildTable,
  WorkflowPhaseTable,
  WorkflowRunTable,
} from "../workflow.sql"
import { appendBudgetUsage, isBudgetExceeded, publishBudgetUsage, writeBudgetUsage } from "./budget"
import { ensureFinalReportArtifact, WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID } from "./final-report"
import {
  assertChildBelongsToRun,
  assertPhaseBelongsToRun,
  assertSessionCompatible,
  evaluateCompletionGate,
  fromArtifactRow,
  fromBudgetLedgerRow,
  fromChildRow,
  fromPhaseRow,
  fromRunRow,
  getRun,
  isTerminalChildStatus,
  isTerminalPhaseStatus,
  isTerminalRunStatus,
  matchesChildStatuses,
  matchesPhaseStatuses,
  parseWorkflowDetailRows,
  phaseOrder,
  childOrder,
  type StatusRows,
  publishArtifactWritten,
  publishChildCreated,
  publishChildUpdated,
  publishCreated,
  publishPhaseUpdated,
  publishUpdated,
  publishVerificationAttached,
  readChild,
  readPhase,
  readRunRow,
  touchRun,
  unique,
  uniqueEvidenceRefs,
} from "./internal"

export { WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID }
export { appendBudgetUsage, isBudgetExceeded }

const log = Log.create({ service: "workflow.run" })

// --- CRUD operations ---

async function create(input: WorkflowRunState.CreateInput): Promise<WorkflowRunState.Info> {
  const parsed = WorkflowRunState.CreateInput.parse(input)
  if (parsed.parentSessionID) await assertSessionCompatible(parsed.parentSessionID)
  const inputValues = (() => {
    try {
      return resolveWorkflowInputValues(parsed.spec, parsed.inputValues)
    } catch (error) {
      if (error instanceof WorkflowInputValidationError) throw new HTTPException(400, { message: error.message })
      throw error
    }
  })()

  const now = Date.now()
  const run = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const id = WorkflowRunID.ascending()
    const phaseIDs = parsed.spec.phases.map(() => WorkflowPhaseID.ascending())
    const currentPhaseID = phaseIDs[0]
    const row = db
      .insert(WorkflowRunTable)
      .values({
        id,
        project_id: Instance.project.id,
        directory: Instance.directory,
        parent_session_id: parsed.parentSessionID,
        source_template_id: parsed.sourceTemplateID,
        source_task_id: parsed.sourceTaskID,
        status: "queued",
        current_phase_id: currentPhaseID,
        spec_snapshot: parsed.spec,
        input_values: inputValues,
        budget: parsed.spec.budget,
        budget_usage: EmptyWorkflowBudgetUsage,
        verification_envelope_ids: [],
        time_created: now,
        time_updated: now,
      })
      .returning()
      .get()

    for (const [index, phase] of parsed.spec.phases.entries()) {
      db.insert(WorkflowPhaseTable)
        .values({
          id: phaseIDs[index]!,
          run_id: id,
          spec_phase_id: phase.id,
          position: index,
          name: phase.name,
          kind: phase.kind,
          status: "queued",
          agent: phase.agent,
          model_policy: phase.modelPolicy,
          budget: phase.budget,
          outputs: phase.outputs,
          time_created: now,
          time_updated: now,
        })
        .run()
    }

    return fromRunRow(row)
  })
  publishCreated(run)
  return run
}

function readableJson(...columns: SQLWrapper[]) {
  return sql.join(
    columns.map((column) => sql`(${column} is null or (typeof(${column}) = 'text' and json_valid(${column})))`),
    sql` and `,
  )
}

const readableRunJson = readableJson(
  WorkflowRunTable.spec_snapshot,
  WorkflowRunTable.input_values,
  WorkflowRunTable.budget,
  WorkflowRunTable.budget_usage,
  WorkflowRunTable.verification_envelope_ids,
)
const readablePhaseJson = readableJson(
  WorkflowPhaseTable.model_policy,
  WorkflowPhaseTable.budget,
  WorkflowPhaseTable.outputs,
)
const readableChildJson = readableJson(
  WorkflowChildTable.model,
  WorkflowChildTable.budget_slice,
  WorkflowChildTable.artifact_ids,
  WorkflowChildTable.evidence_refs,
)
const readableArtifactJson = readableJson(
  WorkflowArtifactTable.payload,
  WorkflowArtifactTable.redaction,
  WorkflowArtifactTable.evidence_refs,
)
const readableBudgetJson = readableJson(WorkflowBudgetLedgerTable.usage_delta)

async function list(input: Partial<WorkflowRunState.ListInput> = {}): Promise<WorkflowRunState.Info[]> {
  const parsed = WorkflowRunState.ListInput.partial().parse(input)
  if (parsed.parentSessionID) await assertSessionCompatible(parsed.parentSessionID)
  const conditions = [eq(WorkflowRunTable.project_id, Instance.project.id), readableRunJson]
  if (parsed.status) conditions.push(eq(WorkflowRunTable.status, parsed.status))
  if (parsed.parentSessionID) conditions.push(eq(WorkflowRunTable.parent_session_id, parsed.parentSessionID))
  return SessionShard.storeForProject(Instance.project.id).use((db) => {
    let query = db
      .select()
      .from(WorkflowRunTable)
      .where(and(...conditions))
      .orderBy(desc(WorkflowRunTable.time_created), desc(WorkflowRunTable.id))
      .$dynamic()
    if (parsed.limit) query = query.limit(parsed.limit)
    return query.all().flatMap((row) => {
      try {
        return [fromRunRow(row)]
      } catch {
        log.warn("skipping corrupt workflow run row", { id: row.id })
        return []
      }
    })
  })
}

async function get(id: WorkflowRunID): Promise<WorkflowRunState.Info> {
  return getRun(id)
}

function readDetail(
  db: Database.TxOrDb,
  run: WorkflowRunState.Info,
  mode: "execution" | "display" | "dashboard",
): WorkflowRunDetail {
  const skipUnreadableRows = mode !== "execution"
  const skipMalformedJson = mode === "display"
  const phaseRows = db
    .select()
    .from(WorkflowPhaseTable)
    .where(and(eq(WorkflowPhaseTable.run_id, run.id), skipMalformedJson ? readablePhaseJson : undefined))
    .orderBy(...phaseOrder)
    .all()
  const phases = parseWorkflowDetailRows(phaseRows, fromPhaseRow, "phase", skipUnreadableRows)
  const childRows = db
    .select()
    .from(WorkflowChildTable)
    .where(and(eq(WorkflowChildTable.run_id, run.id), skipMalformedJson ? readableChildJson : undefined))
    .orderBy(...childOrder)
    .all()
  const children = parseWorkflowDetailRows(childRows, fromChildRow, "child", skipUnreadableRows)
  const artifactRows = db
    .select()
    .from(WorkflowArtifactTable)
    .where(and(eq(WorkflowArtifactTable.run_id, run.id), skipMalformedJson ? readableArtifactJson : undefined))
    .orderBy(asc(WorkflowArtifactTable.time_created), asc(WorkflowArtifactTable.id))
    .all()
  const artifacts = parseWorkflowDetailRows(artifactRows, fromArtifactRow, "artifact", skipUnreadableRows)
  const budgetRows = db
    .select()
    .from(WorkflowBudgetLedgerTable)
    .where(and(eq(WorkflowBudgetLedgerTable.run_id, run.id), skipMalformedJson ? readableBudgetJson : undefined))
    .orderBy(asc(WorkflowBudgetLedgerTable.time_created), asc(WorkflowBudgetLedgerTable.id))
    .all()
  const budgetLedger = parseWorkflowDetailRows(budgetRows, fromBudgetLedgerRow, "budget ledger", skipUnreadableRows)
  return { ...run, phases, children, artifacts, budgetLedger }
}

export async function getDetail(id: WorkflowRunID): Promise<WorkflowRunDetail> {
  let detail: WorkflowRunDetail
  try {
    detail = SessionShard.storeForProject(Instance.project.id).use((db) =>
      readDetail(db, fromRunRow(readRunRow(db, id)), "execution"),
    )
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof ZodError)) throw error
    throw new HTTPException(409, { message: `Workflow run ${id} contains unreadable stored data.`, cause: error })
  }

  const phaseIDs = new Set(detail.phases.map((phase) => phase.specPhaseID))
  if (
    detail.phases.length !== detail.spec.phases.length ||
    detail.spec.phases.some((phase) => !phaseIDs.has(phase.id))
  ) {
    throw new HTTPException(409, { message: `Workflow run ${id} has incomplete or inconsistent phase records.` })
  }
  return detail
}

async function getDisplayDetail(id: WorkflowRunID): Promise<WorkflowRunDetail> {
  return SessionShard.storeForProject(Instance.project.id).use((db) =>
    readDetail(db, fromRunRow(readRunRow(db, id)), "display"),
  )
}

async function listDetails(input: Partial<WorkflowRunState.ListInput> = {}): Promise<WorkflowRunDetail[]> {
  const runs = await list(input)
  return SessionShard.storeForProject(Instance.project.id).use((db) =>
    runs.flatMap(({ id }) => {
      try {
        // Keep incomplete JSON records out of dashboard summaries.
        return [readDetail(db, fromRunRow(readRunRow(db, id)), "dashboard")]
      } catch (error) {
        if (NotFoundError.isInstance(error)) return []
        if (!(error instanceof SyntaxError || error instanceof ZodError)) throw error
        log.warn("skipping unreadable workflow run details", { id })
        return []
      }
    }),
  )
}

type QueueStatusOptions = { queueItem?: TaskQueue.Info }

async function setStatus(
  input: WorkflowRunState.SetStatusInput,
  options: QueueStatusOptions & {
    ifCurrent?: { status: WorkflowRunState.Status; phases: StatusRows }
    reopenCancelled?: boolean
    signal?: AbortSignal
    preserveTerminal?: boolean
  } = {},
): Promise<WorkflowRunState.Info> {
  const parsed = WorkflowRunState.SetStatusInput.parse(input)
  const completionGate =
    parsed.status === "completed" ? evaluateCompletionGate(await getDetail(parsed.id)) : { ok: true as const }
  const result = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const current = readRunRow(db, parsed.id)
    if (
      options.signal?.aborted ||
      (options.queueItem && !TaskQueue.matchesWorkflowStatus(db, options.queueItem)) ||
      (options.preserveTerminal && isTerminalRunStatus(current.status)) ||
      (current.status === "cancelled" && !options.reopenCancelled) ||
      (parsed.status === "cancelled" && TaskQueue.hasLiveWorkflowChildren(db, parsed.id))
    )
      return { run: fromRunRow(current) }
    const expected = options.ifCurrent
    if (expected && (current.status !== expected.status || !matchesPhaseStatuses(db, parsed.id, expected.phases))) {
      return { run: fromRunRow(current) }
    }
    const now = Date.now()
    const status = completionGate.ok ? parsed.status : "blocked"
    const updates: Partial<typeof WorkflowRunTable.$inferInsert> = {
      status,
      error: completionGate.ok ? (parsed.error ?? null) : completionGate.message,
      time_updated: now,
      time_completed: isTerminalRunStatus(status) ? now : null,
    }
    if (status === "running" && current.time_started === null) updates.time_started = now
    const row = db.update(WorkflowRunTable).set(updates).where(eq(WorkflowRunTable.id, parsed.id)).returning().get()
    return { run: fromRunRow(row), previous: current.status }
  })
  if (result.previous) publishUpdated(result.run, result.previous)
  return result.run
}

function finishCancellation(runID: WorkflowRunID): WorkflowRunDetail {
  const result = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const current = readRunRow(db, runID)
    if (TaskQueue.hasLiveWorkflowChildren(db, runID)) {
      throw new HTTPException(409, { message: `Cannot cancel workflow run ${runID} while a child is active.` })
    }
    const now = Date.now()
    const terminal: Array<"completed" | "failed" | "cancelled"> = ["completed", "failed", "cancelled"]
    const phaseScope = and(eq(WorkflowPhaseTable.run_id, runID), notInArray(WorkflowPhaseTable.status, terminal))
    const childScope = and(eq(WorkflowChildTable.run_id, runID), notInArray(WorkflowChildTable.status, terminal))
    const oldPhases = new Map(
      db
        .select({ id: WorkflowPhaseTable.id, status: WorkflowPhaseTable.status })
        .from(WorkflowPhaseTable)
        .where(phaseScope)
        .all()
        .map((row) => [row.id, row.status]),
    )
    const oldChildren = new Map(
      db
        .select({ id: WorkflowChildTable.id, status: WorkflowChildTable.status })
        .from(WorkflowChildTable)
        .where(childScope)
        .all()
        .map((row) => [row.id, row.status]),
    )
    const updates = { status: "cancelled" as const, error: null, time_completed: now, time_updated: now }
    // Status updates must succeed even when unrelated detail payloads are unreadable.
    const phases = db.update(WorkflowPhaseTable).set(updates).where(phaseScope).run()
    const children = db.update(WorkflowChildTable).set(updates).where(childScope).run()
    const changed = current.status !== "cancelled" || phases.changes > 0 || children.changes > 0
    const row = changed
      ? db.update(WorkflowRunTable).set(updates).where(eq(WorkflowRunTable.id, runID)).returning().get()
      : current
    const run = fromRunRow(row)
    return { run, detail: readDetail(db, run, "display"), changed, previous: current.status, oldPhases, oldChildren }
  })
  for (const phase of result.detail.phases) {
    const previous = result.oldPhases.get(phase.id)
    if (previous && phase.status === "cancelled") publishPhaseUpdated(phase, previous)
  }
  for (const child of result.detail.children) {
    const previous = result.oldChildren.get(child.id)
    if (previous && child.status === "cancelled") publishChildUpdated(child, previous)
  }
  if (result.changed) publishUpdated(result.run, result.previous)
  return result.detail
}

async function setPhaseStatus(
  input: WorkflowRunState.SetPhaseStatusInput,
  options: QueueStatusOptions & { ifCurrent?: { status: WorkflowRunState.PhaseStatus; children: StatusRows } } = {},
): Promise<WorkflowPhaseRecord> {
  const parsed = WorkflowRunState.SetPhaseStatusInput.parse(input)
  const result = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const { phase: current, run } = readPhase(db, parsed.id)
    if (run.status === "cancelled" || (options.queueItem && !TaskQueue.matchesWorkflowStatus(db, options.queueItem))) {
      return { phase: current }
    }
    const expected = options.ifCurrent
    if (expected && (current.status !== expected.status || !matchesChildStatuses(db, current, expected.children))) {
      return { phase: current }
    }
    const now = Date.now()
    const updates: Partial<typeof WorkflowPhaseTable.$inferInsert> = {
      status: parsed.status,
      error: parsed.error ?? null,
      time_updated: now,
      time_started: parsed.status === "running" && current.time.started === undefined ? now : undefined,
      time_completed: isTerminalPhaseStatus(parsed.status) ? now : null,
    }
    const row = db.update(WorkflowPhaseTable).set(updates).where(eq(WorkflowPhaseTable.id, parsed.id)).returning().get()
    if (!row) throw new NotFoundError({ message: `Workflow phase not found: ${parsed.id}` })
    db.update(WorkflowRunTable)
      .set(parsed.status === "running" ? { current_phase_id: row.id, time_updated: now } : { time_updated: now })
      .where(eq(WorkflowRunTable.id, row.run_id))
      .run()
    return { phase: fromPhaseRow(row), previous: current.status }
  })
  if (result.previous) publishPhaseUpdated(result.phase, result.previous)
  return result.phase
}

function insertChild(
  db: Database.TxOrDb,
  input: WorkflowRunState.AppendChildInput,
  id: WorkflowChildID,
  now: number,
): WorkflowChildRecord {
  const row = db
    .insert(WorkflowChildTable)
    .values({
      id,
      run_id: input.runID,
      phase_id: input.phaseID,
      task_queue_id: input.taskQueueID,
      session_id: input.sessionID,
      status: "queued",
      agent: input.agent,
      model: input.model,
      budget_slice: input.budgetSlice,
      artifact_ids: [],
      evidence_refs: [],
      time_created: now,
      time_updated: now,
    })
    .returning()
    .get()
  touchRun(db, input.runID, now)
  return fromChildRow(row)
}

async function appendChild(input: WorkflowRunState.AppendChildInput): Promise<WorkflowChildRecord> {
  const parsed = WorkflowRunState.AppendChildInput.parse(input)
  if (parsed.sessionID) await assertSessionCompatible(parsed.sessionID)
  await assertPhaseBelongsToRun(parsed.phaseID, parsed.runID)
  const child = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    if (readRunRow(db, parsed.runID).status === "cancelled") {
      throw new HTTPException(409, { message: `Workflow run ${parsed.runID} is cancelled.` })
    }
    return insertChild(db, parsed, WorkflowChildID.ascending(), Date.now())
  })
  publishChildCreated(child)
  return child
}

type PreparedWorkflowChild = {
  projectID: WorkflowRunState.Info["projectID"]
  runID: WorkflowRunID
  phaseID: WorkflowPhaseID
  insert: (db: Database.TxOrDb, now: number) => { child: WorkflowChildRecord; task: TaskQueue.Info }
  publish: (created: { child: WorkflowChildRecord; task: TaskQueue.Info }) => Promise<void>
}

async function prepareQueuedChild(
  input: Omit<WorkflowRunState.AppendChildInput, "taskQueueID"> & { sessionID: SessionID },
  queue: Pick<TaskQueue.EnqueueInput, "title" | "payload" | "sourceTaskID"> & {
    specPhaseID: string
    startOptions: unknown
  },
): Promise<PreparedWorkflowChild> {
  const parsed = WorkflowRunState.AppendChildInput.parse(input)
  const id = WorkflowChildID.ascending()
  const insert = await TaskQueue.prepareEnqueue({
    sessionID: input.sessionID,
    kind: "subagent",
    title: queue.title,
    agent: parsed.agent,
    model: parsed.model,
    sourceTaskID: queue.sourceTaskID,
    payload: {
      ...queue.payload,
      workflow: {
        runID: parsed.runID,
        phaseID: parsed.phaseID,
        childID: id,
        specPhaseID: queue.specPhaseID,
        startOptions: queue.startOptions,
      },
    },
  })
  return {
    projectID: Instance.project.id,
    runID: parsed.runID,
    phaseID: parsed.phaseID,
    insert: Instance.bind((db: Database.TxOrDb, now: number) => {
      const task = insert(db, now)
      return { child: insertChild(db, { ...parsed, taskQueueID: task.id }, id, now), task }
    }),
    publish: Instance.bind(async ({ child, task }: { child: WorkflowChildRecord; task: TaskQueue.Info }) => {
      publishChildCreated(child)
      await TaskQueue.publishEnqueued(task)
    }),
  }
}

function rejectPhaseBudget(
  db: Database.TxOrDb,
  run: ReturnType<typeof readRunRow>,
  phaseID: WorkflowPhaseID,
  childCount: number,
  now: number,
): ReturnType<typeof writeBudgetUsage> | undefined {
  const budget = evaluateWorkflowBudget({
    budget: run.budget,
    usage: addWorkflowBudgetUsage(run.budget_usage, { childAgents: childCount }),
    elapsedMs: now - (run.time_started ?? run.time_created),
  })
  if (budget.exceeded.length === 0) return undefined
  return writeBudgetUsage(
    db,
    {
      runID: run.id,
      phaseID,
      kind: "exceeded",
      usageDelta: EmptyWorkflowBudgetUsage,
      message: `Workflow phase admission exceeded budget: ${budget.exceeded.join("; ")}`,
    },
    now,
    budget,
  )
}

function readAdmissiblePhase(
  db: Database.TxOrDb,
  run: ReturnType<typeof readRunRow>,
  phaseID: WorkflowPhaseID,
): typeof WorkflowPhaseTable.$inferSelect | undefined {
  if (run.status !== "running" && run.status !== "blocked") return undefined
  const phase = db
    .select()
    .from(WorkflowPhaseTable)
    .where(and(eq(WorkflowPhaseTable.id, phaseID), eq(WorkflowPhaseTable.run_id, run.id)))
    .get()
  if (!phase) throw new NotFoundError({ message: `Workflow phase not found: ${phaseID}` })
  if (isTerminalPhaseStatus(phase.status) || phase.status === "paused") return undefined
  return phase
}

function canPreparePhaseChildren(runID: WorkflowRunID, phaseID: WorkflowPhaseID, childCount: number): boolean {
  const result = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const run = readRunRow(db, runID)
    if (!readAdmissiblePhase(db, run, phaseID)) return { allowed: false }
    const failed = rejectPhaseBudget(db, run, phaseID, childCount, Date.now())
    return { allowed: !failed, failed }
  })
  if (result.failed) publishBudgetUsage(result.failed)
  return result.allowed
}

async function enqueuePhaseChildren(
  runID: WorkflowRunID,
  phaseID: WorkflowPhaseID,
  prepared: readonly PreparedWorkflowChild[],
): Promise<TaskQueue.Info[]> {
  const projectID = Instance.project.id
  if (prepared.some((child) => child.runID !== runID || child.phaseID !== phaseID || child.projectID !== projectID)) {
    throw new Error("Prepared workflow children belong to another phase or project.")
  }
  const result = SessionShard.storeForProject(projectID, { write: true }).transaction((db) => {
    const run = readRunRow(db, runID)
    const current = readAdmissiblePhase(db, run, phaseID)
    if (!current) return undefined
    const existing = db
      .select({ id: WorkflowChildTable.id })
      .from(WorkflowChildTable)
      .where(and(eq(WorkflowChildTable.run_id, runID), eq(WorkflowChildTable.phase_id, phaseID)))
      .get()
    if (existing) return undefined

    const now = Date.now()
    const failed = rejectPhaseBudget(db, run, phaseID, prepared.length, now)
    if (failed) return { kind: "budget" as const, failed }

    const phaseRow = db
      .update(WorkflowPhaseTable)
      .set({
        status: "running",
        error: null,
        time_started: current.time_started ?? now,
        time_updated: now,
        time_completed: null,
      })
      .where(eq(WorkflowPhaseTable.id, phaseID))
      .returning()
      .get()
    db.update(WorkflowRunTable)
      .set({ current_phase_id: phaseID, time_updated: now })
      .where(eq(WorkflowRunTable.id, runID))
      .run()

    const children = prepared.map((candidate) => {
      const created = candidate.insert(db, now)
      const accounting = writeBudgetUsage(
        db,
        {
          runID,
          phaseID,
          childID: created.child.id,
          kind: "reserve",
          usageDelta: { ...EmptyWorkflowBudgetUsage, childAgents: 1 },
        },
        now,
      )
      return { created, accounting, publish: candidate.publish }
    })
    return { kind: "queued" as const, phase: fromPhaseRow(phaseRow), previous: current.status, children }
  })
  if (!result) return []
  if (result.kind === "budget") {
    publishBudgetUsage(result.failed)
    return []
  }
  publishPhaseUpdated(result.phase, result.previous)
  await Promise.all(
    result.children.map(({ accounting, publish, created }) => {
      publishBudgetUsage(accounting)
      return publish(created)
    }),
  )
  return result.children.map(({ created }) => created.task)
}

async function setChildStatus(
  input: WorkflowRunState.SetChildStatusInput,
  options: QueueStatusOptions = {},
): Promise<WorkflowChildRecord> {
  const parsed = WorkflowRunState.SetChildStatusInput.parse(input)
  const result = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const { child: current, run } = readChild(db, parsed.id)
    if (run.status === "cancelled" || (options.queueItem && !TaskQueue.matchesWorkflowStatus(db, options.queueItem))) {
      return { child: current }
    }
    const now = Date.now()
    const updates: Partial<typeof WorkflowChildTable.$inferInsert> = {
      status: parsed.status,
      output_summary: parsed.outputSummary,
      artifact_ids: parsed.artifactIDs,
      evidence_refs: parsed.evidenceRefs,
      error: parsed.error ?? null,
      time_updated: now,
      time_started: parsed.status === "running" && current.time.started === undefined ? now : undefined,
      time_completed: isTerminalChildStatus(parsed.status) ? now : null,
    }
    const row = db.update(WorkflowChildTable).set(updates).where(eq(WorkflowChildTable.id, parsed.id)).returning().get()
    if (!row) throw new NotFoundError({ message: `Workflow child not found: ${parsed.id}` })
    touchRun(db, row.run_id, now)
    return { child: fromChildRow(row), previous: current.status }
  })
  if (result.previous) publishChildUpdated(result.child, result.previous)
  return result.child
}

export async function appendArtifact(input: WorkflowRunState.AppendArtifactInput): Promise<WorkflowArtifactRecord> {
  const parsed = WorkflowRunState.AppendArtifactInput.parse(input)
  await get(parsed.runID)
  if (parsed.phaseID) await assertPhaseBelongsToRun(parsed.phaseID, parsed.runID)
  if (parsed.childID) await assertChildBelongsToRun(parsed.childID, parsed.runID)

  const now = Date.now()
  const artifact = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const id = WorkflowArtifactID.ascending()
    const row = db
      .insert(WorkflowArtifactTable)
      .values({
        id,
        run_id: parsed.runID,
        phase_id: parsed.phaseID,
        child_id: parsed.childID,
        spec_artifact_id: parsed.specArtifactID,
        kind: parsed.kind,
        retention: parsed.retention,
        expose_to_main_context: parsed.exposeToMainContext,
        summary: parsed.summary,
        payload: parsed.payload,
        redaction: parsed.redaction ?? defaultWorkflowArtifactRedaction(parsed),
        evidence_refs: parsed.evidenceRefs,
        time_created: now,
        time_updated: now,
      })
      .returning()
      .get()

    if (parsed.childID) {
      const child = db.select().from(WorkflowChildTable).where(eq(WorkflowChildTable.id, parsed.childID)).get()
      if (child) {
        const outputSummary = child.output_summary ?? (parsed.kind === "summary" ? parsed.summary : undefined)
        db.update(WorkflowChildTable)
          .set({
            artifact_ids: unique([...child.artifact_ids, id]),
            evidence_refs: uniqueEvidenceRefs([...child.evidence_refs, { kind: "artifact" as const, id }]),
            ...(outputSummary !== undefined ? { output_summary: outputSummary } : {}),
            time_updated: now,
          })
          .where(eq(WorkflowChildTable.id, child.id))
          .run()
      }
    }
    touchRun(db, parsed.runID, now)
    return fromArtifactRow(row)
  })
  publishArtifactWritten(artifact)
  return artifact
}

async function attachVerificationEnvelopeIDs(
  input: WorkflowRunState.AttachVerificationInput,
): Promise<WorkflowRunState.Info> {
  const parsed = WorkflowRunState.AttachVerificationInput.parse(input)
  const now = Date.now()
  const changed = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const existing = db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, parsed.id)).get()
    if (!existing) throw new NotFoundError({ message: `Workflow run not found: ${parsed.id}` })
    const attachedEnvelopeIDs = unique(
      parsed.envelopeIDs.filter((envelopeID) => !existing.verification_envelope_ids.includes(envelopeID)),
    )
    const row = db
      .update(WorkflowRunTable)
      .set({
        verification_envelope_ids: unique([...existing.verification_envelope_ids, ...parsed.envelopeIDs]),
        time_updated: now,
      })
      .where(eq(WorkflowRunTable.id, parsed.id))
      .returning()
      .get()
    if (!row) throw new NotFoundError({ message: `Workflow run not found: ${parsed.id}` })
    return { run: fromRunRow(row), attachedEnvelopeIDs }
  })
  publishUpdated(changed.run)
  if (changed.attachedEnvelopeIDs.length > 0) publishVerificationAttached(changed.run, changed.attachedEnvelopeIDs)
  return changed.run
}

// --- Public API ---

export const WorkflowRun = {
  ...WorkflowRunState,
  create,
  list,
  listDetails,
  get,
  getDetail,
  getDisplayDetail,
  setStatus,
  setPhaseStatus,
  appendChild,
  canPreparePhaseChildren,
  prepareQueuedChild,
  enqueuePhaseChildren,
  finishCancellation,
  setChildStatus,
  appendArtifact,
  appendBudgetUsage,
  isBudgetExceeded,
  attachVerificationEnvelopeIDs,
  ensureFinalReportArtifact,
  isTerminalRunStatus,
  isTerminalPhaseStatus,
  isTerminalChildStatus,
}

export namespace WorkflowRun {
  export type Info = WorkflowRunState.Info
  export type Status = WorkflowRunState.Status
  export type PhaseStatus = WorkflowRunState.PhaseStatus
  export type ChildStatus = WorkflowRunState.ChildStatus
  export type ArtifactKind = WorkflowRunState.ArtifactKind
  export type ArtifactRetention = WorkflowRunState.ArtifactRetention
  export type BudgetLedgerKind = WorkflowRunState.BudgetLedgerKind
  export type CreateInput = WorkflowRunState.CreateInput
  export type ListInput = WorkflowRunState.ListInput
  export type SetStatusInput = WorkflowRunState.SetStatusInput
  export type SetPhaseStatusInput = WorkflowRunState.SetPhaseStatusInput
  export type AppendChildInput = WorkflowRunState.AppendChildInput
  export type SetChildStatusInput = WorkflowRunState.SetChildStatusInput
  export type AppendArtifactInput = WorkflowRunState.AppendArtifactInput
  export type AppendBudgetUsageInput = WorkflowRunState.AppendBudgetUsageInput
  export type AttachVerificationInput = WorkflowRunState.AttachVerificationInput
}
