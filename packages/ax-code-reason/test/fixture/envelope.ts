import type { StructuredFailure, VerificationEnvelope } from "../../src/quality/verification-envelope"

// Shared envelope builder for verification-related tests. Produces a
// schema-valid v1 envelope; overrides are shallow per-section.

export type EnvelopeOverrides = {
  status?: VerificationEnvelope["result"]["status"]
  passed?: boolean
  duration?: number
  output?: string
  structuredFailures?: StructuredFailure[]
  runId?: string
  name?: string
}

export function makeEnvelope(overrides: EnvelopeOverrides = {}): VerificationEnvelope {
  const status = overrides.status ?? "passed"
  return {
    schemaVersion: 1,
    workflow: "debug",
    scope: { kind: "package", paths: ["packages/ax-code-reason"] },
    command: { runner: "pnpm", argv: ["pnpm", "test"], cwd: "/repo" },
    result: {
      name: overrides.name ?? "test",
      type: "test",
      passed: overrides.passed ?? status === "passed",
      status,
      issues: [],
      duration: overrides.duration ?? 12,
      output: overrides.output,
    },
    structuredFailures: overrides.structuredFailures ?? [],
    artifactRefs: [],
    source: { tool: "verify_project", version: "7.7.8", runId: overrides.runId ?? "run-1" },
  }
}
