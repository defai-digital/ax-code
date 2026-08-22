import { describe, expect, test } from "vitest"
import {
  applyVerificationSetToHypothesis,
  applyVerificationToHypothesis,
  classifyEnvelope,
  classifyEnvelopeSet,
  resolveCaseStatus,
} from "../src/verify-after-fix"
import { computeEnvelopeId } from "../src/quality/verification-envelope"
import type { DebugHypothesis } from "../src/runtime-debug"
import { makeEnvelope } from "./fixture/envelope"

// Current-behavior contract for verify-after-fix. Phase 3 introduced the
// explicit hypothesis state machine: confirmed/refuted/unresolved are
// terminal, so the tests below assert that illegal transitions return the
// unchanged hypothesis instead of overwriting.

const source = { tool: "debug", version: "7.7.8", runId: "run-1" }

function makeHypothesis(overrides: Partial<DebugHypothesis> = {}): DebugHypothesis {
  return {
    schemaVersion: 1,
    hypothesisId: "a".repeat(16),
    caseId: "b".repeat(16),
    claim: "the cache is stale",
    confidence: 0.6,
    evidenceRefs: [],
    status: "active",
    source,
    ...overrides,
  }
}

const failing = { kind: "test" as const, testName: "does the thing", framework: "vitest" }

describe("classifyEnvelope", () => {
  test("passed confirms", () => {
    expect(classifyEnvelope(makeEnvelope({ status: "passed" }))).toBe("confirmed")
  })

  test("failed with structured failures refutes", () => {
    expect(classifyEnvelope(makeEnvelope({ status: "failed", passed: false, structuredFailures: [failing] }))).toBe(
      "refuted",
    )
  })

  test("failed without structured failures is inconclusive", () => {
    expect(classifyEnvelope(makeEnvelope({ status: "failed", passed: false }))).toBe("inconclusive")
  })

  test("skipped, timeout, and error are inconclusive", () => {
    expect(classifyEnvelope(makeEnvelope({ status: "skipped" }))).toBe("inconclusive")
    expect(classifyEnvelope(makeEnvelope({ status: "timeout", passed: false }))).toBe("inconclusive")
    expect(classifyEnvelope(makeEnvelope({ status: "error", passed: false }))).toBe("inconclusive")
  })
})

describe("classifyEnvelopeSet", () => {
  test("empty set is inconclusive", () => {
    expect(classifyEnvelopeSet([])).toBe("inconclusive")
  })

  test("any refuting envelope refutes the whole set, even with a passing one present", () => {
    const envelopes = [
      makeEnvelope({ status: "passed", runId: "run-pass" }),
      makeEnvelope({ status: "failed", passed: false, structuredFailures: [failing], runId: "run-fail" }),
    ]
    expect(classifyEnvelopeSet(envelopes)).toBe("refuted")
  })

  test("failed/error/timeout without structured failures makes the set inconclusive even with a pass", () => {
    const passing = makeEnvelope({ status: "passed", runId: "run-pass" })
    for (const status of ["failed", "error", "timeout"] as const) {
      expect(classifyEnvelopeSet([passing, makeEnvelope({ status, passed: false, runId: `run-${status}` })])).toBe(
        "inconclusive",
      )
    }
  })

  test("all-passing set confirms", () => {
    expect(classifyEnvelopeSet([makeEnvelope({ runId: "run-a" }), makeEnvelope({ runId: "run-b" })])).toBe("confirmed")
  })

  test("skipped-only set is inconclusive", () => {
    expect(classifyEnvelopeSet([makeEnvelope({ status: "skipped" })])).toBe("inconclusive")
  })
})

describe("applyVerificationToHypothesis", () => {
  test("confirmed: appends the envelope ID to evidenceRefs and sets status", () => {
    const hypothesis = makeHypothesis({ evidenceRefs: ["c".repeat(16)] })
    const envelope = makeEnvelope()
    const updated = applyVerificationToHypothesis({ hypothesis, envelope })
    expect(updated.status).toBe("confirmed")
    expect(updated.evidenceRefs).toEqual(["c".repeat(16), computeEnvelopeId(envelope)])
    // The input hypothesis and its evidenceRefs array are not mutated.
    expect(hypothesis.status).toBe("active")
    expect(hypothesis.evidenceRefs).toEqual(["c".repeat(16)])
    expect(updated.evidenceRefs).not.toBe(hypothesis.evidenceRefs)
  })

  test("applying the same envelope twice records the ID once", () => {
    const envelope = makeEnvelope()
    const once = applyVerificationToHypothesis({ hypothesis: makeHypothesis(), envelope })
    const twice = applyVerificationToHypothesis({ hypothesis: once, envelope })
    expect(twice.evidenceRefs.filter((ref) => ref === computeEnvelopeId(envelope))).toHaveLength(1)
  })

  test("refuted: failing envelope with structured failures flips status", () => {
    const envelope = makeEnvelope({ status: "failed", passed: false, structuredFailures: [failing] })
    const updated = applyVerificationToHypothesis({ hypothesis: makeHypothesis(), envelope })
    expect(updated.status).toBe("refuted")
    expect(updated.evidenceRefs).toContain(computeEnvelopeId(envelope))
  })

  test("inconclusive: returns the same reference, untouched", () => {
    const hypothesis = makeHypothesis()
    const envelope = makeEnvelope({ status: "skipped" })
    expect(applyVerificationToHypothesis({ hypothesis, envelope })).toBe(hypothesis)
  })

  test("confirmed is terminal: a failing envelope cannot refute it", () => {
    // Phase 3 (D5): confirmed is a terminal state. A later failing envelope
    // must NOT demote the hypothesis — the transition is rejected and the
    // unchanged hypothesis is returned.
    const confirmedHypothesis = makeHypothesis({ status: "confirmed" })
    const envelope = makeEnvelope({ status: "failed", passed: false, structuredFailures: [failing] })
    const result = applyVerificationToHypothesis({ hypothesis: confirmedHypothesis, envelope })
    expect(result).toBe(confirmedHypothesis)
    expect(result.status).toBe("confirmed")
  })

  test("unresolved is terminal: cannot jump straight to confirmed", () => {
    const unresolvedHypothesis = makeHypothesis({ status: "unresolved" })
    const envelope = makeEnvelope()
    const result = applyVerificationToHypothesis({ hypothesis: unresolvedHypothesis, envelope })
    expect(result).toBe(unresolvedHypothesis)
    expect(result.status).toBe("unresolved")
  })
})

describe("applyVerificationSetToHypothesis", () => {
  test("confirmed set appends every envelope ID in the set", () => {
    const passing = makeEnvelope({ runId: "run-pass" })
    const skipped = makeEnvelope({ status: "skipped", runId: "run-skip" })
    const updated = applyVerificationSetToHypothesis({ hypothesis: makeHypothesis(), envelopes: [passing, skipped] })
    expect(updated.status).toBe("confirmed")
    // Current behavior: IDs of ALL envelopes in the set are recorded,
    // including ones that did not drive the outcome.
    expect(updated.evidenceRefs).toEqual([computeEnvelopeId(passing), computeEnvelopeId(skipped)])
  })

  test("inconclusive set returns the same reference", () => {
    const hypothesis = makeHypothesis()
    const envelopes = [makeEnvelope({ status: "skipped" })]
    expect(applyVerificationSetToHypothesis({ hypothesis, envelopes })).toBe(hypothesis)
  })

  test("refuted set appends IDs without duplicating existing refs", () => {
    const failingEnvelope = makeEnvelope({ status: "failed", passed: false, structuredFailures: [failing] })
    const hypothesis = makeHypothesis({ evidenceRefs: [computeEnvelopeId(failingEnvelope)] })
    const updated = applyVerificationSetToHypothesis({ hypothesis, envelopes: [failingEnvelope] })
    expect(updated.status).toBe("refuted")
    expect(updated.evidenceRefs).toEqual([computeEnvelopeId(failingEnvelope)])
  })
})

describe("resolveCaseStatus", () => {
  test("resolved and unresolved are sticky at the case level", () => {
    const confirmed = makeHypothesis({ status: "confirmed" })
    expect(resolveCaseStatus("resolved", [])).toBe("resolved")
    expect(resolveCaseStatus("resolved", [confirmed])).toBe("resolved")
    // Current behavior: even a confirmed hypothesis does not reopen an
    // unresolved case.
    expect(resolveCaseStatus("unresolved", [confirmed])).toBe("unresolved")
    expect(resolveCaseStatus("unresolved", [])).toBe("unresolved")
  })

  test("no hypotheses maps back to open", () => {
    expect(resolveCaseStatus("open", [])).toBe("open")
    // Current behavior: an investigating case with zero hypotheses also
    // computes to open.
    expect(resolveCaseStatus("investigating", [])).toBe("open")
  })

  test("any confirmed hypothesis resolves the case", () => {
    const hypotheses = [makeHypothesis({ status: "active" }), makeHypothesis({ status: "confirmed" })]
    expect(resolveCaseStatus("open", hypotheses)).toBe("resolved")
  })

  test("all refuted/unresolved hypotheses make the case unresolved", () => {
    const hypotheses = [makeHypothesis({ status: "refuted" }), makeHypothesis({ status: "unresolved" })]
    expect(resolveCaseStatus("investigating", hypotheses)).toBe("unresolved")
  })

  test("otherwise the case stays investigating", () => {
    const hypotheses = [makeHypothesis({ status: "refuted" }), makeHypothesis({ status: "active" })]
    expect(resolveCaseStatus("open", hypotheses)).toBe("investigating")
  })
})
