import type { Finding } from "../quality/finding"
import type { ReviewResult } from "../quality/review-result"
import type { VerificationEnvelope } from "../quality/verification-envelope"
import type { Snapshot } from "../snapshot"
import type { SessionRollback } from "./rollback"

export type ReviewFileStatus = "added" | "modified" | "deleted" | "renamed" | "unchanged"

export type ReviewFileNode = {
  path: string
  status: ReviewFileStatus
  findingCount: number
  verificationCount: number
  hasRollbackPoint: boolean
}

export type ReviewFindingSummary = {
  findingId: string
  severity: Finding["severity"]
  category: Finding["category"]
  path: string
  summary: string
}

export type VerificationSummary = {
  total: number
  passed: number
  failed: number
  skipped: number
}

export type RollbackSummary = {
  count: number
  latestStep?: number
}

export type ReviewSurfaceModel = {
  sessionId: string
  files: ReviewFileNode[]
  findings: ReviewFindingSummary[]
  verification: VerificationSummary
  rollback: RollbackSummary
  reviewResults: Array<{
    reviewId: string
    decision: ReviewResult["decision"]
    recommendedDecision: ReviewResult["recommendedDecision"]
    summary: string
  }>
  emptyState?: "no-changes" | "no-evidence" | "loading" | "error"
}

export type BuildReviewSurfaceModelInput = {
  sessionId: string
  diffs?: Snapshot.FileDiff[]
  findings?: Finding[]
  verificationEnvelopes?: VerificationEnvelope[]
  reviewResults?: ReviewResult[]
  rollbackPoints?: SessionRollback.Point[]
  emptyState?: "loading" | "error"
}

export function buildReviewSurfaceModel(input: BuildReviewSurfaceModelInput): ReviewSurfaceModel {
  const diffs = input.diffs ?? []
  const findings = input.findings ?? []
  const verificationEnvelopes = input.verificationEnvelopes ?? []
  const reviewResults = input.reviewResults ?? []
  const rollbackPoints = input.rollbackPoints ?? []
  const filePaths = new Set<string>()

  for (const diff of diffs) filePaths.add(diff.file)
  for (const finding of findings) filePaths.add(finding.file)
  for (const envelope of verificationEnvelopes) {
    for (const path of verificationPaths(envelope)) filePaths.add(path)
  }

  const diffByPath = new Map(diffs.map((diff) => [diff.file, diff]))
  const files = [...filePaths].sort().map((path): ReviewFileNode => {
    const diff = diffByPath.get(path)
    return {
      path,
      status: diffStatus(diff),
      findingCount: findings.filter((finding) => finding.file === path).length,
      verificationCount: verificationEnvelopes.filter((envelope) => verificationPaths(envelope).has(path)).length,
      hasRollbackPoint: rollbackPoints.length > 0 && !!diff,
    }
  })

  const verification = verificationEnvelopes.reduce<VerificationSummary>(
    (summary, envelope) => {
      summary.total++
      if (envelope.result.status === "passed") summary.passed++
      else if (envelope.result.status === "skipped") summary.skipped++
      else summary.failed++
      return summary
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  )

  return {
    sessionId: input.sessionId,
    files,
    findings: findings.map((finding) => ({
      findingId: finding.findingId,
      severity: finding.severity,
      category: finding.category,
      path: finding.file,
      summary: finding.summary,
    })),
    verification,
    rollback: {
      count: rollbackPoints.length,
      latestStep: rollbackPoints.map((point) => point.step).sort((a, b) => b - a)[0],
    },
    reviewResults: reviewResults.map((result) => ({
      reviewId: result.reviewId,
      decision: result.decision,
      recommendedDecision: result.recommendedDecision,
      summary: result.summary,
    })),
    emptyState:
      input.emptyState ?? emptyState({ files, findings, verificationEnvelopes, reviewResults, rollbackPoints }),
  }
}

function diffStatus(diff: Snapshot.FileDiff | undefined): ReviewFileStatus {
  return diff?.status ?? (diff ? "modified" : "unchanged")
}

function verificationPaths(envelope: VerificationEnvelope) {
  const paths = new Set<string>()
  for (const path of envelope.scope.paths ?? []) paths.add(path)
  for (const issue of envelope.result.issues) paths.add(issue.file)
  for (const failure of envelope.structuredFailures) {
    if ("file" in failure && failure.file) paths.add(failure.file)
  }
  return paths
}

function emptyState(input: {
  files: ReviewFileNode[]
  findings: Finding[]
  verificationEnvelopes: VerificationEnvelope[]
  reviewResults: ReviewResult[]
  rollbackPoints: SessionRollback.Point[]
}): ReviewSurfaceModel["emptyState"] {
  if (input.files.length > 0) return undefined
  if (
    input.findings.length > 0 ||
    input.verificationEnvelopes.length > 0 ||
    input.reviewResults.length > 0 ||
    input.rollbackPoints.length > 0
  ) {
    return "no-changes"
  }
  return "no-evidence"
}
