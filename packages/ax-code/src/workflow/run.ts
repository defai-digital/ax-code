import { HTTPException } from "hono/http-exception"
import { Bus } from "../bus"
import { ModelID, ProviderID } from "../provider/schema"
import { Instance } from "../project/instance"
import { VerificationEnvelopeSchema, type VerificationEnvelope } from "../quality/verification-envelope"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { sessionAssistantPath, zeroTokenUsage } from "../session/prompt-message-builders"
import { MessageID, PartID, SessionID } from "../session/schema"
import { Database, NotFoundError, and, asc, desc, eq, inArray } from "../storage/db"
import { Log } from "../util/log"
import { defaultWorkflowArtifactRedaction } from "./artifact"
import { addWorkflowBudgetUsage, evaluateWorkflowBudget, evaluateWorkflowChildBudget } from "./budget"
import { classifyWorkflowFindingArtifact, type WorkflowEvalFindingStatus } from "./eval"
import { WorkflowInputValidationError, resolveWorkflowInputValues } from "./spec"
import {
  EmptyWorkflowBudgetUsage,
  WorkflowArtifactID,
  WorkflowArtifactRecord,
  WorkflowBudgetLedgerEntry,
  WorkflowBudgetLedgerID,
  WorkflowChildID,
  WorkflowChildRecord,
  WorkflowPhaseID,
  WorkflowPhaseRecord,
  WorkflowRun as WorkflowRunState,
  WorkflowRunDetail,
  WorkflowRunID,
} from "./state"
import {
  WorkflowArtifactTable,
  WorkflowBudgetLedgerTable,
  WorkflowChildTable,
  WorkflowPhaseTable,
  WorkflowRunTable,
} from "./workflow.sql"

export const WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID = "workflow-final-report"

const log = Log.create({ service: "workflow.run" })
const WORKFLOW_RUNTIME_MODEL_ID = ModelID.make("workflow-runtime")
const WORKFLOW_RUNTIME_PROVIDER_ID = ProviderID.axCode

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
    return query.all().map(fromRunRow)
  })
}

async function get(id: WorkflowRunID): Promise<WorkflowRunState.Info> {
  const run = Database.use((db) => {
    const row = db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, id)).get()
    if (!row) throw new NotFoundError({ message: `Workflow run not found: ${id}` })
    return fromRunRow(row)
  })
  assertProjectRun(run)
  return run
}

async function getDetail(id: WorkflowRunID): Promise<WorkflowRunDetail> {
  const run = await get(id)
  const detail = Database.use((db) => {
    const phases = db
      .select()
      .from(WorkflowPhaseTable)
      .where(eq(WorkflowPhaseTable.run_id, id))
      .orderBy(asc(WorkflowPhaseTable.position), asc(WorkflowPhaseTable.id))
      .all()
      .map(fromPhaseRow)
    const children = db
      .select()
      .from(WorkflowChildTable)
      .where(eq(WorkflowChildTable.run_id, id))
      .orderBy(asc(WorkflowChildTable.time_created), asc(WorkflowChildTable.id))
      .all()
      .map(fromChildRow)
    const artifacts = db
      .select()
      .from(WorkflowArtifactTable)
      .where(eq(WorkflowArtifactTable.run_id, id))
      .orderBy(asc(WorkflowArtifactTable.time_created), asc(WorkflowArtifactTable.id))
      .all()
      .map(fromArtifactRow)
    const budgetLedger = db
      .select()
      .from(WorkflowBudgetLedgerTable)
      .where(eq(WorkflowBudgetLedgerTable.run_id, id))
      .orderBy(asc(WorkflowBudgetLedgerTable.time_created), asc(WorkflowBudgetLedgerTable.id))
      .all()
      .map(fromBudgetLedgerRow)
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
  if (isTerminalRunStatus(status)) updates.time_completed = now

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
  if (isTerminalPhaseStatus(parsed.status)) updates.time_completed = now

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
  if (isTerminalChildStatus(parsed.status)) updates.time_completed = now

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

async function appendArtifact(input: WorkflowRunState.AppendArtifactInput): Promise<WorkflowArtifactRecord> {
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

async function appendBudgetUsage(input: WorkflowRunState.AppendBudgetUsageInput): Promise<WorkflowBudgetLedgerEntry> {
  const parsed = WorkflowRunState.AppendBudgetUsageInput.parse(input)
  await get(parsed.runID)
  if (parsed.phaseID) await assertPhaseBelongsToRun(parsed.phaseID, parsed.runID)
  if (parsed.childID) await assertChildBelongsToRun(parsed.childID, parsed.runID)

  const now = Date.now()
  const changed = Database.transaction((db): AppendBudgetUsageChange => {
    const run = db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, parsed.runID)).get()
    if (!run) throw new NotFoundError({ message: `Workflow run not found: ${parsed.runID}` })
    const nextUsage = addWorkflowBudgetUsage(run.budget_usage, parsed.usageDelta)
    const workflowEvaluation = evaluateWorkflowBudget({
      budget: run.budget,
      usage: nextUsage,
      elapsedMs: now - (run.time_started ?? run.time_created),
    })
    const budgetChild = parsed.childID
      ? db.select().from(WorkflowChildTable).where(eq(WorkflowChildTable.id, parsed.childID)).get()
      : undefined
    const childUsage = parsed.childID
      ? addWorkflowBudgetUsage(
          db
            .select()
            .from(WorkflowBudgetLedgerTable)
            .where(eq(WorkflowBudgetLedgerTable.child_id, parsed.childID))
            .all()
            .reduce((usage, ledger) => addWorkflowBudgetUsage(usage, ledger.usage_delta), EmptyWorkflowBudgetUsage),
          parsed.usageDelta,
        )
      : undefined
    const childEvaluation = evaluateWorkflowChildBudget({
      budgetSlice: budgetChild?.budget_slice ?? undefined,
      usage: childUsage ?? EmptyWorkflowBudgetUsage,
      elapsedMs: budgetChild ? now - (budgetChild.time_started ?? budgetChild.time_created) : undefined,
    })
    const budgetWarnings = [...workflowEvaluation.warnings, ...childEvaluation.warnings]
    const budgetExceededMessages = [...workflowEvaluation.exceeded, ...childEvaluation.exceeded]
    const budgetExceeded = budgetExceededMessages.length > 0
    const stopMessage = budgetExceeded ? `Workflow budget exceeded: ${budgetExceededMessages.join("; ")}` : undefined
    const row = db
      .insert(WorkflowBudgetLedgerTable)
      .values({
        id: WorkflowBudgetLedgerID.ascending(),
        run_id: parsed.runID,
        phase_id: parsed.phaseID,
        child_id: parsed.childID,
        kind: parsed.kind,
        usage_delta: parsed.usageDelta,
        message: parsed.message,
        time_created: now,
        time_updated: now,
      })
      .returning()
      .get()

    let exceededEntry: WorkflowBudgetLedgerEntry | undefined
    let failedRun: WorkflowRunState.Info | undefined
    let failedPhase: WorkflowPhaseRecord | undefined
    let failedPhasePreviousStatus: WorkflowRun.PhaseStatus | undefined
    let failedChild: WorkflowChildRecord | undefined
    let failedChildPreviousStatus: WorkflowRun.ChildStatus | undefined

    if (budgetExceeded && stopMessage && !isTerminalRunStatus(run.status)) {
      if (parsed.kind !== "exceeded") {
        const exceededRow = db
          .insert(WorkflowBudgetLedgerTable)
          .values({
            id: WorkflowBudgetLedgerID.ascending(),
            run_id: parsed.runID,
            phase_id: parsed.phaseID,
            child_id: parsed.childID,
            kind: "exceeded",
            usage_delta: EmptyWorkflowBudgetUsage,
            message: stopMessage,
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
        exceededEntry = fromBudgetLedgerRow(exceededRow)
      }

      if (parsed.childID) {
        if (budgetChild && !isTerminalChildStatus(budgetChild.status)) {
          failedChildPreviousStatus = budgetChild.status
          const failedChildRow = db
            .update(WorkflowChildTable)
            .set({
              status: "failed",
              error: stopMessage,
              time_completed: now,
              time_updated: now,
            })
            .where(eq(WorkflowChildTable.id, parsed.childID))
            .returning()
            .get()
          if (failedChildRow) failedChild = fromChildRow(failedChildRow)
        }
      }

      if (parsed.phaseID) {
        const phase = db.select().from(WorkflowPhaseTable).where(eq(WorkflowPhaseTable.id, parsed.phaseID)).get()
        if (phase && !isTerminalPhaseStatus(phase.status)) {
          failedPhasePreviousStatus = phase.status
          const failedPhaseRow = db
            .update(WorkflowPhaseTable)
            .set({
              status: "failed",
              error: stopMessage,
              time_completed: now,
              time_updated: now,
            })
            .where(eq(WorkflowPhaseTable.id, parsed.phaseID))
            .returning()
            .get()
          if (failedPhaseRow) failedPhase = fromPhaseRow(failedPhaseRow)
        }
      }

      const failedRunRow = db
        .update(WorkflowRunTable)
        .set({
          status: "failed",
          error: stopMessage,
          budget_usage: nextUsage,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, parsed.runID))
        .returning()
        .get()
      if (failedRunRow) failedRun = fromRunRow(failedRunRow)
    } else {
      db.update(WorkflowRunTable)
        .set({
          budget_usage: nextUsage,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, parsed.runID))
        .run()
    }

    return {
      entry: fromBudgetLedgerRow(row),
      exceededEntry,
      failedRun,
      failedRunPreviousStatus: run.status,
      failedPhase,
      failedPhasePreviousStatus,
      failedChild,
      failedChildPreviousStatus,
      warnings: budgetWarnings,
      exceeded: budgetExceededMessages,
    }
  })
  publishBudgetAppended(changed.entry)
  if (changed.warnings.length > 0) publishBudgetWarning(changed.entry, changed.warnings)
  if (changed.exceededEntry) publishBudgetAppended(changed.exceededEntry)
  if (changed.exceeded.length > 0) {
    publishBudgetExceeded(changed.exceededEntry ?? changed.entry, changed.exceeded)
  }
  if (changed.failedChild) publishChildUpdated(changed.failedChild, changed.failedChildPreviousStatus)
  if (changed.failedPhase) publishPhaseUpdated(changed.failedPhase, changed.failedPhasePreviousStatus)
  if (changed.failedRun) publishUpdated(changed.failedRun, changed.failedRunPreviousStatus)
  return changed.entry
}

type AppendBudgetUsageChange = {
  entry: WorkflowBudgetLedgerEntry
  exceededEntry: WorkflowBudgetLedgerEntry | undefined
  failedRun: WorkflowRunState.Info | undefined
  failedRunPreviousStatus: WorkflowRun.Status | undefined
  failedPhase: WorkflowPhaseRecord | undefined
  failedPhasePreviousStatus: WorkflowRun.PhaseStatus | undefined
  failedChild: WorkflowChildRecord | undefined
  failedChildPreviousStatus: WorkflowRun.ChildStatus | undefined
  warnings: string[]
  exceeded: string[]
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

async function ensureFinalReportArtifact(runID: WorkflowRunID): Promise<WorkflowArtifactRecord | undefined> {
  const detail = await getDetail(runID)
  const existing = detail.artifacts.find(
    (artifact) => artifact.specArtifactID === WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
  )
  if (existing) {
    await syncFinalReportToParentSession(detail, existing)
    return existing
  }

  const phaseCounts = countByStatus(detail.phases.map((phase) => phase.status))
  const childCounts = countByStatus(detail.children.map((child) => child.status))
  const artifactCounts = countByStatus(detail.artifacts.map((artifact) => artifact.kind))
  const verification = finalReportVerification(detail)
  const findings = finalReportFindings(detail)
  const evidenceRefs = finalReportEvidenceRefs(detail)
  const summary = [
    `Workflow final report: ${detail.spec.name}`,
    `Status: ${detail.status}`,
    `Verification: ${verification.status} (${verification.mode})`,
    ...verification.summaryLines,
    `Evidence refs: ${formatEvidenceRefs(evidenceRefs)}`,
    `Budget limits: ${formatWorkflowBudgetLimit(detail.budget)}`,
    `Pacing: ${formatWorkflowPacing(detail.spec.pacing)}`,
    findingSummaryLine(findings),
    ...findingBucketSummaryLines(findings),
    `Phases: ${detail.phases.length} total, ${phaseCounts.completed ?? 0} completed, ${phaseCounts.failed ?? 0} failed, ${phaseCounts.cancelled ?? 0} cancelled.`,
    `Children: ${detail.children.length} total, ${childCounts.completed ?? 0} completed, ${childCounts.failed ?? 0} failed, ${childCounts.cancelled ?? 0} cancelled.`,
    `Artifacts: ${detail.artifacts.length} existing, verification envelopes: ${detail.verificationEnvelopeIDs.length}.`,
  ].join("\n")

  const artifact = await appendArtifact({
    runID,
    specArtifactID: WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
    kind: "summary",
    retention: "session",
    exposeToMainContext: detail.spec.synthesis.exposeToMainContext,
    summary,
    payload: {
      kind: "workflow-final-report",
      runID: detail.id,
      status: detail.status,
      sourceTemplateID: detail.sourceTemplateID,
      spec: {
        id: detail.spec.id,
        name: detail.spec.name,
        tags: detail.spec.tags,
      },
      phaseCounts,
      childCounts,
      artifactCounts,
      evidenceRefs,
      verification,
      findings,
      budgetLimit: detail.budget,
      pacing: detail.spec.pacing,
      budgetUsage: detail.budgetUsage,
      budgetLedger: detail.budgetLedger.map(compactBudgetLedgerEntry),
      verificationEnvelopeIDs: detail.verificationEnvelopeIDs,
      exposedArtifactIDs: detail.artifacts
        .filter((artifact) => artifact.exposeToMainContext)
        .map((artifact) => artifact.id),
    },
    redaction: { status: "pending", summary: "Generated compact workflow final report from durable run state." },
    evidenceRefs,
  })
  await syncFinalReportToParentSession(detail, artifact)
  return artifact
}

function compactBudgetLedgerEntry(entry: WorkflowBudgetLedgerEntry) {
  return {
    id: entry.id,
    phaseID: entry.phaseID,
    childID: entry.childID,
    kind: entry.kind,
    usageDelta: entry.usageDelta,
    message: entry.message,
    time: entry.time,
  }
}

function finalReportEvidenceRefs(detail: WorkflowRunDetail): WorkflowArtifactRecord["evidenceRefs"] {
  return uniqueEvidenceRefs([
    ...detail.artifacts.map((artifact) => ({ kind: "artifact" as const, id: artifact.id })),
    ...detail.verificationEnvelopeIDs.map((id) => ({ kind: "verification" as const, id })),
  ])
}

function formatEvidenceRefs(evidenceRefs: WorkflowArtifactRecord["evidenceRefs"], max = 12) {
  if (evidenceRefs.length === 0) return "none."
  const shown = evidenceRefs.slice(0, max).map((ref) => `${ref.kind}:${ref.id}`)
  const suffix = evidenceRefs.length > max ? `, +${evidenceRefs.length - max} more` : ""
  return `${shown.join(", ")}${suffix}.`
}

function formatWorkflowBudgetLimit(budget: WorkflowRunDetail["budget"]) {
  return [
    `tokens ${budget.maxTotalTokens}`,
    `child agents ${budget.maxTotalAgents}`,
    `concurrent ${budget.maxConcurrentAgents}`,
    `tool calls ${budget.maxToolCalls}`,
    `retries ${budget.maxRetries}`,
    `wall ${formatDurationMs(budget.maxWallTimeMs)}`,
  ].join(", ")
}

function formatWorkflowPacing(pacing: WorkflowRunDetail["spec"]["pacing"]) {
  return `requests/min ${pacing.maxRequestsPerMinute}, tokens/min ${pacing.maxTokensPerMinute}.`
}

function formatDurationMs(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

async function syncFinalReportToParentSession(detail: WorkflowRunDetail, artifact: WorkflowArtifactRecord) {
  if (!detail.parentSessionID || !artifact.exposeToMainContext) return
  try {
    const messages = await Session.messages({ sessionID: detail.parentSessionID })
    if (hasParentFinalReportMessage(messages, detail.id)) return

    const now = Date.now()
    const latestUser = findLatestUserMessage(messages)
    let parentID = latestUser?.info.id
    if (!parentID) {
      const anchor: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID: detail.parentSessionID,
        role: "user",
        time: { created: now },
        agent: "workflow",
        model: {
          providerID: WORKFLOW_RUNTIME_PROVIDER_ID,
          modelID: WORKFLOW_RUNTIME_MODEL_ID,
        },
      }
      const anchorPart: MessageV2.TextPart = {
        id: PartID.ascending(),
        messageID: anchor.id,
        sessionID: detail.parentSessionID,
        type: "text",
        text: `Workflow ${detail.id} completed.`,
        synthetic: true,
        ignored: true,
        metadata: {
          workflowFinalReportAnchor: {
            schemaVersion: 1,
            runID: detail.id,
            artifactID: artifact.id,
          },
        },
      }
      await Session.updateMessageWithParts(anchor, [anchorPart])
      parentID = anchor.id
    }

    const assistant: MessageV2.Assistant = {
      id: MessageID.ascending(),
      sessionID: detail.parentSessionID,
      role: "assistant",
      parentID,
      modelID: WORKFLOW_RUNTIME_MODEL_ID,
      providerID: WORKFLOW_RUNTIME_PROVIDER_ID,
      mode: "workflow",
      agent: "workflow",
      path: sessionAssistantPath({ directory: detail.directory }),
      tokens: zeroTokenUsage(),
      time: {
        created: now,
        completed: now,
      },
      finish: "stop",
    }
    const part: MessageV2.TextPart = {
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID: detail.parentSessionID,
      type: "text",
      text: formatParentFinalReport(detail, artifact),
      metadata: {
        workflowFinalReport: {
          schemaVersion: 1,
          runID: detail.id,
          artifactID: artifact.id,
          status: detail.status,
          specID: detail.spec.id,
          specName: detail.spec.name,
        },
      },
    }
    await Session.updateMessageWithParts(assistant, [part])
  } catch (error) {
    log.warn("failed to sync workflow final report to parent session", {
      runID: detail.id,
      parentSessionID: detail.parentSessionID,
      artifactID: artifact.id,
      error,
    })
  }
}

function hasParentFinalReportMessage(messages: MessageV2.WithParts[], runID: WorkflowRunID) {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (part.type !== "text") return false
      const metadata = part.metadata?.workflowFinalReport
      if (!metadata || typeof metadata !== "object") return false
      return (metadata as Record<string, unknown>).runID === runID
    }),
  )
}

function findLatestUserMessage(messages: MessageV2.WithParts[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.info.role === "user") return message as MessageV2.WithParts & { info: MessageV2.User }
  }
  return undefined
}

function formatParentFinalReport(detail: WorkflowRunDetail, artifact: WorkflowArtifactRecord) {
  const usage = detail.budgetUsage
  const cost =
    usage.estimatedCostUsd === undefined || usage.estimatedCostUsd <= 0
      ? ""
      : `, estimated cost $${usage.estimatedCostUsd.toFixed(4)}`
  return [
    artifact.summary ?? `Workflow final report: ${detail.spec.name}`,
    "",
    `Run: ${detail.id}`,
    `Final artifact: ${artifact.id}`,
    `Linked evidence refs: ${formatEvidenceRefs(artifact.evidenceRefs)}`,
    `Budget limits: ${formatWorkflowBudgetLimit(detail.budget)}`,
    `Pacing: ${formatWorkflowPacing(detail.spec.pacing)}`,
    `Budget used: ${usage.totalTokens} tokens, ${usage.toolCalls} tool calls, ${usage.childAgents} child agents${cost}.`,
  ].join("\n")
}

async function recoverInterrupted(): Promise<{ failed: WorkflowRunState.Info[] }> {
  const now = Date.now()
  const interruptedRunStatuses = ["running"] as const
  const interruptedPhaseStatuses = ["running", "blocked"] as const
  const interruptedChildStatuses = ["running", "blocked_permission", "blocked_question"] as const
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
    for (const row of rows) {
      db.update(WorkflowPhaseTable)
        .set({
          status: "failed",
          error: "Workflow phase interrupted by backend restart; inspect artifacts and retry when safe.",
          time_completed: now,
          time_updated: now,
        })
        .where(and(eq(WorkflowPhaseTable.run_id, row.id), inArray(WorkflowPhaseTable.status, interruptedPhaseStatuses)))
        .run()
      db.update(WorkflowChildTable)
        .set({
          status: "failed",
          error: "Workflow child interrupted by backend restart; inspect artifacts and retry when safe.",
          time_completed: now,
          time_updated: now,
        })
        .where(and(eq(WorkflowChildTable.run_id, row.id), inArray(WorkflowChildTable.status, interruptedChildStatuses)))
        .run()
      const updated = db
        .update(WorkflowRunTable)
        .set({
          status: "failed",
          error: "Workflow interrupted by backend restart; inspect artifacts and retry when safe.",
          time_completed: now,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, row.id))
        .returning()
        .get()
      if (updated) failed.push(fromRunRow(updated))
    }
    return { failed }
  })
  for (const run of changed.failed) publishUpdated(run, "running")
  return changed
}

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

function fromRunRow(row: typeof WorkflowRunTable.$inferSelect): WorkflowRunState.Info {
  return WorkflowRunState.Record.parse({
    id: row.id,
    projectID: row.project_id,
    directory: row.directory,
    parentSessionID: row.parent_session_id ?? undefined,
    sourceTemplateID: row.source_template_id ?? undefined,
    sourceTaskID: row.source_task_id ?? undefined,
    status: row.status,
    currentPhaseID: row.current_phase_id ?? undefined,
    spec: row.spec_snapshot,
    inputValues: row.input_values,
    budget: row.budget,
    budgetUsage: row.budget_usage,
    verificationEnvelopeIDs: row.verification_envelope_ids,
    error: row.error ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      started: row.time_started ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  })
}

function fromPhaseRow(row: typeof WorkflowPhaseTable.$inferSelect): WorkflowPhaseRecord {
  return WorkflowPhaseRecord.parse({
    id: row.id,
    runID: row.run_id,
    specPhaseID: row.spec_phase_id,
    position: row.position,
    name: row.name,
    kind: row.kind,
    status: row.status,
    agent: row.agent ?? undefined,
    modelPolicy: row.model_policy ?? undefined,
    budget: row.budget ?? undefined,
    outputs: row.outputs,
    error: row.error ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      started: row.time_started ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  })
}

function fromChildRow(row: typeof WorkflowChildTable.$inferSelect): WorkflowChildRecord {
  return WorkflowChildRecord.parse({
    id: row.id,
    runID: row.run_id,
    phaseID: row.phase_id,
    taskQueueID: row.task_queue_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    status: row.status,
    agent: row.agent ?? undefined,
    model: row.model ?? undefined,
    budgetSlice: row.budget_slice ?? undefined,
    artifactIDs: row.artifact_ids,
    evidenceRefs: row.evidence_refs,
    outputSummary: row.output_summary ?? undefined,
    error: row.error ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      started: row.time_started ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  })
}

function fromArtifactRow(row: typeof WorkflowArtifactTable.$inferSelect): WorkflowArtifactRecord {
  return WorkflowArtifactRecord.parse({
    id: row.id,
    runID: row.run_id,
    phaseID: row.phase_id ?? undefined,
    childID: row.child_id ?? undefined,
    specArtifactID: row.spec_artifact_id ?? undefined,
    kind: row.kind,
    retention: row.retention,
    exposeToMainContext: row.expose_to_main_context,
    summary: row.summary ?? undefined,
    payload: row.payload ?? undefined,
    redaction: row.redaction ?? undefined,
    evidenceRefs: row.evidence_refs,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  })
}

function fromBudgetLedgerRow(row: typeof WorkflowBudgetLedgerTable.$inferSelect): WorkflowBudgetLedgerEntry {
  return WorkflowBudgetLedgerEntry.parse({
    id: row.id,
    runID: row.run_id,
    phaseID: row.phase_id ?? undefined,
    childID: row.child_id ?? undefined,
    kind: row.kind,
    usageDelta: row.usage_delta,
    message: row.message ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  })
}

async function assertSessionCompatible(sessionID: SessionID) {
  const session = await Session.get(sessionID)
  if (Session.isCompatibleWithCurrentProject(session)) return session
  throw new HTTPException(409, {
    message: `Session ${sessionID} belongs to a different project directory; create the workflow from that project instead.`,
  })
}

function assertProjectRun(run: WorkflowRun.Info) {
  if (run.projectID === Instance.project.id) return
  throw new HTTPException(409, {
    message: `Workflow run ${run.id} belongs to a different project.`,
  })
}

async function getPhase(id: WorkflowPhaseID): Promise<WorkflowPhaseRecord> {
  const phase = Database.use((db) => {
    const row = db.select().from(WorkflowPhaseTable).where(eq(WorkflowPhaseTable.id, id)).get()
    if (!row) throw new NotFoundError({ message: `Workflow phase not found: ${id}` })
    return fromPhaseRow(row)
  })
  await WorkflowRun.get(phase.runID)
  return phase
}

async function getChild(id: WorkflowChildID): Promise<WorkflowChildRecord> {
  const child = Database.use((db) => {
    const row = db.select().from(WorkflowChildTable).where(eq(WorkflowChildTable.id, id)).get()
    if (!row) throw new NotFoundError({ message: `Workflow child not found: ${id}` })
    return fromChildRow(row)
  })
  await WorkflowRun.get(child.runID)
  return child
}

async function assertPhaseBelongsToRun(phaseID: WorkflowPhaseID, runID: WorkflowRunID) {
  const phase = await getPhase(phaseID)
  if (phase.runID === runID) return
  throw new HTTPException(409, {
    message: `Workflow phase ${phaseID} does not belong to workflow run ${runID}.`,
  })
}

async function assertChildBelongsToRun(childID: WorkflowChildID, runID: WorkflowRunID) {
  const child = await getChild(childID)
  if (child.runID === runID) return
  throw new HTTPException(409, {
    message: `Workflow child ${childID} does not belong to workflow run ${runID}.`,
  })
}

function touchRun(db: Database.TxOrDb, runID: WorkflowRunID, now: number) {
  db.update(WorkflowRunTable).set({ time_updated: now }).where(eq(WorkflowRunTable.id, runID)).run()
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function uniqueEvidenceRefs(items: WorkflowChildRecord["evidenceRefs"]): WorkflowChildRecord["evidenceRefs"] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function countByStatus(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function finalReportVerification(detail: WorkflowRunDetail) {
  const requiredArtifactIds = detail.spec.verification.requiredArtifactIds
  const presentArtifactIds = new Set(detail.artifacts.map((artifact) => artifact.specArtifactID).filter(Boolean))
  const hasVerificationArtifact = detail.artifacts.some((artifact) => artifact.kind === "verification")
  const hasVerificationEnvelope = detail.verificationEnvelopeIDs.length > 0
  const envelopeFailures = verificationEnvelopeFailures(detail)
  const requiredArtifactsSatisfied =
    requiredArtifactIds.length > 0 && requiredArtifactIds.every((artifactID) => presentArtifactIds.has(artifactID))

  const status =
    detail.spec.verification.mode === "skipped" || detail.spec.verification.mode === "deferred"
      ? detail.spec.verification.mode
      : envelopeFailures.length > 0
        ? "failed"
        : requiredArtifactsSatisfied || hasVerificationArtifact || hasVerificationEnvelope
        ? "satisfied"
        : detail.spec.verification.mode === "required"
          ? "missing"
          : "not_run"

  return {
    mode: detail.spec.verification.mode,
    status,
    requiredArtifactIds,
    commands: detail.spec.verification.commands,
    reason: detail.spec.verification.reason,
    failures: envelopeFailures,
    summaryLines: verificationSummaryLines(detail, status, envelopeFailures),
    verificationEnvelopeCount: detail.verificationEnvelopeIDs.length,
  }
}

function verificationSummaryLines(detail: WorkflowRunDetail, status: string, failures: string[]) {
  if (detail.spec.verification.mode === "deferred") {
    const commands = detail.spec.verification.commands
    return [
      commands.length > 0
        ? `Deferred verification plan: ${commands.join(" && ")}.`
        : "Deferred verification plan: run targeted checks before relying on this workflow result.",
      "Unresolved risk: verification is deferred and must be completed before treating findings as fully proven.",
    ]
  }
  if (detail.spec.verification.mode === "skipped") {
    return [`Verification skipped reason: ${detail.spec.verification.reason}.`]
  }
  if (detail.spec.verification.mode === "optional" && status === "not_run") {
    return ["Optional verification did not run for this workflow."]
  }
  if (status === "failed") {
    return [`Verification failed: ${failures.join("; ")}.`]
  }
  return []
}

type FinalReportFinding = {
  artifactID: WorkflowArtifactID
  specArtifactID?: string
  summary?: string
  evidenceRefs: WorkflowArtifactRecord["evidenceRefs"]
}

type FinalReportFindingBuckets = Record<WorkflowEvalFindingStatus, FinalReportFinding[]>

function finalReportFindings(detail: WorkflowRunDetail): FinalReportFindingBuckets {
  const buckets: FinalReportFindingBuckets = {
    confirmed: [],
    likely: [],
    rejected: [],
    unverified: [],
  }

  for (const artifact of detail.artifacts) {
    if (artifact.kind !== "finding") continue
    buckets[classifyWorkflowFindingArtifact(artifact)].push({
      artifactID: artifact.id,
      specArtifactID: artifact.specArtifactID,
      summary: artifact.summary,
      evidenceRefs: artifact.evidenceRefs,
    })
  }

  return buckets
}

function findingSummaryLine(findings: FinalReportFindingBuckets) {
  return [
    `Findings: ${findings.confirmed.length} confirmed`,
    `${findings.likely.length} likely`,
    `${findings.rejected.length} rejected`,
    `${findings.unverified.length} unverified.`,
  ].join(", ")
}

function findingBucketSummaryLines(findings: FinalReportFindingBuckets) {
  const lines: string[] = []
  for (const status of ["confirmed", "likely", "rejected", "unverified"] as const) {
    const bucket = findings[status]
    if (bucket.length === 0) continue
    lines.push(`${titleCase(status)} findings:`)
    for (const finding of bucket.slice(0, 5)) {
      const summary = finding.summary ? ` - ${finding.summary}` : ""
      const evidence =
        finding.evidenceRefs.length > 0
          ? ` evidence=${finding.evidenceRefs.map((ref) => `${ref.kind}:${ref.id}`).join(",")}`
          : ""
      lines.push(`- ${finding.artifactID}${summary}${evidence}`)
    }
    if (bucket.length > 5) lines.push(`- ${bucket.length - 5} more ${status} findings omitted from compact summary.`)
  }
  return lines
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isTerminalRunStatus(status: WorkflowRun.Status) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function evaluateCompletionGate(detail: WorkflowRunDetail): { ok: true } | { ok: false; message: string } {
  const artifactsBySpecID = new Set(
    detail.artifacts.map((artifact) => artifact.specArtifactID).filter((id): id is string => !!id),
  )

  if (detail.spec.verification.mode === "required") {
    const envelopeFailures = verificationEnvelopeFailures(detail)
    if (envelopeFailures.length > 0) {
      return {
        ok: false,
        message: `Workflow verification gate is required; verification envelopes did not pass: ${envelopeFailures.join("; ")}`,
      }
    }

    const missingArtifacts = detail.spec.verification.requiredArtifactIds.filter((id) => !artifactsBySpecID.has(id))
    if (missingArtifacts.length > 0) {
      return {
        ok: false,
        message: `Workflow verification gate is required; missing required workflow artifacts: ${missingArtifacts.join(", ")}`,
      }
    }

    if (
      detail.spec.verification.requiredArtifactIds.length === 0 &&
      detail.verificationEnvelopeIDs.length === 0 &&
      !detail.artifacts.some((artifact) => artifact.kind === "verification")
    ) {
      return {
        ok: false,
        message: "Workflow verification gate is required; no verification artifact or envelope is attached.",
      }
    }
  }

  const missingSynthesisArtifacts = detail.spec.synthesis.requiredArtifactIds.filter((id) => !artifactsBySpecID.has(id))
  if (missingSynthesisArtifacts.length > 0) {
    return {
      ok: false,
      message: `Workflow synthesis gate is required; missing required workflow artifacts: ${missingSynthesisArtifacts.join(", ")}`,
    }
  }

  return { ok: true }
}

function verificationEnvelopeFailures(detail: WorkflowRunDetail) {
  const failures: string[] = []
  for (const artifact of detail.artifacts) {
    if (artifact.kind !== "verification") continue
    for (const envelope of verificationEnvelopesFromPayload(artifact.payload)) {
      if (envelope.result.passed && envelope.result.status === "passed") continue
      const scope = envelope.scope.paths?.join(",") ?? envelope.scope.description ?? envelope.scope.kind
      failures.push(
        `${artifact.specArtifactID ?? artifact.id}:${envelope.result.name}:${envelope.result.status}:${scope}`,
      )
    }
  }
  return failures
}

function verificationEnvelopesFromPayload(payload: unknown): VerificationEnvelope[] {
  const parsed = VerificationEnvelopeSchema.safeParse(payload)
  if (parsed.success) return [parsed.data]
  if (Array.isArray(payload)) return payload.flatMap(verificationEnvelopesFromPayload)
  if (!payload || typeof payload !== "object") return []

  const record = payload as Record<string, unknown>
  return [
    ...verificationEnvelopesFromPayload(record.envelope),
    ...verificationEnvelopesFromPayload(record.verificationEnvelope),
    ...verificationEnvelopesFromPayload(record.envelopes),
    ...verificationEnvelopesFromPayload(record.verificationEnvelopes),
  ]
}

function isTerminalPhaseStatus(status: WorkflowRun.PhaseStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function isTerminalChildStatus(status: WorkflowRun.ChildStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function publishCreated(run: WorkflowRun.Info) {
  Bus.publishDetached(WorkflowRun.Event.Created, { run })
}

function publishUpdated(run: WorkflowRun.Info, previousStatus?: WorkflowRun.Status) {
  Bus.publishDetached(WorkflowRun.Event.Updated, { run })
  if (previousStatus && previousStatus !== run.status) publishRunStatusChanged(run, previousStatus)
}

function publishPhaseUpdated(phase: WorkflowPhaseRecord, previousStatus?: WorkflowRun.PhaseStatus) {
  Bus.publishDetached(WorkflowRun.Event.PhaseUpdated, { phase })
  if (previousStatus && previousStatus !== phase.status) publishPhaseStatusChanged(phase)
}

function publishChildCreated(child: WorkflowChildRecord) {
  Bus.publishDetached(WorkflowRun.Event.ChildCreated, { child })
}

function publishChildUpdated(child: WorkflowChildRecord, previousStatus?: WorkflowRun.ChildStatus) {
  Bus.publishDetached(WorkflowRun.Event.ChildUpdated, { child })
  if (previousStatus && previousStatus !== child.status) publishChildStatusChanged(child)
}

function publishArtifactWritten(artifact: WorkflowArtifactRecord) {
  Bus.publishDetached(WorkflowRun.Event.ArtifactWritten, { artifact })
}

function publishBudgetAppended(entry: WorkflowBudgetLedgerEntry) {
  Bus.publishDetached(WorkflowRun.Event.BudgetAppended, { entry })
}

function publishBudgetWarning(entry: WorkflowBudgetLedgerEntry, warnings: string[]) {
  Bus.publishDetached(WorkflowRun.Event.BudgetWarning, { entry, warnings })
}

function publishBudgetExceeded(entry: WorkflowBudgetLedgerEntry, exceeded: string[]) {
  Bus.publishDetached(WorkflowRun.Event.BudgetExceeded, { entry, exceeded })
}

function publishVerificationAttached(run: WorkflowRun.Info, envelopeIDs: string[]) {
  Bus.publishDetached(WorkflowRun.Event.VerificationAttached, {
    verification: {
      runID: run.id,
      envelopeIDs,
      run,
    },
  })
}

function publishRunStatusChanged(run: WorkflowRun.Info, previousStatus: WorkflowRun.Status) {
  if (run.status === "running") {
    Bus.publishDetached(previousStatus === "paused" ? WorkflowRun.Event.Resumed : WorkflowRun.Event.Started, { run })
    return
  }
  if (run.status === "blocked") Bus.publishDetached(WorkflowRun.Event.Blocked, { run })
  if (run.status === "paused") Bus.publishDetached(WorkflowRun.Event.Paused, { run })
  if (run.status === "completed") Bus.publishDetached(WorkflowRun.Event.Completed, { run })
  if (run.status === "failed") Bus.publishDetached(WorkflowRun.Event.Failed, { run })
  if (run.status === "cancelled") Bus.publishDetached(WorkflowRun.Event.Cancelled, { run })
}

function publishPhaseStatusChanged(phase: WorkflowPhaseRecord) {
  if (phase.status === "running") Bus.publishDetached(WorkflowRun.Event.PhaseStarted, { phase })
  if (phase.status === "completed") Bus.publishDetached(WorkflowRun.Event.PhaseCompleted, { phase })
  if (phase.status === "failed") Bus.publishDetached(WorkflowRun.Event.PhaseFailed, { phase })
}

function publishChildStatusChanged(child: WorkflowChildRecord) {
  if (child.status === "running") Bus.publishDetached(WorkflowRun.Event.ChildStarted, { child })
  if (child.status === "completed") Bus.publishDetached(WorkflowRun.Event.ChildCompleted, { child })
  if (child.status === "failed") Bus.publishDetached(WorkflowRun.Event.ChildFailed, { child })
  if (child.status === "cancelled") Bus.publishDetached(WorkflowRun.Event.ChildCancelled, { child })
}
