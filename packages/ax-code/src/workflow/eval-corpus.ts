import z from "zod"
import {
  WorkflowEvalBaseline,
  WorkflowEvalFindingStatus,
  WorkflowEvalSummary,
  classifyWorkflowFindingArtifact,
  evaluateWorkflowRun,
} from "./eval"
import { WorkflowRunDetail, type WorkflowArtifactRecord } from "./state"

const SeedID = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/, "must be kebab-case starting with a lowercase letter")

export const WorkflowEvalCaseID = z.enum(["verified-bug-sweep-seeded"])
export type WorkflowEvalCaseID = z.infer<typeof WorkflowEvalCaseID>

export const WorkflowEvalSeededFinding = z.object({
  id: SeedID,
  file: z.string().trim().min(1),
  line: z.number().int().positive(),
  expectedStatus: WorkflowEvalFindingStatus,
  severity: z.enum(["critical", "high", "medium", "low", "info"]).default("medium"),
  summary: z.string().trim().min(1),
  rationale: z.string().trim().min(1).optional(),
})
export type WorkflowEvalSeededFinding = z.infer<typeof WorkflowEvalSeededFinding>

export const WorkflowEvalCase = z.object({
  id: WorkflowEvalCaseID,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  fixtureID: z.string().trim().min(1),
  templateID: z
    .string()
    .min(1)
    .max(120)
    .regex(/^(builtin|user|project):[a-z][a-z0-9-]*$/),
  baseline: WorkflowEvalBaseline,
  seeds: z.array(WorkflowEvalSeededFinding).min(1),
})
export type WorkflowEvalCase = z.infer<typeof WorkflowEvalCase>

export const WorkflowEvalCaseMetrics = z.object({
  expectedConfirmedFindings: z.number().int().min(0),
  expectedLikelyFindings: z.number().int().min(0),
  expectedRejectedFindings: z.number().int().min(0),
  expectedUnverifiedFindings: z.number().int().min(0),
  observedSeedConfirmedFindings: z.number().int().min(0),
  observedSeedLikelyFindings: z.number().int().min(0),
  observedSeedRejectedFindings: z.number().int().min(0),
  observedSeedUnverifiedFindings: z.number().int().min(0),
  missingSeedFindings: z.number().int().min(0),
  mismatchedSeedFindings: z.number().int().min(0),
  duplicateSeedArtifacts: z.number().int().min(0),
  unmatchedFindingArtifacts: z.number().int().min(0),
  costPerConfirmedFindingUsd: z.number().min(0).nullable(),
  falsePositiveRejectionRate: z.number().min(0).max(1).nullable(),
  confirmedFindingRecall: z.number().min(0).max(1).nullable(),
  completionRate: z.number().min(0).max(1),
  verificationPassRate: z.number().min(0).max(1),
  budgetStopped: z.boolean(),
  interventionCount: z.number().int().min(0),
})
export type WorkflowEvalCaseMetrics = z.infer<typeof WorkflowEvalCaseMetrics>

export const WorkflowEvalCaseRunSummary = z.object({
  caseID: WorkflowEvalCaseID,
  templateID: z.string(),
  fixtureID: z.string(),
  decision: z.enum(["promote", "hold", "rollback"]),
  reasons: z.array(z.string()),
  missingSeedIDs: z.array(SeedID),
  mismatchedSeedIDs: z.array(SeedID),
  summary: WorkflowEvalSummary,
  metrics: WorkflowEvalCaseMetrics,
})
export type WorkflowEvalCaseRunSummary = z.infer<typeof WorkflowEvalCaseRunSummary>

const VerifiedBugSweepSeededCase = WorkflowEvalCase.parse({
  id: "verified-bug-sweep-seeded",
  name: "Verified Bug Sweep Seeded Corpus",
  description:
    "Small local corpus with a confirmed bug, a likely bug, a deliberate false positive, and an unverified signal.",
  fixtureID: "verified-bug-sweep-seeded",
  templateID: "builtin:verified-bug-sweep",
  baseline: {
    label: "single-agent-seeded-review",
    metrics: {
      confirmedFindings: 1,
      falsePositiveFindings: 1,
      totalTokens: 12_000,
      elapsedMs: 60_000,
      estimatedCostUsd: 0.06,
      interventionCount: 0,
    },
  },
  seeds: [
    {
      id: "auth-missing-token-confirmed",
      file: "src/auth.ts",
      line: 2,
      expectedStatus: "confirmed",
      severity: "high",
      summary: "Unauthenticated callers are treated as administrators.",
      rationale: "The fixture intentionally returns true for a missing token.",
    },
    {
      id: "retry-no-cap-likely",
      file: "src/retry.ts",
      line: 2,
      expectedStatus: "likely",
      severity: "medium",
      summary: "Retry delay grows without a cap and can create poor recovery behavior.",
    },
    {
      id: "text-content-xss-rejected",
      file: "src/render.ts",
      line: 2,
      expectedStatus: "rejected",
      severity: "low",
      summary: "User input is assigned through textContent, so the XSS-looking candidate is a false positive.",
    },
    {
      id: "shared-cache-scope-unverified",
      file: "src/cache.ts",
      line: 4,
      expectedStatus: "unverified",
      severity: "medium",
      summary: "Cache scoping might be incomplete, but the fixture lacks enough call-site evidence.",
    },
  ],
})

const WorkflowEvalCases: Record<WorkflowEvalCaseID, WorkflowEvalCase> = {
  "verified-bug-sweep-seeded": VerifiedBugSweepSeededCase,
}

export function listWorkflowEvalCases(): WorkflowEvalCase[] {
  return Object.values(WorkflowEvalCases).map((item) => WorkflowEvalCase.parse(item))
}

export function getWorkflowEvalCase(id: WorkflowEvalCaseID): WorkflowEvalCase {
  return WorkflowEvalCase.parse(WorkflowEvalCases[id])
}

export function evaluateWorkflowEvalCaseRun(input: {
  run: z.infer<typeof WorkflowRunDetail>
  caseID?: WorkflowEvalCaseID
  now?: number
}): WorkflowEvalCaseRunSummary {
  const parsed = z
    .object({
      run: WorkflowRunDetail,
      caseID: WorkflowEvalCaseID.default("verified-bug-sweep-seeded"),
      now: z.number().int().min(0).optional(),
    })
    .parse(input)
  const evalCase = getWorkflowEvalCase(parsed.caseID)
  const summary = evaluateWorkflowRun({ run: parsed.run, baseline: evalCase.baseline, now: parsed.now })
  const seedObservation = observeSeededFindings(parsed.run.artifacts, evalCase.seeds)
  const expected = countSeeds(evalCase.seeds)
  const caseReasons = casePromotionBlockers({ evalCase, seedObservation })
  const decision =
    summary.decision === "rollback"
      ? "rollback"
      : summary.decision === "hold" || caseReasons.length
        ? "hold"
        : "promote"

  return WorkflowEvalCaseRunSummary.parse({
    caseID: evalCase.id,
    templateID: evalCase.templateID,
    fixtureID: evalCase.fixtureID,
    decision,
    reasons: [...summary.reasons, ...caseReasons],
    missingSeedIDs: seedObservation.missingSeedIDs,
    mismatchedSeedIDs: seedObservation.mismatchedSeedIDs,
    summary,
    metrics: {
      expectedConfirmedFindings: expected.confirmed,
      expectedLikelyFindings: expected.likely,
      expectedRejectedFindings: expected.rejected,
      expectedUnverifiedFindings: expected.unverified,
      observedSeedConfirmedFindings: seedObservation.counts.confirmed,
      observedSeedLikelyFindings: seedObservation.counts.likely,
      observedSeedRejectedFindings: seedObservation.counts.rejected,
      observedSeedUnverifiedFindings: seedObservation.counts.unverified,
      missingSeedFindings: seedObservation.missingSeedIDs.length,
      mismatchedSeedFindings: seedObservation.mismatchedSeedIDs.length,
      duplicateSeedArtifacts: seedObservation.duplicateSeedArtifacts,
      unmatchedFindingArtifacts: seedObservation.unmatchedFindingArtifacts,
      costPerConfirmedFindingUsd: costPerConfirmedFinding(summary),
      falsePositiveRejectionRate: ratio(seedObservation.counts.rejected, expected.rejected),
      confirmedFindingRecall: ratio(seedObservation.counts.confirmed, expected.confirmed),
      completionRate: parsed.run.status === "completed" ? 1 : 0,
      verificationPassRate: summary.verificationSatisfied ? 1 : 0,
      budgetStopped: summary.budgetStatus === "exceeded",
      interventionCount: summary.metrics.interventionCount,
    },
  })
}

function observeSeededFindings(artifacts: WorkflowArtifactRecord[], seeds: WorkflowEvalSeededFinding[]) {
  const seedByID = new Map(seeds.map((seed) => [seed.id, seed]))
  const observedBySeed = new Map<string, WorkflowEvalFindingStatus>()
  let duplicateSeedArtifacts = 0
  let unmatchedFindingArtifacts = 0

  for (const artifact of artifacts) {
    if (artifact.kind !== "finding") continue
    const seedID = payloadSeedID(artifact.payload)
    if (!seedID || !seedByID.has(seedID)) {
      unmatchedFindingArtifacts++
      continue
    }
    if (observedBySeed.has(seedID)) {
      duplicateSeedArtifacts++
      continue
    }
    observedBySeed.set(seedID, classifyWorkflowFindingArtifact(artifact))
  }

  const counts = emptyStatusCounts()
  const missingSeedIDs: string[] = []
  const mismatchedSeedIDs: string[] = []
  for (const seed of seeds) {
    const observed = observedBySeed.get(seed.id)
    if (!observed) {
      missingSeedIDs.push(seed.id)
      continue
    }
    counts[observed]++
    if (observed !== seed.expectedStatus) mismatchedSeedIDs.push(seed.id)
  }

  return {
    counts,
    missingSeedIDs,
    mismatchedSeedIDs,
    duplicateSeedArtifacts,
    unmatchedFindingArtifacts,
  }
}

function casePromotionBlockers(input: {
  evalCase: WorkflowEvalCase
  seedObservation: ReturnType<typeof observeSeededFindings>
}) {
  const reasons: string[] = []
  const missingByStatus = new Map<WorkflowEvalFindingStatus, string[]>()
  for (const seedID of input.seedObservation.missingSeedIDs) {
    const seed = input.evalCase.seeds.find((item) => item.id === seedID)
    if (!seed) continue
    const list = missingByStatus.get(seed.expectedStatus) ?? []
    list.push(seedID)
    missingByStatus.set(seed.expectedStatus, list)
  }

  addMissingReason(reasons, missingByStatus, "confirmed", "expected confirmed seed findings are missing")
  addMissingReason(reasons, missingByStatus, "likely", "expected likely seed findings are missing")
  addMissingReason(reasons, missingByStatus, "rejected", "expected false-positive rejections are missing")
  addMissingReason(reasons, missingByStatus, "unverified", "expected unverified seed findings are missing")
  if (input.seedObservation.mismatchedSeedIDs.length) {
    reasons.push(`seed finding statuses mismatched: ${input.seedObservation.mismatchedSeedIDs.join(", ")}`)
  }
  return reasons
}

function addMissingReason(
  reasons: string[],
  missingByStatus: Map<WorkflowEvalFindingStatus, string[]>,
  status: WorkflowEvalFindingStatus,
  message: string,
) {
  const seedIDs = missingByStatus.get(status)
  if (!seedIDs?.length) return
  reasons.push(`${message}: ${seedIDs.join(", ")}`)
}

function countSeeds(seeds: WorkflowEvalSeededFinding[]) {
  const counts = emptyStatusCounts()
  for (const seed of seeds) counts[seed.expectedStatus]++
  return counts
}

function emptyStatusCounts() {
  return {
    confirmed: 0,
    likely: 0,
    rejected: 0,
    unverified: 0,
  }
}

function payloadSeedID(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const value = (payload as Record<string, unknown>).seedID
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function costPerConfirmedFinding(summary: WorkflowEvalSummary) {
  if (summary.metrics.confirmedFindings === 0) return null
  return summary.metrics.estimatedCostUsd / summary.metrics.confirmedFindings
}

function ratio(numerator: number, denominator: number) {
  if (denominator === 0) return null
  return Math.min(1, numerator / denominator)
}
