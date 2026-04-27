import { describe, expect, test } from "bun:test"
import { applyPolicyFilter } from "../../src/quality/policy-filter"
import type { Finding } from "../../src/quality/finding"
import type { PolicyRules } from "../../src/quality/policy"

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    schemaVersion: 1,
    findingId: "0123456789abcdef",
    workflow: "review",
    category: "bug",
    severity: "HIGH",
    summary: "Off-by-one in pagination loop",
    file: "src/server/routes/list.ts",
    anchor: { kind: "line", line: 42 },
    rationale: "Loop runs n+1 times when limit equals total.",
    evidence: ["src/server/routes/list.ts:42"],
    suggestedNextAction: "Use `<` instead of `<=`.",
    source: { tool: "review", version: "4.x.x", runId: "ses_test" },
    ...overrides,
  }
}

describe("applyPolicyFilter", () => {
  test("returns input unchanged when rules is undefined", () => {
    const findings = [makeFinding()]
    const result = applyPolicyFilter(findings, undefined)
    expect(result.kept).toEqual(findings)
    expect(result.dropped).toEqual([])
    expect(result.warnings).toEqual([])
  })

  test("severity_floor drops findings below the floor", () => {
    const rules: PolicyRules = { severity_floor: "MEDIUM" }
    const findings = [
      makeFinding({ severity: "CRITICAL", findingId: "aaaaaaaaaaaaaaaa" }),
      makeFinding({ severity: "HIGH", findingId: "bbbbbbbbbbbbbbbb" }),
      makeFinding({ severity: "MEDIUM", findingId: "cccccccccccccccc" }),
      makeFinding({ severity: "LOW", findingId: "dddddddddddddddd" }),
      makeFinding({ severity: "INFO", findingId: "eeeeeeeeeeeeeeee" }),
    ]
    const result = applyPolicyFilter(findings, rules)
    expect(result.kept).toHaveLength(3) // CRITICAL, HIGH, MEDIUM
    expect(result.kept.map((f) => f.severity)).toEqual(["CRITICAL", "HIGH", "MEDIUM"])
    expect(result.dropped).toHaveLength(2) // LOW, INFO
    expect(result.dropped[0].reasons[0]).toContain("severity LOW below floor MEDIUM")
  })

  test("prohibited_categories drops findings in the listed categories", () => {
    const rules: PolicyRules = { prohibited_categories: ["regression_risk", "behavior_change"] }
    const findings = [
      makeFinding({ category: "bug", findingId: "1111111111111111" }),
      makeFinding({ category: "regression_risk", findingId: "2222222222222222" }),
      makeFinding({ category: "behavior_change", findingId: "3333333333333333" }),
      makeFinding({ category: "security", findingId: "4444444444444444" }),
    ]
    const result = applyPolicyFilter(findings, rules)
    expect(result.kept).toHaveLength(2) // bug, security
    expect(result.dropped).toHaveLength(2)
    expect(result.dropped[0].reasons[0]).toContain("category regression_risk is prohibited")
  })

  test("scope_glob keeps only findings whose file matches at least one pattern", () => {
    const rules: PolicyRules = { scope_glob: ["src/**", "test/**"] }
    const findings = [
      makeFinding({ file: "src/foo.ts", findingId: "1111111111111111" }),
      makeFinding({ file: "test/bar.test.ts", findingId: "2222222222222222" }),
      makeFinding({ file: "scripts/build.ts", findingId: "3333333333333333" }),
      makeFinding({ file: "README.md", findingId: "4444444444444444" }),
    ]
    const result = applyPolicyFilter(findings, rules)
    expect(result.kept.map((f) => f.file)).toEqual(["src/foo.ts", "test/bar.test.ts"])
    expect(result.dropped).toHaveLength(2)
    expect(result.dropped[0].reasons[0]).toContain("not matched by scope_glob")
  })

  test("a single finding can be dropped for multiple reasons (all collected)", () => {
    const rules: PolicyRules = {
      severity_floor: "HIGH",
      prohibited_categories: ["regression_risk"],
    }
    const finding = makeFinding({ severity: "LOW", category: "regression_risk" })
    const result = applyPolicyFilter([finding], rules)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0].reasons).toHaveLength(2)
    expect(result.dropped[0].reasons.some((r) => r.includes("severity"))).toBe(true)
    expect(result.dropped[0].reasons.some((r) => r.includes("category"))).toBe(true)
  })

  test("required_categories emits a warning when a required category is absent from kept findings", () => {
    const rules: PolicyRules = { required_categories: ["bug", "security"] }
    const findings = [
      makeFinding({ category: "bug", findingId: "1111111111111111" }),
      // no security
    ]
    const result = applyPolicyFilter(findings, rules)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("security")
  })

  test("required_categories emits no warning when all required categories are present", () => {
    const rules: PolicyRules = { required_categories: ["bug", "security"] }
    const findings = [
      makeFinding({ category: "bug", findingId: "1111111111111111" }),
      makeFinding({ category: "security", findingId: "2222222222222222" }),
    ]
    const result = applyPolicyFilter(findings, rules)
    expect(result.warnings).toEqual([])
  })

  test("required_categories considers only kept findings (post-filter, not pre)", () => {
    // bug is required, but the only bug finding is below severity floor — so
    // the "required" check should still warn that bug is missing from kept.
    const rules: PolicyRules = {
      required_categories: ["bug"],
      severity_floor: "HIGH",
    }
    const findings = [
      makeFinding({ category: "bug", severity: "LOW", findingId: "1111111111111111" }),
    ]
    const result = applyPolicyFilter(findings, rules)
    expect(result.kept).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
    expect(result.warnings[0]).toContain("bug")
  })

  test("an empty rules object is a no-op (preserves all findings)", () => {
    const findings = [makeFinding(), makeFinding({ severity: "INFO" })]
    const result = applyPolicyFilter(findings, {})
    expect(result.kept).toHaveLength(2)
    expect(result.dropped).toEqual([])
  })

  test("input array is not mutated", () => {
    const findings = [makeFinding(), makeFinding({ severity: "LOW" })]
    const rules: PolicyRules = { severity_floor: "MEDIUM" }
    const before = JSON.stringify(findings)
    applyPolicyFilter(findings, rules)
    expect(JSON.stringify(findings)).toBe(before)
  })
})
