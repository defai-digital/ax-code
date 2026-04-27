import { describe, expect, test } from "bun:test"
import type { DebugEngine } from "../../src/debug-engine"
import { fromRefactorApplyResult } from "../../src/quality/verification-envelope-builder"
import { VerificationEnvelopeSchema } from "../../src/quality/verification-envelope"
import { Installation } from "../../src/installation"

function applyResult(overrides: Partial<DebugEngine.ApplyResult> = {}): DebugEngine.ApplyResult {
  return {
    applied: true,
    planId: "plan_test" as DebugEngine.ApplyResult["planId"],
    checks: {
      typecheck: { ok: true, errors: [] },
      lint: { ok: true, errors: [] },
      tests: { ok: true, errors: [], ran: 12, failed: 0, failures: [], selection: "targeted" },
    },
    filesChanged: ["src/foo.ts"],
    rolledBack: false,
    abortReason: null,
    explain: { tool: "refactor_apply", queryId: "q1", graphQueries: [], heuristicsApplied: [] } as any,
    ...overrides,
  }
}

const baseInput = {
  sessionID: "ses_test",
  cwd: "/tmp/work",
}

describe("fromRefactorApplyResult", () => {
  test("returns three envelopes (typecheck, lint, tests) on a clean run", () => {
    const envs = fromRefactorApplyResult({ applyResult: applyResult(), ...baseInput })
    expect(envs).toHaveLength(3)
    expect(envs.map((e) => e.command.runner)).toEqual(["typecheck", "lint", "test"])
    expect(envs.every((e) => e.workflow === "qa")).toBe(true)
  })

  test("each envelope parses against VerificationEnvelopeSchema", () => {
    const envs = fromRefactorApplyResult({ applyResult: applyResult(), ...baseInput })
    for (const env of envs) {
      expect(() => VerificationEnvelopeSchema.parse(env)).not.toThrow()
    }
  })

  test("typecheck.ok=true → status passed; ok=false → status failed", () => {
    const passing = fromRefactorApplyResult({ applyResult: applyResult(), ...baseInput })
    expect(passing[0].result.status).toBe("passed")
    expect(passing[0].result.passed).toBe(true)

    const failing = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: { ok: false, errors: ["src/foo.ts(1,1): error TS2322: ..."] },
          lint: { ok: true, errors: [] },
          tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
        },
      }),
      ...baseInput,
    })
    expect(failing[0].result.status).toBe("failed")
    expect(failing[0].result.passed).toBe(false)
    expect(failing[0].result.output).toContain("TS2322")
  })

  test("tests.selection='skipped' produces status='skipped' regardless of ok flag", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: { ok: true, errors: [] },
          lint: { ok: true, errors: [] },
          tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
        },
      }),
      ...baseInput,
    })
    const tests = envs.find((e) => e.command.runner === "test")!
    expect(tests.result.status).toBe("skipped")
  })

  test("structuredFailures is empty in v1 (placeholder for future error parsing)", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: { ok: false, errors: ["a", "b", "c"] },
          lint: { ok: false, errors: ["x"] },
          tests: { ok: false, errors: [], ran: 5, failed: 2, failures: ["t1", "t2"], selection: "targeted" },
        },
      }),
      ...baseInput,
    })
    for (const env of envs) {
      expect(env.structuredFailures).toEqual([])
    }
  })

  test("scope.kind=workspace when filesChanged is empty (preflight-only run)", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({ applied: false, filesChanged: [] }),
      ...baseInput,
    })
    for (const env of envs) {
      expect(env.scope.kind).toBe("workspace")
      expect(env.scope.paths).toBeUndefined()
    }
  })

  test("scope.kind=file with paths when filesChanged is populated", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({ filesChanged: ["src/a.ts", "src/b.ts"] }),
      ...baseInput,
    })
    for (const env of envs) {
      expect(env.scope.kind).toBe("file")
      expect(env.scope.paths).toEqual(["src/a.ts", "src/b.ts"])
    }
  })

  test("source.tool='refactor_apply', version=Installation.VERSION, runId=sessionID", () => {
    const envs = fromRefactorApplyResult({ applyResult: applyResult(), ...baseInput })
    for (const env of envs) {
      expect(env.source.tool).toBe("refactor_apply")
      expect(env.source.version).toBe(Installation.VERSION)
      expect(env.source.runId).toBe("ses_test")
    }
  })

  test("command.cwd is taken from input cwd verbatim", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult(),
      sessionID: "ses_x",
      cwd: "/some/other/path",
    })
    for (const env of envs) {
      expect(env.command.cwd).toBe("/some/other/path")
    }
  })

  test("output is omitted when no errors and present (joined) when errors exist", () => {
    const passing = fromRefactorApplyResult({ applyResult: applyResult(), ...baseInput })
    expect(passing[0].result.output).toBeUndefined()

    const failing = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: { ok: false, errors: ["err1", "err2"] },
          lint: { ok: true, errors: [] },
          tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
        },
      }),
      ...baseInput,
    })
    expect(failing[0].result.output).toBe("err1\nerr2")
  })

  test("test envelope output joins TestResult.failures (not errors)", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: { ok: true, errors: [] },
          lint: { ok: true, errors: [] },
          tests: {
            ok: false,
            errors: [],
            ran: 5,
            failed: 2,
            failures: ["test/foo > should pass", "test/bar > should also pass"],
            selection: "targeted",
          },
        },
      }),
      ...baseInput,
    })
    const tests = envs.find((e) => e.command.runner === "test")!
    expect(tests.result.output).toContain("test/foo")
    expect(tests.result.output).toContain("test/bar")
  })
})
