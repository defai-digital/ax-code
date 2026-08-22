import { SourceStateSchema, type SourceState, type VerificationEnvelope } from "./verification-envelope"

// Phase 1 (PRD D3): evidence freshness. Verification envelopes captured
// against a worktree go stale when the worktree moves on — citing a stale
// envelope as authoritative evidence for a hypothesis confirmation must
// never silently pass. These helpers are pure: core captures the current
// source state (see src/quality/source-state.ts in ax-code) and passes it
// in; the engine classifies and enforces.

export { SourceStateSchema, type SourceState }

export type EnvelopeFreshness =
  | { status: "fresh" }
  | { status: "stale"; reason: "commit-moved" | "dirty-changed" }
  | { status: "unknown"; reason: "no-source-state" | "source-unavailable" }

// Classify an envelope against the current source state:
//   envelope has no sourceState        → unknown / no-source-state
//   either side unavailable            → unknown / source-unavailable
//   commit mismatch                    → stale / commit-moved
//   dirtyDigest mismatch               → stale / dirty-changed
//   otherwise                          → fresh
// A null commit on both sides (e.g. a repo with no commits yet) compares
// equal — the dirty digest still carries the fingerprint in that case.
export function classifyEnvelopeFreshness(
  envelope: Pick<VerificationEnvelope, "sourceState">,
  current: SourceState,
): EnvelopeFreshness {
  const captured = envelope.sourceState
  if (!captured) return { status: "unknown", reason: "no-source-state" }
  if (!captured.available || !current.available) return { status: "unknown", reason: "source-unavailable" }
  if (captured.commit !== current.commit) return { status: "stale", reason: "commit-moved" }
  if (captured.dirtyDigest !== current.dirtyDigest) return { status: "stale", reason: "dirty-changed" }
  return { status: "fresh" }
}

export type CitationUse = "authoritative" | "provenance"

export type CitationFreshnessDecision = {
  ok: boolean
  needsVerification: boolean
}

// Authoritative citations (hypothesis confirmation, refactor-apply gating)
// require fresh evidence: stale or unknown freshness fails closed with
// needsVerification. Provenance citations (finding evidenceRefs trails) are
// never blocked — they record where evidence came from, not that it still
// holds.
export function enforceCitationFreshness(freshness: EnvelopeFreshness, use: CitationUse): CitationFreshnessDecision {
  if (use === "provenance") return { ok: true, needsVerification: false }
  if (freshness.status === "fresh") return { ok: true, needsVerification: false }
  return { ok: false, needsVerification: true }
}
