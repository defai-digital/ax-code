import z from "zod"

export namespace QualityStabilityGuard {
  export const DEFAULT_COOLDOWN_HOURS = 24
  export const DEFAULT_REPEAT_FAILURE_WINDOW_HOURS = 24 * 7
  export const DEFAULT_REPEAT_FAILURE_THRESHOLD = 2

  export const StabilityGate = z.object({
    name: z.string(),
    status: z.enum(["pass", "warn", "fail"]),
    detail: z.string(),
  })
  export type StabilityGate = z.output<typeof StabilityGate>

  export const StabilitySummary = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-stability-summary"),
    source: z.string(),
    evaluatedAt: z.string(),
    latestRollbackAt: z.string().nullable(),
    cooldownUntil: z.string().nullable(),
    cooldownHours: z.number().nonnegative(),
    repeatFailureWindowHours: z.number().positive(),
    repeatFailureThreshold: z.number().int().positive(),
    recentRollbackCount: z.number().int().nonnegative(),
    coolingWindowActive: z.boolean(),
    escalationRequired: z.boolean(),
    overallStatus: z.enum(["pass", "warn", "fail"]),
    gates: StabilityGate.array(),
  })
  export type StabilitySummary = z.output<typeof StabilitySummary>

  type RollbackLike = {
    source: string
    rolledBackAt: string
  }

  function isoAt(date: Date) {
    return date.toISOString()
  }

  function addHours(iso: string, hours: number) {
    return isoAt(new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000))
  }

  function subtractHours(iso: string, hours: number) {
    return isoAt(new Date(new Date(iso).getTime() - hours * 60 * 60 * 1000))
  }

  export function summarize(input: {
    source: string
    rollbacks: RollbackLike[]
    now?: string
    cooldownHours?: number
    repeatFailureWindowHours?: number
    repeatFailureThreshold?: number
  }): StabilitySummary {
    const evaluatedAt = input.now ?? new Date().toISOString()
    const cooldownHours = Math.max(0, input.cooldownHours ?? DEFAULT_COOLDOWN_HOURS)
    const repeatFailureWindowHours = Math.max(1, input.repeatFailureWindowHours ?? DEFAULT_REPEAT_FAILURE_WINDOW_HOURS)
    const repeatFailureThreshold = Math.max(1, input.repeatFailureThreshold ?? DEFAULT_REPEAT_FAILURE_THRESHOLD)
    const records = [...input.rollbacks]
      .filter((record) => record.source === input.source)
      .sort((a, b) => a.rolledBackAt.localeCompare(b.rolledBackAt))

    const latestRollbackAt = records[records.length - 1]?.rolledBackAt ?? null
    const cooldownUntil = latestRollbackAt ? addHours(latestRollbackAt, cooldownHours) : null
    const coolingWindowActive = cooldownUntil ? evaluatedAt < cooldownUntil : false
    const windowStart = subtractHours(evaluatedAt, repeatFailureWindowHours)
    const recentRollbackCount = records.filter((record) => record.rolledBackAt >= windowStart && record.rolledBackAt <= evaluatedAt).length
    const escalationRequired = recentRollbackCount >= repeatFailureThreshold

    const gates: StabilityGate[] = [
      {
        name: "cooling-window",
        status: coolingWindowActive ? "fail" : "pass",
        detail: latestRollbackAt
          ? `latest rollback=${latestRollbackAt}; cooldown until=${cooldownUntil}`
          : "no prior rollback recorded",
      },
      {
        name: "repeated-failures",
        status: escalationRequired ? "warn" : "pass",
        detail: `${recentRollbackCount} rollback(s) in trailing ${repeatFailureWindowHours}h window; threshold=${repeatFailureThreshold}`,
      },
    ]
    const overallStatus = gates.some((gate) => gate.status === "fail")
      ? "fail"
      : gates.some((gate) => gate.status === "warn")
        ? "warn"
        : "pass"

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-model-stability-summary",
      source: input.source,
      evaluatedAt,
      latestRollbackAt,
      cooldownUntil,
      cooldownHours,
      repeatFailureWindowHours,
      repeatFailureThreshold,
      recentRollbackCount,
      coolingWindowActive,
      escalationRequired,
      overallStatus,
      gates,
    }
  }

  export function renderReport(summary: StabilitySummary) {
    const lines: string[] = []
    lines.push("## ax-code quality model stability")
    lines.push("")
    lines.push(`- source: ${summary.source}`)
    lines.push(`- evaluated at: ${summary.evaluatedAt}`)
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- latest rollback at: ${summary.latestRollbackAt ?? "n/a"}`)
    lines.push(`- cooldown until: ${summary.cooldownUntil ?? "n/a"}`)
    lines.push(`- cooling window active: ${summary.coolingWindowActive}`)
    lines.push(`- recent rollback count: ${summary.recentRollbackCount}`)
    lines.push(`- repeated failure threshold: ${summary.repeatFailureThreshold}`)
    lines.push(`- escalation required: ${summary.escalationRequired}`)
    lines.push("")
    lines.push("Gates:")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
