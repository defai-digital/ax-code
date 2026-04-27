import {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
  type DebugCase,
  DebugCaseSchema,
  type DebugEvidence,
  DebugEvidenceSchema,
  type DebugHypothesis,
  DebugHypothesisSchema,
} from "../debug-engine/runtime-debug"
import { EventQuery } from "../replay/query"
import { Log } from "../util/log"
import type { SessionID } from "./schema"

export namespace SessionDebug {
  const log = Log.create({ service: "session-debug" })

  // Walks the session event log and rebuilds Phase 3 runtime debug
  // artefacts (cases, evidence, hypotheses) from tool.result metadata.
  // Each artefact is re-validated against its schema; entries that fail
  // validation are skipped (with a warning) so a single corrupted record
  // cannot block the rest. Mirrors SessionFindings.load.
  //
  // The three tools that emit these artefacts are debug_open_case,
  // debug_capture_evidence, and debug_propose_hypothesis. Loaders here
  // are tool-name agnostic — any tool.result that carries a metadata
  // entry of the right shape is included.

  export type Loaded = {
    cases: DebugCase[]
    evidence: DebugEvidence[]
    hypotheses: DebugHypothesis[]
  }

  export function load(sessionID: SessionID): Loaded {
    const events = EventQuery.bySession(sessionID)
    const cases: DebugCase[] = []
    const evidence: DebugEvidence[] = []
    const hypotheses: DebugHypothesis[] = []
    for (const event of events) {
      if (event.type !== "tool.result") continue
      if (event.status !== "completed") continue
      const meta = event.metadata
      if (!meta) continue

      if (meta.debugCase) {
        const parsed = DebugCaseSchema.safeParse(meta.debugCase)
        if (parsed.success) cases.push(parsed.data)
        else logSkip(sessionID, event.callID, "debugCase", parsed.error.issues.length)
      }
      if (meta.debugEvidence) {
        const parsed = DebugEvidenceSchema.safeParse(meta.debugEvidence)
        if (parsed.success) evidence.push(parsed.data)
        else logSkip(sessionID, event.callID, "debugEvidence", parsed.error.issues.length)
      }
      if (meta.debugHypothesis) {
        const parsed = DebugHypothesisSchema.safeParse(meta.debugHypothesis)
        if (parsed.success) hypotheses.push(parsed.data)
        else logSkip(sessionID, event.callID, "debugHypothesis", parsed.error.issues.length)
      }
    }
    return { cases, evidence, hypotheses }
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

  // Aggregates per-case status by walking hypotheses. A case is:
  // - "resolved" if any hypothesis is "confirmed"
  // - "unresolved" if all hypotheses are "refuted" (no path forward)
  // - "investigating" if at least one hypothesis is "active"
  // - "open" otherwise (no hypotheses yet)
  export type CaseRollup = DebugCase & { effectiveStatus: DebugCase["status"] }

  export function rollup(loaded: Loaded): CaseRollup[] {
    return loaded.cases.map((c) => {
      const own = loaded.hypotheses.filter((h) => h.caseId === c.caseId)
      const effective = effectiveStatusFor(c.status, own)
      return { ...c, effectiveStatus: effective }
    })
  }

  function effectiveStatusFor(
    declared: DebugCase["status"],
    hypotheses: readonly DebugHypothesis[],
  ): DebugCase["status"] {
    // Tool-declared status wins when it explicitly says resolved or
    // unresolved — those are terminal, the model has signalled closure.
    if (declared === "resolved" || declared === "unresolved") return declared
    if (hypotheses.length === 0) return "open"
    if (hypotheses.some((h) => h.status === "confirmed")) return "resolved"
    if (hypotheses.every((h) => h.status === "refuted" || h.status === "unresolved")) return "unresolved"
    return "investigating"
  }
}

export const _internal = {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
}
