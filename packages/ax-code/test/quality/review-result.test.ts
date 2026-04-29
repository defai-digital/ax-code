import { describe, expect, test } from "bun:test"
import { computeFindingId, type Finding } from "../../src/quality/finding"
import {
  createReviewResult,
  recommendReviewDecision,
  type VerificationEnvelopeWithId,
} from "../../src/quality/review-result"

function finding(severity: Finding["severity"]): Finding {
  const anchor = { kind: "line" as const, line: 1 }
  return {
    schemaVersion: 1,
    workflow: "review",
    category: "bug",
    severity,
    summary: `${severity} finding`,
    file: `src/${severity.toLowerCase()}.ts`,
    anchor,
    rationale: "Review rationale.",
    evidence: [],
    suggestedNextAction: "Fix it.",
    findingId: computeFindingId({
      workflow: "review",
      category: "bug",
      file: `src/${severity.toLowerCase()}.ts`,
      anchor,
    }),
    source: { tool: "review", version: "4.x.x", runId: "ses_test" },
  }
}

function verification(status: "passed" | "failed" | "skipped"): VerificationEnvelopeWithId {
  return {
    envelopeId: `${status === "passed" ? "1" : status === "failed" ? "2" : "3"}`.repeat(16),
    envelope: {
      schemaVersion: 1,
      workflow: "review",
      scope: { kind: "workspace" },
      command: { runner: "typecheck", argv: [], cwd: "/tmp/work" },
      result: {
        name: "typecheck",
        type: "typecheck",
        passed: status === "passed",
        status,
        issues: [],
        duration: 1,
      },
      structuredFailures: [],
      artifactRefs: [],
      source: { tool: "verify_project", version: "4.x.x", runId: "ses_test" },
    },
  }
}

describe("review-result", () => {
  test("recommends request_changes for blocking findings", () => {
    expect(recommendReviewDecision([finding("HIGH")], [verification("passed")])).toBe("request_changes")
    expect(recommendReviewDecision([finding("CRITICAL")], [verification("passed")])).toBe("request_changes")
  })

  test("recommends needs_verification when no verification passed", () => {
    expect(recommendReviewDecision([finding("LOW")], [])).toBe("needs_verification")
    expect(recommendReviewDecision([finding("LOW")], [verification("failed"), verification("skipped")])).toBe(
      "needs_verification",
    )
  })

  test("recommends needs_verification when selected verification is only partially passing", () => {
    expect(recommendReviewDecision([finding("LOW")], [verification("passed"), verification("failed")])).toBe(
      "needs_verification",
    )
  })

  test("allows skipped checks only when at least one selected verification passed", () => {
    expect(recommendReviewDecision([finding("LOW")], [verification("passed"), verification("skipped")])).toBe(
      "approve",
    )
    expect(recommendReviewDecision([finding("LOW")], [verification("skipped")])).toBe("needs_verification")
  })

  test("creates a stable review result with counts and ids", () => {
    const result = createReviewResult({
      sessionID: "ses_test",
      summary: "Review completed.",
      findings: [finding("LOW"), finding("INFO")],
      verificationEnvelopes: [verification("passed")],
      source: { tool: "review_complete", version: "4.x.x", runId: "ses_test" },
      createdAt: "2026-04-29T00:00:00.000Z",
    })

    expect(result.decision).toBe("approve")
    expect(result.counts).toMatchObject({ LOW: 1, INFO: 1, total: 2 })
    expect(result.blockingFindingIds).toEqual([])
    expect(result.verificationEnvelopeIds).toEqual(["1111111111111111"])
    expect(result.reviewId).toMatch(/^[0-9a-f]{16}$/)
  })

  test("marks mixed verification status as missing usable verification", () => {
    const result = createReviewResult({
      sessionID: "ses_test",
      summary: "Review completed.",
      findings: [finding("LOW")],
      verificationEnvelopes: [verification("passed"), verification("failed")],
      source: { tool: "review_complete", version: "4.x.x", runId: "ses_test" },
      createdAt: "2026-04-29T00:00:00.000Z",
    })

    expect(result.decision).toBe("needs_verification")
    expect(result.missingVerification).toBe(true)
  })
})
