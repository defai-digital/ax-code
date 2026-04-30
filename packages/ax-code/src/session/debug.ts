import {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
  computeDebugInstrumentationPlanId,
  type DebugCase,
  type DebugCaseRollup,
  DebugCaseSchema,
  type DebugEvidence,
  DebugEvidenceSchema,
  type DebugHypothesis,
  DebugHypothesisSchema,
  type DebugInstrumentationPlan,
  DebugInstrumentationPlanSchema,
} from "../debug-engine/runtime-debug"
import { resolveCaseStatus } from "../debug-engine/verify-after-fix"
import { EventQuery } from "../replay/query"
import { Log } from "../util/log"
import type { SessionID } from "./schema"

export namespace SessionDebug {
  const log = Log.create({ service: "session-debug" })

  // Walks the session event log and rebuilds Phase 3 runtime debug
  // artefacts (cases, evidence, instrumentation plans, hypotheses) from
  // tool.result metadata.
  // Each artefact is re-validated against its schema; entries that fail
  // validation are skipped (with a warning) so a single corrupted record
  // cannot block the rest. Mirrors SessionFindings.load.
  //
  // The tools that emit these artefacts are debug_open_case,
  // debug_capture_evidence, debug_plan_instrumentation,
  // debug_propose_hypothesis, and debug_apply_verification. Loaders here
  // are tool-name agnostic; any tool.result that carries a metadata entry of
  // the right shape is included.

  export type Loaded = {
    cases: DebugCase[]
    evidence: DebugEvidence[]
    instrumentationPlans: DebugInstrumentationPlan[]
    hypotheses: DebugHypothesis[]
  }

  export function load(sessionID: SessionID): Loaded {
    const events = EventQuery.bySession(sessionID)
    // Dedup by deterministic id within each kind. Cases and evidence are
    // keep-FIRST: cases are written once at open, evidence is content-
    // addressed (same content → same id → same payload). Hypotheses are
    // keep-LAST: a re-emit with the same caseId + claim produces the same
    // hypothesisId, but its `status` (active / refuted / confirmed) is
    // part of the input and may transition over time (e.g. a future
    // verify-after-fix flow flips active → confirmed). Keeping last lets
    // status updates win.
    const seenCases = new Set<string>()
    const seenEvidence = new Set<string>()
    const cases: DebugCase[] = []
    const evidence: DebugEvidence[] = []
    const instrumentationPlansById = new Map<string, DebugInstrumentationPlan>()
    const hypothesesById = new Map<string, DebugHypothesis>()
    for (const event of events) {
      if (event.type !== "tool.result") continue
      if (event.status !== "completed") continue
      const meta = event.metadata
      if (!meta) continue

      if (meta.debugCase) {
        const parsed = DebugCaseSchema.safeParse(meta.debugCase)
        if (parsed.success) {
          if (!seenCases.has(parsed.data.caseId)) {
            seenCases.add(parsed.data.caseId)
            cases.push(parsed.data)
          }
        } else logSkip(sessionID, event.callID, "debugCase", parsed.error.issues.length)
      }
      if (meta.debugEvidence) {
        const parsed = DebugEvidenceSchema.safeParse(meta.debugEvidence)
        if (parsed.success) {
          if (!seenEvidence.has(parsed.data.evidenceId)) {
            seenEvidence.add(parsed.data.evidenceId)
            evidence.push(parsed.data)
          }
        } else logSkip(sessionID, event.callID, "debugEvidence", parsed.error.issues.length)
      }
      if (meta.debugInstrumentationPlan) {
        const parsed = DebugInstrumentationPlanSchema.safeParse(meta.debugInstrumentationPlan)
        if (parsed.success) {
          instrumentationPlansById.set(parsed.data.planId, parsed.data)
        } else logSkip(sessionID, event.callID, "debugInstrumentationPlan", parsed.error.issues.length)
      }
      if (meta.debugHypothesis) {
        const parsed = DebugHypothesisSchema.safeParse(meta.debugHypothesis)
        if (parsed.success) {
          // Map.set on an existing key updates value but preserves
          // insertion order; later events overwrite earlier ones with
          // the same hypothesisId.
          hypothesesById.set(parsed.data.hypothesisId, parsed.data)
        } else logSkip(sessionID, event.callID, "debugHypothesis", parsed.error.issues.length)
      }
    }
    return {
      cases,
      evidence,
      instrumentationPlans: [...instrumentationPlansById.values()],
      hypotheses: [...hypothesesById.values()],
    }
  }

  function logSkip(sessionID: SessionID, callID: string, kind: string, issues: number): void {
    log.warn("dropping malformed debug metadata entry", { sessionID, callID, kind, issues })
  }

  // Cheap helpers for the strict validators in debug_capture_evidence /
  // debug_propose_hypothesis — they reject artefacts that reference an
  // id not present in the session.
  //
  // Single-call sites (capture_evidence only needs caseIds) keep the
  // narrow helpers below; callers that need BOTH sets — like
  // propose_hypothesis, which validates caseId AND every evidenceRef —
  // must use indexedIds() so we walk the event log once instead of twice.

  export type IndexedIds = {
    caseIds: Set<string>
    evidenceIds: Set<string>
  }

  export type DebugAnalyzeReference = {
    callID: string
    chainLength: number
    chainConfidence: number
  }

  export function indexedIds(sessionID: SessionID): IndexedIds {
    const loaded = load(sessionID)
    const caseIds = new Set<string>()
    const evidenceIds = new Set<string>()
    for (const c of loaded.cases) caseIds.add(c.caseId)
    for (const e of loaded.evidence) evidenceIds.add(e.evidenceId)
    return { caseIds, evidenceIds }
  }

  export function caseIdSet(sessionID: SessionID): Set<string> {
    return indexedIds(sessionID).caseIds
  }

  export function evidenceIdSet(sessionID: SessionID): Set<string> {
    return indexedIds(sessionID).evidenceIds
  }

  export function debugAnalyzeReferences(sessionID: SessionID): Map<string, DebugAnalyzeReference> {
    const references = new Map<string, DebugAnalyzeReference>()
    for (const event of EventQuery.bySession(sessionID)) {
      if (event.type !== "tool.result") continue
      if (event.status !== "completed") continue
      if (event.tool !== "debug_analyze") continue
      const chainLength = event.metadata?.chainLength
      const chainConfidence = event.metadata?.confidence
      if (typeof chainLength !== "number" || typeof chainConfidence !== "number") continue
      references.set(event.callID, {
        callID: event.callID,
        chainLength,
        chainConfidence,
      })
    }
    return references
  }

  // Aggregates per-case status by walking hypotheses. A case is:
  // - "resolved" if any hypothesis is "confirmed"
  // - "unresolved" if all hypotheses are "refuted" (no path forward)
  // - "investigating" if at least one hypothesis is "active"
  // - "open" otherwise (no hypotheses yet)
  export type CaseRollup = DebugCaseRollup
  type RollupInput = Pick<Loaded, "cases" | "hypotheses"> & Partial<Pick<Loaded, "evidence" | "instrumentationPlans">>

  export function rollup(loaded: RollupInput): CaseRollup[] {
    return loaded.cases.map((c) => {
      const own = loaded.hypotheses.filter((h) => h.caseId === c.caseId)
      const effective = resolveCaseStatus(c.status, own)
      return { ...c, effectiveStatus: effective }
    })
  }
}

export const _internal = {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
  computeDebugInstrumentationPlanId,
}
