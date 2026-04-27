import { computeEnvelopeId, type VerificationEnvelope } from "../quality/verification-envelope"
import type { DebugCase, DebugHypothesis } from "./runtime-debug"

// Phase 3 P3.4: pure helpers that wire a verification result into a debug
// case + hypothesis. No IO, no session writes — callers consume the
// returned (immutable copy of the) hypothesis/case and decide where to
// emit it (typically via debug_propose_hypothesis with status updated, or
// a future debug_resolve_case tool).
//
// "Verify-after-fix" means: a model attempted a fix for a hypothesis, ran
// verification (typecheck/lint/test via the P2.1 runner), and now wants
// to update the hypothesis based on the verification outcome. Pass the
// envelope; the helper returns the new hypothesis state.

export type VerifyOutcome = "confirmed" | "refuted" | "inconclusive"

export function classifyEnvelope(envelope: VerificationEnvelope): VerifyOutcome {
  const status = envelope.result.status
  // A passing verification confirms the hypothesis — the proposed fix
  // didn't break anything and the broken behaviour is gone.
  if (status === "passed") return "confirmed"
  // A failure with structured failures refutes the hypothesis — the fix
  // didn't work, or the proposed cause didn't capture reality.
  if (status === "failed" && envelope.structuredFailures.length > 0) return "refuted"
  // failed-without-structured-failures, error, timeout, skipped — none
  // of these tell us whether the fix worked. Stay active.
  return "inconclusive"
}

export type VerifyApplication = {
  hypothesis: DebugHypothesis
  envelope: VerificationEnvelope
}

// Returns a new hypothesis with status updated based on the envelope, plus
// a verification evidence ref appended so the trail is queryable later.
// Hypothesis is unchanged when outcome is "inconclusive".
export function applyVerificationToHypothesis(input: VerifyApplication): DebugHypothesis {
  const outcome = classifyEnvelope(input.envelope)
  if (outcome === "inconclusive") return input.hypothesis

  const envelopeId = computeEnvelopeId(input.envelope)
  // We track the envelope id in evidenceRefs even though it's an envelope
  // id (not an evidence id). The Phase 0 contract is the union of "ids
  // that justify this hypothesis"; consumers that care about the kind can
  // resolve via SessionVerifications + SessionDebug at render time.
  // (Adding kind discrimination would require a Hypothesis schema bump.)
  const evidenceRefs = input.hypothesis.evidenceRefs.includes(envelopeId)
    ? input.hypothesis.evidenceRefs
    : [...input.hypothesis.evidenceRefs, envelopeId]

  return {
    ...input.hypothesis,
    status: outcome === "confirmed" ? "confirmed" : "refuted",
    evidenceRefs,
  }
}

// Returns the case status that should follow from the current hypotheses.
// Mirrors SessionDebug.rollup's effectiveStatus logic but exposed as a
// pure helper so callers updating a single hypothesis can recompute the
// case-level rollup without re-loading the session.
export function resolveCaseStatus(
  current: DebugCase["status"],
  hypotheses: readonly DebugHypothesis[],
): DebugCase["status"] {
  if (current === "resolved" || current === "unresolved") return current
  if (hypotheses.length === 0) return "open"
  if (hypotheses.some((h) => h.status === "confirmed")) return "resolved"
  if (hypotheses.every((h) => h.status === "refuted" || h.status === "unresolved")) return "unresolved"
  return "investigating"
}
