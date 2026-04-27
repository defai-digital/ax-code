import z from "zod"
import { ArtifactRefKindEnum, FindingSource, WorkflowEnum } from "./finding"

// VerificationEnvelope is the publishable, cross-process shape that wraps a
// runtime VerificationResult (defined in src/planner/verification/index.ts) so
// review/debug/qa workflows can attach the same envelope without each reparsing
// terminal output. The runtime VerificationResult is intentionally NOT a Zod
// schema — it lives inside the process. This envelope is what crosses session
// artifact / JSON export / future GitHub Action boundaries.

export const ScopeKindEnum = z.enum(["file", "package", "workspace", "custom"])
export const VerificationStatusEnum = z.enum(["passed", "failed", "skipped", "timeout", "error"])
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
})
export type VerificationEnvelope = z.infer<typeof VerificationEnvelopeSchema>
