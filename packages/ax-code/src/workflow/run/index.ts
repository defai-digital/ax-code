import { HTTPException } from "hono/http-exception"
import { Instance } from "../../project/instance"
import { SessionShard } from "../../session/shard"
import { TaskQueue } from "../../session/task-queue"
import type { SessionID } from "../../session/schema"
import { type Database, NotFoundError, and, asc, desc, eq, inArray, notInArray } from "../../storage/db"
import { Log } from "../../util/log"
import { defaultWorkflowArtifactRedaction } from "../artifact"
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
  WorkflowRunDetail,
  WorkflowRunID,
} from "../state"
import {
  WorkflowArtifactTable,
  WorkflowBudgetLedgerTable,
  WorkflowChildTable,
  WorkflowPhaseTable,
  WorkflowRunTable,
} from "../workflow.sql"
import { appendBudgetUsage, isBudgetExceeded } from "./budget"
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
  getChild,
  getPhase,
  getRun,
  isTerminalChildStatus,
  isTerminalPhaseStatus,
  isTerminalRunStatus,
  parseWorkflowDetailRows,
  publishArtifactWritten,
  publishChildCreated,
  publishChildUpdated,
  publishCreated,
  publishPhaseUpdated,
  publishUpdated,
  publishVerificationAttached,
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

async function list(input: Partial<WorkflowRunState.ListInput> = {}): Promise<WorkflowRunState.Info[]> {
  const parsed = WorkflowRunState.ListInput.partial().parse(input)
  if (parsed.parentSessionID) await assertSessionCompatible(parsed.parentSessionID)
  const conditions = [eq(WorkflowRunTable.project_id, Instance.project.id)]
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

export async function getDetail(id: WorkflowRunID): Promise<WorkflowRunDetail> {
  const run = await get(id)
  const detail = SessionShard.storeForProject(Instance.project.id).use((db) => {
    const phaseRows = db
      .select()
      .from(WorkflowPhaseTable)
      .where(eq(WorkflowPhaseTable.run_id, id))
      .orderBy(asc(WorkflowPhaseTable.position), asc(WorkflowPhaseTable.id))
      .all()
    const phases = parseWorkflowDetailRows(phaseRows, fromPhaseRow, "phase")
    const childRows = db
      .select()
      .from(WorkflowChildTable)
      .where(eq(WorkflowChildTable.run_id, id))
      .orderBy(asc(WorkflowChildTable.time_created), asc(WorkflowChildTable.id))
      .all()
    const children = parseWorkflowDetailRows(childRows, fromChildRow, "child")
    const artifactRows = db
      .select()
      .from(WorkflowArtifactTable)
      .where(eq(WorkflowArtifactTable.run_id, id))
      .orderBy(asc(WorkflowArtifactTable.time_created), asc(WorkflowArtifactTable.id))
      .all()
    const artifacts = parseWorkflowDetailRows(artifactRows, fromArtifactRow, "artifact")
    const budgetRows = db
      .select()
      .from(WorkflowBudgetLedgerTable)
      .where(eq(WorkflowBudgetLedgerTable.run_id, id))
      .orderBy(asc(WorkflowBudgetLedgerTable.time_created), asc(WorkflowBudgetLedgerTable.id))
      .all()
    const budgetLedger = parseWorkflowDetailRows(budgetRows, fromBudgetLedgerRow, "budget ledger")
    return { ...run, phases, children, artifacts, budgetLedger }
  })
  return WorkflowRunDetail.parse(detail)
}

async function setStatus(
  input: WorkflowRunState.SetStatusInput,
  options: { reopenCancelled?: boolean } = {},
): Promise<WorkflowRunState.Info> {
  const parsed = WorkflowRunState.SetStatusInput.parse(input)
  const completionGate =
    parsed.status === "completed" ? evaluateCompletionGate(await getDetail(parsed.id)) : { ok: true as const }
  const result = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const current = readRunRow(db, parsed.id)
    if (
      (current.status === "cancelled" && !options.reopenCancelled) ||
      (parsed.status === "cancelled" && TaskQueue.hasLiveWorkflowChildren(db, parsed.id))
    )
      return { run: fromRunRow(current) }
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

async function finishCancellation(runID: WorkflowRunID): Promise<WorkflowRunDetail> {
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
    const phases = db.update(WorkflowPhaseTable).set(updates).where(phaseScope).returning().all().map(fromPhaseRow)
    const children = db.update(WorkflowChildTable).set(updates).where(childScope).returning().all().map(fromChildRow)
    const run =
      current.status === "cancelled" && phases.length === 0 && children.length === 0
        ? undefined
        : fromRunRow(db.update(WorkflowRunTable).set(updates).where(eq(WorkflowRunTable.id, runID)).returning().get())
    return { run, previous: current.status, phases, children, oldPhases, oldChildren }
  })
  for (const phase of result.phases) publishPhaseUpdated(phase, result.oldPhases.get(phase.id))
  for (const child of result.children) publishChildUpdated(child, result.oldChildren.get(child.id))
  if (result.run) publishUpdated(result.run, result.previous)
  return getDetail(runID)
}

async function setPhaseStatus(input: WorkflowRunState.SetPhaseStatusInput): Promise<WorkflowPhaseRecord> {
  const parsed = WorkflowRunState.SetPhaseStatusInput.parse(input)
  const current = await getPhase(parsed.id)
  const now = Date.now()
  const updates: Partial<typeof WorkflowPhaseTable.$inferInsert> = {
    status: parsed.status,
    // Null (not undefined) so a re-enabled phase actually clears a stale error.
    error: parsed.error ?? null,
    time_updated: now,
  }
  if (parsed.status === "running" && current.time.started === undefined) updates.time_started = now
  updates.time_completed = isTerminalPhaseStatus(parsed.status) ? now : null

  const phase = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    if (readRunRow(db, current.runID).status === "cancelled") return undefined
    const row = db.update(WorkflowPhaseTable).set(updates).where(eq(WorkflowPhaseTable.id, parsed.id)).returning().get()
    if (!row) throw new NotFoundError({ message: `Workflow phase not found: ${parsed.id}` })
    db.update(WorkflowRunTable)
      .set(parsed.status === "running" ? { current_phase_id: row.id, time_updated: now } : { time_updated: now })
      .where(eq(WorkflowRunTable.id, row.run_id))
      .run()
    return fromPhaseRow(row)
  })
  if (!phase) return getPhase(parsed.id)
  publishPhaseUpdated(phase, current.status)
  return phase
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

async function enqueueChild(
  input: Omit<WorkflowRunState.AppendChildInput, "taskQueueID"> & { sessionID: SessionID },
  queue: Pick<TaskQueue.EnqueueInput, "title" | "payload" | "sourceTaskID"> & {
    specPhaseID: string
    startOptions: unknown
  },
): Promise<{ child: WorkflowChildRecord; task: TaskQueue.Info } | undefined> {
  const parsed = WorkflowRunState.AppendChildInput.parse(input)
  await assertPhaseBelongsToRun(parsed.phaseID, parsed.runID)
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
  const result = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const run = readRunRow(db, parsed.runID)
    if (run.status !== "running" && run.status !== "blocked") return undefined
    const now = Date.now()
    const task = insert(db, now)
    const child = insertChild(db, { ...parsed, taskQueueID: task.id }, id, now)
    return { child, task }
  })
  if (result) {
    publishChildCreated(result.child)
    await TaskQueue.publishEnqueued(result.task)
  }
  return result
}

async function setChildStatus(input: WorkflowRunState.SetChildStatusInput): Promise<WorkflowChildRecord> {
  const parsed = WorkflowRunState.SetChildStatusInput.parse(input)
  const current = await getChild(parsed.id)
  const now = Date.now()
  const updates: Partial<typeof WorkflowChildTable.$inferInsert> = {
    status: parsed.status,
    output_summary: parsed.outputSummary,
    artifact_ids: parsed.artifactIDs ?? current.artifactIDs,
    evidence_refs: parsed.evidenceRefs ?? current.evidenceRefs,
    // Null (not undefined) so a re-enabled child actually clears a stale error.
    error: parsed.error ?? null,
    time_updated: now,
  }
  if (parsed.status === "running" && current.time.started === undefined) updates.time_started = now
  updates.time_completed = isTerminalChildStatus(parsed.status) ? now : null

  const child = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    if (readRunRow(db, current.runID).status === "cancelled") return undefined
    const row = db.update(WorkflowChildTable).set(updates).where(eq(WorkflowChildTable.id, parsed.id)).returning().get()
    if (!row) throw new NotFoundError({ message: `Workflow child not found: ${parsed.id}` })
    touchRun(db, row.run_id, now)
    return fromChildRow(row)
  })
  if (!child) return getChild(parsed.id)
  publishChildUpdated(child, current.status)
  return child
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

async function recoverInterrupted(): Promise<{ failed: WorkflowRunState.Info[]; recovered: WorkflowRunState.Info[] }> {
  const now = Date.now()
  const interruptedRunStatuses = ["running"] as const
  const changed = SessionShard.storeForProject(Instance.project.id, { write: true }).transaction((db) => {
    const rows = db
      .select()
      .from(WorkflowRunTable)
      .where(
        and(
          eq(WorkflowRunTable.project_id, Instance.project.id),
          inArray(WorkflowRunTable.status, interruptedRunStatuses),
        ),
      )
      .all()
    const failed: WorkflowRunState.Info[] = []
    const recovered: WorkflowRunState.Info[] = []
    for (const row of rows) {
      db.update(WorkflowChildTable)
        .set({
          status: "queued",
          error: null,
          time_started: null,
          time_completed: null,
          time_updated: now,
        })
        .where(and(eq(WorkflowChildTable.run_id, row.id), eq(WorkflowChildTable.status, "running")))
        .run()
      const updated = db
        .update(WorkflowRunTable)
        .set({
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, row.id))
        .returning()
        .get()
      if (updated) recovered.push(fromRunRow(updated))
    }
    return { failed, recovered }
  })
  for (const run of changed.recovered) publishUpdated(run)
  return changed
}

// --- Public API ---

export const WorkflowRun = {
  ...WorkflowRunState,
  create,
  list,
  get,
  getDetail,
  setStatus,
  setPhaseStatus,
  appendChild,
  enqueueChild,
  finishCancellation,
  setChildStatus,
  appendArtifact,
  appendBudgetUsage,
  isBudgetExceeded,
  attachVerificationEnvelopeIDs,
  ensureFinalReportArtifact,
  recoverInterrupted,
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
