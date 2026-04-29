import z from "zod"
import { FindingSchema } from "../../../../quality/finding"
import { VerificationEnvelopeSchema } from "../../../../quality/verification-envelope"
import { DebugCaseSchema, DebugEvidenceSchema, DebugHypothesisSchema } from "../../../../debug-engine/runtime-debug"
import { DecisionHints } from "../../../../session/decision-hints"

export const SyncedSessionQualityReadiness = z.object({
  workflow: z.enum(["review", "debug", "qa"]),
  overallStatus: z.enum(["pass", "warn", "fail"]),
  readyForBenchmark: z.boolean(),
  labeledItems: z.number().int().nonnegative().default(0),
  resolvedLabeledItems: z.number().int().nonnegative(),
  unresolvedLabeledItems: z.number().int().nonnegative().default(0),
  missingLabels: z.number().int().nonnegative().default(0),
  totalItems: z.number().int().nonnegative(),
  nextAction: z.string().nullable().optional(),
  gates: z
    .object({
      name: z.string(),
      status: z.enum(["pass", "warn", "fail"]),
      detail: z.string(),
    })
    .array()
    .default([]),
})
export type SyncedSessionQualityReadiness = z.output<typeof SyncedSessionQualityReadiness>

export const SyncedSessionRisk = z.object({
  id: z.string(),
  quality: z
    .object({
      review: SyncedSessionQualityReadiness.nullable().optional().default(null),
      debug: SyncedSessionQualityReadiness.nullable().optional().default(null),
      qa: SyncedSessionQualityReadiness.nullable().optional().default(null),
    })
    .optional(),
  findings: z.array(FindingSchema).optional(),
  envelopes: z.array(VerificationEnvelopeSchema).optional(),
  debug: z
    .object({
      cases: z.array(DebugCaseSchema),
      evidence: z.array(DebugEvidenceSchema),
      hypotheses: z.array(DebugHypothesisSchema),
    })
    .optional(),
  decisionHints: DecisionHints.SummarySchema.optional(),
})
export type SyncedSessionRisk = z.output<typeof SyncedSessionRisk>

export function parseSyncedSessionRisk(input: unknown) {
  return SyncedSessionRisk.parse(input)
}
