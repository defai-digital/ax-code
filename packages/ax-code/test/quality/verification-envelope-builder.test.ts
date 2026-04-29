import { describe, expect, test } from "bun:test"
import type { DebugEngine } from "../../src/debug-engine"
import { fromRefactorApplyResult, fromVerificationCommandResult } from "../../src/quality/verification-envelope-builder"
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

  test("structuredFailures is empty when error strings don't match any known format", () => {
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

  test("typecheck structuredFailures populated when output matches the TS error pattern", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: {
            ok: false,
            errors: [
              "src/foo.ts(10,4): error TS2322: Type 'string' is not assignable to type 'number'.",
              "src/bar.ts(42,1): error TS7006: Parameter 'x' implicitly has an 'any' type.",
            ],
          },
          lint: { ok: true, errors: [] },
          tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
        },
      }),
      ...baseInput,
    })
    const tc = envs.find((e) => e.command.runner === "typecheck")!
    expect(tc.structuredFailures).toHaveLength(2)
    expect(tc.structuredFailures[0]).toEqual({
      kind: "typecheck",
      file: "src/foo.ts",
      line: 10,
      column: 4,
      code: "TS2322",
      message: "Type 'string' is not assignable to type 'number'.",
    })
    expect(tc.structuredFailures[1]).toMatchObject({
      kind: "typecheck",
      file: "src/bar.ts",
      line: 42,
      column: 1,
      code: "TS7006",
    })
  })

  test("typecheck structuredFailures skips lines that don't match the pattern", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: {
            ok: false,
            errors: [
              "Some prelude line that is not a TS error",
              "src/foo.ts(10,4): error TS2322: Type 'string' is not assignable to type 'number'.",
              "Found 1 error in 1 file.",
            ],
          },
          lint: { ok: true, errors: [] },
          tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
        },
      }),
      ...baseInput,
    })
    const tc = envs.find((e) => e.command.runner === "typecheck")!
    expect(tc.structuredFailures).toHaveLength(1)
    expect(tc.structuredFailures[0]).toMatchObject({
      file: "src/foo.ts",
      line: 10,
      code: "TS2322",
    })
  })

  test("typecheck structuredFailures is [] when typecheck passed (no errors)", () => {
    const envs = fromRefactorApplyResult({ applyResult: applyResult(), ...baseInput })
    const tc = envs.find((e) => e.command.runner === "typecheck")!
    expect(tc.structuredFailures).toEqual([])
  })

  test("lint structuredFailures populated when ESLint compact output matches", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: { ok: true, errors: [] },
          lint: {
            ok: false,
            errors: [
              "src/foo.ts:10:5: 'foo' is assigned a value but never used (no-unused-vars)",
              "src/bar.ts:42:1: warning - missing semicolon (semi)",
            ],
          },
          tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
        },
      }),
      ...baseInput,
    })
    const lint = envs.find((e) => e.command.runner === "lint")!
    expect(lint.structuredFailures).toHaveLength(2)
    expect(lint.structuredFailures[0]).toEqual({
      kind: "lint",
      file: "src/foo.ts",
      line: 10,
      rule: "no-unused-vars",
      severity: "error",
      message: "'foo' is assigned a value but never used",
    })
    expect(lint.structuredFailures[1]).toMatchObject({
      file: "src/bar.ts",
      line: 42,
      rule: "semi",
      severity: "warning",
    })
  })

  test("test structuredFailures populated when bun:test fail headers match", () => {
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
            failures: ["(fail) describe > should pass [0.08ms]", "(fail) auth > rejects expired token [12ms]"],
            selection: "targeted",
          },
        },
      }),
      ...baseInput,
    })
    const tests = envs.find((e) => e.command.runner === "test")!
    expect(tests.structuredFailures).toHaveLength(2)
    expect(tests.structuredFailures[0]).toEqual({
      kind: "test",
      framework: "bun:test",
      testName: "describe > should pass",
    })
    expect(tests.structuredFailures[1]).toMatchObject({
      kind: "test",
      framework: "bun:test",
      testName: "auth > rejects expired token",
    })
  })

  test("lint/test structuredFailures stay empty when output doesn't match supported formats", () => {
    const envs = fromRefactorApplyResult({
      applyResult: applyResult({
        checks: {
          typecheck: { ok: true, errors: [] },
          lint: {
            ok: false,
            // ESLint stylish format — multi-line, intentionally NOT supported
            errors: ["/path/to/file.ts\n  10:5  error  'foo' is unused  no-unused-vars"],
          },
          tests: {
            ok: false,
            errors: [],
            ran: 1,
            failed: 1,
            // jest format — intentionally NOT supported in v1
            failures: ["● describe > should pass\n\nExpected: 1\nReceived: 0"],
            selection: "targeted",
          },
        },
      }),
      ...baseInput,
    })
    const lint = envs.find((e) => e.command.runner === "lint")!
    const tests = envs.find((e) => e.command.runner === "test")!
    expect(lint.structuredFailures).toEqual([])
    expect(tests.structuredFailures).toEqual([])
    // raw output is still preserved for human inspection
    expect(lint.result.output).toContain("no-unused-vars")
    expect(tests.result.output).toContain("Received: 0")
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

describe("fromVerificationCommandResult", () => {
  test("returns citable envelopes for a general verification run", () => {
    const envs = fromVerificationCommandResult({
      workflow: "review",
      sessionID: "ses_verify",
      cwd: "/tmp/work",
      sourceTool: "verify_project",
      scope: { kind: "file", paths: ["src/foo.ts"] },
      commands: {
        typecheck: "bun run typecheck",
        lint: null,
        test: null,
      },
      checks: {
        typecheck: {
          ok: false,
          skipped: false,
          errors: ["src/foo.ts(10,4): error TS2322: Type 'string' is not assignable to type 'number'."],
          duration: 25,
        },
        lint: { ok: true, skipped: true, errors: [], duration: 0 },
        tests: {
          ok: true,
          skipped: true,
          errors: [],
          ran: 0,
          failed: 0,
          failures: [],
          selection: "skipped",
          duration: 0,
        },
      },
    })

    expect(envs).toHaveLength(3)
    for (const env of envs) expect(() => VerificationEnvelopeSchema.parse(env)).not.toThrow()

    const typecheck = envs.find((env) => env.result.name === "typecheck")!
    expect(typecheck.workflow).toBe("review")
    expect(typecheck.command).toEqual({
      runner: "typecheck",
      argv: ["sh", "-c", "bun run typecheck"],
      cwd: "/tmp/work",
    })
    expect(typecheck.result.status).toBe("failed")
    expect(typecheck.result.duration).toBe(25)
    expect(typecheck.source.tool).toBe("verify_project")
    expect(typecheck.source.version).toBe(Installation.VERSION)
    expect(typecheck.source.runId).toBe("ses_verify")
    expect(typecheck.structuredFailures).toHaveLength(1)

    const lint = envs.find((env) => env.result.name === "lint")!
    expect(lint.result.status).toBe("skipped")
    expect(lint.command.argv).toEqual([])
  })

  test("uses timeout status when the runner reports a timed-out command", () => {
    const envs = fromVerificationCommandResult({
      workflow: "qa",
      sessionID: "ses_timeout",
      cwd: "/tmp/work",
      sourceTool: "verify_project",
      scope: { kind: "workspace" },
      commands: { typecheck: "bun run typecheck", lint: null, test: null },
      checks: {
        typecheck: {
          ok: false,
          skipped: false,
          timedOut: true,
          errors: ["typecheck command timed out after 300000ms"],
        },
        lint: { ok: true, skipped: true, errors: [] },
        tests: {
          ok: true,
          skipped: true,
          errors: [],
          ran: 0,
          failed: 0,
          failures: [],
          selection: "skipped",
        },
      },
    })

    expect(envs[0].result.status).toBe("timeout")
    expect(envs[0].result.passed).toBe(false)
  })
})
