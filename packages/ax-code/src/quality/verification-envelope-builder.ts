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

// Mirrors the regex in src/planner/verification/index.ts parseTypeScriptErrors.
// Inlined here so this module stays free of node-only deps from planner/.
// Format: `file(line,col): error TSxxxx: message`
//
// String.prototype.matchAll is used (not exec + lastIndex) because the
// previous exec-with-shared-lastIndex pattern raced when concurrent
// envelope builds shared the module-scope RegExp object — each iteration
// here gets its own independent iterator.
const TS_ERROR_PATTERN = /^(.+)\((\d+),(\d+)\):\s+(?:error|warning)\s+(TS\d+):\s+(.+)$/gm

function parseTypecheckFailures(text: string | undefined): StructuredFailure[] {
  if (!text) return []
  const failures: StructuredFailure[] = []
  for (const match of text.matchAll(TS_ERROR_PATTERN)) {
    const [, file, line, column, code, message] = match
    failures.push({
      kind: "typecheck",
      file,
      line: Number.parseInt(line, 10),
      column: Number.parseInt(column, 10),
      code,
      message,
    })
  }
  return failures
}

// Lint and test parsing are deferred. ESLint and test-framework output formats
// vary widely; populating them prematurely would either lock in a fragile
// regex or pull in a per-formatter parser library. Until a real consumer
// needs structured lint/test failures, the envelope.result.output raw text
// is the source of truth.
function parseLintFailures(_text: string | undefined): StructuredFailure[] {
  return []
}

function parseTestFailures(_text: string | undefined): StructuredFailure[] {
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
  const output = joinErrors(check.errors)
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
      output,
    },
    structuredFailures: parseTypecheckFailures(output),
    artifactRefs: [],
    source: source(input.sessionID),
  })
}

function envelopeForLint(input: FromRefactorApplyInput): VerificationEnvelope {
  const check = input.applyResult.checks.lint
  const output = joinErrors(check.errors)
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
      output,
    },
    structuredFailures: parseLintFailures(output),
    artifactRefs: [],
    source: source(input.sessionID),
  })
}

function envelopeForTests(input: FromRefactorApplyInput): VerificationEnvelope {
  const tests = input.applyResult.checks.tests
  const status = tests.selection === "skipped" ? "skipped" : checkStatus(tests.ok)
  const output = joinErrors(tests.failures)
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
      output,
    },
    structuredFailures: parseTestFailures(output),
    artifactRefs: [],
    source: source(input.sessionID),
  })
}

export function fromRefactorApplyResult(input: FromRefactorApplyInput): VerificationEnvelope[] {
  return [envelopeForTypecheck(input), envelopeForLint(input), envelopeForTests(input)]
}
