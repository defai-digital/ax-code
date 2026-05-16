import { describe, expect, test } from "bun:test"
import {
  computeEnvelopeId,
  ENVELOPE_ID_PATTERN,
  StructuredFailureSchema,
  VerificationEnvelopeSchema,
  VerificationResultSchema,
} from "../../src/quality/verification-envelope"
import type { VerificationEnvelope } from "../../src/quality/verification-envelope"

const validResult = {
  name: "typecheck",
  type: "typecheck" as const,
  passed: false,
  status: "failed" as const,
  issues: [
    {
      file: "src/foo.ts",
      line: 10,
      column: 4,
      severity: "error" as const,
      message: "Type 'string' is not assignable to type 'number'.",
      code: "TS2322",
    },
  ],
  duration: 1234,
  output: "...",
}

const validEnvelope: VerificationEnvelope = {
  schemaVersion: 1,
  workflow: "qa",
  scope: { kind: "file", paths: ["src/foo.ts"] },
  command: { runner: "tsc", argv: ["bun", "typecheck"], cwd: "packages/ax-code" },
  result: validResult,
  structuredFailures: [
    {
      kind: "typecheck",
      file: "src/foo.ts",
      line: 10,
      column: 4,
      code: "TS2322",
      message: "Type 'string' is not assignable to type 'number'.",
    },
  ],
  artifactRefs: [{ kind: "finding", id: "0123456789abcdef" }],
  source: { tool: "qa", version: "4.1.0", runId: "ses_abc" },
}

describe("VerificationResultSchema", () => {
  test("accepts the existing planner/verification shape", () => {
    expect(() => VerificationResultSchema.parse(validResult)).not.toThrow()
  })

  test("rejects unknown status", () => {
    expect(() => VerificationResultSchema.parse({ ...validResult, status: "unknown" })).toThrow()
  })
})

describe("StructuredFailureSchema", () => {
  test("accepts each documented failure kind", () => {
    expect(() =>
      StructuredFailureSchema.parse({
        kind: "typecheck",
        file: "src/a.ts",
        line: 1,
        code: "TS1",
        message: "x",
      }),
    ).not.toThrow()
    expect(() =>
      StructuredFailureSchema.parse({
        kind: "lint",
        file: "src/a.ts",
        line: 1,
        rule: "no-unused",
        severity: "error",
        message: "x",
      }),
    ).not.toThrow()
    expect(() =>
      StructuredFailureSchema.parse({
        kind: "test",
        testName: "t",
        framework: "bun:test",
      }),
    ).not.toThrow()
    expect(() =>
      StructuredFailureSchema.parse({
        kind: "custom",
        message: "x",
      }),
    ).not.toThrow()
  })

  test("rejects unknown kind", () => {
    expect(() => StructuredFailureSchema.parse({ kind: "compile", message: "x" })).toThrow()
  })

  test("typecheck failure rejects missing required fields", () => {
    expect(() => StructuredFailureSchema.parse({ kind: "typecheck", file: "x", line: 1 })).toThrow()
  })
})

describe("VerificationEnvelopeSchema", () => {
  test("accepts a full valid envelope", () => {
    expect(() => VerificationEnvelopeSchema.parse(validEnvelope)).not.toThrow()
  })

  test("rejects schemaVersion other than 1", () => {
    expect(() => VerificationEnvelopeSchema.parse({ ...validEnvelope, schemaVersion: 2 })).toThrow()
  })

  test("rejects unknown workflow", () => {
    expect(() => VerificationEnvelopeSchema.parse({ ...validEnvelope, workflow: "lint" })).toThrow()
  })

  test("rejects unknown scope kind", () => {
    expect(() =>
      VerificationEnvelopeSchema.parse({
        ...validEnvelope,
        scope: { kind: "module" } as unknown as VerificationEnvelope["scope"],
      }),
    ).toThrow()
  })

  test("rejects unknown artifactRef kind", () => {
    expect(() =>
      VerificationEnvelopeSchema.parse({
        ...validEnvelope,
        artifactRefs: [{ kind: "metric", id: "x" }],
      }),
    ).toThrow()
  })

  test("requires structuredFailures to be an array (empty allowed)", () => {
    expect(() => VerificationEnvelopeSchema.parse({ ...validEnvelope, structuredFailures: [] })).not.toThrow()
    expect(() =>
      VerificationEnvelopeSchema.parse({
        ...validEnvelope,
        structuredFailures: undefined as unknown as VerificationEnvelope["structuredFailures"],
      }),
    ).toThrow()
  })
})

describe("computeEnvelopeId", () => {
  test("returns a 16-char lowercase hex matching ENVELOPE_ID_PATTERN", () => {
    const id = computeEnvelopeId(validEnvelope)
    expect(id).toMatch(ENVELOPE_ID_PATTERN)
    expect(id).toHaveLength(16)
  })

  test("is deterministic for identical content", () => {
    expect(computeEnvelopeId(validEnvelope)).toBe(computeEnvelopeId(validEnvelope))
  })

  test("is independent of object key insertion order (canonical JSON)", () => {
    const reordered: VerificationEnvelope = {
      source: validEnvelope.source,
      artifactRefs: validEnvelope.artifactRefs,
      structuredFailures: validEnvelope.structuredFailures,
      result: validEnvelope.result,
      command: validEnvelope.command,
      scope: validEnvelope.scope,
      workflow: validEnvelope.workflow,
      schemaVersion: validEnvelope.schemaVersion,
    }
    expect(computeEnvelopeId(reordered)).toBe(computeEnvelopeId(validEnvelope))
  })

  test("is stable across JSON persistence when optional fields are undefined", () => {
    const withUndefinedOutput = VerificationEnvelopeSchema.parse({
      ...validEnvelope,
      result: {
        ...validEnvelope.result,
        output: undefined,
      },
    })
    const persisted = JSON.parse(JSON.stringify(withUndefinedOutput)) as VerificationEnvelope

    expect(computeEnvelopeId(withUndefinedOutput)).toBe(computeEnvelopeId(persisted))
  })

  test("changes when command.runner changes", () => {
    const a = computeEnvelopeId(validEnvelope)
    const b = computeEnvelopeId({ ...validEnvelope, command: { ...validEnvelope.command, runner: "lint" } })
    expect(a).not.toBe(b)
  })

  test("changes when result.status changes", () => {
    const passing: VerificationEnvelope = {
      ...validEnvelope,
      result: { ...validEnvelope.result, passed: true, status: "passed" },
    }
    const failing: VerificationEnvelope = {
      ...validEnvelope,
      result: { ...validEnvelope.result, passed: false, status: "failed" },
    }
    expect(computeEnvelopeId(passing)).not.toBe(computeEnvelopeId(failing))
  })

  test("changes when source.runId changes (so envelopes from different sessions don't collide)", () => {
    const a = computeEnvelopeId(validEnvelope)
    const b = computeEnvelopeId({ ...validEnvelope, source: { ...validEnvelope.source, runId: "ses_other" } })
    expect(a).not.toBe(b)
  })

  test("changes when structuredFailures content changes", () => {
    const empty = computeEnvelopeId({ ...validEnvelope, structuredFailures: [] })
    const populated = computeEnvelopeId(validEnvelope) // has one structured failure
    expect(empty).not.toBe(populated)
  })

  test("identical envelopes from different runs produce different ids via runId", () => {
    const run1 = { ...validEnvelope, source: { ...validEnvelope.source, runId: "ses_1" } }
    const run2 = { ...validEnvelope, source: { ...validEnvelope.source, runId: "ses_2" } }
    expect(computeEnvelopeId(run1)).not.toBe(computeEnvelopeId(run2))
  })
})
