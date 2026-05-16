import { createHash } from "node:crypto"
import z from "zod"
import { FindingSource } from "../quality/finding"

// Phase 3 P3.1/P3.2: contract for the runtime debug workflow. Four artifact
// shapes anchor every later phase 3 slice:
//
//   DebugCase       — one investigation. "this thing is broken; find out why."
//   DebugEvidence   — a single runtime data point attached to a case
//                     (log capture, instrumentation result, stack trace,
//                     graph query receipt). Mirrors Finding.evidence but
//                     for runtime artefacts that exist outside the file.
//   DebugInstrumentationPlan — an auditable, removable plan for temporary
//                     runtime probes before any file is edited.
//   DebugHypothesis — a candidate explanation. Carries (a) optional static
//                     analysis from debug_analyze, (b) runtime evidence
//                     refs, (c) a single combined confidence. Status moves
//                     active → refuted | confirmed | unresolved as the
//                     workflow progresses.
//
// The schemas are intentionally narrow: every field below has a named
// consumer in P3.2-P3.5. No speculative fields. Like FindingSchema and
// VerificationEnvelopeSchema, schemaVersion is locked at 1 — structural
// changes ship as v2 with parallel emit.

export const DebugCaseStatus = z.enum(["open", "investigating", "resolved", "unresolved"])
export type DebugCaseStatus = z.infer<typeof DebugCaseStatus>

export const DebugEvidenceKind = z.enum(["log_capture", "instrumentation_result", "stack_trace", "graph_query"])
export type DebugEvidenceKind = z.infer<typeof DebugEvidenceKind>

export const DebugHypothesisStatus = z.enum(["active", "refuted", "confirmed", "unresolved"])
export type DebugHypothesisStatus = z.infer<typeof DebugHypothesisStatus>

export const DEBUG_ID_PATTERN = /^[0-9a-f]{16}$/

export const DebugCaseSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().regex(DEBUG_ID_PATTERN, "caseId must be 16-char lowercase hex"),
  problem: z.string().min(1).max(500),
  status: DebugCaseStatus,
  createdAt: z.string().datetime(),
  source: FindingSource,
})
export type DebugCase = z.infer<typeof DebugCaseSchema>

// Derived read model used by session/risk and TUI sync consumers. It is not
// emitted by tools; it makes unresolved/resolved case state explicit without
// forcing every caller to re-run the hypothesis aggregation rules.
export const DebugCaseRollupSchema = DebugCaseSchema.extend({
  effectiveStatus: DebugCaseStatus,
  // Summary of instrumentation plans for this case. Always present when
  // computed via SessionDebug.rollup(); optional so older serialised rollups
  // (without the field) still parse.
  planSummary: z
    .object({
      total: z.number().int().min(0),
      applied: z.number().int().min(0),
      removed: z.number().int().min(0),
    })
    .optional(),
})
export type DebugCaseRollup = z.infer<typeof DebugCaseRollupSchema>

// Soft upper bound on a single evidence record. Logs, stack traces, and
// graph-query payloads are usually well under this — but a pasted megabyte
// of CI output would be recorded into the session event log on every call
// and re-parsed on every SessionDebug.load. 200 KB is generous enough for
// any realistic log capture and bounded enough to cap the worst-case
// memory cost of replaying a session.
const DEBUG_EVIDENCE_CONTENT_MAX = 200_000

export const DebugEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  evidenceId: z.string().regex(DEBUG_ID_PATTERN, "evidenceId must be 16-char lowercase hex"),
  caseId: z.string().regex(DEBUG_ID_PATTERN),
  kind: DebugEvidenceKind,
  capturedAt: z.string().datetime(),
  // Free-form text. Logs and stack traces are usually multi-line plaintext;
  // graph queries are JSON-serialized payloads. Consumers handle their kind.
  content: z.string().min(1).max(DEBUG_EVIDENCE_CONTENT_MAX),
  // Optional back-reference to the DebugInstrumentationPlan whose probes
  // produced this evidence. Not part of the evidenceId hash — provenance
  // metadata only. Validated by debug_capture_evidence against known plan ids.
  planId: z.string().regex(DEBUG_ID_PATTERN).optional(),
  source: FindingSource,
})
export type DebugEvidence = z.infer<typeof DebugEvidenceSchema>

export const DebugInstrumentationStatus = z.enum(["planned", "applied", "removed"])
export type DebugInstrumentationStatus = z.infer<typeof DebugInstrumentationStatus>

export const DebugInstrumentationTargetSchema = z.object({
  file: z.string().min(1).max(500),
  anchor: z
    .object({
      line: z.number().int().min(1).optional(),
      symbol: z.string().min(1).max(200).optional(),
    })
    .optional(),
  probe: z.string().min(1).max(500),
  removeInstruction: z.string().min(1).max(500),
})
export type DebugInstrumentationTarget = z.infer<typeof DebugInstrumentationTargetSchema>

export const DebugInstrumentationPlanSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().regex(DEBUG_ID_PATTERN),
  caseId: z.string().regex(DEBUG_ID_PATTERN),
  purpose: z.string().min(1).max(500),
  targets: z.array(DebugInstrumentationTargetSchema).min(1).max(20),
  status: DebugInstrumentationStatus,
  createdAt: z.string().datetime(),
  source: FindingSource,
})
export type DebugInstrumentationPlan = z.infer<typeof DebugInstrumentationPlanSchema>

export const DebugHypothesisSchema = z.object({
  schemaVersion: z.literal(1),
  hypothesisId: z.string().regex(DEBUG_ID_PATTERN),
  caseId: z.string().regex(DEBUG_ID_PATTERN),
  claim: z.string().min(1).max(500),
  // Combined confidence (static + runtime). Capped at 0.95 — same cap as
  // debug_analyze, for the same reason: never claim certainty in debug.
  confidence: z.number().min(0).max(0.95),
  // When the hypothesis is anchored on debug_analyze output, point at the
  // tool.call id and carry summary fields. Optional because some hypotheses
  // come purely from runtime evidence with no static graph walk.
  staticAnalysis: z
    .object({
      sourceCallId: z.string().min(1),
      chainLength: z.number().int().min(0),
      chainConfidence: z.number().min(0).max(0.95),
    })
    .optional(),
  // Refs to DebugEvidence entries that support or refute this hypothesis.
  evidenceRefs: z.array(z.string().regex(DEBUG_ID_PATTERN)).default([]),
  status: DebugHypothesisStatus,
  source: FindingSource,
})
export type DebugHypothesis = z.infer<typeof DebugHypothesisSchema>

// Deterministic ID helpers. Same 16-char hex shape as Finding/Envelope.
// Each ID is a hash of the load-bearing identity inputs — repeat callers
// reach for the same id when the underlying claim hasn't changed, which
// lets consumers dedup across runs.

export type DebugCaseIdInput = {
  problem: string
  runId: string
}

export function computeDebugCaseId(input: DebugCaseIdInput): string {
  const payload = [input.problem, input.runId].join("\u0000")
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

export type DebugEvidenceIdInput = {
  caseId: string
  kind: DebugEvidenceKind
  content: string
}

export function computeDebugEvidenceId(input: DebugEvidenceIdInput): string {
  const payload = [input.caseId, input.kind, input.content].join("\u0000")
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

export type DebugInstrumentationPlanIdInput = {
  caseId: string
  purpose: string
  targets: readonly DebugInstrumentationTarget[]
}

export function computeDebugInstrumentationPlanId(input: DebugInstrumentationPlanIdInput): string {
  const payload = [input.caseId, input.purpose, JSON.stringify(input.targets)].join("\u0000")
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

export type DebugHypothesisIdInput = {
  caseId: string
  claim: string
}

export function computeDebugHypothesisId(input: DebugHypothesisIdInput): string {
  const payload = [input.caseId, input.claim].join("\u0000")
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}
