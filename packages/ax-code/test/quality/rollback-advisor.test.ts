import { describe, expect, test } from "bun:test"
import { QualityModelRegistry } from "../../src/quality/model-registry"
import { QualityPromotionWatch } from "../../src/quality/promotion-watch"
import { QualityRollbackAdvisor } from "../../src/quality/rollback-advisor"

function promotionRecord(input: {
  source: string
  promotedAt: string
  previousActiveSource?: string | null
}): QualityModelRegistry.PromotionRecord {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-model-promotion",
    promotionID: `promotion:${input.source}`,
    source: input.source,
    promotedAt: input.promotedAt,
    previousActiveSource: input.previousActiveSource ?? null,
    decision: "pass",
    benchmark: {
      baselineSource: "baseline",
      overallStatus: "pass",
      trainSessions: 2,
      evalSessions: 1,
      labeledTrainingItems: 4,
      gates: [{ name: "dataset-consistency", status: "pass", detail: "ok" }],
    },
  }
}

function watchSummary(input: {
  source: string
  promotedAt: string
  overallStatus: "pass" | "warn" | "fail"
}): QualityPromotionWatch.WatchSummary {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-promotion-watch-summary",
    source: input.source,
    baselineSource: "Risk.assess",
    promotedAt: input.promotedAt,
    releasePolicy: {
      policy: {
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-release-policy",
        stability: {
          cooldownHours: 24,
          repeatFailureWindowHours: 168,
          repeatFailureThreshold: 2,
        },
        watch: {
          minRecords: 5,
          maxRecords: 20,
          abstentionWarnRate: 0.15,
          abstentionFailRate: 0.35,
          avgConfidenceWarnAbsDelta: 0.15,
          avgConfidenceFailAbsDelta: 0.3,
          maxConfidenceWarnAbsDelta: 0.6,
          requireCandidateCoverage: true,
        },
        approval: {
          schemaVersion: 1,
          kind: "ax-code-quality-promotion-approval-policy",
          rules: {
            none: {
              minimumApprovals: 0,
              minimumRole: null,
              requireDistinctApprovers: false,
              requireIndependentReviewer: false,
              requirePriorApproverExclusion: false,
              maxPriorApproverOverlapRatio: null,
              reviewerCarryoverBudget: null,
              reviewerCarryoverLookbackPromotions: null,
              teamCarryoverBudget: null,
              teamCarryoverLookbackPromotions: null,
              maxPriorReportingChainOverlapRatio: null,
              reportingChainCarryoverBudget: null,
              reportingChainCarryoverLookbackPromotions: null,
              requireRoleCohortDiversity: false,
              minimumDistinctRoleCohorts: null,
              requireReviewerTeamDiversity: false,
              minimumDistinctReviewerTeams: null,
              requireReportingChainDiversity: false,
              minimumDistinctReportingChains: null,
              approvalConcentrationBudget: null,
              approvalConcentrationPreset: null,
              approvalConcentrationWeights: { approver: 1, team: 1, reportingChain: 1 },
            },
            allow_warn: {
              minimumApprovals: 1,
              minimumRole: "staff-engineer",
              requireDistinctApprovers: true,
              requireIndependentReviewer: false,
              requirePriorApproverExclusion: false,
              maxPriorApproverOverlapRatio: null,
              reviewerCarryoverBudget: null,
              reviewerCarryoverLookbackPromotions: null,
              teamCarryoverBudget: null,
              teamCarryoverLookbackPromotions: null,
              maxPriorReportingChainOverlapRatio: null,
              reportingChainCarryoverBudget: null,
              reportingChainCarryoverLookbackPromotions: null,
              requireRoleCohortDiversity: false,
              minimumDistinctRoleCohorts: null,
              requireReviewerTeamDiversity: false,
              minimumDistinctReviewerTeams: null,
              requireReportingChainDiversity: false,
              minimumDistinctReportingChains: null,
              approvalConcentrationBudget: null,
              approvalConcentrationPreset: null,
              approvalConcentrationWeights: { approver: 1, team: 1, reportingChain: 1 },
            },
            force: {
              minimumApprovals: 2,
              minimumRole: "manager",
              requireDistinctApprovers: true,
              requireIndependentReviewer: false,
              requirePriorApproverExclusion: false,
              maxPriorApproverOverlapRatio: null,
              reviewerCarryoverBudget: null,
              reviewerCarryoverLookbackPromotions: null,
              teamCarryoverBudget: null,
              teamCarryoverLookbackPromotions: null,
              maxPriorReportingChainOverlapRatio: null,
              reportingChainCarryoverBudget: null,
              reportingChainCarryoverLookbackPromotions: null,
              requireRoleCohortDiversity: false,
              minimumDistinctRoleCohorts: null,
              requireReviewerTeamDiversity: false,
              minimumDistinctReviewerTeams: null,
              requireReportingChainDiversity: false,
              minimumDistinctReportingChains: null,
              approvalConcentrationBudget: null,
              approvalConcentrationPreset: null,
              approvalConcentrationWeights: { approver: 1, team: 1, reportingChain: 1 },
            },
            reentry: {
              minimumApprovals: 1,
              minimumRole: "staff-engineer",
              requireDistinctApprovers: true,
              requireIndependentReviewer: true,
              requirePriorApproverExclusion: true,
              maxPriorApproverOverlapRatio: 0.5,
              reviewerCarryoverBudget: 0.5,
              reviewerCarryoverLookbackPromotions: 3,
              teamCarryoverBudget: 0.5,
              teamCarryoverLookbackPromotions: 3,
              maxPriorReportingChainOverlapRatio: 0.5,
              reportingChainCarryoverBudget: 0.5,
              reportingChainCarryoverLookbackPromotions: 3,
              requireRoleCohortDiversity: true,
              minimumDistinctRoleCohorts: 2,
              requireReviewerTeamDiversity: true,
              minimumDistinctReviewerTeams: 2,
              requireReportingChainDiversity: true,
              minimumDistinctReportingChains: 2,
              approvalConcentrationBudget: 0.4,
              approvalConcentrationPreset: "reviewer-heavy",
              approvalConcentrationWeights: { approver: 0.5, team: 0.25, reportingChain: 0.25 },
            },
          },
        },
      },
      provenance: {
        policySource: "project",
        policyProjectID: "rollback-project-1",
        compatibilityApprovalSource: null,
        resolvedAt: "2026-04-20T02:00:00.000Z",
        persistedScope: "project",
        persistedUpdatedAt: "2026-04-20T01:00:00.000Z",
        digest: "rollback-watch-policy-digest",
      },
    },
    window: {
      since: input.promotedAt,
      through: "2026-04-20T03:00:00.000Z",
      minRecords: 5,
      maxRecords: 20,
      totalRecords: 6,
      sessionsCovered: 4,
    },
    shadow: {
      schemaVersion: 1,
      kind: "ax-code-quality-shadow-summary",
      baselineSource: "Risk.assess",
      candidateSource: input.source,
      totalItems: 6,
      comparableItems: 6,
      missingCandidateItems: input.overallStatus === "fail" ? 2 : 0,
      predictionChangedItems: input.overallStatus === "fail" ? 4 : 1,
      abstentionChangedItems: input.overallStatus === "warn" ? 1 : 0,
      avgConfidenceDelta: input.overallStatus === "fail" ? 0.31 : 0.05,
      maxAbsConfidenceDelta: input.overallStatus === "fail" ? 0.7 : 0.1,
      candidatePromotions: 0,
      candidateDemotions: 0,
    },
    predictionChangedRate: input.overallStatus === "fail" ? 0.6667 : 0.1667,
    abstentionChangedRate: input.overallStatus === "warn" ? 0.1667 : 0,
    missingCandidateRate: input.overallStatus === "fail" ? 0.3333 : 0,
    overallStatus: input.overallStatus,
    gates: [
      {
        name: input.overallStatus === "warn" ? "watch-volume" : "candidate-coverage",
        status: input.overallStatus,
        detail: "gate detail",
      },
    ],
  }
}

describe("QualityRollbackAdvisor", () => {
  test("recommends rollback when a failed watch targets the active promoted model", () => {
    const recommendation = QualityRollbackAdvisor.recommend({
      promotion: promotionRecord({
        source: "candidate-v2",
        promotedAt: "2026-04-20T02:00:00.000Z",
        previousActiveSource: "candidate-v1",
      }),
      watch: watchSummary({
        source: "candidate-v2",
        promotedAt: "2026-04-20T02:00:00.000Z",
        overallStatus: "fail",
      }),
      currentActiveSource: "candidate-v2",
    })

    expect(recommendation.action).toBe("rollback")
    expect(recommendation.rollbackTargetSource).toBe("candidate-v1")
    expect(recommendation.watch.releasePolicySource).toBe("project")
    expect(recommendation.watch.releasePolicyDigest).toBe("rollback-watch-policy-digest")
    expect(recommendation.rationale.some((item) => item.includes("rollback is recommended"))).toBe(true)

    const report = QualityRollbackAdvisor.renderRecommendationReport(recommendation)
    expect(report).toContain("## ax-code quality rollback recommendation")
    expect(report).toContain("- recommended action: rollback")
    expect(report).toContain("- release policy source: project")
  })

  test("recommends observation instead of rollback for warn status or active mismatch", () => {
    const warnRecommendation = QualityRollbackAdvisor.recommend({
      promotion: promotionRecord({
        source: "candidate-v2",
        promotedAt: "2026-04-20T02:00:00.000Z",
        previousActiveSource: "candidate-v1",
      }),
      watch: watchSummary({
        source: "candidate-v2",
        promotedAt: "2026-04-20T02:00:00.000Z",
        overallStatus: "warn",
      }),
      currentActiveSource: "candidate-v2",
    })
    expect(warnRecommendation.action).toBe("observe")

    const mismatchRecommendation = QualityRollbackAdvisor.recommend({
      promotion: promotionRecord({
        source: "candidate-v2",
        promotedAt: "2026-04-20T02:00:00.000Z",
        previousActiveSource: "candidate-v1",
      }),
      watch: watchSummary({
        source: "candidate-v2",
        promotedAt: "2026-04-20T02:00:00.000Z",
        overallStatus: "fail",
      }),
      currentActiveSource: "candidate-v3",
    })
    expect(mismatchRecommendation.action).toBe("observe")
    expect(mismatchRecommendation.rollbackTargetSource).toBeNull()
  })
})
