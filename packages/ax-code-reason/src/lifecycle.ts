import type { DebugCaseStatus, DebugHypothesisStatus, DebugInstrumentationStatus } from "./runtime-debug"
import type { RefactorPlanStatus } from "./schema.sql"
import type { SourceState, VerificationEnvelope } from "./quality/verification-envelope"
import { classifyEnvelopeFreshness } from "./quality/freshness"

// Explicit lifecycle state machines for the runtime-debug and refactor-plan
// artifacts (PRD G5 / D5). Before Phase 3, status flips were implicit —
// `applyVerificationToHypothesis` overwrote ANY status, so a confirmed
// hypothesis could be silently demoted back to active/refuted by a later
// event-log replay. These tables make the permitted transitions explicit,
// mark terminal states, and give every rejection a stable, testable reason.
//
// The tables are pure data (Readonly<Record<From, readonly To[]>>) so callers
// can validate a transition without the evidence-polarity logic that only
// applies to hypotheses. `transitionHypothesis` layers the evidence rules on
// top of the hypothesis table.

// ─── Transition tables ─────────────────────────────────────────────────

// Terminal states are confirmed / refuted / unresolved. Once a hypothesis is
// terminal it can only stay there; reviving it requires a NEW hypothesis id
// (council decision 6). `active` is the only non-terminal state.
export const HYPOTHESIS_TRANSITIONS: Readonly<Record<DebugHypothesisStatus, readonly DebugHypothesisStatus[]>> = {
  active: ["active", "confirmed", "refuted", "unresolved"],
  confirmed: ["confirmed"],
  refuted: ["refuted"],
  unresolved: ["unresolved"],
}

export const HYPOTHESIS_TERMINAL_STATUSES: readonly DebugHypothesisStatus[] = ["confirmed", "refuted", "unresolved"]

export const CASE_TRANSITIONS: Readonly<Record<DebugCaseStatus, readonly DebugCaseStatus[]>> = {
  open: ["open", "investigating", "resolved", "unresolved"],
  investigating: ["investigating", "resolved", "unresolved"],
  resolved: ["resolved"],
  unresolved: ["unresolved"],
}

export const CASE_TERMINAL_STATUSES: readonly DebugCaseStatus[] = ["resolved", "unresolved"]

// A temporary instrumentation plan moves planned → applied → removed.
// `removed` is terminal: probes already stripped from the worktree can't be
// re-applied under the same plan id.
export const INSTRUMENTATION_TRANSITIONS: Readonly<
  Record<DebugInstrumentationStatus, readonly DebugInstrumentationStatus[]>
> = {
  planned: ["planned", "applied", "removed"],
  applied: ["applied", "removed"],
  removed: ["removed"],
}

export const INSTRUMENTATION_TERMINAL_STATUSES: readonly DebugInstrumentationStatus[] = ["removed"]

// Refactor plans: pending → applied / aborted / stale. `aborted → pending`
// is the only non-terminal "revival" — a hard failure writes `aborted`, and
// an idempotent retry can re-arm the plan back to `pending`. `applied` and
// `stale` are terminal.
export const PLAN_TRANSITIONS: Readonly<Record<RefactorPlanStatus, readonly RefactorPlanStatus[]>> = {
  pending: ["pending", "applied", "aborted", "stale"],
  aborted: ["aborted", "pending"],
  applied: ["applied"],
  stale: ["stale"],
}

export const PLAN_TERMINAL_STATUSES: readonly RefactorPlanStatus[] = ["applied", "stale"]

// ─── Generic transition validation ─────────────────────────────────────

export type TransitionRejectionReason = "terminal-status" | "illegal-transition"

export type TransitionDecision<T extends string> =
  | { ok: true; status: T }
  | { ok: false; status: T; reason: TransitionRejectionReason }

// Validate `from → to` against a transition table without any evidence rules.
// Rejects out-of-table transitions; a transition out of a terminal state gets
// the more specific `terminal-status` reason.
export function validateTransition<T extends string>(
  table: Readonly<Record<T, readonly T[]>>,
  terminalStatuses: readonly T[],
  from: T,
  to: T,
): TransitionDecision<T> {
  const allowed = table[from]
  if (allowed.includes(to)) return { ok: true, status: to }
  if (terminalStatuses.includes(from)) return { ok: false, status: from, reason: "terminal-status" }
  return { ok: false, status: from, reason: "illegal-transition" }
}

// ─── Hypothesis transitions (evidence-polarity rules) ──────────────────

export type HypothesisRejectionReason =
  | TransitionRejectionReason
  | "insufficient-evidence"
  | "stale-source"
  | "conflicting-evidence"

export type HypothesisTransitionResult =
  | { ok: true; status: DebugHypothesisStatus }
  | { ok: false; status: DebugHypothesisStatus; reason: HypothesisRejectionReason }

export type TransitionEvidence = {
  envelopes: readonly VerificationEnvelope[]
  // The current worktree fingerprint. When provided, confirmation/refutation
  // rejects envelopes whose captured sourceState no longer matches (stale).
  // When omitted, freshness is not enforced here — callers (the core tools)
  // enforce it before delegating, so this stays a pure, optional layer.
  currentSourceState?: SourceState
}

function isFresh(envelope: VerificationEnvelope, current: SourceState | undefined): boolean {
  if (!current) return true
  const freshness = classifyEnvelopeFreshness(envelope, current)
  return freshness.status === "fresh"
}

// The evidence-polarity contract for hypothesis confirmation/refutation:
//
//   confirmed — needs ≥1 fresh passing envelope and ZERO failing envelopes
//               (failing = status "failed" with structured failures).
//   refuted   — needs ≥1 fresh envelope that failed with structured failures.
//
// Rejection reasons, in precedence order:
//   - terminal-status / illegal-transition — the transition isn't in the table
//   - stale-source     — a cited envelope is no longer fresh for the current
//                        worktree (authoritative citation fails closed)
//   - conflicting-evidence — a failing envelope is present while confirming
//   - insufficient-evidence — the polarity rule for the target status is unmet
export function transitionHypothesis(
  from: DebugHypothesisStatus,
  to: DebugHypothesisStatus,
  evidence: TransitionEvidence = { envelopes: [] },
): HypothesisTransitionResult {
  // 1. Structural check against the hypothesis transition table.
  const structural = validateTransition(HYPOTHESIS_TRANSITIONS, HYPOTHESIS_TERMINAL_STATUSES, from, to)
  if (!structural.ok) return structural

  // 2. No-op transitions (from === to) need no evidence.
  if (from === to) return { ok: true, status: from }

  // 3. Only confirmed / refuted are gated on evidence. active → unresolved is
  //    a plain structural transition.
  if (to !== "confirmed" && to !== "refuted") return { ok: true, status: to }

  const envelopes = evidence.envelopes
  const failing = envelopes.filter((e) => e.result.status === "failed" && e.structuredFailures.length > 0)
  const passing = envelopes.filter((e) => e.result.status === "passed")

  // Authoritative citations fail closed on stale evidence.
  const stale = envelopes.filter((e) => !isFresh(e, evidence.currentSourceState))
  if (stale.length > 0) return { ok: false, status: from, reason: "stale-source" }

  if (to === "confirmed") {
    // Confirmation is monotone: any failing envelope contradicts it.
    if (failing.length > 0) return { ok: false, status: from, reason: "conflicting-evidence" }
    if (passing.length < 1) return { ok: false, status: from, reason: "insufficient-evidence" }
    return { ok: true, status: "confirmed" }
  }

  // to === "refuted"
  if (failing.length < 1) return { ok: false, status: from, reason: "insufficient-evidence" }
  return { ok: true, status: "refuted" }
}
