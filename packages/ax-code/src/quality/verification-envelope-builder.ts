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

// ESLint compact format: `<file>:<line>:<col>: <message> (<rule>)`. Other
// formatters (stylish, codeframe, json) are not parsed — projects that use
// them will see envelope.result.output preserved as raw text. To opt into
// structured failures, configure ESLint with --format compact.
const ESLINT_COMPACT_PATTERN =
  /^(.+?):(\d+):(\d+):\s*(?:(error|warning)\s*-\s*)?(.+?)\s*\(([\w-]+(?:\/[\w-]+)*)\)\s*$/gm

function parseLintFailures(text: string | undefined): StructuredFailure[] {
  if (!text) return []
  const failures: StructuredFailure[] = []
  for (const match of text.matchAll(ESLINT_COMPACT_PATTERN)) {
    const [, file, line, , severityRaw, message, rule] = match
    const severity = severityRaw === "warning" ? "warning" : "error"
    failures.push({
      kind: "lint",
      file,
      line: Number.parseInt(line, 10),
      rule,
      severity,
      message: message.trim(),
    })
  }
  return failures
}

// bun:test failure header: `(fail) <describe path> > <test name> [<duration>]`.
// We capture the path (everything between "(fail)" and the trailing duration
// bracket) and split on " > " into a describe-path. The final segment is the
// test name; everything before it is the describe chain. Other frameworks
// (jest, vitest, mocha, pytest) are not parsed — same rationale as lint.
const BUN_TEST_FAIL_PATTERN = /^\(fail\)\s+(.+?)\s*\[\d+(?:\.\d+)?(?:ms|s)\]\s*$/gm

function parseTestFailures(text: string | undefined): StructuredFailure[] {
  if (!text) return []
  const failures: StructuredFailure[] = []
  for (const match of text.matchAll(BUN_TEST_FAIL_PATTERN)) {
    const fullPath = match[1].trim()
    failures.push({
      kind: "test",
      framework: "bun:test",
      testName: fullPath,
    })
  }
  return failures
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
