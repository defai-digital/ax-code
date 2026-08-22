import { describe, expect, test } from "vitest"
import { computeFindingId } from "../src/quality/finding"
import { computeEnvelopeId } from "../src/quality/verification-envelope"
import {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
  computeDebugInstrumentationPlanId,
  DEBUG_ID_PATTERN,
} from "../src/runtime-debug"
import { RefactorPlanID } from "../src/id"
import { makeEnvelope } from "./fixture/envelope"

// Deterministic 16-hex ID contract for every engine entity. These IDs are
// content-addressed so consumers can dedup across runs; any change to the
// hashed inputs is a breaking contract change.

describe("deterministic 16-hex IDs", () => {
  test("finding IDs hash workflow/category/file/anchor/ruleId", () => {
    const input = {
      workflow: "debug" as const,
      category: "bug" as const,
      file: "src/main.ts",
      anchor: { kind: "line" as const, line: 7 },
      ruleId: "axcode:missing-cleanup",
    }
    const id = computeFindingId(input)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(computeFindingId({ ...input })).toBe(id)
    expect(computeFindingId({ ...input, workflow: "review" as const })).not.toBe(id)
    expect(computeFindingId({ ...input, ruleId: undefined })).not.toBe(id)
    // Symbol anchors hash a different identity channel than line anchors.
    expect(computeFindingId({ ...input, anchor: { kind: "symbol" as const, symbolId: "n1" } })).not.toBe(id)
  })

  test("envelope IDs are stable for identical content", () => {
    const envelope = makeEnvelope()
    const id = computeEnvelopeId(envelope)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(computeEnvelopeId(makeEnvelope())).toBe(id)
  })

  test("debug case IDs hash problem + runId", () => {
    const input = { problem: "flaky test", runId: "run-1" }
    const id = computeDebugCaseId(input)
    expect(id).toMatch(DEBUG_ID_PATTERN)
    expect(computeDebugCaseId({ ...input })).toBe(id)
    expect(computeDebugCaseId({ ...input, problem: "other" })).not.toBe(id)
    expect(computeDebugCaseId({ ...input, runId: "run-2" })).not.toBe(id)
  })

  test("debug evidence IDs hash caseId + kind + content", () => {
    const input = { caseId: "a".repeat(16), kind: "log_capture" as const, content: "line one\nline two" }
    const id = computeDebugEvidenceId(input)
    expect(id).toMatch(DEBUG_ID_PATTERN)
    expect(computeDebugEvidenceId({ ...input })).toBe(id)
    expect(computeDebugEvidenceId({ ...input, kind: "stack_trace" as const })).not.toBe(id)
    expect(computeDebugEvidenceId({ ...input, content: "line one\nline 2" })).not.toBe(id)
  })

  test("debug hypothesis IDs hash caseId + claim", () => {
    const input = { caseId: "b".repeat(16), claim: "the cache is stale" }
    const id = computeDebugHypothesisId(input)
    expect(id).toMatch(DEBUG_ID_PATTERN)
    expect(computeDebugHypothesisId({ ...input })).toBe(id)
    expect(computeDebugHypothesisId({ ...input, claim: "the cache is fine" })).not.toBe(id)
  })

  test("instrumentation plan IDs hash caseId + purpose + serialized targets", () => {
    const target = { file: "src/a.ts", probe: "console.log(x)", removeInstruction: "remove the log" }
    const input = { caseId: "c".repeat(16), purpose: "trace x", targets: [target] }
    const id = computeDebugInstrumentationPlanId(input)
    expect(id).toMatch(DEBUG_ID_PATTERN)
    expect(computeDebugInstrumentationPlanId({ ...input, targets: [{ ...target }] })).toBe(id)
    // Current behavior: targets are hashed via JSON.stringify in array
    // order, so reordering the array changes the ID.
    const second = { file: "src/b.ts", probe: "console.log(y)", removeInstruction: "remove it" }
    const forward = computeDebugInstrumentationPlanId({ ...input, targets: [target, second] })
    const backward = computeDebugInstrumentationPlanId({ ...input, targets: [second, target] })
    expect(forward).not.toBe(backward)
  })

  test("refactor plan IDs carry the rpl_ prefix and validate at the boundary", () => {
    const a = RefactorPlanID.ascending()
    const b = RefactorPlanID.ascending()
    expect(a).toMatch(/^rpl_/)
    expect(b).toMatch(/^rpl_/)
    expect(a).not.toBe(b)
    expect(RefactorPlanID.zod.safeParse(a).success).toBe(true)
    expect(RefactorPlanID.zod.safeParse("dpt_other").success).toBe(false)
  })
})
