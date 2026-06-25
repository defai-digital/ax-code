import { HTTPException } from "hono/http-exception"
import { Instance } from "../../project/instance"
import { Database, NotFoundError, and, asc, desc, eq, inArray } from "../../storage/db"
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
import { appendBudgetUsage } from "./budget"
import { ensureFinalReportArtifact, WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID } from "./final-report"
import {
  assertChildBelongsToRun,
  assertPhaseBelongsToRun,
  assertProjectRun,
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
  touchRun,
  unique,
  uniqueEvidenceRefs,
} from "./internal"

export { WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID }
export { appendBudgetUsage }

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
  const run = Database.transaction((db) => {
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
  return Database.use((db) => {
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
  const detail = Database.use((db) => {
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

async function setStatus(input: WorkflowRunState.SetStatusInput): Promise<WorkflowRunState.Info> {
  const parsed = WorkflowRunState.SetStatusInput.parse(input)
  const completionGate =
    parsed.status === "completed" ? evaluateCompletionGate(await getDetail(parsed.id)) : { ok: true as const }
  const current = await get(parsed.id)
  const now = Date.now()
  const status = completionGate.ok ? parsed.status : "blocked"
  const updates: Partial<typeof WorkflowRunTable.$inferInsert> = {
    status,
    error: completionGate.ok ? parsed.error : completionGate.message,
    time_updated: now,
  }
  if (status === "running" && current.time.started === undefined) updates.time_started = now
  updates.time_completed = isTerminalRunStatus(status) ? now : null

  const run = Database.use((db) => {
    const row = db.update(WorkflowRunTable).set(updates).where(eq(WorkflowRunTable.id, parsed.id)).returning().get()
    if (!row) throw new NotFoundError({ message: `Workflow run not found: ${parsed.id}` })
    return fromRunRow(row)
  })
  assertProjectRun(run)
  publishUpdated(run, current.status)
  return run
}

async function setPhaseStatus(input: WorkflowRunState.SetPhaseStatusInput): Promise<WorkflowPhaseRecord> {
  const parsed = WorkflowRunState.SetPhaseStatusInput.parse(input)
  const current = await getPhase(parsed.id)
  const now = Date.now()
  const updates: Partial<typeof WorkflowPhaseTable.$inferInsert> = {
    status: parsed.status,
    error: parsed.error,
    time_updated: now,
  }
  if (parsed.status === "running" && current.time.started === undefined) updates.time_started = now
  updates.time_completed = isTerminalPhaseStatus(parsed.status) ? now : null

  const phase = Database.transaction((db) => {
    const row = db.update(WorkflowPhaseTable).set(updates).where(eq(WorkflowPhaseTable.id, parsed.id)).returning().get()
    if (!row) throw new NotFoundError({ message: `Workflow phase not found: ${parsed.id}` })
    db.update(WorkflowRunTable)
      .set(parsed.status === "running" ? { current_phase_id: row.id, time_updated: now } : { time_updated: now })
      .where(eq(WorkflowRunTable.id, row.run_id))
      .run()
    return fromPhaseRow(row)
  })
  assertProjectRun(await get(phase.runID))
  publishPhaseUpdated(phase, current.status)
  return phase
}

async function appendChild(input: WorkflowRunState.AppendChildInput): Promise<WorkflowChildRecord> {
  const parsed = WorkflowRunState.AppendChildInput.parse(input)
  if (parsed.sessionID) await assertSessionCompatible(parsed.sessionID)
  await get(parsed.runID)
  await assertPhaseBelongsToRun(parsed.phaseID, parsed.runID)
  const now = Date.now()
  const child = Database.transaction((db) => {
    const row = db
      .insert(WorkflowChildTable)
      .values({
        id: WorkflowChildID.ascending(),
        run_id: parsed.runID,
        phase_id: parsed.phaseID,
        task_queue_id: parsed.taskQueueID,
        session_id: parsed.sessionID,
        status: "queued",
        agent: parsed.agent,
        model: parsed.model,
        budget_slice: parsed.budgetSlice,
        artifact_ids: [],
        evidence_refs: [],
        time_created: now,
        time_updated: now,
      })
      .returning()
      .get()
    touchRun(db, parsed.runID, now)
    return fromChildRow(row)
  })
  publishChildCreated(child)
  return child
}

async function setChildStatus(input: WorkflowRunState.SetChildStatusInput): Promise<WorkflowChildRecord> {
  const parsed = WorkflowRunState.SetChildStatusInput.parse(input)
  const current = await getChild(parsed.id)
  await get(current.runID)
  const now = Date.now()
  const updates: Partial<typeof WorkflowChildTable.$inferInsert> = {
    status: parsed.status,
    output_summary: parsed.outputSummary,
    artifact_ids: parsed.artifactIDs ?? current.artifactIDs,
    evidence_refs: parsed.evidenceRefs ?? current.evidenceRefs,
    error: parsed.error,
    time_updated: now,
  }
  if (parsed.status === "running" && current.time.started === undefined) updates.time_started = now
  updates.time_completed = isTerminalChildStatus(parsed.status) ? now : null

  const child = Database.transaction((db) => {
    const row = db.update(WorkflowChildTable).set(updates).where(eq(WorkflowChildTable.id, parsed.id)).returning().get()
    if (!row) throw new NotFoundError({ message: `Workflow child not found: ${parsed.id}` })
    touchRun(db, row.run_id, now)
    return fromChildRow(row)
  })
  publishChildUpdated(child, current.status)
  return child
}

async function attachChildTaskQueueID(input: WorkflowRunState.AttachChildTaskQueueInput): Promise<WorkflowChildRecord> {
  const parsed = WorkflowRunState.AttachChildTaskQueueInput.parse(input)
  const current = await getChild(parsed.id)
  await get(current.runID)
  const now = Date.now()
  const child = Database.transaction((db) => {
    const row = db
      .update(WorkflowChildTable)
      .set({
        task_queue_id: parsed.taskQueueID,
        time_updated: now,
      })
      .where(eq(WorkflowChildTable.id, parsed.id))
      .returning()
      .get()
    if (!row) throw new NotFoundError({ message: `Workflow child not found: ${parsed.id}` })
    touchRun(db, row.run_id, now)
    return fromChildRow(row)
  })
  publishChildUpdated(child)
  return child
}

export async function appendArtifact(input: WorkflowRunState.AppendArtifactInput): Promise<WorkflowArtifactRecord> {
  const parsed = WorkflowRunState.AppendArtifactInput.parse(input)
  await get(parsed.runID)
  if (parsed.phaseID) await assertPhaseBelongsToRun(parsed.phaseID, parsed.runID)
  if (parsed.childID) await assertChildBelongsToRun(parsed.childID, parsed.runID)

  const now = Date.now()
  const artifact = Database.transaction((db) => {
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
  const changed = Database.transaction((db) => {
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
  const changed = Database.transaction((db) => {
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
  setChildStatus,
  attachChildTaskQueueID,
  appendArtifact,
  appendBudgetUsage,
  attachVerificationEnvelopeIDs,
  ensureFinalReportArtifact,
  recoverInterrupted,
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
  export type AttachChildTaskQueueInput = WorkflowRunState.AttachChildTaskQueueInput
  export type AppendArtifactInput = WorkflowRunState.AppendArtifactInput
  export type AppendBudgetUsageInput = WorkflowRunState.AppendBudgetUsageInput
  export type AttachVerificationInput = WorkflowRunState.AttachVerificationInput
}
