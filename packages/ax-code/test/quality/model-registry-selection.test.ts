import { describe, expect, test } from "vitest"
import {
  normalizeRegistryReportingChain,
  normalizeRegistryTeam,
  promotionApprovers,
  promotionReportingChains,
  reportingChainCarryoverHistory,
  reviewerCarryoverHistory,
  sortModelRecords,
  sortPromotionRecords,
  sortRollbackRecords,
  teamCarryoverHistory,
} from "../../src/quality/model-registry-selection"

function promotion(overrides: Record<string, unknown> = {}) {
  return {
    promotionID: "promotion-1",
    source: "quality-source",
    promotedAt: "2026-04-21T00:00:00.000Z",
    ...overrides,
  }
}

describe("quality model registry selection helpers", () => {
  test("sorts registry records without mutating the input arrays", () => {
    const models = [
      { registeredAt: "2026-04-21T00:01:00.000Z", model: { source: "b" } },
      { registeredAt: "2026-04-21T00:00:00.000Z", model: { source: "z" } },
      { registeredAt: "2026-04-21T00:00:00.000Z", model: { source: "a" } },
    ]
    const promotions = [
      promotion({ promotionID: "promotion-b", source: "b", promotedAt: "2026-04-21T00:00:00.000Z" }),
      promotion({ promotionID: "promotion-a", source: "a", promotedAt: "2026-04-21T00:00:00.000Z" }),
      promotion({ promotionID: "promotion-c", source: "c", promotedAt: "2026-04-21T00:01:00.000Z" }),
    ]
    const rollbacks = [
      { source: "b", rolledBackAt: "2026-04-21T00:00:00.000Z" },
      { source: "a", rolledBackAt: "2026-04-21T00:00:00.000Z" },
      { source: "c", rolledBackAt: "2026-04-21T00:01:00.000Z" },
    ]

    expect(sortModelRecords(models).map((record) => record.model.source)).toEqual(["a", "z", "b"])
    expect(sortPromotionRecords(promotions).map((record) => record.promotionID)).toEqual([
      "promotion-a",
      "promotion-b",
      "promotion-c",
    ])
    expect(sortRollbackRecords(rollbacks).map((record) => record.source)).toEqual(["a", "b", "c"])
    expect(models.map((record) => record.model.source)).toEqual(["b", "z", "a"])
  })

  test("normalizes and deduplicates approval identity fields", () => {
    const record = promotion({
      approval: {
        approver: "alice",
        team: " Core ",
        reportingChain: " Platform / Core ",
      },
      approvals: [
        {
          approver: "bob",
          team: "core",
          reportingChain: "platform / core",
        },
        {
          approver: "alice",
          team: " ",
          reportingChain: null,
        },
      ],
    })

    expect(normalizeRegistryTeam(" Core ")).toBe("core")
    expect(normalizeRegistryTeam(" ")).toBeNull()
    expect(normalizeRegistryReportingChain(" Platform / Core ")).toBe("platform / core")
    expect(promotionApprovers(record)).toEqual(["alice", "bob"])
    expect(promotionReportingChains(record)).toEqual(["platform / core"])
  })

  test("builds reentry carryover history from the most recent eligible promotions", () => {
    const promotions = [
      promotion({
        promotionID: "ignored-no-reentry",
        promotedAt: "2026-04-21T00:00:00.000Z",
        approval: { approver: "old", team: "old-team", reportingChain: "old-chain" },
      }),
      promotion({
        promotionID: "older-reentry",
        promotedAt: "2026-04-21T00:01:00.000Z",
        eligibility: { reentryContext: { rollbackID: "rollback-1" } },
        approval: { approver: "carol", team: "platform", reportingChain: "platform / infra" },
      }),
      promotion({
        promotionID: "middle-reentry",
        promotedAt: "2026-04-21T00:02:00.000Z",
        eligibility: { reentryContext: { rollbackID: "rollback-2" } },
        approval: { approver: "alice", team: "core", reportingChain: "platform / core" },
      }),
      promotion({
        promotionID: "newest-reentry",
        promotedAt: "2026-04-21T00:03:00.000Z",
        eligibility: { reentryContext: { rollbackID: "rollback-3" } },
        approvals: [
          { approver: "alice", team: "core", reportingChain: "platform / core" },
          { approver: "bob", team: "infra", reportingChain: "platform / infra" },
        ],
      }),
    ]

    expect(reviewerCarryoverHistory(promotions, 2)).toEqual([
      {
        approver: "alice",
        weightedReuseScore: 1.5,
        appearances: 2,
        mostRecentPromotionID: "newest-reentry",
        mostRecentPromotedAt: "2026-04-21T00:03:00.000Z",
      },
      {
        approver: "bob",
        weightedReuseScore: 1,
        appearances: 1,
        mostRecentPromotionID: "newest-reentry",
        mostRecentPromotedAt: "2026-04-21T00:03:00.000Z",
      },
    ])
    expect(teamCarryoverHistory(promotions, 2).map((entry) => [entry.team, entry.weightedReuseScore])).toEqual([
      ["core", 1.5],
      ["infra", 1],
    ])
    expect(
      reportingChainCarryoverHistory(promotions, 2).map((entry) => [entry.reportingChain, entry.weightedReuseScore]),
    ).toEqual([
      ["platform / core", 1.5],
      ["platform / infra", 1],
    ])

    expect(reviewerCarryoverHistory(promotions, Number.NaN)).toEqual([])
    expect(teamCarryoverHistory(promotions, Number.POSITIVE_INFINITY)).toEqual([])
    expect(reportingChainCarryoverHistory(promotions, 0)).toEqual([])
    expect(reviewerCarryoverHistory(promotions, 1.9).map((entry) => entry.approver)).toEqual(["alice", "bob"])
  })
})
