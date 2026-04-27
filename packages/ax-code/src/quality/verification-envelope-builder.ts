import type { DebugEngine } from "../debug-engine"
import { Installation } from "../installation"
import { type StructuredFailure, type VerificationEnvelope, VerificationEnvelopeSchema } from "./verification-envelope"

// Pure converter: legacy refactor_apply check shape → VerificationEnvelope[].
//
// refactor_apply currently returns DebugEngine.ApplyResult.checks =
// { typecheck: CheckResult, lint: CheckResult, tests: TestResult }. CheckResult
// flattens errors to string[] which loses file/line/code structure. This
// converter produces one envelope per check kind with what we have today;
// structuredFailures is intentionally [] in v1 because the source data
// doesn't carry the per-failure fields the schema requires. A later slice
// can parse the error strings (mirroring planner/verification's
// parseTypeScriptErrors) to populate them.

export type FromRefactorApplyInput = {
  applyResult: DebugEngine.ApplyResult
  sessionID: string
  cwd: string
}

function checkStatus(ok: boolean): "passed" | "failed" {
  return ok ? "passed" : "failed"
}

function joinErrors(errors: readonly string[]): string | undefined {
  if (errors.length === 0) return undefined
  return errors.join("\n")
}

function structuredFailuresFromCheck(_kind: "typecheck" | "lint" | "test"): StructuredFailure[] {
  // v1: refactor_apply emits raw error strings only. A follow-up slice will
  // parse them (TS error pattern, ESLint output, test framework markers)
  // into typed StructuredFailure entries.
  return []
}

function source(sessionID: string) {
  return {
    tool: "refactor_apply",
    version: Installation.VERSION,
    runId: sessionID,
  }
}

function commonScope(applyResult: DebugEngine.ApplyResult) {
  if (applyResult.filesChanged.length === 0) {
    return { kind: "workspace" as const }
  }
  return { kind: "file" as const, paths: [...applyResult.filesChanged] }
}

function envelopeForTypecheck(input: FromRefactorApplyInput): VerificationEnvelope {
  const check = input.applyResult.checks.typecheck
  return VerificationEnvelopeSchema.parse({
    schemaVersion: 1,
    workflow: "qa",
    scope: commonScope(input.applyResult),
    command: { runner: "typecheck", argv: [], cwd: input.cwd },
    result: {
      name: "typecheck",
      type: "typecheck",
      passed: check.ok,
      status: checkStatus(check.ok),
      issues: [],
      duration: 0,
      output: joinErrors(check.errors),
    },
    structuredFailures: structuredFailuresFromCheck("typecheck"),
    artifactRefs: [],
    source: source(input.sessionID),
  })
}

function envelopeForLint(input: FromRefactorApplyInput): VerificationEnvelope {
  const check = input.applyResult.checks.lint
  return VerificationEnvelopeSchema.parse({
    schemaVersion: 1,
    workflow: "qa",
    scope: commonScope(input.applyResult),
    command: { runner: "lint", argv: [], cwd: input.cwd },
    result: {
      name: "lint",
      type: "lint",
      passed: check.ok,
      status: checkStatus(check.ok),
      issues: [],
      duration: 0,
      output: joinErrors(check.errors),
    },
    structuredFailures: structuredFailuresFromCheck("lint"),
    artifactRefs: [],
    source: source(input.sessionID),
  })
}

function envelopeForTests(input: FromRefactorApplyInput): VerificationEnvelope {
  const tests = input.applyResult.checks.tests
  const status = tests.selection === "skipped" ? "skipped" : checkStatus(tests.ok)
  return VerificationEnvelopeSchema.parse({
    schemaVersion: 1,
    workflow: "qa",
    scope: commonScope(input.applyResult),
    command: { runner: "test", argv: [], cwd: input.cwd },
    result: {
      name: "tests",
      type: "test",
      passed: tests.ok,
      status,
      issues: [],
      duration: 0,
      output: joinErrors(tests.failures),
    },
    structuredFailures: structuredFailuresFromCheck("test"),
    artifactRefs: [],
    source: source(input.sessionID),
  })
}

export function fromRefactorApplyResult(input: FromRefactorApplyInput): VerificationEnvelope[] {
  return [envelopeForTypecheck(input), envelopeForLint(input), envelopeForTests(input)]
}
