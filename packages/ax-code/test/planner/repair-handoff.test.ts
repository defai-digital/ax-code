import { describe, expect, test } from "bun:test"
import { briefFromFailure, shouldHandoff } from "../../src/planner/verification/repair-handoff"
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
    ...overrides,
  }
}

describe("shouldHandoff", () => {
  test("returns true for a localised typecheck failure with default policy", () => {
    const decision = shouldHandoff(envelope())
    expect(decision.handoff).toBe(true)
  })

  test("returns false when status is 'passed' (default allows only 'failed')", () => {
    const decision = shouldHandoff(
      envelope({
        result: { name: "tc", type: "typecheck", passed: true, status: "passed", issues: [], duration: 0 },
      }),
    )
    expect(decision.handoff).toBe(false)
    expect(decision.reasoning).toContain("status passed")
  })

  test("returns false when status is 'error' under default policy (infra issue, not code)", () => {
    const decision = shouldHandoff(
      envelope({
        result: { name: "tc", type: "typecheck", passed: false, status: "error", issues: [], duration: 0 },
      }),
    )
    expect(decision.handoff).toBe(false)
  })

  test("caller can opt into 'error' / 'timeout' via allowedStatuses", () => {
    const decision = shouldHandoff(
      envelope({
        result: { name: "tc", type: "typecheck", passed: false, status: "timeout", issues: [], duration: 0 },
      }),
      { allowedStatuses: ["failed", "timeout"] },
    )
    expect(decision.handoff).toBe(true)
  })

  test("returns false when runner is not in allowedRunners", () => {
    const decision = shouldHandoff(envelope(), { allowedRunners: ["lint", "test"] })
    expect(decision.handoff).toBe(false)
    expect(decision.reasoning).toContain("not in allowedRunners")
  })

  test("returns false when there are no structured failures (raw output only)", () => {
    const decision = shouldHandoff(envelope({ structuredFailures: [] }))
    expect(decision.handoff).toBe(false)
    expect(decision.reasoning).toContain("no structured failures")
  })

  test("returns false when failure count exceeds maxFailures (too broad to repair)", () => {
    const many: VerificationEnvelope["structuredFailures"] = Array.from({ length: 30 }, (_, i) => ({
      kind: "typecheck" as const,
      file: `src/file${i}.ts`,
      line: 1,
      code: "TS2322",
      message: "type mismatch",
    }))
    const decision = shouldHandoff(envelope({ structuredFailures: many }), { maxFailures: 25 })
    expect(decision.handoff).toBe(false)
    expect(decision.reasoning).toContain("too broad")
  })

  test("respects custom maxFailures", () => {
    const five: VerificationEnvelope["structuredFailures"] = Array.from({ length: 5 }, (_, i) => ({
      kind: "lint" as const,
      file: `src/f${i}.ts`,
      line: 1,
      rule: "no-unused-vars",
      severity: "error" as const,
      message: "unused",
    }))
    const accept = shouldHandoff(
      envelope({
        command: { runner: "lint", argv: [], cwd: "/tmp" },
        structuredFailures: five,
      }),
      { maxFailures: 5 },
    )
    expect(accept.handoff).toBe(true)

    const reject = shouldHandoff(
      envelope({
        command: { runner: "lint", argv: [], cwd: "/tmp" },
        structuredFailures: five,
      }),
      { maxFailures: 4 },
    )
    expect(reject.handoff).toBe(false)
  })
})

describe("briefFromFailure", () => {
  test("includes runner, status, scope, and a list of failures", () => {
    const brief = briefFromFailure(envelope())
    expect(brief).toContain("typecheck (failed)")
    expect(brief).toContain("Workflow: qa")
    expect(brief).toContain("Scope: file (src/foo.ts)")
    expect(brief).toContain("Failures: 1")
    expect(brief).toContain("src/foo.ts:10:4 TS2322")
  })

  test("includes raw output truncated to first 30 lines", () => {
    const longOutput = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n")
    const brief = briefFromFailure(envelope({ result: { ...envelope().result, output: longOutput } }))
    expect(brief).toContain("Raw output (first 30 lines):")
    expect(brief).toContain("line 1")
    expect(brief).toContain("line 30")
    expect(brief).not.toContain("line 31")
  })

  test("formats lint failures with rule and severity", () => {
    const brief = briefFromFailure(
      envelope({
        command: { runner: "lint", argv: [], cwd: "/tmp" },
        structuredFailures: [
          { kind: "lint", file: "src/a.ts", line: 5, rule: "no-unused-vars", severity: "error", message: "unused 'x'" },
        ],
      }),
    )
    expect(brief).toContain("src/a.ts:5 [error] no-unused-vars: unused 'x'")
  })

  test("formats test failures with framework and test name", () => {
    const brief = briefFromFailure(
      envelope({
        command: { runner: "test", argv: [], cwd: "/tmp" },
        structuredFailures: [
          { kind: "test", framework: "bun:test", testName: "auth > rejects expired token" },
        ],
      }),
    )
    expect(brief).toContain("bun:test: auth > rejects expired token")
  })

  test("ends with a tight repair guidance footer", () => {
    const brief = briefFromFailure(envelope())
    expect(brief).toContain("Repair guidance:")
    expect(brief).toContain("fix only the listed failures")
    expect(brief).toContain("Do not refactor surrounding code")
  })
})
