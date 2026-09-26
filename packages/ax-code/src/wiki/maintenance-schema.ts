import z from "zod"
export const WikiMaintenanceSchema = z
  .object({
    phase: z.enum(["queued", "running", "ready", "disabled", "failed"]),
    reason: z.enum(["idle", "busy", "permissions", "disabled", "non_git", "building", "complete", "failed"]),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
  })
  .meta({ ref: "WikiMaintenanceStatus" })
