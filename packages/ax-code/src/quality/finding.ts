import { createHash } from "node:crypto"
import z from "zod"
import { ArtifactRefKind, Category, EvidenceRefKind, Severity, Workflow } from "./finding-registry"

export const SeverityEnum = z.enum(Severity)
export const CategoryEnum = z.enum(Category)
export const WorkflowEnum = z.enum(Workflow)
export const EvidenceRefKindEnum = z.enum(EvidenceRefKind)
export const ArtifactRefKindEnum = z.enum(ArtifactRefKind)

export const FindingAnchor = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("line"),
    line: z.number().int().min(1),
    endLine: z.number().int().min(1).optional(),
  }),
  z.object({
    kind: z.literal("symbol"),
    symbolId: z.string().min(1),
  }),
])
export type FindingAnchor = z.infer<typeof FindingAnchor>

export const EvidenceRef = z.object({
  kind: EvidenceRefKindEnum,
  id: z.string().min(1),
})
export type EvidenceRef = z.infer<typeof EvidenceRef>

export const FindingSource = z.object({
  tool: z.string().min(1),
  version: z.string().min(1),
  runId: z.string().min(1),
})
export type FindingSource = z.infer<typeof FindingSource>

export const RULE_ID_PATTERN = /^(axcode|policy|user):[a-z0-9][a-z0-9-]*$/
export const FINDING_ID_PATTERN = /^[0-9a-f]{16}$/

export const FindingSchema = z.object({
  schemaVersion: z.literal(1),
  findingId: z.string().regex(FINDING_ID_PATTERN, "findingId must be 16-char lowercase hex"),
  workflow: WorkflowEnum,
  category: CategoryEnum,
  severity: SeverityEnum,
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string().min(1).max(200),
  file: z.string().min(1),
  anchor: FindingAnchor,
  rationale: z.string().min(1),
  evidence: z.array(z.string()),
  evidenceRefs: z.array(EvidenceRef).optional(),
  suggestedNextAction: z.string().min(1),
  ruleId: z.string().regex(RULE_ID_PATTERN, "ruleId must be <axcode|policy|user>:<kebab-name>").optional(),
  source: FindingSource,
})
export type Finding = z.infer<typeof FindingSchema>

export type FindingIdInput = {
  workflow: Finding["workflow"]
  category: Finding["category"]
  file: string
  anchor: FindingAnchor
  ruleId?: string
}

// Deterministic 16-char hex hash. Inputs are stable across `.ax-code/` config
// reloads and across multiple `/review` runs for the same defect, so consumers
// (PR comment refresh, session artifact dedup) can detect duplicates by id.
export function computeFindingId(input: FindingIdInput): string {
  const anchorRef = input.anchor.kind === "line" ? `line:${input.anchor.line}` : `symbol:${input.anchor.symbolId}`
  const payload = [input.workflow, input.category, input.file, anchorRef, input.ruleId ?? ""].join("\u0000")
  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}
