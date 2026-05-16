import { describe, expect, test } from "bun:test"
import { computeFindingId, FINDING_ID_PATTERN, FindingSchema, RULE_ID_PATTERN } from "../../src/quality/finding"
import type { Finding, FindingAnchor } from "../../src/quality/finding"

const validFinding: Finding = {
  schemaVersion: 1,
  findingId: "0123456789abcdef",
  workflow: "review",
  category: "bug",
  severity: "HIGH",
  summary: "Off-by-one in pagination loop",
  file: "src/server/routes/list.ts",
  anchor: { kind: "line", line: 42 },
  rationale: "Loop runs n+1 times when limit equals total.",
  evidence: ["src/server/routes/list.ts:42 - condition uses <= instead of <"],
  suggestedNextAction: "Change condition to `<` and add a regression test.",
  source: { tool: "review", version: "4.1.0", runId: "ses_abc123" },
}

describe("FindingSchema", () => {
  test("accepts a minimal valid finding", () => {
    const parsed = FindingSchema.parse(validFinding)
    expect(parsed.severity).toBe("HIGH")
    expect(parsed.category).toBe("bug")
  })

  test("accepts a symbol anchor", () => {
    const finding: Finding = {
      ...validFinding,
      anchor: { kind: "symbol", symbolId: "node://src/foo.ts#bar" },
    }
    expect(() => FindingSchema.parse(finding)).not.toThrow()
  })

  test("accepts optional confidence, ruleId, evidenceRefs", () => {
    const finding: Finding = {
      ...validFinding,
      confidence: 0.83,
      ruleId: "axcode:bug-empty-catch",
      evidenceRefs: [{ kind: "verification", id: "ver_xyz" }],
    }
    const parsed = FindingSchema.parse(finding)
    expect(parsed.confidence).toBe(0.83)
    expect(parsed.ruleId).toBe("axcode:bug-empty-catch")
    expect(parsed.evidenceRefs?.[0].kind).toBe("verification")
  })

  test("rejects schemaVersion other than 1", () => {
    expect(() => FindingSchema.parse({ ...validFinding, schemaVersion: 2 })).toThrow()
  })

  test("rejects unknown severity", () => {
    expect(() => FindingSchema.parse({ ...validFinding, severity: "BLOCKER" })).toThrow()
  })

  test("rejects unknown category", () => {
    expect(() => FindingSchema.parse({ ...validFinding, category: "style" })).toThrow()
  })

  test("rejects unknown workflow", () => {
    expect(() => FindingSchema.parse({ ...validFinding, workflow: "lint" })).toThrow()
  })

  test("rejects malformed findingId", () => {
    expect(() => FindingSchema.parse({ ...validFinding, findingId: "not-hex" })).toThrow()
    expect(() => FindingSchema.parse({ ...validFinding, findingId: "ABCDEF0123456789" })).toThrow()
  })

  test("rejects malformed ruleId", () => {
    expect(() => FindingSchema.parse({ ...validFinding, ruleId: "unprefixed-rule" })).toThrow()
    expect(() => FindingSchema.parse({ ...validFinding, ruleId: "vendor:Some_Rule" })).toThrow()
  })

  test("rejects confidence out of [0,1]", () => {
    expect(() => FindingSchema.parse({ ...validFinding, confidence: 1.5 })).toThrow()
    expect(() => FindingSchema.parse({ ...validFinding, confidence: -0.1 })).toThrow()
  })

  test("rejects summary over 200 characters", () => {
    expect(() => FindingSchema.parse({ ...validFinding, summary: "x".repeat(201) })).toThrow()
  })

  test("rejects empty rationale", () => {
    expect(() => FindingSchema.parse({ ...validFinding, rationale: "" })).toThrow()
  })

  test("RULE_ID_PATTERN accepts the documented namespaces", () => {
    expect(RULE_ID_PATTERN.test("axcode:bug-empty-catch")).toBe(true)
    expect(RULE_ID_PATTERN.test("policy:require-changelog")).toBe(true)
    expect(RULE_ID_PATTERN.test("user:custom-rule-001")).toBe(true)
    expect(RULE_ID_PATTERN.test("vendor:custom-rule")).toBe(false)
  })
})

describe("computeFindingId", () => {
  const baseInput: Parameters<typeof computeFindingId>[0] = {
    workflow: "review",
    category: "bug",
    file: "src/foo.ts",
    anchor: { kind: "line", line: 42 } as FindingAnchor,
  }

  test("returns 16-char lowercase hex matching FINDING_ID_PATTERN", () => {
    const id = computeFindingId(baseInput)
    expect(id).toMatch(FINDING_ID_PATTERN)
  })

  test("is deterministic for identical inputs", () => {
    expect(computeFindingId(baseInput)).toBe(computeFindingId(baseInput))
  })

  test("changes when any input field changes", () => {
    const baseId = computeFindingId(baseInput)
    expect(computeFindingId({ ...baseInput, workflow: "debug" })).not.toBe(baseId)
    expect(computeFindingId({ ...baseInput, category: "security" })).not.toBe(baseId)
    expect(computeFindingId({ ...baseInput, file: "src/bar.ts" })).not.toBe(baseId)
    expect(computeFindingId({ ...baseInput, anchor: { kind: "line", line: 43 } as FindingAnchor })).not.toBe(baseId)
    expect(computeFindingId({ ...baseInput, ruleId: "axcode:r1" })).not.toBe(baseId)
  })

  test("differs between line anchor and symbol anchor for the same file", () => {
    const lineId = computeFindingId(baseInput)
    const symbolId = computeFindingId({
      ...baseInput,
      anchor: { kind: "symbol", symbolId: "src/foo.ts#bar" },
    })
    expect(lineId).not.toBe(symbolId)
  })

  test("includes ruleId in the hash so same defect under different rules dedups separately", () => {
    const a = computeFindingId({ ...baseInput, ruleId: "axcode:rule-a" })
    const b = computeFindingId({ ...baseInput, ruleId: "axcode:rule-b" })
    expect(a).not.toBe(b)
  })
})
