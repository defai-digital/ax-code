import { describe, expect, test } from "vitest"
import { computeFindingId, FindingSchema } from "../src/quality/finding"

const source = { tool: "review", version: "7.7.7", runId: "run-1" }

describe("quality findings", () => {
  test("computes deterministic IDs from the finding identity", () => {
    const input = {
      workflow: "review" as const,
      category: "bug" as const,
      file: "src/main.ts",
      anchor: { kind: "line" as const, line: 7 },
      ruleId: "axcode:missing-cleanup",
    }
    expect(computeFindingId(input)).toBe(computeFindingId({ ...input }))
    expect(computeFindingId(input)).toMatch(/^[0-9a-f]{16}$/)
    expect(computeFindingId({ ...input, anchor: { kind: "line", line: 8 } })).not.toBe(computeFindingId(input))
  })

  test("rejects non-finite JSON numbers at the public schema boundary", () => {
    const base = {
      schemaVersion: 1 as const,
      findingId: "0123456789abcdef",
      workflow: "review" as const,
      category: "bug" as const,
      severity: "HIGH" as const,
      summary: "A concrete defect",
      file: "src/main.ts",
      anchor: { kind: "line" as const, line: 7 },
      rationale: "The resource is not released.",
      evidence: ["src/main.ts:7"],
      suggestedNextAction: "Release it in finally.",
      source,
    }

    expect(FindingSchema.safeParse({ ...base, confidence: 0.9 }).success).toBe(true)
    expect(FindingSchema.safeParse({ ...base, confidence: Number.NaN }).success).toBe(false)
  })
})
