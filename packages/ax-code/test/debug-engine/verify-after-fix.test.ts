import { describe, expect, test } from "bun:test"
import {
  applyVerificationToHypothesis,
  classifyEnvelope,
  resolveCaseStatus,
} from "../../src/debug-engine/verify-after-fix"
import type { DebugHypothesis } from "../../src/debug-engine/runtime-debug"
import type { VerificationEnvelope } from "../../src/quality/verification-envelope"

function envelope(overrides: Partial<VerificationEnvelope> = {}): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "qa",
    scope: { kind: "file", paths: ["src/foo.ts"] },
    command: { runner: "typecheck", argv: [], cwd: "/tmp" },
    result: {
      name: "typecheck",
      type: "typecheck",
      passed: true,
      status: "passed",
      issues: [],
      duration: 0,
    },
    structuredFailures: [],
    artifactRefs: [],
    source: { tool: "refactor_apply", version: "4.x.x", runId: "ses_test" },
    ...overrides,
  }
}

function hypothesis(overrides: Partial<DebugHypothesis> = {}): DebugHypothesis {
  return {
    schemaVersion: 1,
    hypothesisId: "abcdef0123456789",
    caseId: "0123456789abcdef",
    claim: "the cache is wrong",
    confidence: 0.6,
    evidenceRefs: [],
    status: "active",
    source: { tool: "debug_propose_hypothesis", version: "4.x.x", runId: "ses_test" },
    ...overrides,
  }
}

describe("classifyEnvelope", () => {
  test("passed → confirmed", () => {
    expect(classifyEnvelope(envelope())).toBe("confirmed")
  })

  test("failed with structured failures → refuted", () => {
    expect(
      classifyEnvelope(
        envelope({
          result: {
            name: "tc",
            type: "typecheck",
            passed: false,
            status: "failed",
            issues: [],
            duration: 0,
          },
          structuredFailures: [
            { kind: "typecheck", file: "src/foo.ts", line: 10, code: "TS2322", message: "type mismatch" },
          ],
        }),
      ),
    ).toBe("refuted")
  })

  test("failed without structured failures → inconclusive (couldn't pin down what broke)", () => {
    expect(
      classifyEnvelope(
        envelope({
          result: {
            name: "tc",
            type: "typecheck",
            passed: false,
            status: "failed",
            issues: [],
            duration: 0,
          },
          structuredFailures: [],
        }),
      ),
    ).toBe("inconclusive")
  })

  test("error / timeout / skipped → inconclusive (infra problems, not signal)", () => {
    for (const status of ["error", "timeout", "skipped"] as const) {
      expect(
        classifyEnvelope(
          envelope({
            result: { name: "tc", type: "typecheck", passed: false, status, issues: [], duration: 0 },
          }),
        ),
      ).toBe("inconclusive")
    }
  })
})

describe("applyVerificationToHypothesis", () => {
  test("passing envelope → hypothesis status flips to 'confirmed' and envelope id is appended to evidenceRefs", () => {
    const result = applyVerificationToHypothesis({ hypothesis: hypothesis(), envelope: envelope() })
    expect(result.status).toBe("confirmed")
    expect(result.evidenceRefs).toHaveLength(1)
    expect(result.evidenceRefs[0]).toMatch(/^[0-9a-f]{16}$/)
  })

  test("failing envelope → hypothesis status flips to 'refuted'", () => {
    const result = applyVerificationToHypothesis({
      hypothesis: hypothesis(),
      envelope: envelope({
        result: { name: "tc", type: "typecheck", passed: false, status: "failed", issues: [], duration: 0 },
        structuredFailures: [
          { kind: "typecheck", file: "src/foo.ts", line: 10, code: "TS2322", message: "type mismatch" },
        ],
      }),
    })
    expect(result.status).toBe("refuted")
  })

  test("inconclusive envelope → hypothesis returned unchanged (referentially equal evidenceRefs)", () => {
    const original = hypothesis({ evidenceRefs: ["ev0000aaaa1111bb"] })
    const result = applyVerificationToHypothesis({
      hypothesis: original,
      envelope: envelope({
        result: { name: "tc", type: "typecheck", passed: false, status: "timeout", issues: [], duration: 0 },
      }),
    })
    expect(result).toBe(original)
  })

  test("envelope id is not duplicated when already present in evidenceRefs", () => {
    const ev = envelope()
    // Compute the id the helper will append, then start the hypothesis with
    // that ref already present.
    const first = applyVerificationToHypothesis({ hypothesis: hypothesis(), envelope: ev })
    const seenId = first.evidenceRefs[0]

    const second = applyVerificationToHypothesis({
      hypothesis: hypothesis({ evidenceRefs: [seenId] }),
      envelope: ev,
    })
    expect(second.evidenceRefs).toEqual([seenId])
  })

  test("does not mutate the input hypothesis", () => {
    const before = hypothesis({ evidenceRefs: ["existing0000aaaa"] })
    const beforeJson = JSON.stringify(before)
    applyVerificationToHypothesis({ hypothesis: before, envelope: envelope() })
    expect(JSON.stringify(before)).toBe(beforeJson)
  })

  test("returned evidenceRefs is a fresh array reference (mutation isolation)", () => {
    // confirmed branch — even when the envelope id is ALREADY in evidenceRefs
    // (no append needed), the returned hypothesis must own a fresh array so
    // a caller mutating it does not corrupt the input.
    const ev = envelope()
    const seeded = applyVerificationToHypothesis({ hypothesis: hypothesis(), envelope: ev })
    const envelopeIdAlreadyPresent = seeded.evidenceRefs[0]

    const original = hypothesis({ evidenceRefs: [envelopeIdAlreadyPresent] })
    const result = applyVerificationToHypothesis({ hypothesis: original, envelope: ev })

    expect(result.evidenceRefs).not.toBe(original.evidenceRefs)
    // Mutating the result must not bleed back into the input.
    result.evidenceRefs.push("new000aaaa1111bb")
    expect(original.evidenceRefs).toEqual([envelopeIdAlreadyPresent])
  })
})

describe("resolveCaseStatus", () => {
  test("declared 'resolved' or 'unresolved' wins regardless of hypothesis state", () => {
    expect(resolveCaseStatus("resolved", [hypothesis({ status: "active" })])).toBe("resolved")
    expect(resolveCaseStatus("unresolved", [hypothesis({ status: "confirmed" })])).toBe("unresolved")
  })

  test("no hypotheses → 'open'", () => {
    expect(resolveCaseStatus("open", [])).toBe("open")
  })

  test("any confirmed hypothesis → 'resolved'", () => {
    expect(resolveCaseStatus("open", [hypothesis({ status: "refuted" }), hypothesis({ status: "confirmed" })])).toBe(
      "resolved",
    )
  })

  test("all hypotheses refuted/unresolved → 'unresolved'", () => {
    expect(resolveCaseStatus("open", [hypothesis({ status: "refuted" }), hypothesis({ status: "unresolved" })])).toBe(
      "unresolved",
    )
  })

  test("at least one active and no confirmed → 'investigating'", () => {
    expect(resolveCaseStatus("open", [hypothesis({ status: "refuted" }), hypothesis({ status: "active" })])).toBe(
      "investigating",
    )
  })
})
