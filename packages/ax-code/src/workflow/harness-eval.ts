import { parseJsonResult, parseJsonStrict } from "@/util/json-value"
import z from "zod"

export namespace HarnessEval {
  const identity = z.string().trim().min(1).max(300)
  const counter = z.number().int().nonnegative().safe()
  export const Run = z
    .object({
      taskID: identity,
      arm: identity,
      model: identity,
      cohort: identity,
      repetition: counter,
      outcome: z.enum(["completed", "failed", "timeout", "cancelled"]),
      verified: z.boolean(),
      elapsedMs: z.number().finite().nonnegative(),
      verificationMs: z.number().finite().nonnegative().optional(),
      inputTokens: counter.optional(),
      outputTokens: counter.optional(),
      cacheReadTokens: counter.optional(),
      toolCalls: counter.optional(),
    })
    .strict()
    .refine((run) => !run.verified || run.outcome === "completed", "Only completed runs can be verified")
  export type Run = z.infer<typeof Run>

  export function records(text: string) {
    const parsed = parseJsonResult(text)
    if (parsed.ok && Array.isArray(parsed.value)) return z.array(Run).parse(parsed.value)
    const Event = z.discriminatedUnion("type", [
      z.object({ type: z.literal("run"), run: Run }).strict(),
      z.object({ type: z.literal("comparison"), comparison: z.unknown(), incomplete: z.boolean() }).strict(),
    ])
    return text
      .trim()
      .split("\n")
      .map((line) => Event.parse(parseJsonStrict(line)))
      .flatMap((event) => (event.type === "run" ? [event.run] : []))
  }

  function median(values: number[]) {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2
  }

  function summary(runs: Run[]) {
    const successful = runs.filter((run) => run.verified)
    const durations = successful.map((run) => run.elapsedMs).sort((a, b) => a - b)
    const homogeneous = new Set(runs.map((run) => JSON.stringify([run.taskID, run.model, run.cohort]))).size === 1
    const failures = { failed: 0, timeout: 0, cancelled: 0, completed_unverified: 0 }
    for (const run of runs)
      if (!run.verified) failures[run.outcome === "completed" ? "completed_unverified" : run.outcome]++
    return {
      count: runs.length,
      verifiedCount: successful.length,
      successRate: successful.length / runs.length,
      successfulElapsedMedianMs: median(durations),
      successfulElapsedP95Ms:
        homogeneous && durations.length >= 20 ? durations[Math.ceil(durations.length * 0.95) - 1] : null,
      failures,
    }
  }

  export function compare(input: unknown, baselineArm: string, candidateArm: string) {
    identity.parse(baselineArm)
    identity.parse(candidateArm)
    if (baselineArm === candidateArm) throw new Error("Comparison arms must differ")
    const runs = z.array(Run).min(2).max(100_000).parse(input)
    const pairs = new Map<string, Map<string, Run>>()
    for (const run of runs) {
      if (run.arm !== baselineArm && run.arm !== candidateArm) throw new Error(`Unknown comparison arm: ${run.arm}`)
      const key = JSON.stringify([run.taskID, run.model, run.cohort, run.repetition])
      const pair = pairs.get(key) ?? new Map<string, Run>()
      if (pair.has(run.arm)) throw new Error("Duplicate task/model/cohort/repetition/arm")
      pair.set(run.arm, run)
      pairs.set(key, pair)
    }
    const ratios: number[] = []
    let pairedVerifiedCount = 0
    for (const pair of pairs.values()) {
      const baseline = pair.get(baselineArm)
      const candidate = pair.get(candidateArm)
      if (!baseline || !candidate) throw new Error("Missing matched task/model/cohort/repetition pair")
      if (baseline.verified && candidate.verified) {
        pairedVerifiedCount++
        const ratio = candidate.elapsedMs / baseline.elapsedMs
        if (baseline.elapsedMs > 0 && Number.isFinite(ratio)) ratios.push(ratio)
      }
    }
    const cells = new Map<string, Run[]>()
    for (const run of runs) {
      const key = JSON.stringify([run.taskID, run.model, run.cohort])
      const cell = cells.get(key) ?? []
      cell.push(run)
      cells.set(key, cell)
    }
    return {
      cells: [...cells]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, cell]) => ({
          taskID: cell[0].taskID,
          model: cell[0].model,
          cohort: cell[0].cohort,
          baseline: summary(cell.filter((run) => run.arm === baselineArm)),
          candidate: summary(cell.filter((run) => run.arm === candidateArm)),
        })),
      baseline: { arm: baselineArm, ...summary(runs.filter((run) => run.arm === baselineArm)) },
      candidate: { arm: candidateArm, ...summary(runs.filter((run) => run.arm === candidateArm)) },
      pairedVerifiedCount,
      ratioSampleCount: ratios.length,
      medianCandidateOverBaselineElapsedRatio: median(ratios),
      limitations: [
        "Latency summaries condition on verified success; inspect success rates and every failure before interpreting speed.",
        "Paired ratios exclude zero baseline durations and non-finite ratios.",
        "P95 requires at least 20 verified observations per task/model/cohort/arm cell and is withheld for mixed-cell aggregates; it is descriptive only; no statistical significance or default promotion is implied.",
        "The cohort must identify controlled settings and immutable fixture/oracle revisions; a matching label alone does not prove experimental control.",
      ],
    }
  }
}
