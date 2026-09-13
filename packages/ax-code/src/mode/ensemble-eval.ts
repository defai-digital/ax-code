/**
 * Deterministic ensemble evaluation (ADR-102). Pure, model-call-free:
 * golden JSON fixtures exercise council aggregation, debate convergence,
 * arena ranking, and judge label-mapping. Consumed by
 * `script/ensemble-eval.ts` (run/sweep) and the regression vitest suite.
 */
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import z from "zod"
import { Council } from "./council"
import { Debate } from "./debate"
import { Arena } from "./arena"

export namespace EnsembleEval {
  // --- Fixture schemas ----------------------------------------------------

  const IssueFixture = z.object({
    memberId: z.string(),
    severity: z.enum(["high", "medium", "low"]),
    category: z.string(),
    location: z.string().optional(),
    summary: z.string(),
    suggestedFix: z.string().optional(),
  })

  const MemberFixture = z.object({
    memberId: z.string(),
    providerID: z.string().default("p"),
    modelID: z.string().default("m"),
    overall: z.string().optional(),
    issues: IssueFixture.array().default([]),
    error: z.string().optional(),
  })

  const TierName = z.enum(["consensus", "majority", "minority", "singleton"])

  const CouncilCase = z.object({
    version: z.literal(1),
    kind: z.literal("council-aggregate"),
    name: z.string(),
    members: MemberFixture.array(),
    expect: z.object({
      quorum: z.number().int().optional(),
      incomplete: z.boolean().optional(),
      tiers: z
        .object({
          consensus: z.number().int(),
          majority: z.number().int(),
          minority: z.number().int(),
          singleton: z.number().int(),
        })
        .partial()
        .optional(),
      findings: z
        .array(
          z.object({
            summary: z.string(),
            tier: TierName,
            supportCount: z.number().int().optional(),
            totalMembers: z.number().int().optional(),
          }),
        )
        .default([]),
      // Summary pairs that must land in one merged bucket / must stay apart.
      merged: z.array(z.object({ a: z.string(), b: z.string() })).default([]),
      separate: z.array(z.object({ a: z.string(), b: z.string() })).default([]),
    }),
  })

  const DebateCase = z.object({
    version: z.literal(1),
    kind: z.literal("debate-convergence"),
    name: z.string(),
    members: MemberFixture.array(),
    round: z.number().int().default(1),
    maxRounds: z.number().int().default(3),
    agreementThreshold: z.number().optional(),
    expect: z.object({
      continue: z.boolean(),
      /** Prefix match on the stop/continue reason, e.g. "converged:". */
      reason: z.string(),
    }),
  })

  const ArenaCandidateFixture = z.object({
    id: z.string(),
    providerID: z.string().default("p"),
    modelID: z.string().default("m"),
    verification: z.enum(["pass", "unknown", "fail"]),
    riskScore: z.number().optional(),
    judgeScore: z.number().optional(),
    patchFingerprint: z.string().optional(),
    popularity: z.number().optional(),
  })

  const ArenaCase = z.object({
    version: z.literal(1),
    kind: z.literal("arena-rank"),
    name: z.string(),
    strategy: z.enum(["verify_first", "diversity", "hybrid_score"]).default("verify_first"),
    candidates: ArenaCandidateFixture.array(),
    expect: z.object({
      top1: z.string().optional(),
      order: z.array(z.string()).optional(),
      /** candidate id -> required score (exact). */
      scores: z.record(z.string(), z.number()).optional(),
      /** candidate id -> substring required in reasons. */
      reasons: z.record(z.string(), z.string()).optional(),
    }),
  })

  const JudgeCase = z.object({
    version: z.literal(1),
    kind: z.literal("judge-map"),
    name: z.string(),
    /** Anonymous label -> memberId the label stands for. */
    labels: z.record(z.string(), z.string()),
    output: z.object({
      scores: z.array(
        z.object({
          candidate: z.string(),
          requirementCoverage: z.number(),
          feasibility: z.number(),
          verificationPlan: z.number(),
          riskEvidence: z.number(),
        }),
      ),
    }),
    expect: z.object({
      /** memberId -> expected rubric total. */
      totals: z.record(z.string(), z.number()).default({}),
      error: z.string().optional(),
    }),
  })

  export const Case = z.discriminatedUnion("kind", [CouncilCase, DebateCase, ArenaCase, JudgeCase])
  export type EvalCase = z.infer<typeof Case>

  // --- Loader -------------------------------------------------------------

  export function loadCases(dir: string): EvalCase[] {
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort()
    return files.map((file) => {
      // Golden fixtures are project-owned; parse-then-validate with zod so a
      // malformed case fails loudly with its filename.
      const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as unknown
      return Case.parse(raw)
    })
  }

  // --- Evaluation ---------------------------------------------------------

  export type CaseResult = {
    name: string
    kind: EvalCase["kind"]
    pass: boolean
    failures: string[]
  }

  function evalCouncil(c: z.infer<typeof CouncilCase>, options?: Council.AggregateOptions): CaseResult {
    const failures: string[] = []
    const report = Council.aggregateCouncil(c.members, options)
    if (c.expect.quorum !== undefined && report.quorum !== c.expect.quorum) {
      failures.push(`quorum: expected ${c.expect.quorum}, got ${report.quorum}`)
    }
    if (c.expect.incomplete !== undefined && report.incomplete !== c.expect.incomplete) {
      failures.push(`incomplete: expected ${c.expect.incomplete}, got ${report.incomplete}`)
    }
    if (c.expect.tiers) {
      const actual = {
        consensus: report.consensus.length,
        majority: report.majority.length,
        minority: report.minority.length,
        singleton: report.singleton.length,
      }
      for (const [tier, expected] of Object.entries(c.expect.tiers)) {
        const got = actual[tier as keyof typeof actual]
        if (got !== expected) failures.push(`tier ${tier}: expected ${expected}, got ${got}`)
      }
    }
    const all = [...report.consensus, ...report.majority, ...report.minority, ...report.singleton]
    for (const finding of c.expect.findings) {
      const item = all.find((entry) => entry.summary === finding.summary)
      if (!item) {
        failures.push(`finding missing: ${JSON.stringify(finding.summary)}`)
        continue
      }
      if (item.tier !== finding.tier) {
        failures.push(`finding ${JSON.stringify(finding.summary)}: expected tier ${finding.tier}, got ${item.tier}`)
      }
      if (finding.supportCount !== undefined && item.supportCount !== finding.supportCount) {
        failures.push(
          `finding ${JSON.stringify(finding.summary)}: expected support ${finding.supportCount}, got ${item.supportCount}`,
        )
      }
      if (finding.totalMembers !== undefined && item.totalMembers !== finding.totalMembers) {
        failures.push(
          `finding ${JSON.stringify(finding.summary)}: expected attempted ${finding.totalMembers}, got ${item.totalMembers}`,
        )
      }
    }
    for (const pair of c.expect.merged) {
      const a = all.find((entry) => entry.summary === pair.a)
      const b = all.find((entry) => entry.summary === pair.b)
      if (a && b && a.key !== b.key) {
        failures.push(`expected merged into one bucket: ${JSON.stringify(pair.a)} / ${JSON.stringify(pair.b)}`)
      }
      const representative = a ?? b
      if (!representative) {
        failures.push(`merged pair has no surviving bucket: ${JSON.stringify(pair.a)} / ${JSON.stringify(pair.b)}`)
      } else if (representative.supportCount < 2) {
        failures.push(
          `merged bucket for ${JSON.stringify(pair.a)} / ${JSON.stringify(pair.b)} has support ${representative.supportCount}, expected ≥2`,
        )
      }
    }
    for (const pair of c.expect.separate) {
      if (pair.a === pair.b) {
        // Identical summaries: the guard under test (e.g. location mismatch)
        // must keep two distinct buckets with the same text.
        const matches = all.filter((entry) => entry.summary === pair.a)
        if (matches.length < 2) {
          failures.push(`expected ≥2 separate buckets for ${JSON.stringify(pair.a)}, got ${matches.length}`)
        }
        continue
      }
      const a = all.find((entry) => entry.summary === pair.a)
      const b = all.find((entry) => entry.summary === pair.b)
      if (!a || !b) {
        failures.push(`separate pair missing a bucket: ${JSON.stringify(pair.a)} / ${JSON.stringify(pair.b)}`)
      } else if (a.key === b.key) {
        failures.push(`expected separate buckets: ${JSON.stringify(pair.a)} / ${JSON.stringify(pair.b)}`)
      }
    }
    return { name: c.name, kind: c.kind, pass: failures.length === 0, failures }
  }

  function evalDebate(c: z.infer<typeof DebateCase>): CaseResult {
    const failures: string[] = []
    const report = Council.aggregateCouncil(c.members)
    const decision = Debate.shouldContinueDebate({
      round: c.round,
      maxRounds: c.maxRounds,
      report,
      agreementThreshold: c.agreementThreshold,
    })
    if (decision.continue !== c.expect.continue) {
      failures.push(`continue: expected ${c.expect.continue}, got ${decision.continue} (${decision.reason})`)
    }
    if (!decision.reason.startsWith(c.expect.reason)) {
      failures.push(
        `reason: expected prefix ${JSON.stringify(c.expect.reason)}, got ${JSON.stringify(decision.reason)}`,
      )
    }
    return { name: c.name, kind: c.kind, pass: failures.length === 0, failures }
  }

  function evalArena(c: z.infer<typeof ArenaCase>): CaseResult {
    const failures: string[] = []
    const ranked = Arena.rankArenaCandidates(c.candidates, c.strategy)
    if (c.expect.top1 !== undefined && ranked[0]?.id !== c.expect.top1) {
      failures.push(`top1: expected ${c.expect.top1}, got ${ranked[0]?.id ?? "<none>"}`)
    }
    if (c.expect.order) {
      const actual = ranked.map((entry) => entry.id)
      if (actual.join(",") !== c.expect.order.join(",")) {
        failures.push(`order: expected [${c.expect.order.join(", ")}], got [${actual.join(", ")}]`)
      }
    }
    for (const [id, score] of Object.entries(c.expect.scores ?? {})) {
      const item = ranked.find((entry) => entry.id === id)
      if (!item) failures.push(`candidate missing: ${id}`)
      else if (item.score !== score) failures.push(`candidate ${id}: expected score ${score}, got ${item.score}`)
    }
    for (const [id, reason] of Object.entries(c.expect.reasons ?? {})) {
      const item = ranked.find((entry) => entry.id === id)
      if (!item) failures.push(`candidate missing: ${id}`)
      else if (!item.reasons.some((entry) => entry.includes(reason))) {
        failures.push(`candidate ${id}: reasons ${JSON.stringify(item.reasons)} lack ${JSON.stringify(reason)}`)
      }
    }
    return { name: c.name, kind: c.kind, pass: failures.length === 0, failures }
  }

  function evalJudge(c: z.infer<typeof JudgeCase>): CaseResult {
    const failures: string[] = []
    const labels = new Map(Object.entries(c.labels))
    if (c.expect.error !== undefined) {
      try {
        Arena.mapJudgeScores(c.output, labels)
        failures.push(`expected error ${JSON.stringify(c.expect.error)}, but mapping succeeded`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes(c.expect.error)) {
          failures.push(`error: expected ${JSON.stringify(c.expect.error)}, got ${JSON.stringify(message)}`)
        }
      }
      return { name: c.name, kind: c.kind, pass: failures.length === 0, failures }
    }
    let scores: Map<string, Arena.JudgeDimensionScores>
    try {
      scores = Arena.mapJudgeScores(c.output, labels)
    } catch (error) {
      return {
        name: c.name,
        kind: c.kind,
        pass: false,
        failures: [`unexpected error: ${error instanceof Error ? error.message : String(error)}`],
      }
    }
    if (scores.size !== Object.keys(c.expect.totals).length) {
      failures.push(`mapped members: expected ${Object.keys(c.expect.totals).length}, got ${scores.size}`)
    }
    for (const [memberId, total] of Object.entries(c.expect.totals)) {
      const score = scores.get(memberId)
      if (!score) failures.push(`member missing: ${memberId}`)
      else if (score.total !== total) failures.push(`member ${memberId}: expected total ${total}, got ${score.total}`)
    }
    return { name: c.name, kind: c.kind, pass: failures.length === 0, failures }
  }

  export function evaluate(c: EvalCase, options?: Council.AggregateOptions): CaseResult {
    switch (c.kind) {
      case "council-aggregate":
        return evalCouncil(c, options)
      case "debate-convergence":
        return evalDebate(c)
      case "arena-rank":
        return evalArena(c)
      case "judge-map":
        return evalJudge(c)
    }
  }

  export function evaluateSuite(cases: readonly EvalCase[], options?: Council.AggregateOptions): CaseResult[] {
    return cases.map((c) => evaluate(c, options))
  }

  // --- Reporting ----------------------------------------------------------

  export function renderRunMarkdown(results: readonly CaseResult[]): string {
    const lines = ["# Ensemble eval", ""]
    const passed = results.filter((r) => r.pass).length
    lines.push(`${passed}/${results.length} golden cases pass against the current constants.`, "")
    for (const result of results) {
      lines.push(`- ${result.pass ? "✓" : "✗"} \`${result.kind}\` ${result.name}`)
      for (const failure of result.failures) lines.push(`  - ${failure}`)
    }
    return lines.join("\n")
  }

  export function renderSweepMarkdown(
    cases: readonly EvalCase[],
    thresholds: readonly number[],
  ): { markdown: string; best: { threshold: number; passed: number } } {
    const councilCases = cases.filter((c) => c.kind === "council-aggregate")
    const lines = ["# Ensemble eval — similarity threshold sweep", ""]
    lines.push("| threshold | council cases passed | failures |")
    lines.push("| --------- | -------------------- | -------- |")
    let best: { threshold: number; passed: number } = { threshold: thresholds[0] ?? 0, passed: -1 }
    for (const threshold of thresholds) {
      const results = councilCases.map((c) => evaluate(c, { similarityThreshold: threshold }))
      const passed = results.filter((r) => r.pass).length
      const failing = results
        .filter((r) => !r.pass)
        .map((r) => r.name)
        .join(", ")
      lines.push(`| ${threshold.toFixed(2)} | ${passed}/${councilCases.length} | ${failing || "—"} |`)
      if (passed > best.passed) best = { threshold, passed }
    }
    lines.push(
      "",
      `Current constant: ${Council.SIMILARITY_MERGE_THRESHOLD}. The sweep is evidence, not auto-tuning — constant changes land through the normal PRD/ADR path.`,
    )
    return { markdown: lines.join("\n"), best }
  }
}
