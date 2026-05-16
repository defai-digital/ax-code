import { describe, expect, test } from "bun:test"
import { renderJson, renderTerminal } from "../../src/quality/finding-render"
import type { Finding } from "../../src/quality/finding"
import type { VerificationEnvelope } from "../../src/quality/verification-envelope"

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
    evidence: ["src/server/routes/list.ts:42 - condition uses <= instead of <"],
    suggestedNextAction: "Change condition to `<` and add a regression test.",
    source: { tool: "review", version: "4.1.0", runId: "ses_abc" },
    ...overrides,
  }
}

describe("renderTerminal", () => {
  test('returns "No findings." for an empty list', () => {
    expect(renderTerminal([])).toBe("No findings.")
  })

  test("includes summary, file:line, rationale, evidence, and suggestedNextAction", () => {
    const out = renderTerminal([makeFinding()])
    expect(out).toContain("Off-by-one in pagination loop")
    expect(out).toContain("src/server/routes/list.ts:42")
    expect(out).toContain("Loop runs n+1 times")
    expect(out).toContain("condition uses <= instead of <")
    expect(out).toContain("Change condition to `<`")
  })

  test("renders symbol anchors with the symbol id", () => {
    const out = renderTerminal([makeFinding({ anchor: { kind: "symbol", symbolId: "node://src/foo.ts#bar" } })])
    expect(out).toContain("node://src/foo.ts#bar")
  })

  test("renders endLine ranges when present", () => {
    const out = renderTerminal([makeFinding({ anchor: { kind: "line", line: 10, endLine: 14 } })])
    expect(out).toContain("src/server/routes/list.ts:10-14")
  })

  test("emits no ANSI escapes when color is disabled", () => {
    const out = renderTerminal([makeFinding()], { color: false })
    expect(out).not.toMatch(/\x1b\[/)
  })

  test("emits ANSI escapes when color is enabled", () => {
    const out = renderTerminal([makeFinding()], { color: true })
    expect(out).toMatch(/\x1b\[/)
  })

  test("groups by severity by default and ranks CRITICAL above HIGH above MEDIUM", () => {
    const out = renderTerminal([
      makeFinding({ severity: "MEDIUM", summary: "med" }),
      makeFinding({ severity: "CRITICAL", summary: "crit" }),
      makeFinding({ severity: "HIGH", summary: "high" }),
    ])
    const critIndex = out.indexOf("crit")
    const highIndex = out.indexOf("high")
    const medIndex = out.indexOf("med")
    expect(critIndex).toBeLessThan(highIndex)
    expect(highIndex).toBeLessThan(medIndex)
  })

  test("group=none does not emit a section header", () => {
    const out = renderTerminal([makeFinding()], { group: "none" })
    expect(out).not.toContain("──")
  })

  test("group=file produces one header per file", () => {
    const out = renderTerminal(
      [makeFinding({ file: "src/a.ts", summary: "a-issue" }), makeFinding({ file: "src/b.ts", summary: "b-issue" })],
      { group: "file" },
    )
    expect(out).toContain("src/a.ts")
    expect(out).toContain("src/b.ts")
  })

  test("is deterministic for the same input (pure function)", () => {
    const findings = [makeFinding(), makeFinding({ severity: "LOW", summary: "low one" })]
    expect(renderTerminal(findings)).toBe(renderTerminal(findings))
  })

  test("emits confidence and ruleId lines only when present", () => {
    const without = renderTerminal([makeFinding()])
    expect(without).not.toContain("confidence:")
    expect(without).not.toContain("rule:")
    const withBoth = renderTerminal([makeFinding({ confidence: 0.7, ruleId: "axcode:rule-x" })])
    expect(withBoth).toContain("confidence: 0.70")
    expect(withBoth).toContain("rule: axcode:rule-x")
  })

  test("evidenceRefs verification entries expand to a one-line envelope summary when envelopes are passed", () => {
    const envelope: VerificationEnvelope = {
      schemaVersion: 1,
      workflow: "qa",
      scope: { kind: "file", paths: ["src/foo.ts"] },
      command: { runner: "typecheck", argv: [], cwd: "/tmp" },
      result: {
        name: "typecheck",
        type: "typecheck",
        passed: false,
        status: "failed",
        issues: [],
        duration: 0,
      },
      structuredFailures: [
        { kind: "typecheck", file: "src/foo.ts", line: 10, column: 4, code: "TS2322", message: "type mismatch" },
      ],
      artifactRefs: [],
      source: { tool: "refactor_apply", version: "4.x.x", runId: "ses_test" },
    }
    const out = renderTerminal([makeFinding({ evidenceRefs: [{ kind: "verification", id: "envelope-id-1" }] })], {
      envelopes: new Map([["envelope-id-1", envelope]]),
    })
    expect(out).toContain("verified by: typecheck ✗ src/foo.ts:10 TS2322")
  })

  test("evidenceRefs verification entries fall back to plain '<kind>: <id>' when envelopes lookup is missing", () => {
    const out = renderTerminal([makeFinding({ evidenceRefs: [{ kind: "verification", id: "envelope-id-2" }] })])
    expect(out).toContain("verification: envelope-id-2")
    expect(out).not.toContain("verified by:")
  })

  test("non-verification evidenceRefs render as plain '<kind>: <id>'", () => {
    const out = renderTerminal([
      makeFinding({
        evidenceRefs: [
          { kind: "log", id: "log-id-1" },
          { kind: "graph", id: "graph-id-1" },
          { kind: "diff", id: "diff-id-1" },
        ],
      }),
    ])
    expect(out).toContain("log: log-id-1")
    expect(out).toContain("graph: graph-id-1")
    expect(out).toContain("diff: diff-id-1")
  })

  test("verification with passed status uses ✓ glyph in summary", () => {
    const passed: VerificationEnvelope = {
      schemaVersion: 1,
      workflow: "qa",
      scope: { kind: "workspace" },
      command: { runner: "lint", argv: [], cwd: "/tmp" },
      result: {
        name: "lint",
        type: "lint",
        passed: true,
        status: "passed",
        issues: [],
        duration: 0,
      },
      structuredFailures: [],
      artifactRefs: [],
      source: { tool: "refactor_apply", version: "4.x.x", runId: "ses_test" },
    }
    const out = renderTerminal([makeFinding({ evidenceRefs: [{ kind: "verification", id: "ok-1" }] })], {
      envelopes: new Map([["ok-1", passed]]),
    })
    expect(out).toContain("verified by: lint ✓")
  })
})

describe("renderJson", () => {
  test("produces parseable JSON that round-trips", () => {
    const findings = [makeFinding(), makeFinding({ severity: "LOW" })]
    const text = renderJson(findings)
    const parsed = JSON.parse(text)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].findingId).toBe(findings[0].findingId)
  })

  test("indents with two spaces", () => {
    const text = renderJson([makeFinding()])
    expect(text).toMatch(/^\[\n {2}\{\n {4}"schemaVersion"/)
  })
})
