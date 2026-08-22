import { describe, expect, test } from "vitest"
import {
  computeEnvelopeId,
  ENVELOPE_ID_PATTERN,
  VerificationEnvelopeSchema,
  verificationEnvelopesFromPayload,
} from "../src/quality/verification-envelope"
import { makeEnvelope } from "./fixture/envelope"

const source = { tool: "verify_project", version: "7.7.8", runId: "run-1" }

describe("VerificationEnvelopeSchema failure shapes", () => {
  test("accepts every result status of the v1 enum", () => {
    for (const status of ["passed", "failed", "skipped", "timeout", "error"] as const) {
      const envelope = makeEnvelope({ status, passed: status === "passed" })
      expect(VerificationEnvelopeSchema.safeParse(envelope).success).toBe(true)
    }
  })

  test("accepts every structured-failure kind", () => {
    const failures = [
      { kind: "typecheck" as const, file: "src/a.ts", line: 3, code: "TS2322", message: "type mismatch" },
      {
        kind: "lint" as const,
        file: "src/a.ts",
        line: 4,
        rule: "no-unused-vars",
        severity: "error" as const,
        message: "x",
      },
      { kind: "test" as const, testName: "does the thing", framework: "vitest" },
      { kind: "custom" as const, message: "smoke check failed", details: { exit: 1 } },
    ]
    const envelope = makeEnvelope({ status: "failed", passed: false, structuredFailures: failures })
    const parsed = VerificationEnvelopeSchema.safeParse(envelope)
    expect(parsed.success).toBe(true)
  })

  test("rejects malformed structured failures", () => {
    const base = makeEnvelope({ status: "failed", passed: false })
    // Unknown kind
    expect(
      VerificationEnvelopeSchema.safeParse({
        ...base,
        structuredFailures: [{ kind: "compile", message: "x" }],
      }).success,
    ).toBe(false)
    // typecheck failure missing its required `code`
    expect(
      VerificationEnvelopeSchema.safeParse({
        ...base,
        structuredFailures: [{ kind: "typecheck", file: "src/a.ts", line: 3, message: "x" }],
      }).success,
    ).toBe(false)
  })

  test("rejects unknown result statuses and wrong schemaVersion", () => {
    const envelope = makeEnvelope()
    expect(
      VerificationEnvelopeSchema.safeParse({
        ...envelope,
        result: { ...envelope.result, status: "unavailable" },
      }).success,
    ).toBe(false)
    expect(VerificationEnvelopeSchema.safeParse({ ...envelope, schemaVersion: 2 }).success).toBe(false)
  })
})

describe("verificationEnvelopesFromPayload", () => {
  test("extracts a single envelope", () => {
    const envelope = makeEnvelope()
    expect(verificationEnvelopesFromPayload(envelope)).toEqual([envelope])
  })

  test("extracts from arrays and the common nesting keys", () => {
    const a = makeEnvelope({ runId: "run-a" })
    const b = makeEnvelope({ runId: "run-b" })
    expect(verificationEnvelopesFromPayload([a, b])).toHaveLength(2)
    expect(verificationEnvelopesFromPayload({ envelope: a })).toEqual([a])
    expect(verificationEnvelopesFromPayload({ verificationEnvelope: a })).toEqual([a])
    expect(verificationEnvelopesFromPayload({ envelopes: [a, b] })).toHaveLength(2)
    expect(verificationEnvelopesFromPayload({ verificationEnvelopes: a })).toEqual([a])
    expect(verificationEnvelopesFromPayload({ outer: { envelope: a } })).toEqual([])
    expect(verificationEnvelopesFromPayload({ envelope: { envelope: a } })).toEqual([a])
  })

  test("returns [] for non-envelope payloads", () => {
    expect(verificationEnvelopesFromPayload(undefined)).toEqual([])
    expect(verificationEnvelopesFromPayload(null)).toEqual([])
    expect(verificationEnvelopesFromPayload("envelope")).toEqual([])
    expect(verificationEnvelopesFromPayload({ hello: "world" })).toEqual([])
    expect(verificationEnvelopesFromPayload([{ hello: "world" }])).toEqual([])
  })
})

describe("computeEnvelopeId — current whole-object hash contract", () => {
  // Phase 1 switches computeEnvelopeId to an identity projection; these
  // tests lock the CURRENT behavior (hash of the canonicalized whole
  // object) and must be revisited when that lands.

  test("same content with different key insertion order produces the same ID", () => {
    const a = makeEnvelope()
    // Rebuild with a different literal key order, including a nested object.
    const b = {
      source: a.source,
      artifactRefs: a.artifactRefs,
      structuredFailures: a.structuredFailures,
      result: {
        output: a.result.output,
        duration: a.result.duration,
        issues: a.result.issues,
        status: a.result.status,
        passed: a.result.passed,
        type: a.result.type,
        name: a.result.name,
      },
      command: { argv: a.command.argv, cwd: a.command.cwd, runner: a.command.runner },
      scope: a.scope,
      workflow: a.workflow,
      schemaVersion: a.schemaVersion,
    }
    expect(computeEnvelopeId(b)).toBe(computeEnvelopeId(a))
    expect(computeEnvelopeId(a)).toMatch(ENVELOPE_ID_PATTERN)
  })

  test("changing any hashed field — including result.duration — changes the ID", () => {
    const base = makeEnvelope()
    const id = computeEnvelopeId(base)
    expect(computeEnvelopeId(makeEnvelope({ duration: 13 }))).not.toBe(id)
    expect(computeEnvelopeId(makeEnvelope({ runId: "run-2" }))).not.toBe(id)
    expect(computeEnvelopeId(makeEnvelope({ output: "12 tests passed" }))).not.toBe(id)
  })
})
