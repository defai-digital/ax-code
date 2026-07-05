import { HTTPException } from "hono/http-exception"
import { Bus } from "../../bus"
import { Instance } from "../../project/instance"
import {
  computeEnvelopeId,
  verificationEnvelopesFromPayload,
  type VerificationEnvelope,
} from "../../quality/verification-envelope"
import { Session } from "../../session"
import { SessionVerifications } from "../../session/verifications"
import { Database, NotFoundError, eq } from "../../storage/db"
import { Log } from "../../util/log"
import { uniqueItems } from "../../util/string-list"
import { compactWorkflowArtifact } from "../artifact"
import {
  WorkflowArtifactRecord,
  WorkflowBudgetLedgerEntry,
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

const log = Log.create({ service: "workflow.run" })

// --- Row parsers ---

export function fromRunRow(row: typeof WorkflowRunTable.$inferSelect): WorkflowRunState.Info {
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

export function fromPhaseRow(row: typeof WorkflowPhaseTable.$inferSelect): WorkflowPhaseRecord {
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

export function fromChildRow(row: typeof WorkflowChildTable.$inferSelect): WorkflowChildRecord {
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

export function fromArtifactRow(row: typeof WorkflowArtifactTable.$inferSelect): WorkflowArtifactRecord {
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

export function fromBudgetLedgerRow(row: typeof WorkflowBudgetLedgerTable.$inferSelect): WorkflowBudgetLedgerEntry {
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

// --- Detail row parsing ---

export function parseWorkflowDetailRows<TRow extends { id: string }, TInfo>(
  rows: TRow[],
  parse: (row: TRow) => TInfo,
  kind: string,
): TInfo[] {
  return rows.flatMap((row) => {
    try {
      return [parse(row)]
    } catch {
      log.warn("skipping corrupt workflow detail row", { kind, id: row.id })
      return []
    }
  })
}

// --- Assertions ---

export async function getRun(id: WorkflowRunID): Promise<WorkflowRunState.Info> {
  const run = Database.use((db) => {
    const row = db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, id)).get()
    if (!row) throw new NotFoundError({ message: `Workflow run not found: ${id}` })
    return fromRunRow(row)
  })
  assertProjectRun(run)
  return run
}

export async function assertSessionCompatible(sessionID: import("../../session/schema").SessionID) {
  const session = await Session.get(sessionID)
  if (Session.isCompatibleWithCurrentProject(session)) return session
  throw new HTTPException(409, {
    message: `Session ${sessionID} belongs to a different project directory; create the workflow from that project instead.`,
  })
}

export function assertProjectRun(run: WorkflowRunState.Info) {
  if (run.projectID === Instance.project.id) return
  throw new HTTPException(409, {
    message: `Workflow run ${run.id} belongs to a different project.`,
  })
}

export async function getPhase(id: WorkflowPhaseID): Promise<WorkflowPhaseRecord> {
  const phase = Database.use((db) => {
    const row = db.select().from(WorkflowPhaseTable).where(eq(WorkflowPhaseTable.id, id)).get()
    if (!row) throw new NotFoundError({ message: `Workflow phase not found: ${id}` })
    return fromPhaseRow(row)
  })
  await getRun(phase.runID)
  return phase
}

export async function getChild(id: WorkflowChildID): Promise<WorkflowChildRecord> {
  const child = Database.use((db) => {
    const row = db.select().from(WorkflowChildTable).where(eq(WorkflowChildTable.id, id)).get()
    if (!row) throw new NotFoundError({ message: `Workflow child not found: ${id}` })
    return fromChildRow(row)
  })
  await getRun(child.runID)
  return child
}

export async function assertPhaseBelongsToRun(phaseID: WorkflowPhaseID, runID: WorkflowRunID) {
  const phase = await getPhase(phaseID)
  if (phase.runID === runID) return
  throw new HTTPException(409, {
    message: `Workflow phase ${phaseID} does not belong to workflow run ${runID}.`,
  })
}

export async function assertChildBelongsToRun(childID: WorkflowChildID, runID: WorkflowRunID) {
  const child = await getChild(childID)
  if (child.runID === runID) return
  throw new HTTPException(409, {
    message: `Workflow child ${childID} does not belong to workflow run ${runID}.`,
  })
}

// --- Utilities ---

export function touchRun(db: Database.TxOrDb, runID: WorkflowRunID, now: number) {
  db.update(WorkflowRunTable).set({ time_updated: now }).where(eq(WorkflowRunTable.id, runID)).run()
}

export function unique<T>(items: T[]): T[] {
  return uniqueItems(items)
}

export function uniqueEvidenceRefs(items: WorkflowChildRecord["evidenceRefs"]): WorkflowChildRecord["evidenceRefs"] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function countByStatus(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

// --- Terminal status checks ---

export function isTerminalRunStatus(status: WorkflowRunState.Status) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

export function isTerminalPhaseStatus(status: WorkflowRunState.PhaseStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

export function isTerminalChildStatus(status: WorkflowRunState.ChildStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

// --- Event publishers ---

export function publishCreated(run: WorkflowRunState.Info) {
  Bus.publishDetached(WorkflowRunState.Event.Created, { run })
}

export function publishUpdated(run: WorkflowRunState.Info, previousStatus?: WorkflowRunState.Status) {
  Bus.publishDetached(WorkflowRunState.Event.Updated, { run })
  if (previousStatus && previousStatus !== run.status) publishRunStatusChanged(run, previousStatus)
}

export function publishPhaseUpdated(phase: WorkflowPhaseRecord, previousStatus?: WorkflowRunState.PhaseStatus) {
  Bus.publishDetached(WorkflowRunState.Event.PhaseUpdated, { phase })
  if (previousStatus && previousStatus !== phase.status) publishPhaseStatusChanged(phase)
}

export function publishChildCreated(child: WorkflowChildRecord) {
  Bus.publishDetached(WorkflowRunState.Event.ChildCreated, { child })
}

export function publishChildUpdated(child: WorkflowChildRecord, previousStatus?: WorkflowRunState.ChildStatus) {
  Bus.publishDetached(WorkflowRunState.Event.ChildUpdated, { child })
  if (previousStatus && previousStatus !== child.status) publishChildStatusChanged(child)
}

export function publishArtifactWritten(artifact: WorkflowArtifactRecord) {
  Bus.publishDetached(WorkflowRunState.Event.ArtifactWritten, { artifact: compactWorkflowArtifact(artifact) })
}

export function publishBudgetAppended(entry: WorkflowBudgetLedgerEntry) {
  Bus.publishDetached(WorkflowRunState.Event.BudgetAppended, { entry })
}

export function publishBudgetWarning(entry: WorkflowBudgetLedgerEntry, warnings: string[]) {
  Bus.publishDetached(WorkflowRunState.Event.BudgetWarning, { entry, warnings })
}

export function publishBudgetExceeded(entry: WorkflowBudgetLedgerEntry, exceeded: string[]) {
  Bus.publishDetached(WorkflowRunState.Event.BudgetExceeded, { entry, exceeded })
}

export function publishVerificationAttached(run: WorkflowRunState.Info, envelopeIDs: string[]) {
  Bus.publishDetached(WorkflowRunState.Event.VerificationAttached, {
    verification: {
      runID: run.id,
      envelopeIDs,
      run,
    },
  })
}

function publishRunStatusChanged(run: WorkflowRunState.Info, previousStatus: WorkflowRunState.Status) {
  if (run.status === "running") {
    Bus.publishDetached(previousStatus === "paused" ? WorkflowRunState.Event.Resumed : WorkflowRunState.Event.Started, {
      run,
    })
    return
  }
  if (run.status === "blocked") Bus.publishDetached(WorkflowRunState.Event.Blocked, { run })
  if (run.status === "paused") Bus.publishDetached(WorkflowRunState.Event.Paused, { run })
  if (run.status === "completed") Bus.publishDetached(WorkflowRunState.Event.Completed, { run })
  if (run.status === "failed") Bus.publishDetached(WorkflowRunState.Event.Failed, { run })
  if (run.status === "cancelled") Bus.publishDetached(WorkflowRunState.Event.Cancelled, { run })
}

function publishPhaseStatusChanged(phase: WorkflowPhaseRecord) {
  if (phase.status === "running") Bus.publishDetached(WorkflowRunState.Event.PhaseStarted, { phase })
  if (phase.status === "completed") Bus.publishDetached(WorkflowRunState.Event.PhaseCompleted, { phase })
  if (phase.status === "failed") Bus.publishDetached(WorkflowRunState.Event.PhaseFailed, { phase })
}

function publishChildStatusChanged(child: WorkflowChildRecord) {
  if (child.status === "running") Bus.publishDetached(WorkflowRunState.Event.ChildStarted, { child })
  if (child.status === "completed") Bus.publishDetached(WorkflowRunState.Event.ChildCompleted, { child })
  if (child.status === "failed") Bus.publishDetached(WorkflowRunState.Event.ChildFailed, { child })
  if (child.status === "cancelled") Bus.publishDetached(WorkflowRunState.Event.ChildCancelled, { child })
}

// --- Verification and completion gates ---

export function evaluateCompletionGate(detail: WorkflowRunDetail): { ok: true } | { ok: false; message: string } {
  const artifactsBySpecID = new Set(
    detail.artifacts.map((artifact) => artifact.specArtifactID).filter((id): id is string => !!id),
  )

  if (detail.spec.verification.mode === "required") {
    const envelopeEvidence = verificationEnvelopeEvidence(detail)
    if (envelopeEvidence.failures.length > 0) {
      return {
        ok: false,
        message: `Workflow verification gate is required; verification envelopes did not pass: ${envelopeEvidence.failures.join("; ")}`,
      }
    }

    const missingArtifacts = detail.spec.verification.requiredArtifactIds.filter((id) => !artifactsBySpecID.has(id))
    if (missingArtifacts.length > 0) {
      return {
        ok: false,
        message: `Workflow verification gate is required; missing required workflow artifacts: ${missingArtifacts.join(", ")}`,
      }
    }

    const missingEnvelopeEvidence = missingRequiredVerificationEnvelopeEvidence(detail, envelopeEvidence)
    if (missingEnvelopeEvidence.length > 0) {
      return {
        ok: false,
        message: `Workflow verification gate is required; missing passing verification envelope evidence: ${missingEnvelopeEvidence.join(", ")}`,
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

export function finalReportVerification(detail: WorkflowRunDetail) {
  const requiredArtifactIds = detail.spec.verification.requiredArtifactIds
  const presentArtifactIds = new Set(detail.artifacts.map((artifact) => artifact.specArtifactID).filter(Boolean))
  const hasVerificationArtifact = detail.artifacts.some((artifact) => artifact.kind === "verification")
  const envelopeEvidence = verificationEnvelopeEvidence(detail)
  const hasVerificationEnvelope = envelopeEvidence.passingEnvelopeIds.size > 0
  const envelopeFailures = envelopeEvidence.failures
  const requiredArtifactsSatisfied =
    requiredArtifactIds.length > 0 && requiredArtifactIds.every((artifactID) => presentArtifactIds.has(artifactID))
  const requiredEnvelopeEvidenceSatisfied =
    requiredArtifactIds.length > 0
      ? hasVerificationEnvelope ||
        requiredArtifactIds.every((artifactID) => envelopeEvidence.passingArtifactIds.has(artifactID))
      : hasVerificationEnvelope || envelopeEvidence.passingArtifactIds.size > 0

  let status: string
  if (detail.spec.verification.mode === "skipped" || detail.spec.verification.mode === "deferred") {
    status = detail.spec.verification.mode
  } else if (envelopeFailures.length > 0) {
    status = "failed"
  } else if (detail.spec.verification.mode === "required") {
    status = requiredArtifactsSatisfied && requiredEnvelopeEvidenceSatisfied ? "satisfied" : "missing"
  } else {
    status = requiredArtifactsSatisfied || hasVerificationArtifact || hasVerificationEnvelope ? "satisfied" : "not_run"
  }

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

function verificationEnvelopeEvidence(detail: WorkflowRunDetail) {
  const evidence = {
    failures: [] as string[],
    missingEnvelopeIds: [] as string[],
    passingEnvelopeIds: new Set<string>(),
    passingArtifactIds: new Set<string>(),
  }
  for (const artifact of detail.artifacts) {
    if (artifact.kind !== "verification") continue
    for (const envelope of verificationEnvelopesFromPayload(artifact.payload)) {
      if (envelope.result.passed && envelope.result.status === "passed") {
        evidence.passingEnvelopeIds.add(computeEnvelopeId(envelope))
        evidence.passingArtifactIds.add(artifact.specArtifactID ?? artifact.id)
        continue
      }
      const scope = envelope.scope.paths?.join(",") ?? envelope.scope.description ?? envelope.scope.kind
      evidence.failures.push(
        `${artifact.specArtifactID ?? artifact.id}:${envelope.result.name}:${envelope.result.status}:${scope}`,
      )
    }
  }

  if (detail.verificationEnvelopeIDs.length > 0) {
    const loaded = detail.parentSessionID
      ? new Map(
          SessionVerifications.loadWithIds(detail.parentSessionID).map((item) => [item.envelopeId, item.envelope]),
        )
      : new Map<string, VerificationEnvelope>()
    for (const envelopeID of detail.verificationEnvelopeIDs) {
      if (evidence.passingEnvelopeIds.has(envelopeID)) continue
      const envelope = loaded.get(envelopeID)
      if (!envelope) {
        evidence.missingEnvelopeIds.push(envelopeID)
        continue
      }
      if (envelope.result.passed && envelope.result.status === "passed") {
        evidence.passingEnvelopeIds.add(envelopeID)
        continue
      }
      const scope = envelope.scope.paths?.join(",") ?? envelope.scope.description ?? envelope.scope.kind
      evidence.failures.push(`envelope:${envelopeID}:${envelope.result.name}:${envelope.result.status}:${scope}`)
    }
  }
  return evidence
}

function missingRequiredVerificationEnvelopeEvidence(
  detail: WorkflowRunDetail,
  evidence: ReturnType<typeof verificationEnvelopeEvidence>,
) {
  if (evidence.missingEnvelopeIds.length > 0) {
    return evidence.missingEnvelopeIds.map((id) => `verification envelope ${id}`)
  }
  if (
    detail.verificationEnvelopeIDs.length > 0 &&
    detail.verificationEnvelopeIDs.every((id) => evidence.passingEnvelopeIds.has(id))
  ) {
    return []
  }
  const required = detail.spec.verification.requiredArtifactIds
  if (required.length === 0) return evidence.passingArtifactIds.size > 0 ? [] : ["verification envelope"]
  return required.filter((artifactID) => !evidence.passingArtifactIds.has(artifactID))
}

// Re-export WorkflowRun state for namespace usage
export { WorkflowRunState }
