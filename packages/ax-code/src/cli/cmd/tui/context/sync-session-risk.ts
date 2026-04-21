import z from "zod"

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
})
export type SyncedSessionRisk = z.output<typeof SyncedSessionRisk>

export function parseSyncedSessionRisk(input: unknown) {
  return SyncedSessionRisk.parse(input)
}
