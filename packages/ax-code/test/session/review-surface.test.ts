import { describe, expect, test } from "vitest"
import type { Finding } from "../../src/quality/finding"
import type { ReviewResult } from "../../src/quality/review-result"
import type { VerificationEnvelope } from "../../src/quality/verification-envelope"
import { buildReviewSurfaceModel } from "../../src/session/review-surface"

function finding(path = "src/app.ts"): Finding {
  return {
    schemaVersion: 1,
    findingId: "1111111111111111",
    workflow: "review",
    category: "bug",
    severity: "HIGH",
    summary: "Null state can crash",
    file: path,
    anchor: { kind: "line", line: 12 },
    rationale: "The branch dereferences an optional value.",
    evidence: [`${path}:12`],
    suggestedNextAction: "Guard the optional state.",
    source: { tool: "register_finding", version: "test", runId: "ses_1" },
  }
}

function verification(
  path = "src/app.ts",
  status: VerificationEnvelope["result"]["status"] = "passed",
): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "review",
    scope: { kind: "file", paths: [path] },
    command: { runner: "test", argv: ["bun", "test"], cwd: "/repo" },
    result: {
      name: "unit",
      type: "test",
      passed: status === "passed",
      status,
      issues: status === "passed" ? [] : [{ file: path, severity: "error", message: "failed" }],
      duration: 1,
    },
    structuredFailures: [],
    artifactRefs: [],
    source: { tool: "verify_project", version: "test", runId: "ses_1" },
  }
}

function reviewResult(): ReviewResult {
  return {
    schemaVersion: 1,
    reviewId: "2222222222222222",
    workflow: "review",
    decision: "request_changes",
    recommendedDecision: "request_changes",
    summary: "Needs one fix.",
    findingIds: ["1111111111111111"],
    verificationEnvelopeIds: [],
    counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0, total: 1 },
    blockingFindingIds: ["1111111111111111"],
    missingVerification: true,
    createdAt: new Date("2026-06-04T00:00:00.000Z").toISOString(),
    source: { tool: "review_complete", version: "test", runId: "ses_1" },
  }
}

describe("buildReviewSurfaceModel", () => {
  test("returns no-evidence for an empty review surface", () => {
    expect(buildReviewSurfaceModel({ sessionId: "ses_1" })).toMatchObject({
      sessionId: "ses_1",
      files: [],
      findings: [],
      verification: { total: 0, passed: 0, failed: 0, skipped: 0 },
      rollback: { count: 0 },
      emptyState: "no-evidence",
    })
  })

  test("returns no-changes when evidence exists without file changes", () => {
    const model = buildReviewSurfaceModel({
      sessionId: "ses_1",
      reviewResults: [reviewResult()],
    })

    expect(model.files).toEqual([])
    expect(model.emptyState).toBe("no-changes")
    expect(model.reviewResults).toEqual([
      {
        reviewId: "2222222222222222",
        decision: "request_changes",
        recommendedDecision: "request_changes",
        summary: "Needs one fix.",
      },
    ])
  })

  test("builds findings-only file nodes", () => {
    const model = buildReviewSurfaceModel({
      sessionId: "ses_1",
      findings: [finding("src/app.ts")],
    })

    expect(model.emptyState).toBeUndefined()
    expect(model.files).toEqual([
      {
        path: "src/app.ts",
        status: "unchanged",
        findingCount: 1,
        verificationCount: 0,
        hasRollbackPoint: false,
      },
    ])
    expect(model.findings).toEqual([
      {
        findingId: "1111111111111111",
        severity: "HIGH",
        category: "bug",
        path: "src/app.ts",
        summary: "Null state can crash",
      },
    ])
  })

  test("builds verification-only file nodes", () => {
    const model = buildReviewSurfaceModel({
      sessionId: "ses_1",
      verificationEnvelopes: [verification("src/check.ts", "failed")],
    })

    expect(model.files).toEqual([
      {
        path: "src/check.ts",
        status: "unchanged",
        findingCount: 0,
        verificationCount: 1,
        hasRollbackPoint: false,
      },
    ])
    expect(model.verification).toEqual({ total: 1, passed: 0, failed: 1, skipped: 0 })
  })

  test("combines diffs, findings, verification, review result, and rollback availability", () => {
    const model = buildReviewSurfaceModel({
      sessionId: "ses_1",
      diffs: [{ file: "src/app.ts", before: "old", after: "new", additions: 1, deletions: 1, status: "modified" }],
      findings: [finding("src/app.ts")],
      verificationEnvelopes: [verification("src/app.ts")],
      reviewResults: [reviewResult()],
      rollbackPoints: [
        {
          step: 2,
          messageID: "msg_1" as any,
          partID: "part_1" as any,
          tools: ["edit"],
          kinds: ["edit"],
        },
      ],
    })

    expect(model.emptyState).toBeUndefined()
    expect(model.files).toEqual([
      {
        path: "src/app.ts",
        status: "modified",
        findingCount: 1,
        verificationCount: 1,
        hasRollbackPoint: true,
      },
    ])
    expect(model.rollback).toEqual({ count: 1, latestStep: 2 })
  })
})
