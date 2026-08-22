import z from "zod"
import { sha256Hex } from "./digest"
import { ArtifactRefKindEnum, FindingSource, WorkflowEnum } from "./finding"

// VerificationEnvelope is the publishable, cross-process shape that wraps a
// runtime VerificationResult (defined in src/planner/verification/index.ts) so
// review/debug/qa workflows can attach the same envelope without each reparsing
// terminal output. The runtime VerificationResult is intentionally NOT a Zod
// schema — it lives inside the process. This envelope is what crosses session
// artifact / JSON export / future GitHub Action boundaries.

export const ScopeKindEnum = z.enum(["file", "package", "workspace", "custom"])
// "unavailable" is additive: nothing emits it yet. It reserves the state for
// verifications whose runner could not produce a result at all (e.g. the
// check environment was missing), distinct from "error" (the runner ran and
// errored) and "skipped" (the caller chose not to run).
export const VerificationStatusEnum = z.enum(["passed", "failed", "skipped", "timeout", "error", "unavailable"])
export const VerificationCheckTypeEnum = z.enum(["typecheck", "lint", "test", "custom"])

export const VerificationIssueSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(1).optional(),
  severity: z.enum(["error", "warning"]),
  message: z.string().min(1),
  code: z.string().optional(),
})

// Mirror of VerificationResult from src/planner/verification/index.ts. Kept as a
// Zod schema here so envelope export validates end-to-end.
export const VerificationResultSchema = z.object({
  name: z.string().min(1),
  type: VerificationCheckTypeEnum,
  passed: z.boolean(),
  status: VerificationStatusEnum,
  issues: z.array(VerificationIssueSchema),
  duration: z.number().min(0),
  output: z.string().optional(),
})

export const StructuredFailureSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("typecheck"),
    file: z.string().min(1),
    line: z.number().int().min(1),
    column: z.number().int().min(1).optional(),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  z.object({
    kind: z.literal("lint"),
    file: z.string().min(1),
    line: z.number().int().min(1),
    rule: z.string().min(1),
    severity: z.enum(["error", "warning"]),
    message: z.string().min(1),
  }),
  z.object({
    kind: z.literal("test"),
    testName: z.string().min(1),
    framework: z.string().min(1),
    file: z.string().optional(),
    assertion: z.string().optional(),
    stack: z.string().optional(),
  }),
  z.object({
    kind: z.literal("custom"),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
])
export type StructuredFailure = z.infer<typeof StructuredFailureSchema>

export const ArtifactRefSchema = z.object({
  kind: ArtifactRefKindEnum,
  id: z.string().min(1),
})
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>

// ─── Phase 1 provenance fields (all optional; never part of the id) ──────
//
// These record the state the verification ran against so citations can be
// classified fresh/stale at read time (see freshness.ts). They are captured
// by core at envelope-build time; envelopes produced before Phase 1 simply
// lack them, which the freshness classifier treats as "unknown".

// Git worktree state at verification time. available=false means the host
// could not fingerprint the source (non-git project, git failure) — such
// envelopes can never be classified fresh.
export const SourceStateSchema = z.object({
  available: z.boolean(),
  commit: z.string().nullable(),
  dirtyDigest: z.string().nullable(),
})
export type SourceState = z.infer<typeof SourceStateSchema>

// Code-graph state at verification time. revision is reserved for the
// derived graph revision (sha256 of cursor fields) — null until the graph
// status endpoint computes one.
export const VerificationGraphSchema = z.object({
  revision: z.string().nullable(),
  lastCommitSha: z.string().nullable(),
  indexedAt: z.number(),
})
export type VerificationGraph = z.infer<typeof VerificationGraphSchema>

export const VerificationEnvironmentSchema = z.object({
  configDigest: z.string(),
  toolVersions: z.record(z.string(), z.string()),
  commandSelectionRationale: z.string().optional(),
})
export type VerificationEnvironment = z.infer<typeof VerificationEnvironmentSchema>

export const VerificationExecutionSchema = z.object({
  startedAt: z.string(),
  endedAt: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  outputHashes: z
    .object({
      stdout: z.string(),
      stderr: z.string(),
    })
    .optional(),
  outputTruncated: z.boolean(),
})
export type VerificationExecution = z.infer<typeof VerificationExecutionSchema>

export const VerificationEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  workflow: WorkflowEnum,
  scope: z.object({
    kind: ScopeKindEnum,
    paths: z.array(z.string()).optional(),
    description: z.string().optional(),
  }),
  command: z.object({
    runner: z.string().min(1),
    argv: z.array(z.string()),
    cwd: z.string().min(1),
  }),
  result: VerificationResultSchema,
  structuredFailures: z.array(StructuredFailureSchema),
  artifactRefs: z.array(ArtifactRefSchema),
  source: FindingSource,
  sourceState: SourceStateSchema.optional(),
  graph: VerificationGraphSchema.optional(),
  environment: VerificationEnvironmentSchema.optional(),
  execution: VerificationExecutionSchema.optional(),
})
export type VerificationEnvelope = z.infer<typeof VerificationEnvelopeSchema>

// Recursively extract verification envelopes from an arbitrary payload — a
// single envelope, an array of them, or an object nesting them under the
// common keys (envelope / verificationEnvelope / envelopes /
// verificationEnvelopes). Used by the workflow eval and run projections.
export function verificationEnvelopesFromPayload(payload: unknown): VerificationEnvelope[] {
  const parsed = VerificationEnvelopeSchema.safeParse(payload)
  if (parsed.success) return [parsed.data]
  if (Array.isArray(payload)) return payload.flatMap(verificationEnvelopesFromPayload)
  if (!payload || typeof payload !== "object") return []

  const record = payload as Record<string, unknown>
  return [
    ...verificationEnvelopesFromPayload(record.envelope),
    ...verificationEnvelopesFromPayload(record.verificationEnvelope),
    ...verificationEnvelopesFromPayload(record.envelopes),
    ...verificationEnvelopesFromPayload(record.verificationEnvelopes),
  ]
}

export const ENVELOPE_ID_PATTERN = /^[0-9a-f]{16}$/

// Deterministic 16-char hex hash of the envelope's identity projection.
// Sets up Phase 2 P2.5: future Finding.evidenceRefs entries with
// kind === "verification" will cite an envelopeId computed from the envelope
// they reference, so a reviewer's finding can deterministically link to the
// typecheck/lint/test run that produced its evidence. IDs are derived, not
// stored.
//
// Only the exact v1 identity keys are hashed — the Phase 1 provenance
// fields (sourceState, graph, environment, execution) never affect the id.
// v1 envelopes contain only identity keys, so their ids are bit-identical
// to the pre-Phase-1 whole-object hash, and re-capturing provenance on an
// unchanged verification never invalidates existing citations.
//
// Object keys are sorted before hashing so two envelopes with identical
// content but different key insertion order produce the same id (JSON
// canonicalisation).
const ENVELOPE_IDENTITY_KEYS = [
  "schemaVersion",
  "workflow",
  "scope",
  "command",
  "result",
  "structuredFailures",
  "artifactRefs",
  "source",
] as const

export function computeEnvelopeId(envelope: VerificationEnvelope): string {
  const projection: Record<string, unknown> = {}
  for (const key of ENVELOPE_IDENTITY_KEYS) {
    const value = envelope[key]
    if (value !== undefined) projection[key] = value
  }
  return sha256Hex(canonicalJSON(projection)).slice(0, 16)
}

function canonicalJSON(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]"
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJSON(v)).join(",") + "}"
}
