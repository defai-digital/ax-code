import { describe, expect, test } from "bun:test"
import {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
  DEBUG_ID_PATTERN,
  DebugCaseSchema,
  DebugEvidenceSchema,
  DebugHypothesisSchema,
} from "../../src/debug-engine/runtime-debug"
import type { DebugCase, DebugEvidence, DebugHypothesis } from "../../src/debug-engine/runtime-debug"

const validCase: DebugCase = {
  schemaVersion: 1,
  caseId: "0123456789abcdef",
  problem: "Tests time out intermittently in CI but pass locally",
  status: "open",
  createdAt: "2026-04-26T18:00:00.000Z",
  source: { tool: "debug", version: "4.x.x", runId: "ses_abc" },
}

const validEvidence: DebugEvidence = {
  schemaVersion: 1,
  evidenceId: "fedcba9876543210",
  caseId: "0123456789abcdef",
  kind: "log_capture",
  capturedAt: "2026-04-26T18:01:00.000Z",
  content: "[2026-04-26T18:00:55.123Z] INFO worker pool: timeout waiting for slot",
  source: { tool: "debug", version: "4.x.x", runId: "ses_abc" },
}

const validHypothesis: DebugHypothesis = {
  schemaVersion: 1,
  hypothesisId: "abcdef0123456789",
  caseId: "0123456789abcdef",
  claim: "Worker pool starvation under CI's reduced concurrency budget",
  confidence: 0.7,
  staticAnalysis: {
    sourceCallId: "call_debug_analyze_1",
    chainLength: 4,
    chainConfidence: 0.6,
  },
  evidenceRefs: ["fedcba9876543210"],
  status: "active",
  source: { tool: "debug", version: "4.x.x", runId: "ses_abc" },
}

describe("DebugCaseSchema", () => {
  test("accepts a minimal valid case", () => {
    expect(() => DebugCaseSchema.parse(validCase)).not.toThrow()
  })

  test("rejects schemaVersion other than 1", () => {
    expect(() => DebugCaseSchema.parse({ ...validCase, schemaVersion: 2 })).toThrow()
  })

  test("rejects unknown status", () => {
    expect(() => DebugCaseSchema.parse({ ...validCase, status: "in_progress" })).toThrow()
  })

  test("rejects malformed caseId", () => {
    expect(() => DebugCaseSchema.parse({ ...validCase, caseId: "not-hex" })).toThrow()
    expect(() => DebugCaseSchema.parse({ ...validCase, caseId: "ABCDEF0123456789" })).toThrow()
  })

  test("rejects empty problem and over-long problem", () => {
    expect(() => DebugCaseSchema.parse({ ...validCase, problem: "" })).toThrow()
    expect(() => DebugCaseSchema.parse({ ...validCase, problem: "x".repeat(501) })).toThrow()
  })

  test("rejects non-ISO datetime", () => {
    expect(() => DebugCaseSchema.parse({ ...validCase, createdAt: "yesterday" })).toThrow()
  })
})

describe("DebugEvidenceSchema", () => {
  test("accepts a minimal valid evidence record", () => {
    expect(() => DebugEvidenceSchema.parse(validEvidence)).not.toThrow()
  })

  test("rejects unknown kind", () => {
    expect(() => DebugEvidenceSchema.parse({ ...validEvidence, kind: "screenshot" })).toThrow()
  })

  test("accepts each documented kind", () => {
    for (const kind of ["log_capture", "instrumentation_result", "stack_trace", "graph_query"] as const) {
      expect(() => DebugEvidenceSchema.parse({ ...validEvidence, kind })).not.toThrow()
    }
  })

  test("rejects empty content", () => {
    expect(() => DebugEvidenceSchema.parse({ ...validEvidence, content: "" })).toThrow()
  })
})

describe("DebugHypothesisSchema", () => {
  test("accepts a hypothesis with both static analysis and runtime evidence", () => {
    expect(() => DebugHypothesisSchema.parse(validHypothesis)).not.toThrow()
  })

  test("accepts a hypothesis without staticAnalysis (pure runtime-driven)", () => {
    const noStatic: DebugHypothesis = { ...validHypothesis, staticAnalysis: undefined }
    expect(() => DebugHypothesisSchema.parse(noStatic)).not.toThrow()
  })

  test("rejects confidence > 0.95 (cap matches debug_analyze convention)", () => {
    expect(() => DebugHypothesisSchema.parse({ ...validHypothesis, confidence: 0.96 })).toThrow()
    expect(() => DebugHypothesisSchema.parse({ ...validHypothesis, confidence: 1.0 })).toThrow()
  })

  test("rejects unknown hypothesis status", () => {
    expect(() => DebugHypothesisSchema.parse({ ...validHypothesis, status: "investigating" })).toThrow()
  })

  test("evidenceRefs defaults to empty array when omitted", () => {
    const { evidenceRefs, ...without } = validHypothesis
    void evidenceRefs
    const parsed = DebugHypothesisSchema.parse(without)
    expect(parsed.evidenceRefs).toEqual([])
  })

  test("rejects malformed evidenceRefs entries", () => {
    expect(() => DebugHypothesisSchema.parse({ ...validHypothesis, evidenceRefs: ["bad-id"] })).toThrow()
  })
})

describe("computeDebugCaseId", () => {
  test("returns 16-char hex matching DEBUG_ID_PATTERN", () => {
    const id = computeDebugCaseId({ problem: "x", runId: "ses_a" })
    expect(id).toMatch(DEBUG_ID_PATTERN)
  })

  test("is deterministic for identical inputs", () => {
    const a = computeDebugCaseId({ problem: "tests fail", runId: "ses_a" })
    const b = computeDebugCaseId({ problem: "tests fail", runId: "ses_a" })
    expect(a).toBe(b)
  })

  test("differs between sessions for the same problem (no cross-session collisions)", () => {
    const a = computeDebugCaseId({ problem: "tests fail", runId: "ses_a" })
    const b = computeDebugCaseId({ problem: "tests fail", runId: "ses_b" })
    expect(a).not.toBe(b)
  })
})

describe("computeDebugEvidenceId", () => {
  test("includes content in the hash so two captures of different output dedupe separately", () => {
    const a = computeDebugEvidenceId({ caseId: "case01234567890a", kind: "log_capture", content: "line a" })
    const b = computeDebugEvidenceId({ caseId: "case01234567890a", kind: "log_capture", content: "line b" })
    expect(a).not.toBe(b)
  })

  test("same content under different kinds dedupes separately", () => {
    const a = computeDebugEvidenceId({ caseId: "case01234567890a", kind: "log_capture", content: "x" })
    const b = computeDebugEvidenceId({ caseId: "case01234567890a", kind: "stack_trace", content: "x" })
    expect(a).not.toBe(b)
  })
})

describe("computeDebugHypothesisId", () => {
  test("two hypotheses with identical claims under the same case share an id", () => {
    const a = computeDebugHypothesisId({ caseId: "case01234567890a", claim: "X is happening" })
    const b = computeDebugHypothesisId({ caseId: "case01234567890a", claim: "X is happening" })
    expect(a).toBe(b)
  })

  test("the same claim under a different case produces a different id", () => {
    const a = computeDebugHypothesisId({ caseId: "case01234567890a", claim: "X" })
    const b = computeDebugHypothesisId({ caseId: "case01234567890b", claim: "X" })
    expect(a).not.toBe(b)
  })
})
