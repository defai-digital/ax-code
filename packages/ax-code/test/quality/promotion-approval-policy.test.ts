import { describe, expect, test } from "bun:test"
import { QualityPromotionApproval } from "../../src/quality/promotion-approval"
import { QualityPromotionApprovalPolicy } from "../../src/quality/promotion-approval-policy"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"

function bundle(
  requiredOverride: "none" | "allow_warn" | "force",
  options?: {
    reentryRollbackID?: string | null
    remediationAuthor?: string | null
    priorPromotionID?: string | null
    priorPromotionApprovers?: string[]
    priorRollbacks?: number
    teamCarryoverHistory?: Array<{
      team: string
      weightedReuseScore: number
      appearances: number
      mostRecentPromotionID: string
      mostRecentPromotedAt: string
    }>
    priorPromotionReportingChains?: string[]
    reviewerCarryoverHistory?: Array<{
      approver: string
      weightedReuseScore: number
      appearances: number
      mostRecentPromotionID: string
      mostRecentPromotedAt: string
    }>
    reportingChainCarryoverHistory?: Array<{
      reportingChain: string
      weightedReuseScore: number
      appearances: number
      mostRecentPromotionID: string
      mostRecentPromotedAt: string
    }>
  },
): QualityPromotionDecisionBundle.DecisionBundle {
  return QualityPromotionDecisionBundle.DecisionBundle.parse({
    schemaVersion: 1,
    kind: "ax-code-quality-promotion-decision-bundle",
    createdAt: "2026-04-20T12:00:00.000Z",
    source: "policy-model-v1",
    policy: {
      cooldownHours: 24,
      repeatFailureWindowHours: 168,
      repeatFailureThreshold: 2,
    },
    benchmark: {
      schemaVersion: 1,
      kind: "ax-code-quality-benchmark-bundle",
      split: {
        ratio: 0.7,
        trainSessionIDs: ["ses_train_1", "ses_train_2"],
        evalSessionIDs: ["ses_eval_1"],
      },
      model: {
        schemaVersion: 1,
        kind: "ax-code-quality-calibration-model",
        source: "policy-model-v1",
        trainedAt: "2026-04-20T00:00:00.000Z",
        globalPrior: 0.5,
        laplaceAlpha: 2,
        requestedBinCount: 1,
        minBinCount: 1,
        training: {
          sessionIDs: ["ses_train_1", "ses_train_2"],
          labeledItems: 4,
          positives: 2,
          negatives: 2,
        },
        groups: [
          {
            workflow: "review",
            artifactKind: "review_run",
            totalCount: 4,
            positives: 2,
            negatives: 2,
            prior: 0.5,
            bins: [
              {
                start: 0,
                end: 1,
                count: 4,
                positives: 2,
                negatives: 2,
                avgBaselineConfidence: 0.5,
                empiricalRate: 0.5,
                smoothedRate: 0.5,
              },
            ],
          },
        ],
      },
      baselineSummary: {
        schemaVersion: 1,
        kind: "ax-code-quality-calibration-summary",
        source: "baseline",
        threshold: 0.5,
        abstainBelow: null,
        totalItems: 1,
        scoredItems: 1,
        missingPredictionItems: 0,
        labeledItems: 1,
        consideredItems: 1,
        abstainedItems: 0,
        positives: 1,
        negatives: 0,
        precision: 1,
        recall: 1,
        falsePositiveRate: null,
        falseNegativeRate: 0,
        precisionAt1: 1,
        precisionAt3: 1,
        calibrationError: 0,
        bins: [],
      },
      candidateSummary: {
        schemaVersion: 1,
        kind: "ax-code-quality-calibration-summary",
        source: "policy-model-v1",
        threshold: 0.5,
        abstainBelow: null,
        totalItems: 1,
        scoredItems: 1,
        missingPredictionItems: 0,
        labeledItems: 1,
        consideredItems: 1,
        abstainedItems: 0,
        positives: 1,
        negatives: 0,
        precision: 1,
        recall: 1,
        falsePositiveRate: null,
        falseNegativeRate: 0,
        precisionAt1: 1,
        precisionAt3: 1,
        calibrationError: 0,
        bins: [],
      },
      comparison: {
        schemaVersion: 1,
        kind: "ax-code-quality-calibration-comparison",
        baselineSource: "baseline",
        candidateSource: "policy-model-v1",
        overallStatus: requiredOverride === "force" ? "fail" : requiredOverride === "allow_warn" ? "warn" : "pass",
        dataset: {
          baselineTotalItems: 1,
          candidateTotalItems: 1,
          baselineScoredItems: 1,
          candidateScoredItems: 1,
          baselineLabeledItems: 1,
          candidateLabeledItems: 1,
          baselineMissingPredictionItems: 0,
          candidateMissingPredictionItems: 0,
        },
        metrics: {
          precision: {
            baseline: 1,
            candidate: 1,
            delta: 0,
            direction: "higher_is_better",
            improvement: false,
            regression: false,
          },
          recall: {
            baseline: 1,
            candidate: 1,
            delta: 0,
            direction: "higher_is_better",
            improvement: false,
            regression: false,
          },
          falsePositiveRate: {
            baseline: null,
            candidate: null,
            delta: null,
            direction: "lower_is_better",
            improvement: false,
            regression: false,
          },
          falseNegativeRate: {
            baseline: 0,
            candidate: 0,
            delta: 0,
            direction: "lower_is_better",
            improvement: false,
            regression: false,
          },
          precisionAt1: {
            baseline: 1,
            candidate: 1,
            delta: 0,
            direction: "higher_is_better",
            improvement: false,
            regression: false,
          },
          precisionAt3: {
            baseline: 1,
            candidate: 1,
            delta: 0,
            direction: "higher_is_better",
            improvement: false,
            regression: false,
          },
          calibrationError: {
            baseline: 0,
            candidate: 0,
            delta: 0,
            direction: "lower_is_better",
            improvement: false,
            regression: false,
          },
        },
        gates: [{ name: "dataset-consistency", status: "pass", detail: "ok" }],
      },
    },
    stability: {
      schemaVersion: 1,
      kind: "ax-code-quality-model-stability-summary",
      source: "policy-model-v1",
      evaluatedAt: "2026-04-20T12:00:00.000Z",
      latestRollbackAt: null,
      cooldownUntil: null,
      cooldownHours: 24,
      repeatFailureWindowHours: 168,
      repeatFailureThreshold: 2,
      recentRollbackCount: 0,
      coolingWindowActive: false,
      escalationRequired: false,
      overallStatus: "pass",
      gates: [{ name: "cooling-window", status: "pass", detail: "ok" }],
    },
    eligibility: {
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-eligibility",
      source: "policy-model-v1",
      evaluatedAt: "2026-04-20T12:00:00.000Z",
      benchmarkStatus: requiredOverride === "force" ? "fail" : requiredOverride === "allow_warn" ? "warn" : "pass",
      stabilityStatus: "pass",
      decision: requiredOverride === "force" ? "no_go" : requiredOverride === "allow_warn" ? "review" : "go",
      requiredOverride,
      currentActiveSource: "baseline-model-v1",
      lastPromotionAt: "2026-04-20T10:00:00.000Z",
      lastRollbackAt: options?.reentryRollbackID ? "2026-04-20T11:00:00.000Z" : null,
      reentryContext: options?.reentryRollbackID
        ? {
            rollbackID: options.reentryRollbackID,
            promotionID: options.priorPromotionID ?? "promotion-1",
            rolledBackAt: "2026-04-20T11:00:00.000Z",
            watchOverallStatus: "fail",
            watchReleasePolicySource: "project",
            watchReleasePolicyDigest: "policy-digest-1",
            sameReleasePolicyAsCurrent: true,
            rollbackTargetSource: "baseline-model-v1",
            priorPromotionApprovers: options.priorPromotionApprovers ?? [],
            teamCarryoverHistory: options.teamCarryoverHistory ?? [],
            priorPromotionReportingChains: options.priorPromotionReportingChains ?? [],
            reviewerCarryoverHistory: options.reviewerCarryoverHistory ?? [],
            reportingChainCarryoverHistory: options.reportingChainCarryoverHistory ?? [],
          }
        : null,
      remediation: options?.remediationAuthor
        ? {
            remediationID: "rem-1",
            contextID: "rollback-ctx-1",
            rollbackID: options.reentryRollbackID ?? "rollback-1",
            createdAt: "2026-04-20T12:00:00.000Z",
            author: options.remediationAuthor,
            summary: "Captured retry remediation context.",
            evidenceCount: 1,
            currentReleasePolicyDigest: "policy-digest-1",
            matchesCurrentReleasePolicyDigest: true,
          }
        : null,
      history: {
        priorPromotions: 1,
        priorRollbacks: options?.priorRollbacks ?? 0,
        recentRollbackCount: 0,
        coolingWindowActive: false,
        escalationRequired: false,
      },
      gates: [
        {
          name: "benchmark-comparison",
          status: requiredOverride === "none" ? "pass" : requiredOverride === "allow_warn" ? "warn" : "fail",
          detail: "ok",
        },
      ],
    },
    snapshot: {
      currentActiveSource: "baseline-model-v1",
      lastPromotionAt: "2026-04-20T10:00:00.000Z",
      lastRollbackAt: null,
      priorPromotions: 1,
      priorRollbacks: options?.priorRollbacks ?? 0,
    },
  })
}

function approval(input: {
  bundle: QualityPromotionDecisionBundle.DecisionBundle
  approver: string
  role?: string | null
  team?: string | null
  reportingChain?: string | null
}) {
  return QualityPromotionApproval.create({
    bundle: input.bundle,
    approver: input.approver,
    role: input.role ?? null,
    team: input.team ?? null,
    reportingChain: input.reportingChain ?? null,
  })
}

describe("QualityPromotionApprovalPolicy", () => {
  test("passes go path without approvals by default", () => {
    const summary = QualityPromotionApprovalPolicy.evaluate({
      bundle: bundle("none"),
      approvals: [],
    })
    expect(summary.overallStatus).toBe("pass")
    expect(summary.requirement.minimumApprovals).toBe(0)
  })

  test("requires a staff-level approval for allow_warn path by default", () => {
    const decisionBundle = bundle("allow_warn")
    const failSummary = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [approval({ bundle: decisionBundle, approver: "eng@example.com", role: "engineer" })],
    })
    expect(failSummary.overallStatus).toBe("fail")

    const passSummary = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [approval({ bundle: decisionBundle, approver: "staff@example.com", role: "staff-engineer" })],
    })
    expect(passSummary.overallStatus).toBe("pass")
    expect(passSummary.acceptedApprovals).toHaveLength(1)
  })

  test("merges overrides onto an existing policy without resetting untouched rules", () => {
    const base = QualityPromotionApprovalPolicy.defaults({
      allowWarn: { minimumApprovals: 2 },
      force: { minimumApprovals: 3, minimumRole: "director" },
      reentry: {
        approvalConcentrationPreset: "org-heavy",
      },
    })

    const presetMerged = QualityPromotionApprovalPolicy.merge(base, {
      reentry: {
        approvalConcentrationPreset: "balanced",
      },
    })
    expect(presetMerged.rules.reentry.approvalConcentrationPreset).toBe("balanced")
    expect(presetMerged.rules.reentry.approvalConcentrationWeights).toEqual({
      approver: 1 / 3,
      team: 1 / 3,
      reportingChain: 1 / 3,
    })

    const merged = QualityPromotionApprovalPolicy.merge(presetMerged, {
      allowWarn: { minimumRole: "principal-engineer" },
      reentry: {
        approvalConcentrationPreset: "org-heavy",
        approvalConcentrationWeights: {
          approver: 0.7,
        },
      },
    })

    expect(merged.rules.allow_warn.minimumApprovals).toBe(2)
    expect(merged.rules.allow_warn.minimumRole).toBe("principal-engineer")
    expect(merged.rules.force.minimumApprovals).toBe(3)
    expect(merged.rules.force.minimumRole).toBe("director")
    expect(merged.rules.reentry.approvalConcentrationPreset).toBeNull()
    expect(merged.rules.reentry.approvalConcentrationWeights).toEqual({
      approver: 0.7,
      team: 0.4,
      reportingChain: 0.4,
    })
  })

  test("rejects policies whose concentration preset does not match the configured weights", () => {
    const policy = QualityPromotionApprovalPolicy.defaults()
    expect(() =>
      QualityPromotionApprovalPolicy.Policy.parse({
        ...policy,
        rules: {
          ...policy.rules,
          reentry: {
            ...policy.rules.reentry,
            approvalConcentrationPreset: "balanced",
            approvalConcentrationWeights: {
              approver: 0.5,
              team: 0.25,
              reportingChain: 0.25,
            },
          },
        },
      }),
    ).toThrow("approval concentration preset")
  })

  test("recommends balanced concentration for standard risk tiers without escalation signals", () => {
    const recommendation = QualityPromotionApprovalPolicy.recommendConcentration({
      riskTier: "standard",
    })
    expect(recommendation.workflow).toBeNull()
    expect(recommendation.preset).toBe("balanced")
    expect(recommendation.budget).toBe(0.5)
    expect(recommendation.escalated).toBe(false)
    expect(recommendation.weights).toEqual({
      approver: 1 / 3,
      team: 1 / 3,
      reportingChain: 1 / 3,
    })
  })

  test("escalates concentration recommendation when same-policy retries or force paths are present", () => {
    const samePolicyRetry = QualityPromotionApprovalPolicy.recommendConcentration({
      workflow: "review",
      riskTier: "standard",
      samePolicyRetry: true,
    })
    expect(samePolicyRetry.workflow).toBe("review")
    expect(samePolicyRetry.preset).toBe("reviewer-heavy")
    expect(samePolicyRetry.budget).toBe(0.4)
    expect(samePolicyRetry.escalated).toBe(true)

    const critical = QualityPromotionApprovalPolicy.recommendConcentration({
      workflow: "refactor",
      riskTier: "elevated",
      forcePath: true,
      priorRollbacks: 3,
    })
    expect(critical.preset).toBe("org-heavy")
    expect(critical.budget).toBe(0.3)
    expect(critical.escalated).toBe(true)
    expect(critical.rationale.some((item) => item.includes("force-path"))).toBe(true)
  })

  test("uses workflow-aware baselines before applying escalation", () => {
    const debug = QualityPromotionApprovalPolicy.recommendConcentration({
      workflow: "debug",
      riskTier: "standard",
    })
    expect(debug.preset).toBe("reviewer-heavy")
    expect(debug.budget).toBe(0.4)
    expect(debug.escalated).toBe(false)

    const refactor = QualityPromotionApprovalPolicy.recommendConcentration({
      workflow: "refactor",
      riskTier: "standard",
    })
    expect(refactor.preset).toBe("reviewer-heavy")

    const qa = QualityPromotionApprovalPolicy.recommendConcentration({
      workflow: "qa",
      riskTier: "elevated",
    })
    expect(qa.preset).toBe("reviewer-heavy")

    const escalatedDebug = QualityPromotionApprovalPolicy.recommendConcentration({
      workflow: "debug",
      riskTier: "standard",
      samePolicyRetry: true,
    })
    expect(escalatedDebug.preset).toBe("org-heavy")
    expect(escalatedDebug.escalated).toBe(true)
  })

  test("infers workflow and risk tier from a decision bundle context", () => {
    const summary = QualityPromotionApprovalPolicy.recommendConcentrationFromContext({
      bundle: bundle("allow_warn"),
    })
    expect(summary.workflow).toBe("review")
    expect(summary.workflowSource).toBe("benchmark")
    expect(summary.riskTier).toBe("elevated")
    expect(summary.riskTierSource).toBe("eligibility")
    expect(summary.samePolicyRetry).toBe(false)
    expect(summary.forcePath).toBe(false)
    expect(summary.priorRollbacks).toBe(0)
    expect(summary.recommendation.preset).toBe("reviewer-heavy")
  })

  test("uses contextual retry signals when recommending from a decision bundle", () => {
    const summary = QualityPromotionApprovalPolicy.recommendConcentrationFromContext({
      bundle: bundle("none", {
        reentryRollbackID: "rollback-ctx-1",
        remediationAuthor: "author@example.com",
        priorRollbacks: 2,
      }),
    })
    expect(summary.workflow).toBe("review")
    expect(summary.samePolicyRetry).toBe(true)
    expect(summary.priorRollbacks).toBe(2)
    expect(summary.recommendation.preset).toBe("org-heavy")
    expect(summary.recommendation.escalated).toBe(true)

    const explicit = QualityPromotionApprovalPolicy.recommendConcentrationFromContext({
      bundle: bundle("none"),
      workflow: "debug",
      riskTier: "critical",
    })
    expect(explicit.workflowSource).toBe("explicit")
    expect(explicit.riskTierSource).toBe("explicit")
    expect(explicit.recommendation.workflow).toBe("debug")
    expect(explicit.recommendation.preset).toBe("org-heavy")
  })

  test("lets explicit contextual retry overrides replace inferred bundle signals", () => {
    const summary = QualityPromotionApprovalPolicy.recommendConcentrationFromContext({
      bundle: bundle("none"),
      samePolicyRetry: true,
      priorRollbacks: 2,
    })
    expect(summary.samePolicyRetry).toBe(true)
    expect(summary.priorRollbacks).toBe(2)
    expect(summary.recommendation.preset).toBe("org-heavy")
    expect(summary.recommendation.escalated).toBe(true)
  })

  test("requires two distinct manager-or-higher approvals for force path by default", () => {
    const decisionBundle = bundle("force")
    const sameApprover = approval({ bundle: decisionBundle, approver: "mgr@example.com", role: "manager" })
    const failSummary = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [sameApprover, { ...sameApprover, approvalID: "dup" }],
    })
    expect(failSummary.overallStatus).toBe("fail")

    const passSummary = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({ bundle: decisionBundle, approver: "mgr1@example.com", role: "manager" }),
        approval({ bundle: decisionBundle, approver: "mgr2@example.com", role: "director" }),
      ],
    })
    expect(passSummary.overallStatus).toBe("pass")

    const report = QualityPromotionApprovalPolicy.renderReport(passSummary)
    expect(report).toContain("## ax-code quality promotion approval policy")
    expect(report).toContain("- overall status: pass")
  })

  test("applies reentry approval requirements even when the base decision is go", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-1",
      remediationAuthor: "author@example.com",
    })

    const failSummary = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [],
    })
    expect(failSummary.overallStatus).toBe("fail")
    expect(failSummary.reentryApplicable).toBe(true)
    expect(failSummary.requirement.minimumApprovals).toBe(1)
    expect(failSummary.requirement.minimumRole).toBe("staff-engineer")

    const passSummary = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [approval({ bundle: decisionBundle, approver: "staff@example.com", role: "staff-engineer" })],
    })
    expect(passSummary.overallStatus).toBe("pass")
    expect(passSummary.reentryRequirement?.minimumApprovals).toBe(1)
  })

  test("requires an independent reviewer for reentry approvals by default", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-2",
      remediationAuthor: "author@example.com",
    })

    const selfApproved = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [approval({ bundle: decisionBundle, approver: "author@example.com", role: "staff-engineer" })],
    })
    expect(selfApproved.overallStatus).toBe("fail")
    expect(selfApproved.independentReviewRequired).toBe(true)
    expect(selfApproved.independentQualifiedApprovals).toBe(0)

    const independentlyApproved = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({ bundle: decisionBundle, approver: "author@example.com", role: "staff-engineer" }),
        approval({ bundle: decisionBundle, approver: "reviewer@example.com", role: "principal-engineer" }),
      ],
    })
    expect(independentlyApproved.overallStatus).toBe("pass")
    expect(independentlyApproved.independentQualifiedApprovals).toBe(1)
  })

  test("requires at least one fresh reviewer when prior promotion approvers are recorded", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-3",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-previous",
      priorPromotionApprovers: ["reviewer@example.com"],
    })

    const repeatedOnly = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [approval({ bundle: decisionBundle, approver: "reviewer@example.com", role: "principal-engineer" })],
    })
    expect(repeatedOnly.overallStatus).toBe("fail")
    expect(repeatedOnly.priorApproverExclusionRequired).toBe(true)
    expect(repeatedOnly.freshQualifiedApprovals).toBe(0)

    const withFreshReviewer = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({ bundle: decisionBundle, approver: "reviewer@example.com", role: "principal-engineer" }),
        approval({ bundle: decisionBundle, approver: "fresh@example.com", role: "principal-engineer" }),
      ],
    })
    expect(withFreshReviewer.overallStatus).toBe("pass")
    expect(withFreshReviewer.freshQualifiedApprovals).toBe(1)
  })

  test("caps reentry reviewer overlap with the rolled-back promotion approver set", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-4",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-previous-overlap",
      priorPromotionApprovers: ["prior1@example.com", "prior2@example.com"],
    })

    const excessiveOverlap = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({ bundle: decisionBundle, approver: "prior1@example.com", role: "principal-engineer" }),
        approval({ bundle: decisionBundle, approver: "prior2@example.com", role: "director" }),
        approval({ bundle: decisionBundle, approver: "fresh@example.com", role: "director" }),
      ],
    })
    expect(excessiveOverlap.overallStatus).toBe("fail")
    expect(excessiveOverlap.maxPriorApproverOverlapRatio).toBe(0.5)
    expect(excessiveOverlap.overlappingQualifiedApprovers).toBe(2)
    expect(excessiveOverlap.priorApproverOverlapRatio).toBeCloseTo(2 / 3)
    expect(excessiveOverlap.gates.find((gate) => gate.name === "prior-approver-overlap")?.status).toBe("fail")

    const acceptableOverlap = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({ bundle: decisionBundle, approver: "prior1@example.com", role: "principal-engineer" }),
        approval({ bundle: decisionBundle, approver: "fresh1@example.com", role: "director" }),
        approval({ bundle: decisionBundle, approver: "fresh2@example.com", role: "director" }),
      ],
    })
    expect(acceptableOverlap.overallStatus).toBe("pass")
    expect(acceptableOverlap.overlappingQualifiedApprovers).toBe(1)
    expect(acceptableOverlap.priorApproverOverlapRatio).toBeCloseTo(1 / 3)
    expect(acceptableOverlap.gates.find((gate) => gate.name === "prior-approver-overlap")?.status).toBe("pass")
  })

  test("limits repeated reviewer reuse across prior reentry promotions", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-5",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-latest",
      priorPromotionApprovers: ["latest@example.com"],
      reviewerCarryoverHistory: [
        {
          approver: "carry@example.com",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-1",
          mostRecentPromotedAt: "2026-04-20T11:30:00.000Z",
        },
      ],
    })

    const reusedReviewer = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({ bundle: decisionBundle, approver: "carry@example.com", role: "principal-engineer" }),
        approval({ bundle: decisionBundle, approver: "fresh@example.com", role: "director" }),
      ],
    })
    expect(reusedReviewer.overallStatus).toBe("fail")
    expect(reusedReviewer.reviewerCarryoverBudget).toBe(0.5)
    expect(reusedReviewer.reviewerCarryoverScore).toBe(1)
    expect(reusedReviewer.carriedOverQualifiedApprovers).toBe(1)
    expect(reusedReviewer.gates.find((gate) => gate.name === "reviewer-carryover-budget")?.status).toBe("fail")

    const rotatedReviewers = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-a@example.com",
          role: "principal-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-b@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/release/director-b",
        }),
      ],
    })
    expect(rotatedReviewers.overallStatus).toBe("pass")
    expect(rotatedReviewers.reviewerCarryoverScore).toBe(0)
    expect(rotatedReviewers.gates.find((gate) => gate.name === "reviewer-carryover-budget")?.status).toBe("pass")
  })

  test("requires role cohort diversity on repeated reentry approvals", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-6",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-role-mix",
      priorPromotionApprovers: ["latest@example.com"],
      reviewerCarryoverHistory: [
        {
          approver: "carry@example.com",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-role-mix",
          mostRecentPromotedAt: "2026-04-20T11:45:00.000Z",
        },
      ],
    })

    const singleCohort = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-manager-1@example.com",
          role: "manager",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-manager-2@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/release/director-b",
        }),
      ],
    })
    expect(singleCohort.overallStatus).toBe("fail")
    expect(singleCohort.roleCohortDiversityRequired).toBe(true)
    expect(singleCohort.minimumDistinctRoleCohorts).toBe(2)
    expect(singleCohort.qualifiedRoleCohorts).toEqual(["management"])
    expect(singleCohort.distinctQualifiedRoleCohorts).toBe(1)
    expect(singleCohort.gates.find((gate) => gate.name === "role-cohort-diversity")?.status).toBe("fail")

    const mixedCohorts = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-ic@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-mgr@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/release/director-b",
        }),
      ],
    })
    expect(mixedCohorts.overallStatus).toBe("pass")
    expect(mixedCohorts.qualifiedRoleCohorts).toEqual(["individual-contributor", "management"])
    expect(mixedCohorts.distinctQualifiedRoleCohorts).toBe(2)
    expect(mixedCohorts.gates.find((gate) => gate.name === "role-cohort-diversity")?.status).toBe("pass")
  })

  test("requires reviewer team diversity on repeated reentry approvals", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-7",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-team-mix",
      priorPromotionApprovers: ["latest@example.com"],
      reviewerCarryoverHistory: [
        {
          approver: "carry@example.com",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-team-mix",
          mostRecentPromotedAt: "2026-04-20T12:00:00.000Z",
        },
      ],
    })

    const singleTeam = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-a@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-b@example.com",
          role: "director",
          team: "quality-platform",
          reportingChain: "eng/release/director-b",
        }),
      ],
    })
    expect(singleTeam.overallStatus).toBe("fail")
    expect(singleTeam.reviewerTeamDiversityRequired).toBe(true)
    expect(singleTeam.minimumDistinctReviewerTeams).toBe(2)
    expect(singleTeam.qualifiedReviewerTeams).toEqual(["quality-platform"])
    expect(singleTeam.distinctQualifiedReviewerTeams).toBe(1)
    expect(singleTeam.missingQualifiedReviewerTeams).toBe(0)
    expect(singleTeam.gates.find((gate) => gate.name === "reviewer-team-diversity")?.status).toBe("fail")

    const mixedTeams = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-ic@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-mgr@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/release/director-b",
        }),
      ],
    })
    expect(mixedTeams.overallStatus).toBe("pass")
    expect(mixedTeams.qualifiedReviewerTeams).toEqual(["quality-platform", "release"])
    expect(mixedTeams.distinctQualifiedReviewerTeams).toBe(2)
    expect(mixedTeams.missingQualifiedReviewerTeams).toBe(0)
    expect(mixedTeams.gates.find((gate) => gate.name === "reviewer-team-diversity")?.status).toBe("pass")
  })

  test("requires reporting chain diversity on repeated reentry approvals", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-8",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-chain-mix",
      priorPromotionApprovers: ["latest@example.com"],
      reviewerCarryoverHistory: [
        {
          approver: "carry@example.com",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-chain-mix",
          mostRecentPromotedAt: "2026-04-20T12:05:00.000Z",
        },
      ],
    })

    const singleChain = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-a@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-b@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/platform/director-a",
        }),
      ],
    })
    expect(singleChain.overallStatus).toBe("fail")
    expect(singleChain.reportingChainDiversityRequired).toBe(true)
    expect(singleChain.minimumDistinctReportingChains).toBe(2)
    expect(singleChain.qualifiedReportingChains).toEqual(["eng/platform/director-a"])
    expect(singleChain.distinctQualifiedReportingChains).toBe(1)
    expect(singleChain.missingQualifiedReportingChains).toBe(0)
    expect(singleChain.gates.find((gate) => gate.name === "reporting-chain-diversity")?.status).toBe("fail")

    const mixedChains = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-ic@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-mgr@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/release/director-b",
        }),
      ],
    })
    expect(mixedChains.overallStatus).toBe("pass")
    expect(mixedChains.qualifiedReportingChains).toEqual(["eng/platform/director-a", "eng/release/director-b"])
    expect(mixedChains.distinctQualifiedReportingChains).toBe(2)
    expect(mixedChains.missingQualifiedReportingChains).toBe(0)
    expect(mixedChains.gates.find((gate) => gate.name === "reporting-chain-diversity")?.status).toBe("pass")
  })

  test("caps reentry reporting chain overlap with the rolled-back promotion chain set", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-9",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-previous-chain-overlap",
      priorPromotionApprovers: ["prior@example.com"],
      priorPromotionReportingChains: ["eng/platform/director-a", "eng/release/director-b"],
      reviewerCarryoverHistory: [
        {
          approver: "carry@example.com",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-chain-overlap",
          mostRecentPromotedAt: "2026-04-20T12:10:00.000Z",
        },
      ],
      reportingChainCarryoverHistory: [
        {
          reportingChain: "eng/legacy/director-z",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-chain-overlap",
          mostRecentPromotedAt: "2026-04-20T12:10:00.000Z",
        },
      ],
    })

    const excessiveOverlap = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-a@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-b@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/release/director-b",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-c@example.com",
          role: "director",
          team: "security",
          reportingChain: "eng/security/director-c",
        }),
      ],
    })
    expect(excessiveOverlap.overallStatus).toBe("fail")
    expect(excessiveOverlap.maxPriorReportingChainOverlapRatio).toBe(0.5)
    expect(excessiveOverlap.overlappingQualifiedReportingChains).toBe(2)
    expect(excessiveOverlap.priorReportingChainOverlapRatio).toBeCloseTo(2 / 3)
    expect(excessiveOverlap.gates.find((gate) => gate.name === "prior-reporting-chain-overlap")?.status).toBe("fail")

    const acceptableOverlap = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-d@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-e@example.com",
          role: "director",
          team: "data",
          reportingChain: "eng/data/director-d",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-f@example.com",
          role: "director",
          team: "infra",
          reportingChain: "eng/infra/director-e",
        }),
      ],
    })
    expect(acceptableOverlap.overallStatus).toBe("pass")
    expect(acceptableOverlap.overlappingQualifiedReportingChains).toBe(1)
    expect(acceptableOverlap.priorReportingChainOverlapRatio).toBeCloseTo(1 / 3)
    expect(acceptableOverlap.gates.find((gate) => gate.name === "prior-reporting-chain-overlap")?.status).toBe("pass")
  })

  test("limits repeated reporting chain reuse across prior reentry promotions", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-10",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-chain-carryover",
      priorPromotionApprovers: ["latest@example.com"],
      priorPromotionReportingChains: ["eng/platform/director-a"],
      reviewerCarryoverHistory: [
        {
          approver: "carry@example.com",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-chain-carryover",
          mostRecentPromotedAt: "2026-04-20T12:15:00.000Z",
        },
      ],
      reportingChainCarryoverHistory: [
        {
          reportingChain: "eng/platform/director-a",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-chain-carryover",
          mostRecentPromotedAt: "2026-04-20T12:15:00.000Z",
        },
      ],
    })

    const reusedChains = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-a@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-b@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/release/director-b",
        }),
      ],
    })
    expect(reusedChains.overallStatus).toBe("fail")
    expect(reusedChains.reportingChainCarryoverBudget).toBe(0.5)
    expect(reusedChains.reportingChainCarryoverScore).toBe(1)
    expect(reusedChains.carriedOverQualifiedReportingChains).toBe(1)
    expect(reusedChains.gates.find((gate) => gate.name === "reporting-chain-carryover-budget")?.status).toBe("fail")

    const rotatedChains = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-c@example.com",
          role: "staff-engineer",
          team: "security",
          reportingChain: "eng/security/director-c",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-d@example.com",
          role: "director",
          team: "data",
          reportingChain: "eng/data/director-d",
        }),
      ],
    })
    expect(rotatedChains.overallStatus).toBe("pass")
    expect(rotatedChains.reportingChainCarryoverScore).toBe(0)
    expect(rotatedChains.carriedOverQualifiedReportingChains).toBe(0)
    expect(rotatedChains.gates.find((gate) => gate.name === "reporting-chain-carryover-budget")?.status).toBe("pass")
  })

  test("fails concentrated repeated reentry approvals even when single-axis reuse caps pass", () => {
    const decisionBundle = bundle("none", {
      reentryRollbackID: "rollback-11",
      remediationAuthor: "author@example.com",
      priorPromotionID: "promotion-concentration",
      priorPromotionApprovers: ["carry@example.com"],
      teamCarryoverHistory: [
        {
          team: "quality-platform",
          weightedReuseScore: 0.5,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-concentration",
          mostRecentPromotedAt: "2026-04-20T12:20:00.000Z",
        },
      ],
      priorPromotionReportingChains: ["eng/platform/director-a"],
      reviewerCarryoverHistory: [
        {
          approver: "carry@example.com",
          weightedReuseScore: 0.5,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-concentration",
          mostRecentPromotedAt: "2026-04-20T12:20:00.000Z",
        },
      ],
      reportingChainCarryoverHistory: [
        {
          reportingChain: "eng/platform/director-a",
          weightedReuseScore: 0.5,
          appearances: 1,
          mostRecentPromotionID: "promotion-reentry-concentration",
          mostRecentPromotedAt: "2026-04-20T12:20:00.000Z",
        },
      ],
    })

    const concentrated = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "carry@example.com",
          role: "staff-engineer",
          team: "quality-platform",
          reportingChain: "eng/platform/director-a",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-manager@example.com",
          role: "director",
          team: "quality-platform",
          reportingChain: "eng/release/director-b",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-ops@example.com",
          role: "director",
          team: "release",
          reportingChain: "eng/platform/director-a",
        }),
      ],
    })
    expect(concentrated.reviewerCarryoverScore).toBe(0.5)
    expect(concentrated.teamCarryoverScore).toBe(0.5)
    expect(concentrated.reportingChainCarryoverScore).toBe(0.5)
    expect(concentrated.approverReuseRatio).toBeCloseTo(1 / 3)
    expect(concentrated.teamReuseRatio).toBeCloseTo(1 / 2)
    expect(concentrated.reportingChainReuseRatio).toBeCloseTo(1 / 2)
    expect(concentrated.approvalConcentrationBudget).toBe(0.4)
    expect(concentrated.approvalConcentrationPreset).toBe("reviewer-heavy")
    expect(concentrated.approvalConcentrationWeights).toEqual({
      approver: 0.5,
      team: 0.25,
      reportingChain: 0.25,
    })
    expect(concentrated.approvalConcentrationAppliedWeightTotal).toBe(1)
    expect(concentrated.approvalConcentrationScore).toBeCloseTo((1 / 3) * 0.5 + (1 / 2) * 0.25 + (1 / 2) * 0.25)
    expect(concentrated.gates.find((gate) => gate.name === "reviewer-carryover-budget")?.status).toBe("pass")
    expect(concentrated.gates.find((gate) => gate.name === "team-carryover-budget")?.status).toBe("pass")
    expect(concentrated.gates.find((gate) => gate.name === "reporting-chain-carryover-budget")?.status).toBe("pass")
    expect(concentrated.gates.find((gate) => gate.name === "approval-concentration")?.status).toBe("fail")

    const rotated = QualityPromotionApprovalPolicy.evaluate({
      bundle: decisionBundle,
      approvals: [
        approval({
          bundle: decisionBundle,
          approver: "fresh-ic@example.com",
          role: "staff-engineer",
          team: "security",
          reportingChain: "eng/security/director-c",
        }),
        approval({
          bundle: decisionBundle,
          approver: "fresh-mgr@example.com",
          role: "director",
          team: "data",
          reportingChain: "eng/data/director-d",
        }),
      ],
    })
    expect(rotated.overallStatus).toBe("pass")
    expect(rotated.approverReuseRatio).toBe(0)
    expect(rotated.teamReuseRatio).toBe(0)
    expect(rotated.reportingChainReuseRatio).toBe(0)
    expect(rotated.approvalConcentrationPreset).toBe("reviewer-heavy")
    expect(rotated.approvalConcentrationAppliedWeightTotal).toBe(1)
    expect(rotated.approvalConcentrationScore).toBe(0)
    expect(rotated.gates.find((gate) => gate.name === "approval-concentration")?.status).toBe("pass")
  })
})
