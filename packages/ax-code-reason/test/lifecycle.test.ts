import { describe, expect, test } from "vitest"
import {
  CASE_TRANSITIONS,
  HYPOTHESIS_TRANSITIONS,
  HYPOTHESIS_TERMINAL_STATUSES,
  INSTRUMENTATION_TRANSITIONS,
  PLAN_TRANSITIONS,
  transitionHypothesis,
  validateTransition,
} from "../src/lifecycle"
import type { DebugHypothesisStatus } from "../src/runtime-debug"
import type { SourceState, VerificationEnvelope } from "../src/quality/verification-envelope"
import { makeEnvelope } from "./fixture/envelope"

const fresh: SourceState = { available: true, commit: "abc", dirtyDigest: "d1" }

// The fixture envelope builder doesn't attach sourceState; wrap it here.
function envelopeWithSourceState(
  opts: { status: "passed" | "failed"; structured: boolean; sourceState?: SourceState } = {
    status: "passed",
    structured: false,
  },
): VerificationEnvelope {
  const base = makeEnvelope({
    status: opts.status,
    passed: opts.status === "passed",
    structuredFailures: opts.structured ? [{ kind: "test", testName: "does the thing", framework: "vitest" }] : [],
  })
  return { ...base, sourceState: opts.sourceState ?? fresh }
}

describe("transition tables", () => {
  test("hypothesis terminal states have no outgoing transitions", () => {
    for (const terminal of HYPOTHESIS_TERMINAL_STATUSES) {
      expect(HYPOTHESIS_TRANSITIONS[terminal]).toEqual([terminal])
    }
  })

  test("active hypothesis can move to every status", () => {
    expect([...HYPOTHESIS_TRANSITIONS.active].sort()).toEqual(["active", "confirmed", "refuted", "unresolved"].sort())
  })

  test("plan aborted → pending is allowed; applied/stale are terminal", () => {
    expect(PLAN_TRANSITIONS.aborted).toContain("pending")
    expect(PLAN_TRANSITIONS.applied).toEqual(["applied"])
    expect(PLAN_TRANSITIONS.stale).toEqual(["stale"])
    expect(PLAN_TRANSITIONS.pending).toContain("aborted")
  })

  test("instrumentation removed is terminal; planned → applied → removed", () => {
    expect(INSTRUMENTATION_TRANSITIONS.removed).toEqual(["removed"])
    expect(INSTRUMENTATION_TRANSITIONS.planned).toContain("applied")
    expect(INSTRUMENTATION_TRANSITIONS.applied).toContain("removed")
    expect(INSTRUMENTATION_TRANSITIONS.applied).not.toContain("planned")
  })

  test("case resolved/unresolved are terminal", () => {
    expect(CASE_TRANSITIONS.resolved).toEqual(["resolved"])
    expect(CASE_TRANSITIONS.unresolved).toEqual(["unresolved"])
  })
})

describe("validateTransition", () => {
  test("legal transition returns ok", () => {
    expect(validateTransition(PLAN_TRANSITIONS, ["applied", "stale"], "aborted", "pending")).toEqual({
      ok: true,
      status: "pending",
    })
  })

  test("self transition is always legal", () => {
    expect(validateTransition(PLAN_TRANSITIONS, ["applied", "stale"], "applied", "applied").ok).toBe(true)
  })

  test("illegal transition out of a terminal state reports terminal-status", () => {
    const result = validateTransition(PLAN_TRANSITIONS, ["applied", "stale"], "applied", "pending")
    expect(result).toEqual({ ok: false, status: "applied", reason: "terminal-status" })
  })

  test("illegal transition between non-terminal states reports illegal-transition", () => {
    const result = validateTransition(INSTRUMENTATION_TRANSITIONS, ["removed"], "applied", "planned")
    expect(result).toEqual({ ok: false, status: "applied", reason: "illegal-transition" })
  })
})

describe("transitionHypothesis", () => {
  test("active → confirmed with a fresh passing envelope", () => {
    const result = transitionHypothesis("active", "confirmed", {
      envelopes: [envelopeWithSourceState()],
      currentSourceState: fresh,
    })
    expect(result).toEqual({ ok: true, status: "confirmed" })
  })

  test("active → confirmed with zero evidence is insufficient-evidence", () => {
    const result = transitionHypothesis("active", "confirmed")
    expect(result).toEqual({ ok: false, status: "active", reason: "insufficient-evidence" })
  })

  test("active → confirmed with only a skipped envelope is insufficient-evidence", () => {
    const skipped = makeEnvelope({ status: "skipped" })
    const result = transitionHypothesis("active", "confirmed", { envelopes: [skipped] })
    expect(result).toEqual({ ok: false, status: "active", reason: "insufficient-evidence" })
  })

  test("active → confirmed with a conflicting failing envelope is conflicting-evidence", () => {
    const result = transitionHypothesis("active", "confirmed", {
      envelopes: [envelopeWithSourceState({ status: "failed", structured: true })],
      currentSourceState: fresh,
    })
    expect(result).toEqual({ ok: false, status: "active", reason: "conflicting-evidence" })
  })

  test("active → refuted needs ≥1 failing envelope with structured failures", () => {
    const result = transitionHypothesis("active", "refuted", {
      envelopes: [envelopeWithSourceState({ status: "failed", structured: true })],
      currentSourceState: fresh,
    })
    expect(result).toEqual({ ok: true, status: "refuted" })
  })

  test("active → refuted with a passing envelope is insufficient-evidence", () => {
    const result = transitionHypothesis("active", "refuted", {
      envelopes: [envelopeWithSourceState()],
      currentSourceState: fresh,
    })
    expect(result).toEqual({ ok: false, status: "active", reason: "insufficient-evidence" })
  })

  test("confirmed is terminal: confirmed → refuted is rejected", () => {
    const result = transitionHypothesis("confirmed", "refuted", {
      envelopes: [envelopeWithSourceState({ status: "failed", structured: true })],
      currentSourceState: fresh,
    })
    expect(result).toEqual({ ok: false, status: "confirmed", reason: "terminal-status" })
  })

  test("refuted is terminal: refuted → active is rejected", () => {
    expect(transitionHypothesis("refuted", "active")).toEqual({
      ok: false,
      status: "refuted",
      reason: "terminal-status",
    })
  })

  test("unresolved is terminal: unresolved → confirmed is rejected", () => {
    expect(transitionHypothesis("unresolved", "confirmed")).toEqual({
      ok: false,
      status: "unresolved",
      reason: "terminal-status",
    })
  })

  test("active → unresolved needs no evidence", () => {
    expect(transitionHypothesis("active", "unresolved")).toEqual({ ok: true, status: "unresolved" })
  })

  test("self-transition is a no-op regardless of evidence", () => {
    expect(transitionHypothesis("confirmed", "confirmed")).toEqual({ ok: true, status: "confirmed" })
    expect(transitionHypothesis("active", "active")).toEqual({ ok: true, status: "active" })
  })

  test("stale evidence rejects confirmation with stale-source", () => {
    const stale: SourceState = { available: true, commit: "old", dirtyDigest: "d0" }
    const envelope = envelopeWithSourceState({ status: "passed", structured: false, sourceState: stale })
    const result = transitionHypothesis("active", "confirmed", {
      envelopes: [envelope],
      currentSourceState: fresh,
    })
    expect(result).toEqual({ ok: false, status: "active", reason: "stale-source" })
  })

  test("no currentSourceState skips freshness enforcement", () => {
    // Without a current fingerprint, the pure evidence-polarity rule applies
    // (freshness is the caller's concern, enforced before delegating).
    const result = transitionHypothesis("active", "confirmed", { envelopes: [envelopeWithSourceState()] })
    expect(result).toEqual({ ok: true, status: "confirmed" })
  })
})

// Type-level sanity: the terminal set covers exactly the terminal statuses.
const allHypothesisStatuses: readonly DebugHypothesisStatus[] = ["active", "confirmed", "refuted", "unresolved"]
const terminalSet = new Set(HYPOTHESIS_TERMINAL_STATUSES)
const nonTerminal = allHypothesisStatuses.filter((s) => !terminalSet.has(s))
void nonTerminal
