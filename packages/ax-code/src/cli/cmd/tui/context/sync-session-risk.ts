import z from "zod"

export const SyncedSessionQualityReadiness = z.object({
  workflow: z.enum(["review", "debug"]),
  overallStatus: z.enum(["pass", "warn", "fail"]),
  readyForBenchmark: z.boolean(),
  resolvedLabeledItems: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  nextAction: z.string().nullable().optional(),
})
export type SyncedSessionQualityReadiness = z.output<typeof SyncedSessionQualityReadiness>

export const SyncedSessionRisk = z.object({
  id: z.string(),
  quality: z
    .object({
      review: SyncedSessionQualityReadiness.nullable(),
      debug: SyncedSessionQualityReadiness.nullable(),
    })
    .optional(),
})
export type SyncedSessionRisk = z.output<typeof SyncedSessionRisk>

export function parseSyncedSessionRisk(input: unknown) {
  return SyncedSessionRisk.parse(input)
}
