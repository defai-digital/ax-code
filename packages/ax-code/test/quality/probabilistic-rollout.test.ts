import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Risk } from "../../src/risk/score"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { QualityPromotionAdoptionDissentHandling } from "../../src/quality/promotion-adoption-dissent-handling"
import { QualityPromotionAdoptionDissentResolution } from "../../src/quality/promotion-adoption-dissent-resolution"
import { QualityPromotionAdoptionDissentSupersession } from "../../src/quality/promotion-adoption-dissent-supersession"
import { QualityPromotionAdoptionReview } from "../../src/quality/promotion-adoption-review"
import { QualityPromotionArchiveManifest } from "../../src/quality/promotion-archive-manifest"
import { QualityPromotionAuditManifest } from "../../src/quality/promotion-audit-manifest"
import { QualityPromotionBoardDecision } from "../../src/quality/promotion-board-decision"
import { QualityPromotionApprovalPacket } from "../../src/quality/promotion-approval-packet"
import { QualityPromotionApproval } from "../../src/quality/promotion-approval"
import { QualityPromotionApprovalPolicy } from "../../src/quality/promotion-approval-policy"
import { QualityPromotionApprovalPolicyStore } from "../../src/quality/promotion-approval-policy-store"
import { QualityPromotionDecisionBundle } from "../../src/quality/promotion-decision-bundle"
import { QualityPromotionExportBundle } from "../../src/quality/promotion-export-bundle"
import { QualityPromotionHandoffPackage } from "../../src/quality/promotion-handoff-package"
import { QualityPromotionPackagedArchive } from "../../src/quality/promotion-packaged-archive"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityPromotionReleaseDecisionRecord } from "../../src/quality/promotion-release-decision-record"
import { QualityPromotionReleasePacket } from "../../src/quality/promotion-release-packet"
import { QualityPromotionPortableExport } from "../../src/quality/promotion-portable-export"
import { QualityPromotionReleasePolicyStore } from "../../src/quality/promotion-release-policy-store"
import { QualityPromotionReviewDossier } from "../../src/quality/promotion-review-dossier"
import { QualityPromotionSignedArchiveAttestationPolicy } from "../../src/quality/promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveAttestationPolicyStore } from "../../src/quality/promotion-signed-archive-attestation-policy-store"
import { QualityPromotionSignedArchiveAttestationPacket } from "../../src/quality/promotion-signed-archive-attestation-packet"
import { QualityPromotionSignedArchiveAttestationRecord } from "../../src/quality/promotion-signed-archive-attestation-record"
import { QualityPromotionSignedArchiveGovernancePacket } from "../../src/quality/promotion-signed-archive-governance-packet"
import { QualityPromotionSignedArchiveReviewDossier } from "../../src/quality/promotion-signed-archive-review-dossier"
import { QualityPromotionSignedArchive } from "../../src/quality/promotion-signed-archive"
import { QualityPromotionSignedArchiveTrust } from "../../src/quality/promotion-signed-archive-trust"
import { QualityPromotionSubmissionBundle } from "../../src/quality/promotion-submission-bundle"
import { QualityReentryContext } from "../../src/quality/reentry-context"
import { QualityReentryRemediation } from "../../src/quality/reentry-remediation"
import { QualityModelRegistry } from "../../src/quality/model-registry"
import { QualityPromotionWatch } from "../../src/quality/promotion-watch"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import { QualityLabelStore } from "../../src/quality/label-store"
import { QualityShadowStore } from "../../src/quality/shadow-store"
import { QualityShadow } from "../../src/quality/shadow-runtime"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("ProbabilisticRollout.exportReplay", () => {
  test("exports review run and finding items from scanner results", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        const projectID = Instance.project.id

        Recorder.begin(sid)
        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "code.graph.snapshot",
          sessionID: sid,
          projectID,
          commitSha: "abc123",
          nodeCount: 10,
          edgeCount: 9,
          lastIndexedAt: Date.now(),
        })
        Recorder.emit({
          type: "tool.call",
          sessionID: sid,
          tool: "security_scan",
          callID: "call_security",
          input: { patterns: ["path_traversal"] },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          tool: "security_scan",
          callID: "call_security",
          status: "completed",
          output: "Findings: 1",
          metadata: {
            findingCount: 1,
            truncated: false,
            report: {
              findings: [
                {
                  file: "src/auth.ts",
                  line: 42,
                  severity: "high",
                  pattern: "path_traversal",
                  description: "Unsanitized path input reaches filesystem access.",
                },
              ],
            },
          },
          durationMs: 12,
        })
        Recorder.emit({
          type: "session.end",
          sessionID: sid,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(sid)

        await new Promise((resolve) => setTimeout(resolve, 50))

        const exported = await ProbabilisticRollout.exportReplay(sid, "review")
        expect(exported.workflow).toBe("review")
        expect(exported.items.map((item) => item.artifactKind)).toEqual(["review_run", "review_finding"])
        expect(exported.items[0]?.evidence.summary).toMatchObject({ findingCount: 1, scannerCount: 1 })
        expect(exported.items[1]?.evidence.finding).toMatchObject({
          sourceTool: "security_scan",
          severity: "high",
          file: "src/auth.ts",
          line: 42,
        })

        EventQuery.deleteBySession(sid)
      },
    })
  })

  test("exports debug case and hypothesis items from debug_analyze results", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        const projectID = Instance.project.id

        Recorder.begin(sid)
        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "debug",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "code.graph.snapshot",
          sessionID: sid,
          projectID,
          commitSha: "def456",
          nodeCount: 20,
          edgeCount: 19,
          lastIndexedAt: Date.now(),
        })
        Recorder.emit({
          type: "tool.call",
          sessionID: sid,
          tool: "debug_analyze",
          callID: "call_debug",
          input: {
            error: "TypeError: undefined is not a function",
            stackTrace: "at handle (/repo/src/app.ts:10:1)",
          },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          tool: "debug_analyze",
          callID: "call_debug",
          status: "completed",
          output: "Confidence: 0.82",
          metadata: {
            confidence: 0.82,
            chainLength: 3,
            resolvedCount: 2,
            truncated: false,
          },
          durationMs: 18,
        })
        Recorder.emit({
          type: "session.end",
          sessionID: sid,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(sid)

        await new Promise((resolve) => setTimeout(resolve, 50))

        const exported = await ProbabilisticRollout.exportReplay(sid, "debug")
        expect(exported.workflow).toBe("debug")
        expect(exported.items.map((item) => item.artifactKind)).toEqual(["debug_case", "debug_hypothesis"])
        expect(exported.items[1]?.baseline.confidence).toBe(0.82)
        expect(exported.items[1]?.evidence.summary).toMatchObject({
          error: "TypeError: undefined is not a function",
          hasStackTrace: true,
          chainLength: 3,
        })

        EventQuery.deleteBySession(sid)
      },
    })
  })
})

describe("ProbabilisticRollout.summarizeReplayReadiness", () => {
  test("warns when replay is exportable but labels have not been recorded yet", () => {
    const replay = ProbabilisticRollout.ReplayExport.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-replay-export",
      workflow: "review",
      sessionID: "session-review-1",
      exportedAt: "2026-04-21T00:00:00.000Z",
      items: [
        {
          schemaVersion: 1,
          kind: "ax-code-quality-replay-item",
          workflow: "review",
          artifactKind: "review_run",
          artifactID: "review:session-review-1",
          sessionID: "session-review-1",
          projectID: "project-1",
          title: "review session",
          createdAt: "2026-04-21T00:00:00.000Z",
          baseline: {
            source: "Risk.assess",
            confidence: 0.7,
            score: 0.7,
            readiness: "ready",
            rank: null,
          },
          context: {
            directory: "/repo",
            graphCommitSha: "abc123",
            touchedFiles: ["src/auth.ts"],
            diffSummary: { files: 1, additions: 10, deletions: 2 },
            eventCount: 4,
            toolCount: 1,
          },
          evidence: {
            toolSummaries: [
              {
                tool: "security_scan",
                callID: "call-1",
                status: "completed",
                timeCreated: 1,
                durationMs: 5,
                findingCount: 1,
              },
            ],
            summary: { findingCount: 1, scannerCount: 1 },
          },
        },
        {
          schemaVersion: 1,
          kind: "ax-code-quality-replay-item",
          workflow: "review",
          artifactKind: "review_finding",
          artifactID: "review:call-1:0",
          sessionID: "session-review-1",
          projectID: "project-1",
          title: "security finding",
          createdAt: "2026-04-21T00:00:00.000Z",
          baseline: {
            source: "Risk.assess",
            confidence: 0.7,
            score: 0.7,
            readiness: "ready",
            rank: null,
          },
          context: {
            directory: "/repo",
            graphCommitSha: "abc123",
            touchedFiles: ["src/auth.ts"],
            diffSummary: { files: 1, additions: 10, deletions: 2 },
            eventCount: 4,
            toolCount: 1,
          },
          evidence: {
            toolSummaries: [
              {
                tool: "security_scan",
                callID: "call-1",
                status: "completed",
                timeCreated: 1,
                durationMs: 5,
                findingCount: 1,
              },
            ],
            finding: {
              sourceTool: "security_scan",
              severity: "high",
            },
          },
        },
      ],
    })

    const summary = ProbabilisticRollout.summarizeReplayReadiness({ replay })
    expect(summary.overallStatus).toBe("warn")
    expect(summary.readyForBenchmark).toBe(false)
    expect(summary.labeledItems).toBe(0)
    expect(summary.nextAction).toContain("Record outcome labels")
  })

  test("passes when debug replay has evidence and at least one resolved label", () => {
    const replay = ProbabilisticRollout.ReplayExport.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-replay-export",
      workflow: "debug",
      sessionID: "session-debug-1",
      exportedAt: "2026-04-21T00:00:00.000Z",
      items: [
        {
          schemaVersion: 1,
          kind: "ax-code-quality-replay-item",
          workflow: "debug",
          artifactKind: "debug_case",
          artifactID: "debug:session-debug-1",
          sessionID: "session-debug-1",
          projectID: "project-debug",
          title: "debug session",
          createdAt: "2026-04-21T00:00:00.000Z",
          baseline: {
            source: "debug_analyze",
            confidence: null,
            score: null,
            readiness: null,
            rank: null,
          },
          context: {
            directory: "/repo",
            graphCommitSha: "def456",
            touchedFiles: ["src/app.ts"],
            diffSummary: { files: 1, additions: 2, deletions: 1 },
            eventCount: 3,
            toolCount: 1,
          },
          evidence: {
            toolSummaries: [
              {
                tool: "debug_analyze",
                callID: "call-debug-1",
                status: "completed",
                timeCreated: 1,
                durationMs: 12,
                confidence: 0.82,
              },
            ],
            summary: { debugAnalyzeCount: 1 },
          },
        },
        {
          schemaVersion: 1,
          kind: "ax-code-quality-replay-item",
          workflow: "debug",
          artifactKind: "debug_hypothesis",
          artifactID: "debug:session-debug-1:call-debug-1",
          sessionID: "session-debug-1",
          projectID: "project-debug",
          title: "hypothesis",
          createdAt: "2026-04-21T00:00:00.000Z",
          baseline: {
            source: "debug_analyze",
            confidence: 0.82,
            score: null,
            readiness: null,
            rank: 1,
          },
          context: {
            directory: "/repo",
            graphCommitSha: "def456",
            touchedFiles: ["src/app.ts"],
            diffSummary: { files: 1, additions: 2, deletions: 1 },
            eventCount: 3,
            toolCount: 1,
          },
          evidence: {
            toolSummaries: [
              {
                tool: "debug_analyze",
                callID: "call-debug-1",
                status: "completed",
                timeCreated: 1,
                durationMs: 12,
                confidence: 0.82,
              },
            ],
            summary: { error: "TypeError", hasStackTrace: true },
          },
        },
      ],
    })
    const labels: ProbabilisticRollout.Label[] = [
      {
        labelID: "label-debug-case",
        artifactID: "debug:session-debug-1",
        artifactKind: "debug_case",
        workflow: "debug",
        projectID: "project-debug",
        sessionID: "session-debug-1",
        labeledAt: "2026-04-21T00:05:00.000Z",
        labelSource: "human",
        labelVersion: 1,
        outcome: "validated",
      },
      {
        labelID: "label-debug-hypothesis",
        artifactID: "debug:session-debug-1:call-debug-1",
        artifactKind: "debug_hypothesis",
        workflow: "debug",
        projectID: "project-debug",
        sessionID: "session-debug-1",
        labeledAt: "2026-04-21T00:05:00.000Z",
        labelSource: "human",
        labelVersion: 1,
        outcome: "validated",
      },
    ]

    const summary = ProbabilisticRollout.summarizeReplayReadiness({ replay, labels })
    expect(summary.overallStatus).toBe("pass")
    expect(summary.readyForBenchmark).toBe(true)
    expect(summary.resolvedLabeledItems).toBe(2)
    expect(summary.nextAction).toBeNull()
  })
})

describe("ProbabilisticRollout.summarizeCalibration", () => {
  test("computes precision, recall, top-k precision, and calibration bins", () => {
    const items: ProbabilisticRollout.ReplayItem[] = [
      {
        schemaVersion: 1,
        kind: "ax-code-quality-replay-item",
        workflow: "review",
        artifactKind: "review_finding",
        artifactID: "a",
        sessionID: "ses_1",
        projectID: "proj_1",
        title: "A",
        createdAt: "2026-04-20T00:00:00.000Z",
        baseline: { source: "Risk.assess", confidence: 0.9, score: 80, readiness: "ready", rank: null },
        context: {
          directory: "/repo",
          graphCommitSha: "abc",
          touchedFiles: ["src/a.ts"],
          diffSummary: { files: 1, additions: 10, deletions: 2 },
          eventCount: 5,
          toolCount: 1,
        },
        evidence: { toolSummaries: [] },
      },
      {
        schemaVersion: 1,
        kind: "ax-code-quality-replay-item",
        workflow: "review",
        artifactKind: "review_finding",
        artifactID: "b",
        sessionID: "ses_1",
        projectID: "proj_1",
        title: "B",
        createdAt: "2026-04-20T00:00:00.000Z",
        baseline: { source: "Risk.assess", confidence: 0.2, score: 10, readiness: "ready", rank: null },
        context: {
          directory: "/repo",
          graphCommitSha: "abc",
          touchedFiles: ["src/b.ts"],
          diffSummary: { files: 1, additions: 1, deletions: 0 },
          eventCount: 5,
          toolCount: 1,
        },
        evidence: { toolSummaries: [] },
      },
      {
        schemaVersion: 1,
        kind: "ax-code-quality-replay-item",
        workflow: "debug",
        artifactKind: "debug_hypothesis",
        artifactID: "c",
        sessionID: "ses_2",
        projectID: "proj_1",
        title: "C",
        createdAt: "2026-04-20T00:00:00.000Z",
        baseline: { source: "debug_analyze", confidence: 0.8, score: null, readiness: null, rank: 1 },
        context: {
          directory: "/repo",
          graphCommitSha: "def",
          touchedFiles: [],
          diffSummary: { files: 0, additions: 0, deletions: 0 },
          eventCount: 3,
          toolCount: 1,
        },
        evidence: { toolSummaries: [] },
      },
    ]

    const labels: ProbabilisticRollout.Label[] = [
      {
        labelID: "lbl_a",
        artifactID: "a",
        artifactKind: "review_finding",
        workflow: "review",
        projectID: "proj_1",
        sessionID: "ses_1",
        labeledAt: "2026-04-20T00:00:00.000Z",
        labelSource: "human",
        labelVersion: 1,
        outcome: "accepted",
      },
      {
        labelID: "lbl_b",
        artifactID: "b",
        artifactKind: "review_finding",
        workflow: "review",
        projectID: "proj_1",
        sessionID: "ses_1",
        labeledAt: "2026-04-20T00:00:00.000Z",
        labelSource: "human",
        labelVersion: 1,
        outcome: "dismissed",
      },
      {
        labelID: "lbl_c",
        artifactID: "c",
        artifactKind: "debug_hypothesis",
        workflow: "debug",
        projectID: "proj_1",
        sessionID: "ses_2",
        labeledAt: "2026-04-20T00:00:00.000Z",
        labelSource: "human",
        labelVersion: 1,
        outcome: "validated",
      },
    ]

    const summary = ProbabilisticRollout.summarizeCalibration(items, labels, {
      threshold: 0.5,
      abstainBelow: 0.1,
      bins: 5,
    })

    expect(summary.labeledItems).toBe(3)
    expect(summary.consideredItems).toBe(3)
    expect(summary.source).toBe("baseline")
    expect(summary.precision).toBe(1)
    expect(summary.recall).toBe(1)
    expect(summary.falsePositiveRate).toBe(0)
    expect(summary.falseNegativeRate).toBe(0)
    expect(summary.precisionAt1).toBe(1)
    expect(summary.precisionAt3).toBeCloseTo(0.6667)
    expect(summary.calibrationError).not.toBeNull()

    const report = ProbabilisticRollout.renderCalibrationReport(summary)
    expect(report).toContain("## ax-code quality calibration report")
    expect(report).toContain("- source: baseline")
    expect(report).toContain("- precision: 1")
    expect(report).toContain("- precision@3: 0.6667")
  })

  test("compares baseline and candidate summaries and produces shadow records", () => {
    const items: ProbabilisticRollout.ReplayItem[] = [
      {
        schemaVersion: 1,
        kind: "ax-code-quality-replay-item",
        workflow: "review",
        artifactKind: "review_finding",
        artifactID: "a",
        sessionID: "ses_1",
        projectID: "proj_1",
        title: "A",
        createdAt: "2026-04-20T00:00:00.000Z",
        baseline: { source: "Risk.assess", confidence: 0.9, score: 80, readiness: "ready", rank: 1 },
        context: {
          directory: "/repo",
          graphCommitSha: "abc",
          touchedFiles: ["src/a.ts"],
          diffSummary: { files: 1, additions: 10, deletions: 2 },
          eventCount: 5,
          toolCount: 1,
        },
        evidence: { toolSummaries: [] },
      },
      {
        schemaVersion: 1,
        kind: "ax-code-quality-replay-item",
        workflow: "review",
        artifactKind: "review_finding",
        artifactID: "b",
        sessionID: "ses_1",
        projectID: "proj_1",
        title: "B",
        createdAt: "2026-04-20T00:00:00.000Z",
        baseline: { source: "Risk.assess", confidence: 0.2, score: 10, readiness: "ready", rank: 2 },
        context: {
          directory: "/repo",
          graphCommitSha: "abc",
          touchedFiles: ["src/b.ts"],
          diffSummary: { files: 1, additions: 1, deletions: 0 },
          eventCount: 5,
          toolCount: 1,
        },
        evidence: { toolSummaries: [] },
      },
      {
        schemaVersion: 1,
        kind: "ax-code-quality-replay-item",
        workflow: "debug",
        artifactKind: "debug_hypothesis",
        artifactID: "c",
        sessionID: "ses_2",
        projectID: "proj_1",
        title: "C",
        createdAt: "2026-04-20T00:00:00.000Z",
        baseline: { source: "debug_analyze", confidence: 0.8, score: null, readiness: null, rank: 1 },
        context: {
          directory: "/repo",
          graphCommitSha: "def",
          touchedFiles: [],
          diffSummary: { files: 0, additions: 0, deletions: 0 },
          eventCount: 3,
          toolCount: 1,
        },
        evidence: { toolSummaries: [] },
      },
    ]

    const labels: ProbabilisticRollout.Label[] = [
      {
        labelID: "lbl_a",
        artifactID: "a",
        artifactKind: "review_finding",
        workflow: "review",
        projectID: "proj_1",
        sessionID: "ses_1",
        labeledAt: "2026-04-20T00:00:00.000Z",
        labelSource: "human",
        labelVersion: 1,
        outcome: "accepted",
      },
      {
        labelID: "lbl_b",
        artifactID: "b",
        artifactKind: "review_finding",
        workflow: "review",
        projectID: "proj_1",
        sessionID: "ses_1",
        labeledAt: "2026-04-20T00:00:00.000Z",
        labelSource: "human",
        labelVersion: 1,
        outcome: "dismissed",
      },
      {
        labelID: "lbl_c",
        artifactID: "c",
        artifactKind: "debug_hypothesis",
        workflow: "debug",
        projectID: "proj_1",
        sessionID: "ses_2",
        labeledAt: "2026-04-20T00:00:00.000Z",
        labelSource: "human",
        labelVersion: 1,
        outcome: "validated",
      },
    ]

    const predictions: ProbabilisticRollout.PredictionFile = {
      schemaVersion: 1,
      kind: "ax-code-quality-prediction-file",
      source: "candidate-v1",
      generatedAt: "2026-04-20T00:00:00.000Z",
      predictions: [
        {
          artifactID: "a",
          workflow: "review",
          artifactKind: "review_finding",
          sessionID: "ses_1",
          source: "candidate-v1",
          confidence: 0.7,
          score: 70,
          readiness: "ready",
          rank: 2,
        },
        {
          artifactID: "b",
          workflow: "review",
          artifactKind: "review_finding",
          sessionID: "ses_1",
          source: "candidate-v1",
          confidence: 0.6,
          score: 60,
          readiness: "ready",
          rank: 1,
        },
        {
          artifactID: "c",
          workflow: "debug",
          artifactKind: "debug_hypothesis",
          sessionID: "ses_2",
          source: "candidate-v1",
          confidence: 0.4,
          score: null,
          readiness: null,
          rank: 2,
        },
      ],
    }

    const baseline = ProbabilisticRollout.summarizeCalibration(items, labels, { threshold: 0.5 })
    const candidate = ProbabilisticRollout.summarizeCalibration(items, labels, {
      threshold: 0.5,
      predictions: predictions.predictions,
      source: predictions.source,
    })

    expect(candidate.source).toBe("candidate-v1")
    expect(candidate.precision).toBe(0.5)
    expect(candidate.recall).toBe(0.5)
    expect(candidate.falsePositiveRate).toBe(1)
    expect(candidate.falseNegativeRate).toBe(0.5)

    const comparison = ProbabilisticRollout.compareCalibrationSummaries(baseline, candidate)
    expect(comparison.overallStatus).toBe("fail")
    expect(comparison.metrics.precision.delta).toBe(-0.5)
    expect(comparison.metrics.falsePositiveRate.delta).toBe(1)

    const comparisonReport = ProbabilisticRollout.renderCalibrationComparisonReport(comparison)
    expect(comparisonReport).toContain("## ax-code quality calibration comparison")
    expect(comparisonReport).toContain("- overall status: fail")

    const shadow = ProbabilisticRollout.buildShadowFile(items, predictions, {
      baselineThreshold: 0.5,
      candidateThreshold: 0.5,
    })
    const shadowSummary = ProbabilisticRollout.summarizeShadowFile(shadow)
    expect(shadowSummary.totalItems).toBe(3)
    expect(shadowSummary.comparableItems).toBe(3)
    expect(shadowSummary.predictionChangedItems).toBe(2)
    expect(shadowSummary.candidatePromotions).toBe(1)
    expect(shadowSummary.candidateDemotions).toBe(2)

    const shadowReport = ProbabilisticRollout.renderShadowReport(shadowSummary)
    expect(shadowReport).toContain("## ax-code quality shadow report")
    expect(shadowReport).toContain("- prediction changed items: 2")
  })
})

describe("QualityLabelStore", () => {
  async function clearSessionLabels(sessionID: string) {
    const keys = await Storage.list(["quality_label", sessionID])
    for (const parts of keys) {
      await Storage.remove(parts)
    }
  }

  test("appends labels, exports them by session, and rejects conflicting rewrites", async () => {
    const sessionID = `ses_quality_${Date.now()}`
    await clearSessionLabels(sessionID)

    const label: ProbabilisticRollout.Label = {
      labelID: "lbl_review_1",
      artifactID: "review:call_1:0",
      artifactKind: "review_finding",
      workflow: "review",
      projectID: "proj_1",
      sessionID,
      labeledAt: "2026-04-20T00:00:00.000Z",
      labelSource: "human",
      labelVersion: 1,
      outcome: "accepted",
    }

    try {
      await QualityLabelStore.append(label)
      await QualityLabelStore.append(label)

      const labels = await QualityLabelStore.list(sessionID)
      expect(labels).toHaveLength(1)
      expect(labels[0]?.labelID).toBe("lbl_review_1")

      const exported = await QualityLabelStore.exportFile({ sessionIDs: [sessionID] })
      expect(exported.labels).toHaveLength(1)
      expect(exported.labels[0]?.artifactID).toBe("review:call_1:0")

      await expect(
        QualityLabelStore.append({
          ...label,
          outcome: "dismissed",
        }),
      ).rejects.toThrow("already exists")
    } finally {
      await clearSessionLabels(sessionID)
    }
  })
})

describe("QualityShadow", () => {
  async function clearModelRegistry() {
    const keys = await Storage.list(["quality_model"])
    for (const parts of keys) {
      await Storage.remove(parts)
    }
    const promotionKeys = await Storage.list(["quality_model_promotion"])
    for (const parts of promotionKeys) {
      await Storage.remove(parts)
    }
    const rollbackKeys = await Storage.list(["quality_model_rollback"])
    for (const parts of rollbackKeys) {
      await Storage.remove(parts)
    }
    const approvalKeys = await Storage.list(["quality_model_approval"])
    for (const parts of approvalKeys) {
      await Storage.remove(parts)
    }
    const approvalPacketKeys = await Storage.list(["quality_model_approval_packet"])
    for (const parts of approvalPacketKeys) {
      await Storage.remove(parts)
    }
    const submissionBundleKeys = await Storage.list(["quality_model_submission_bundle"])
    for (const parts of submissionBundleKeys) {
      await Storage.remove(parts)
    }
    const reviewDossierKeys = await Storage.list(["quality_model_review_dossier"])
    for (const parts of reviewDossierKeys) {
      await Storage.remove(parts)
    }
    const boardDecisionKeys = await Storage.list(["quality_model_board_decision"])
    for (const parts of boardDecisionKeys) {
      await Storage.remove(parts)
    }
    const releaseDecisionRecordKeys = await Storage.list(["quality_model_release_decision_record"])
    for (const parts of releaseDecisionRecordKeys) {
      await Storage.remove(parts)
    }
    const releasePacketKeys = await Storage.list(["quality_model_release_packet"])
    for (const parts of releasePacketKeys) {
      await Storage.remove(parts)
    }
    const auditManifestKeys = await Storage.list(["quality_model_audit_manifest"])
    for (const parts of auditManifestKeys) {
      await Storage.remove(parts)
    }
    const archiveManifestKeys = await Storage.list(["quality_model_archive_manifest"])
    for (const parts of archiveManifestKeys) {
      await Storage.remove(parts)
    }
    const handoffPackageKeys = await Storage.list(["quality_model_handoff_package"])
    for (const parts of handoffPackageKeys) {
      await Storage.remove(parts)
    }
    const portableExportKeys = await Storage.list(["quality_model_portable_export"])
    for (const parts of portableExportKeys) {
      await Storage.remove(parts)
    }
    const packagedArchiveKeys = await Storage.list(["quality_model_packaged_archive"])
    for (const parts of packagedArchiveKeys) {
      await Storage.remove(parts)
    }
    const signedArchiveKeys = await Storage.list(["quality_model_signed_archive"])
    for (const parts of signedArchiveKeys) {
      await Storage.remove(parts)
    }
    const signedArchiveTrustKeys = await Storage.list(["quality_model_signed_archive_trust"])
    for (const parts of signedArchiveTrustKeys) {
      await Storage.remove(parts)
    }
    const signedArchiveAttestationPolicyKeys = await Storage.list(["quality_model_signed_archive_attestation_policy"])
    for (const parts of signedArchiveAttestationPolicyKeys) {
      await Storage.remove(parts)
    }
    const signedArchiveAttestationRecordKeys = await Storage.list(["quality_model_signed_archive_attestation_record"])
    for (const parts of signedArchiveAttestationRecordKeys) {
      await Storage.remove(parts)
    }
    const signedArchiveAttestationPacketKeys = await Storage.list(["quality_model_signed_archive_attestation_packet"])
    for (const parts of signedArchiveAttestationPacketKeys) {
      await Storage.remove(parts)
    }
    const signedArchiveGovernancePacketKeys = await Storage.list(["quality_model_signed_archive_governance_packet"])
    for (const parts of signedArchiveGovernancePacketKeys) {
      await Storage.remove(parts)
    }
    const signedArchiveReviewDossierKeys = await Storage.list(["quality_model_signed_archive_review_dossier"])
    for (const parts of signedArchiveReviewDossierKeys) {
      await Storage.remove(parts)
    }
    const exportBundleKeys = await Storage.list(["quality_model_export_bundle"])
    for (const parts of exportBundleKeys) {
      await Storage.remove(parts)
    }
    const adoptionReviewKeys = await Storage.list(["quality_model_adoption_review"])
    for (const parts of adoptionReviewKeys) {
      await Storage.remove(parts)
    }
    const adoptionDissentResolutionKeys = await Storage.list(["quality_model_adoption_dissent_resolution"])
    for (const parts of adoptionDissentResolutionKeys) {
      await Storage.remove(parts)
    }
    const adoptionDissentSupersessionKeys = await Storage.list(["quality_model_adoption_dissent_supersession"])
    for (const parts of adoptionDissentSupersessionKeys) {
      await Storage.remove(parts)
    }
    const adoptionDissentHandlingKeys = await Storage.list(["quality_model_adoption_dissent_handling"])
    for (const parts of adoptionDissentHandlingKeys) {
      await Storage.remove(parts)
    }
    const approvalPolicyKeys = await Storage.list(["quality_model_approval_policy"])
    for (const parts of approvalPolicyKeys) {
      await Storage.remove(parts)
    }
    const releasePolicyKeys = await Storage.list(["quality_model_release_policy"])
    for (const parts of releasePolicyKeys) {
      await Storage.remove(parts)
    }
    const reentryContextKeys = await Storage.list(["quality_model_reentry_context"])
    for (const parts of reentryContextKeys) {
      await Storage.remove(parts)
    }
    const reentryRemediationKeys = await Storage.list(["quality_model_reentry_remediation"])
    for (const parts of reentryRemediationKeys) {
      await Storage.remove(parts)
    }
    await Storage.remove(["quality_model_active", "current"])
  }

  function createModel(source: string): QualityCalibrationModel.ModelFile {
    return {
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-model",
      source,
      trainedAt: "2026-04-20T00:00:00.000Z",
      globalPrior: 0.5,
      laplaceAlpha: 2,
      requestedBinCount: 1,
      minBinCount: 1,
      training: {
        sessionIDs: ["ses_train_1"],
        labeledItems: 2,
        positives: 1,
        negatives: 1,
      },
      groups: [
        {
          workflow: "review",
          artifactKind: "review_run",
          totalCount: 2,
          positives: 1,
          negatives: 1,
          prior: 0.5,
          bins: [
            {
              start: 0,
              end: 1,
              count: 2,
              positives: 1,
              negatives: 1,
              avgBaselineConfidence: 0.5,
              empiricalRate: 0.5,
              smoothedRate: 0.55,
            },
          ],
        },
      ],
    }
  }

  function createBenchmarkBundle(source: string, status: "pass" | "warn" | "fail"): QualityCalibrationModel.BenchmarkBundle {
    return {
      schemaVersion: 1,
      kind: "ax-code-quality-benchmark-bundle",
      split: {
        ratio: 0.7,
        trainSessionIDs: ["ses_train_1", "ses_train_2"],
        evalSessionIDs: ["ses_eval_1"],
      },
      model: {
        ...createModel(source),
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
                smoothedRate: 0.58,
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
        source,
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
        candidateSource: source,
        overallStatus: status,
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
          precision: { baseline: 1, candidate: 1, delta: 0, direction: "higher_is_better", improvement: false, regression: false },
          recall: { baseline: 1, candidate: 1, delta: 0, direction: "higher_is_better", improvement: false, regression: false },
          falsePositiveRate: { baseline: null, candidate: null, delta: null, direction: "lower_is_better", improvement: false, regression: false },
          falseNegativeRate: { baseline: 0, candidate: 0, delta: 0, direction: "lower_is_better", improvement: false, regression: false },
          precisionAt1: { baseline: 1, candidate: 1, delta: 0, direction: "higher_is_better", improvement: false, regression: false },
          precisionAt3: { baseline: 1, candidate: 1, delta: 0, direction: "higher_is_better", improvement: false, regression: false },
          calibrationError: { baseline: 0, candidate: 0, delta: 0, direction: "lower_is_better", improvement: false, regression: false },
        },
        gates: [
          { name: "dataset-consistency", status: "pass", detail: "ok" },
        ],
      },
    }
  }

  function createWatchSummary(input: {
    source: string
    promotedAt: string
    status: "pass" | "warn" | "fail"
    totalRecords?: number
  }): QualityPromotionWatch.WatchSummary {
    const gateStatus = input.status === "pass" ? "pass" : input.status
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
            none: { minimumApprovals: 0, minimumRole: null, requireDistinctApprovers: false, requireIndependentReviewer: false, requirePriorApproverExclusion: false, maxPriorApproverOverlapRatio: null, reviewerCarryoverBudget: null, reviewerCarryoverLookbackPromotions: null, teamCarryoverBudget: null, teamCarryoverLookbackPromotions: null, maxPriorReportingChainOverlapRatio: null, reportingChainCarryoverBudget: null, reportingChainCarryoverLookbackPromotions: null, requireRoleCohortDiversity: false, minimumDistinctRoleCohorts: null, requireReviewerTeamDiversity: false, minimumDistinctReviewerTeams: null, requireReportingChainDiversity: false, minimumDistinctReportingChains: null, approvalConcentrationBudget: null, approvalConcentrationPreset: null, approvalConcentrationWeights: { approver: 1, team: 1, reportingChain: 1 } },
            allow_warn: { minimumApprovals: 1, minimumRole: "staff-engineer", requireDistinctApprovers: true, requireIndependentReviewer: false, requirePriorApproverExclusion: false, maxPriorApproverOverlapRatio: null, reviewerCarryoverBudget: null, reviewerCarryoverLookbackPromotions: null, teamCarryoverBudget: null, teamCarryoverLookbackPromotions: null, maxPriorReportingChainOverlapRatio: null, reportingChainCarryoverBudget: null, reportingChainCarryoverLookbackPromotions: null, requireRoleCohortDiversity: false, minimumDistinctRoleCohorts: null, requireReviewerTeamDiversity: false, minimumDistinctReviewerTeams: null, requireReportingChainDiversity: false, minimumDistinctReportingChains: null, approvalConcentrationBudget: null, approvalConcentrationPreset: null, approvalConcentrationWeights: { approver: 1, team: 1, reportingChain: 1 } },
            force: { minimumApprovals: 2, minimumRole: "manager", requireDistinctApprovers: true, requireIndependentReviewer: false, requirePriorApproverExclusion: false, maxPriorApproverOverlapRatio: null, reviewerCarryoverBudget: null, reviewerCarryoverLookbackPromotions: null, teamCarryoverBudget: null, teamCarryoverLookbackPromotions: null, maxPriorReportingChainOverlapRatio: null, reportingChainCarryoverBudget: null, reportingChainCarryoverLookbackPromotions: null, requireRoleCohortDiversity: false, minimumDistinctRoleCohorts: null, requireReviewerTeamDiversity: false, minimumDistinctReviewerTeams: null, requireReportingChainDiversity: false, minimumDistinctReportingChains: null, approvalConcentrationBudget: null, approvalConcentrationPreset: null, approvalConcentrationWeights: { approver: 1, team: 1, reportingChain: 1 } },
            reentry: { minimumApprovals: 1, minimumRole: "staff-engineer", requireDistinctApprovers: true, requireIndependentReviewer: true, requirePriorApproverExclusion: true, maxPriorApproverOverlapRatio: 0.5, reviewerCarryoverBudget: 0.5, reviewerCarryoverLookbackPromotions: 3, teamCarryoverBudget: 0.5, teamCarryoverLookbackPromotions: 3, maxPriorReportingChainOverlapRatio: 0.5, reportingChainCarryoverBudget: 0.5, reportingChainCarryoverLookbackPromotions: 3, requireRoleCohortDiversity: true, minimumDistinctRoleCohorts: 2, requireReviewerTeamDiversity: true, minimumDistinctReviewerTeams: 2, requireReportingChainDiversity: true, minimumDistinctReportingChains: 2, approvalConcentrationBudget: 0.4, approvalConcentrationPreset: "reviewer-heavy", approvalConcentrationWeights: { approver: 0.5, team: 0.25, reportingChain: 0.25 } },
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
        totalRecords: input.totalRecords ?? 8,
        sessionsCovered: input.totalRecords ?? 8,
      },
      shadow: {
        schemaVersion: 1,
        kind: "ax-code-quality-shadow-summary",
        baselineSource: "Risk.assess",
        candidateSource: input.source,
        totalItems: input.totalRecords ?? 8,
        comparableItems: input.totalRecords ?? 8,
        missingCandidateItems: 0,
        predictionChangedItems: input.status === "fail" ? 6 : 1,
        abstentionChangedItems: input.status === "fail" ? 4 : 0,
        avgConfidenceDelta: input.status === "fail" ? 0.34 : 0.04,
        maxAbsConfidenceDelta: input.status === "fail" ? 0.72 : 0.12,
        candidatePromotions: 0,
        candidateDemotions: 0,
      },
      predictionChangedRate: input.status === "fail" ? 0.75 : 0.125,
      abstentionChangedRate: input.status === "fail" ? 0.5 : 0,
      missingCandidateRate: 0,
      overallStatus: input.status,
      gates: [
        {
          name: input.status === "warn" ? "watch-volume" : "candidate-coverage",
          status: gateStatus,
          detail: input.status === "warn" ? "4 record(s) observed; target minimum is 5" : "coverage state",
        },
      ],
    }
  }

  async function createAndPersistAdoptionReviews(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviewers = ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
  ) {
    const suggestion = bundle.approvalPolicySuggestion
      ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    const reviews = []
    for (const reviewer of reviewers) {
      const review = QualityPromotionAdoptionReview.create({
        bundle,
        reviewer,
        role: "staff-engineer",
        rationale: suggestion.adoption.status === "accepted"
          ? null
          : "Reviewed and accepted the current policy adoption state for this promotion.",
      })
      await QualityPromotionAdoptionReview.append(review)
      reviews.push(review)
    }
    return reviews
  }

  async function createAndPersistAdoptionDissentResolution(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    targetReviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    resolver = "dissent-resolver@example.com",
  ) {
    const resolution = QualityPromotionAdoptionDissentResolution.create({
      bundle,
      targetReviews,
      resolver,
      role: "director",
      rationale: "Documented why the dissent is being overridden for this promotion.",
    })
    await QualityPromotionAdoptionDissentResolution.append(resolution)
    return resolution
  }

  async function createAndPersistAdoptionDissentSupersession(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    targetReviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    input?: {
      superseder?: string
      role?: string
      disposition?: QualityPromotionAdoptionDissentSupersession.Disposition
      rationale?: string
    },
  ) {
    const supersession = QualityPromotionAdoptionDissentSupersession.create({
      bundle,
      targetReviews,
      superseder: input?.superseder ?? targetReviews[0]?.reviewer ?? "dissent-superseder@example.com",
      role: input?.role ?? "staff-engineer",
      disposition: input?.disposition ?? "withdrawn",
      rationale: input?.rationale ?? "The earlier dissent has been superseded.",
    })
    await QualityPromotionAdoptionDissentSupersession.append(supersession)
    return supersession
  }

  async function createAndPersistAdoptionDissentHandling(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    input?: {
      reviews?: QualityPromotionAdoptionReview.ReviewArtifact[]
      resolutions?: QualityPromotionAdoptionDissentResolution.ResolutionArtifact[]
      supersessions?: QualityPromotionAdoptionDissentSupersession.SupersessionArtifact[]
    },
  ) {
    const handling = QualityPromotionAdoptionDissentHandling.create({
      bundle,
      reviews: input?.reviews ?? await QualityPromotionAdoptionReview.resolveForBundle(bundle),
      resolutions: input?.resolutions,
      supersessions: input?.supersessions,
    })
    await QualityPromotionAdoptionDissentHandling.append(handling)
    return handling
  }

  async function createAndPersistApprovalPacket(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    input?: {
      approvals?: QualityPromotionApproval.ApprovalArtifact[]
      adoptionReviews?: QualityPromotionAdoptionReview.ReviewArtifact[]
      dissentHandling?: QualityPromotionAdoptionDissentHandling.HandlingArtifact
    },
  ) {
    const approvals = input?.approvals
      ?? await QualityPromotionApprovalPacket.resolveApprovalsForBundle(bundle)
    const packet = QualityPromotionApprovalPacket.create({
      bundle,
      approvals,
      adoptionReviews: input?.adoptionReviews,
      dissentHandling: input?.dissentHandling,
    })
    await QualityPromotionApprovalPacket.append(packet)
    return packet
  }

  async function createAndPersistSubmissionBundle(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    input?: {
      approvalPacket?: QualityPromotionApprovalPacket.PacketArtifact
    },
  ) {
    const submission = QualityPromotionSubmissionBundle.create({
      decisionBundle,
      approvalPacket: input?.approvalPacket ?? await createAndPersistApprovalPacket(decisionBundle),
    })
    await QualityPromotionSubmissionBundle.append(submission)
    return submission
  }

  async function createAndPersistReviewDossier(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    input?: {
      submissionBundle?: QualityPromotionSubmissionBundle.BundleArtifact
    },
  ) {
    const dossier = QualityPromotionReviewDossier.create({
      submissionBundle: input?.submissionBundle ?? await createAndPersistSubmissionBundle(decisionBundle),
    })
    await QualityPromotionReviewDossier.append(dossier)
    return dossier
  }

  async function createAndPersistBoardDecision(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    input?: {
      reviewDossier?: QualityPromotionReviewDossier.DossierArtifact
      disposition?: QualityPromotionBoardDecision.Disposition
      overrideAccepted?: boolean
    },
  ) {
    const boardDecision = QualityPromotionBoardDecision.create({
      reviewDossier: input?.reviewDossier ?? await createAndPersistReviewDossier(decisionBundle),
      decider: "board-chair@example.com",
      role: "director",
      team: "quality-governance",
      reportingChain: "eng/quality/release-board",
      disposition: input?.disposition ?? "approved",
      overrideAccepted: input?.overrideAccepted ?? false,
      rationale: "Final board sign-off completed.",
    })
    await QualityPromotionBoardDecision.append(boardDecision)
    return boardDecision
  }

  async function createAndPersistReleaseDecisionRecord(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    input?: {
      boardDecision?: QualityPromotionBoardDecision.DecisionArtifact
    },
  ) {
    const record = QualityPromotionReleaseDecisionRecord.create({
      boardDecision: input?.boardDecision ?? await createAndPersistBoardDecision(decisionBundle),
    })
    await QualityPromotionReleaseDecisionRecord.append(record)
    return record
  }

  async function createAndPersistReleasePacket(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    input?: {
      releaseDecisionRecord?: QualityPromotionReleaseDecisionRecord.RecordArtifact
    },
  ) {
    const packet = QualityPromotionReleasePacket.create({
      releaseDecisionRecord: input?.releaseDecisionRecord ?? await createAndPersistReleaseDecisionRecord(decisionBundle),
    })
    await QualityPromotionReleasePacket.append(packet)
    return packet
  }

  async function clearSessionShadow(sessionID: string) {
    const keys = await Storage.list(["quality_shadow", sessionID])
    for (const parts of keys) {
      await Storage.remove(parts)
    }
  }

  test("registers immutable models and resolves an active model", async () => {
    const model: QualityCalibrationModel.ModelFile = {
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-model",
      source: "registry-model-v1",
      trainedAt: "2026-04-20T00:00:00.000Z",
      globalPrior: 0.5,
      laplaceAlpha: 2,
      requestedBinCount: 1,
      minBinCount: 1,
      training: {
        sessionIDs: ["ses_train_1"],
        labeledItems: 2,
        positives: 1,
        negatives: 1,
      },
      groups: [
        {
          workflow: "review",
          artifactKind: "review_run",
          totalCount: 2,
          positives: 1,
          negatives: 1,
          prior: 0.5,
          bins: [
            {
              start: 0,
              end: 1,
              count: 2,
              positives: 1,
              negatives: 1,
              avgBaselineConfidence: 0.5,
              empiricalRate: 0.5,
              smoothedRate: 0.55,
            },
          ],
        },
      ],
    }

    await clearModelRegistry()
    try {
      await QualityModelRegistry.register(model)
      await QualityModelRegistry.register(model)

      const listed = await QualityModelRegistry.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]?.model.source).toBe("registry-model-v1")

      const active = await QualityModelRegistry.activate(model.source)
      expect(active.source).toBe("registry-model-v1")
      const resolved = await QualityModelRegistry.resolveActiveModel()
      expect(resolved?.source).toBe("registry-model-v1")

      await expect(
        QualityModelRegistry.register({
          ...model,
          globalPrior: 0.9,
        }),
      ).rejects.toThrow("already exists")
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes only passing bundles and records the promotion", async () => {
    const passBundle = createBenchmarkBundle("promotion-model-v1", "pass")
    const failBundle = createBenchmarkBundle("promotion-model-fail-v1", "fail")

    await clearModelRegistry()
    try {
      await expect(QualityModelRegistry.promote(failBundle)).rejects.toThrow("comparison status is fail")

      const promoted = await QualityModelRegistry.promote(passBundle)
      expect(promoted.active.source).toBe("promotion-model-v1")
      expect(promoted.record.decision).toBe("pass")
      expect(promoted.record.eligibility?.decision).toBe("go")
      expect(promoted.record.approvalPolicySuggestion?.recommendation.workflow).toBe("review")
      expect(promoted.record.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationPreset).toBe("balanced")
      expect(promoted.record.approvalPolicySuggestion?.effectiveReentryPolicy).toBeNull()
      expect(promoted.record.approvalPolicySuggestion?.adoption.status).toBe("no_effective_policy")

      const active = await QualityModelRegistry.getActive()
      expect(active?.source).toBe("promotion-model-v1")

      const promotions = await QualityModelRegistry.listPromotions("promotion-model-v1")
      expect(promotions).toHaveLength(1)
      expect(promotions[0]?.benchmark.overallStatus).toBe("pass")
    } finally {
      await clearModelRegistry()
    }
  })

  test("rolls back a failed promotion watch to the previous active model and records the rollback", async () => {
    await clearModelRegistry()
    try {
      const previous = createModel("rollback-previous-v1")
      await QualityModelRegistry.register(previous)
      await QualityModelRegistry.activate(previous.source)

      const promoted = await QualityModelRegistry.promote(createBenchmarkBundle("rollback-candidate-v1", "pass"))
      const watch = createWatchSummary({
        source: promoted.record.source,
        promotedAt: promoted.record.promotedAt,
        status: "fail",
      })

      const rolledBack = await QualityModelRegistry.rollbackPromotion(promoted.record, watch)
      expect(rolledBack.active?.source).toBe("rollback-previous-v1")
      expect(rolledBack.record.decision).toBe("fail_guard")
      expect(rolledBack.record.rollbackTargetSource).toBe("rollback-previous-v1")
      expect(rolledBack.record.reentryContextID).toBe(rolledBack.record.rollbackID)
      expect(rolledBack.record.stability?.overallStatus).toBe("fail")
      expect(rolledBack.record.stability?.recentRollbackCount).toBe(1)

      const active = await QualityModelRegistry.getActive()
      expect(active?.source).toBe("rollback-previous-v1")

      const rollbacks = await QualityModelRegistry.listRollbacks("rollback-candidate-v1")
      expect(rollbacks).toHaveLength(1)
      expect(rollbacks[0]?.watch.overallStatus).toBe("fail")
      expect(rollbacks[0]?.watch.releasePolicy?.digest).toBe("rollback-watch-policy-digest")
      const reentryContext = await QualityReentryContext.latest("rollback-candidate-v1")
      expect(reentryContext?.rollbackID).toBe(rolledBack.record.rollbackID)
      expect(reentryContext?.watch.releasePolicyDigest).toBe("rollback-watch-policy-digest")
    } finally {
      await clearModelRegistry()
    }
  })

  test("requires explicit override to rollback a warn-only watch", async () => {
    await clearModelRegistry()
    try {
      const promoted = await QualityModelRegistry.promote(createBenchmarkBundle("rollback-warn-v1", "pass"))
      const watch = createWatchSummary({
        source: promoted.record.source,
        promotedAt: promoted.record.promotedAt,
        status: "warn",
        totalRecords: 4,
      })

      await expect(QualityModelRegistry.rollbackPromotion(promoted.record, watch)).rejects.toThrow("watch status is warn")

      const rolledBack = await QualityModelRegistry.rollbackPromotion(promoted.record, watch, {
        allowWarn: true,
      })
      expect(rolledBack.record.decision).toBe("warn_override")
      expect(rolledBack.active).toBeNull()

      const active = await QualityModelRegistry.getActive()
      expect(active).toBeUndefined()
    } finally {
      await clearModelRegistry()
    }
  })

  test("blocks direct re-promotion during the cooling window and requires approval for forced retry", async () => {
    await clearModelRegistry()
    try {
      const bundle = createBenchmarkBundle("cooldown-model-v1", "pass")
      const promoted = await QualityModelRegistry.promote(bundle)
      const watch = createWatchSummary({
        source: promoted.record.source,
        promotedAt: promoted.record.promotedAt,
        status: "fail",
      })
      const rolledBack = await QualityModelRegistry.rollbackPromotion(promoted.record, watch)
      expect(rolledBack.record.stability?.coolingWindowActive).toBe(true)

      await expect(QualityModelRegistry.promote(bundle)).rejects.toThrow("cooling window active")
      await expect(QualityModelRegistry.promote(bundle, { force: true })).rejects.toThrow(
        "reentry promotion requires approved decision bundle",
      )

      const releasePolicyResolution = await QualityPromotionReleasePolicyStore.resolve({
        policy: QualityPromotionReleasePolicy.defaults(),
      })
      const reentryContext = await QualityReentryContext.latest("cooldown-model-v1")
      const remediation = QualityReentryRemediation.create({
        context: reentryContext!,
        author: "owner@example.com",
        summary: "Captured remediation evidence before forced retry.",
        evidence: [
          {
            kind: "validation",
            detail: "Replayed the rollback scenario and confirmed the candidate path is stable.",
          },
        ],
        currentReleasePolicyDigest: QualityPromotionReleasePolicyStore.provenance(releasePolicyResolution).digest,
      })
      await QualityReentryRemediation.append(remediation)
      const built = await QualityModelRegistry.buildPromotionDecisionBundle(bundle, {
        releasePolicyResolution,
      })
      const approvalA = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "mgr1@example.com",
        role: "manager",
      })
      const approvalB = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "mgr2@example.com",
        role: "director",
      })
      await QualityPromotionApproval.append(approvalA)
      await QualityPromotionApproval.append(approvalB)
      const forcedAdoptionReview = await createAndPersistAdoptionReviews(built.decisionBundle)

      const forced = await QualityModelRegistry.promoteApprovedDecisionBundle(
        built.decisionBundle,
        [approvalA, approvalB],
        {
          force: true,
          adoptionReviews: forcedAdoptionReview,
          approvalPolicy: releasePolicyResolution.policy.approval,
          approvalPolicySource: releasePolicyResolution.source,
          projectID: releasePolicyResolution.projectID,
          releasePolicyResolution,
        },
      )
      expect(forced.active.source).toBe("cooldown-model-v1")
      expect(forced.record.decision).toBe("force")
      expect(forced.record.stability?.overallStatus).toBe("fail")
      expect(forced.record.eligibility?.decision).toBe("no_go")
    } finally {
      await clearModelRegistry()
    }
  })

  test("surfaces latest reentry remediation during promotion eligibility evaluation", async () => {
    await clearModelRegistry()
    try {
      const previous = createModel("remediation-previous-v1")
      await QualityModelRegistry.register(previous)
      await QualityModelRegistry.activate(previous.source)

      const bundle = createBenchmarkBundle("remediation-candidate-v1", "pass")
      const promoted = await QualityModelRegistry.promote(bundle)
      const watch = createWatchSummary({
        source: promoted.record.source,
        promotedAt: promoted.record.promotedAt,
        status: "fail",
      })
      const rolledBack = await QualityModelRegistry.rollbackPromotion(promoted.record, watch)
      const reentryContext = await QualityReentryContext.latest("remediation-candidate-v1")
      expect(reentryContext?.rollbackID).toBe(rolledBack.record.rollbackID)

      const remediation = QualityReentryRemediation.create({
        context: reentryContext!,
        author: "staff@example.com",
        summary: "Added replay validation evidence and narrowed the candidate retry path.",
        evidence: [
          {
            kind: "validation",
            detail: "Replayed the failing session and confirmed candidate coverage returned to 100%.",
          },
        ],
        currentReleasePolicyDigest: "rollback-watch-policy-digest",
      })
      await QualityReentryRemediation.append(remediation)

      const evaluation = await QualityModelRegistry.evaluatePromotionEligibility(bundle, {
        cooldownHours: 0,
        releasePolicyDigest: "rollback-watch-policy-digest",
      })
      expect(evaluation.reentryRemediation?.remediationID).toBe(remediation.remediationID)
      expect(evaluation.eligibility.remediation?.remediationID).toBe(remediation.remediationID)
      expect(evaluation.eligibility.remediation?.matchesCurrentReleasePolicyDigest).toBe(true)
      expect(evaluation.eligibility.gates.some((gate) => gate.name === "reentry:missing-remediation")).toBe(false)
      expect(evaluation.eligibility.gates.some((gate) => gate.name === "reentry:same-release-policy")).toBe(true)
    } finally {
      await clearModelRegistry()
    }
  })

  test("requires approved decision bundles for reentry promotions even when allowWarn is provided", async () => {
    await clearModelRegistry()
    try {
      const previous = createModel("reapproval-previous-v1")
      await QualityModelRegistry.register(previous)
      await QualityModelRegistry.activate(previous.source)

      const releasePolicyResolution = await QualityPromotionReleasePolicyStore.resolve({
        policy: QualityPromotionReleasePolicy.defaults(),
      })
      const releasePolicy = {
        policy: releasePolicyResolution.policy,
        provenance: QualityPromotionReleasePolicyStore.provenance(releasePolicyResolution),
      }
      const bundle = createBenchmarkBundle("reapproval-candidate-v1", "pass")
      const promoted = await QualityModelRegistry.promote(bundle, {
        releasePolicy,
      })
      const watch = createWatchSummary({
        source: promoted.record.source,
        promotedAt: promoted.record.promotedAt,
        status: "fail",
      })
      await QualityModelRegistry.rollbackPromotion(promoted.record, watch)
      const reentryContext = await QualityReentryContext.latest("reapproval-candidate-v1")
      const remediation = QualityReentryRemediation.create({
        context: reentryContext!,
        author: "staff@example.com",
        summary: "Validated the retry path and captured remediation evidence.",
        evidence: [
          {
            kind: "validation",
            detail: "Replayed the rollback scenario and confirmed stable behavior.",
          },
        ],
        currentReleasePolicyDigest: releasePolicy.provenance.digest,
      })
      await QualityReentryRemediation.append(remediation)

      await expect(
        QualityModelRegistry.promote(bundle, {
          allowWarn: true,
          cooldownHours: 0,
          releasePolicy,
        }),
      ).rejects.toThrow("reentry promotion requires approved decision bundle")

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(bundle, {
        cooldownHours: 0,
        releasePolicyResolution,
      })
      await expect(
        QualityModelRegistry.promoteDecisionBundle(built.decisionBundle, {
          allowWarn: true,
          releasePolicyResolution,
        }),
      ).rejects.toThrow("reentry promotion requires approved decision bundle")

      const selfApproval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "staff@example.com",
        role: "staff-engineer",
      })
      await QualityPromotionApproval.append(selfApproval)
      const reapprovalAdoptionReview = await createAndPersistAdoptionReviews(built.decisionBundle)

      await expect(
        QualityModelRegistry.promoteApprovedDecisionBundle(
          built.decisionBundle,
          selfApproval,
          {
            allowWarn: true,
            adoptionReviews: reapprovalAdoptionReview,
            approvalPolicy: releasePolicyResolution.policy.approval,
            approvalPolicySource: releasePolicyResolution.source,
            projectID: releasePolicyResolution.projectID,
            releasePolicyResolution,
          },
        ),
      ).rejects.toThrow("approval policy not satisfied")

      const independentApproval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "principal-engineer",
      })
      await QualityPromotionApproval.append(independentApproval)

      const rePromoted = await QualityModelRegistry.promoteApprovedDecisionBundle(
        built.decisionBundle,
        [selfApproval, independentApproval],
        {
          allowWarn: true,
          adoptionReviews: reapprovalAdoptionReview,
          approvalPolicy: releasePolicyResolution.policy.approval,
          approvalPolicySource: releasePolicyResolution.source,
          projectID: releasePolicyResolution.projectID,
          releasePolicyResolution,
        },
      )
      expect(rePromoted.active.source).toBe("reapproval-candidate-v1")
      expect(rePromoted.record.approval?.approver).toBe("staff@example.com")
      expect(rePromoted.record.eligibility?.reentryContext?.rollbackID).toBeDefined()
    } finally {
      await clearModelRegistry()
    }
  })

  test("requires at least one fresh approver beyond the rolled-back promotion approver set", async () => {
    await clearModelRegistry()
    try {
      const previous = createModel("fresh-approver-previous-v1")
      await QualityModelRegistry.register(previous)
      await QualityModelRegistry.activate(previous.source)

      const releasePolicyResolution = await QualityPromotionReleasePolicyStore.resolve({
        policy: QualityPromotionReleasePolicy.defaults(),
      })
      const initialBundle = createBenchmarkBundle("fresh-approver-candidate-v1", "pass")
      const initialDecision = await QualityModelRegistry.buildPromotionDecisionBundle(initialBundle, {
        releasePolicyResolution,
      })
      const priorApprovalA = QualityPromotionApproval.create({
        bundle: initialDecision.decisionBundle,
        approver: "prior1@example.com",
        role: "manager",
      })
      const priorApprovalB = QualityPromotionApproval.create({
        bundle: initialDecision.decisionBundle,
        approver: "prior2@example.com",
        role: "director",
      })
      await QualityPromotionApproval.append(priorApprovalA)
      await QualityPromotionApproval.append(priorApprovalB)
      const initialAdoptionReview = await createAndPersistAdoptionReviews(initialDecision.decisionBundle)
      const initialPromotion = await QualityModelRegistry.promoteApprovedDecisionBundle(
        initialDecision.decisionBundle,
        [priorApprovalA, priorApprovalB],
        {
          adoptionReviews: initialAdoptionReview,
          approvalPolicy: releasePolicyResolution.policy.approval,
          approvalPolicySource: releasePolicyResolution.source,
          projectID: releasePolicyResolution.projectID,
          releasePolicyResolution,
        },
      )

      const watch = createWatchSummary({
        source: initialPromotion.record.source,
        promotedAt: initialPromotion.record.promotedAt,
        status: "fail",
      })
      await QualityModelRegistry.rollbackPromotion(initialPromotion.record, watch)
      const reentryContext = await QualityReentryContext.latest("fresh-approver-candidate-v1")
      const remediation = QualityReentryRemediation.create({
        context: reentryContext!,
        author: "owner@example.com",
        summary: "Validated the retry path after rollback.",
        evidence: [
          {
            kind: "validation",
            detail: "Replayed the rollback scenario and confirmed deterministic stability.",
          },
        ],
        currentReleasePolicyDigest: QualityPromotionReleasePolicyStore.provenance(releasePolicyResolution).digest,
      })
      await QualityReentryRemediation.append(remediation)

      const retryDecision = await QualityModelRegistry.buildPromotionDecisionBundle(initialBundle, {
        cooldownHours: 0,
        releasePolicyResolution,
      })
      const repeatedApprovalA = QualityPromotionApproval.create({
        bundle: retryDecision.decisionBundle,
        approver: "prior1@example.com",
        role: "manager",
      })
      const repeatedApprovalB = QualityPromotionApproval.create({
        bundle: retryDecision.decisionBundle,
        approver: "prior2@example.com",
        role: "director",
      })
      await QualityPromotionApproval.append(repeatedApprovalA)
      await QualityPromotionApproval.append(repeatedApprovalB)
      const retryAdoptionReview = await createAndPersistAdoptionReviews(retryDecision.decisionBundle)

      await expect(
        QualityModelRegistry.promoteApprovedDecisionBundle(
          retryDecision.decisionBundle,
          [repeatedApprovalA, repeatedApprovalB],
          {
            allowWarn: true,
            adoptionReviews: retryAdoptionReview,
            approvalPolicy: releasePolicyResolution.policy.approval,
            approvalPolicySource: releasePolicyResolution.source,
            projectID: releasePolicyResolution.projectID,
            releasePolicyResolution,
          },
        ),
      ).rejects.toThrow("approval policy not satisfied")

      const freshApproval = QualityPromotionApproval.create({
        bundle: retryDecision.decisionBundle,
        approver: "fresh@example.com",
        role: "director",
      })
      await QualityPromotionApproval.append(freshApproval)

      const retryPromotion = await QualityModelRegistry.promoteApprovedDecisionBundle(
        retryDecision.decisionBundle,
        [repeatedApprovalA, freshApproval],
        {
          allowWarn: true,
          adoptionReviews: retryAdoptionReview,
          approvalPolicy: releasePolicyResolution.policy.approval,
          approvalPolicySource: releasePolicyResolution.source,
          projectID: releasePolicyResolution.projectID,
          releasePolicyResolution,
        },
      )
      expect(retryPromotion.active.source).toBe("fresh-approver-candidate-v1")
      expect(retryPromotion.record.approvalPolicy?.freshQualifiedApprovals).toBe(1)
      expect(retryPromotion.record.approvalPolicy?.overlappingQualifiedApprovers).toBe(1)
      expect(retryPromotion.record.approvalPolicy?.priorApproverOverlapRatio).toBe(0.5)
      expect(retryPromotion.record.eligibility?.reentryContext?.priorPromotionApprovers).toEqual([
        "prior1@example.com",
        "prior2@example.com",
      ])
    } finally {
      await clearModelRegistry()
    }
  })

  test("limits reviewer carryover across repeated reentry promotions", async () => {
    await clearModelRegistry()
    try {
      const previous = createModel("carryover-previous-v1")
      await QualityModelRegistry.register(previous)
      await QualityModelRegistry.activate(previous.source)

      const releasePolicyResolution = await QualityPromotionReleasePolicyStore.resolve({
        policy: QualityPromotionReleasePolicy.defaults(),
      })
      const candidateBundle = createBenchmarkBundle("carryover-candidate-v1", "pass")
      const initialDecision = await QualityModelRegistry.buildPromotionDecisionBundle(candidateBundle, {
        releasePolicyResolution,
      })
      const initialApprovalA = QualityPromotionApproval.create({
        bundle: initialDecision.decisionBundle,
        approver: "initial1@example.com",
        role: "manager",
      })
      const initialApprovalB = QualityPromotionApproval.create({
        bundle: initialDecision.decisionBundle,
        approver: "initial2@example.com",
        role: "director",
      })
      await QualityPromotionApproval.append(initialApprovalA)
      await QualityPromotionApproval.append(initialApprovalB)
      const initialCarryoverAdoptionReview = await createAndPersistAdoptionReviews(initialDecision.decisionBundle)
      const initialPromotion = await QualityModelRegistry.promoteApprovedDecisionBundle(
        initialDecision.decisionBundle,
        [initialApprovalA, initialApprovalB],
        {
          adoptionReviews: initialCarryoverAdoptionReview,
          approvalPolicy: releasePolicyResolution.policy.approval,
          approvalPolicySource: releasePolicyResolution.source,
          projectID: releasePolicyResolution.projectID,
          releasePolicyResolution,
        },
      )

      await QualityModelRegistry.rollbackPromotion(
        initialPromotion.record,
        createWatchSummary({
          source: initialPromotion.record.source,
          promotedAt: initialPromotion.record.promotedAt,
          status: "fail",
        }),
      )
      const reentryContextOne = await QualityReentryContext.latest("carryover-candidate-v1")
      await QualityReentryRemediation.append(QualityReentryRemediation.create({
        context: reentryContextOne!,
        author: "owner@example.com",
        summary: "Prepared first retry after rollback.",
        evidence: [
          {
            kind: "validation",
            detail: "Confirmed the first retry path is deterministic.",
          },
        ],
        currentReleasePolicyDigest: QualityPromotionReleasePolicyStore.provenance(releasePolicyResolution).digest,
      }))

      const retryDecisionOne = await QualityModelRegistry.buildPromotionDecisionBundle(candidateBundle, {
        cooldownHours: 0,
        releasePolicyResolution,
      })
      const carryApproval = QualityPromotionApproval.create({
        bundle: retryDecisionOne.decisionBundle,
        approver: "carry@example.com",
        role: "principal-engineer",
        team: "quality-platform",
        reportingChain: "eng/platform/director-a",
      })
      const freshApprovalOne = QualityPromotionApproval.create({
        bundle: retryDecisionOne.decisionBundle,
        approver: "fresh1@example.com",
        role: "director",
        team: "release",
        reportingChain: "eng/release/director-b",
      })
      await QualityPromotionApproval.append(carryApproval)
      await QualityPromotionApproval.append(freshApprovalOne)
      const retryAdoptionReviewOne = await createAndPersistAdoptionReviews(retryDecisionOne.decisionBundle)
      const reentryPromotionOne = await QualityModelRegistry.promoteApprovedDecisionBundle(
        retryDecisionOne.decisionBundle,
        [carryApproval, freshApprovalOne],
        {
          allowWarn: true,
          adoptionReviews: retryAdoptionReviewOne,
          approvalPolicy: releasePolicyResolution.policy.approval,
          approvalPolicySource: releasePolicyResolution.source,
          projectID: releasePolicyResolution.projectID,
          releasePolicyResolution,
        },
      )

      await QualityModelRegistry.rollbackPromotion(
        reentryPromotionOne.record,
        createWatchSummary({
          source: reentryPromotionOne.record.source,
          promotedAt: reentryPromotionOne.record.promotedAt,
          status: "fail",
        }),
      )
      const reentryContextTwo = await QualityReentryContext.latest("carryover-candidate-v1")
      await QualityReentryRemediation.append(QualityReentryRemediation.create({
        context: reentryContextTwo!,
        author: "owner@example.com",
        summary: "Prepared second retry after repeated rollback.",
        evidence: [
          {
            kind: "validation",
            detail: "Confirmed the repeated retry path remains reproducible.",
          },
        ],
        currentReleasePolicyDigest: QualityPromotionReleasePolicyStore.provenance(releasePolicyResolution).digest,
      }))

      const retryDecisionTwo = await QualityModelRegistry.buildPromotionDecisionBundle(candidateBundle, {
        cooldownHours: 0,
        releasePolicyResolution,
      })
      expect(retryDecisionTwo.decisionBundle.eligibility.reentryContext?.reviewerCarryoverHistory).toEqual([
        {
          approver: "carry@example.com",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: reentryPromotionOne.record.promotionID,
          mostRecentPromotedAt: reentryPromotionOne.record.promotedAt,
        },
        {
          approver: "fresh1@example.com",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: reentryPromotionOne.record.promotionID,
          mostRecentPromotedAt: reentryPromotionOne.record.promotedAt,
        },
      ])
      expect(retryDecisionTwo.decisionBundle.eligibility.reentryContext?.priorPromotionReportingChains).toEqual([
        "eng/platform/director-a",
        "eng/release/director-b",
      ])
      expect(retryDecisionTwo.decisionBundle.eligibility.reentryContext?.teamCarryoverHistory).toEqual([
        {
          team: "quality-platform",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: reentryPromotionOne.record.promotionID,
          mostRecentPromotedAt: reentryPromotionOne.record.promotedAt,
        },
        {
          team: "release",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: reentryPromotionOne.record.promotionID,
          mostRecentPromotedAt: reentryPromotionOne.record.promotedAt,
        },
      ])
      expect(retryDecisionTwo.decisionBundle.eligibility.reentryContext?.reportingChainCarryoverHistory).toEqual([
        {
          reportingChain: "eng/platform/director-a",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: reentryPromotionOne.record.promotionID,
          mostRecentPromotedAt: reentryPromotionOne.record.promotedAt,
        },
        {
          reportingChain: "eng/release/director-b",
          weightedReuseScore: 1,
          appearances: 1,
          mostRecentPromotionID: reentryPromotionOne.record.promotionID,
          mostRecentPromotedAt: reentryPromotionOne.record.promotedAt,
        },
      ])

      const carryApprovalAgain = QualityPromotionApproval.create({
        bundle: retryDecisionTwo.decisionBundle,
        approver: "carry@example.com",
        role: "principal-engineer",
        team: "quality-platform",
        reportingChain: "eng/platform/director-a",
      })
      const freshApprovalTwo = QualityPromotionApproval.create({
        bundle: retryDecisionTwo.decisionBundle,
        approver: "fresh2@example.com",
        role: "director",
        team: "release",
        reportingChain: "eng/release/director-b",
      })
      await QualityPromotionApproval.append(carryApprovalAgain)
      await QualityPromotionApproval.append(freshApprovalTwo)
      const retryAdoptionReviewTwo = await createAndPersistAdoptionReviews(retryDecisionTwo.decisionBundle)

      await expect(
        QualityModelRegistry.promoteApprovedDecisionBundle(
          retryDecisionTwo.decisionBundle,
          [carryApprovalAgain, freshApprovalTwo],
          {
            allowWarn: true,
            adoptionReviews: retryAdoptionReviewTwo,
            approvalPolicy: releasePolicyResolution.policy.approval,
            approvalPolicySource: releasePolicyResolution.source,
            projectID: releasePolicyResolution.projectID,
            releasePolicyResolution,
          },
        ),
      ).rejects.toThrow("approval policy not satisfied")

      const rotatedApprovalIc = QualityPromotionApproval.create({
        bundle: retryDecisionTwo.decisionBundle,
        approver: "fresh3@example.com",
        role: "staff-engineer",
        team: "security",
        reportingChain: "eng/security/director-c",
      })
      const rotatedApprovalMgr = QualityPromotionApproval.create({
        bundle: retryDecisionTwo.decisionBundle,
        approver: "fresh4@example.com",
        role: "director",
        team: "data",
        reportingChain: "eng/data/director-d",
      })
      await QualityPromotionApproval.append(rotatedApprovalIc)
      await QualityPromotionApproval.append(rotatedApprovalMgr)

      const reentryPromotionTwo = await QualityModelRegistry.promoteApprovedDecisionBundle(
        retryDecisionTwo.decisionBundle,
        [rotatedApprovalIc, rotatedApprovalMgr],
        {
          allowWarn: true,
          adoptionReviews: retryAdoptionReviewTwo,
          approvalPolicy: releasePolicyResolution.policy.approval,
          approvalPolicySource: releasePolicyResolution.source,
          projectID: releasePolicyResolution.projectID,
          releasePolicyResolution,
        },
      )
      expect(reentryPromotionTwo.active.source).toBe("carryover-candidate-v1")
      expect(reentryPromotionTwo.record.approvalPolicy?.reviewerCarryoverBudget).toBe(0.5)
      expect(reentryPromotionTwo.record.approvalPolicy?.reviewerCarryoverScore).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.carriedOverQualifiedApprovers).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.teamCarryoverBudget).toBe(0.5)
      expect(reentryPromotionTwo.record.approvalPolicy?.teamCarryoverScore).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.carriedOverQualifiedTeams).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.distinctQualifiedRoleCohorts).toBe(2)
      expect(reentryPromotionTwo.record.approvalPolicy?.distinctQualifiedReviewerTeams).toBe(2)
      expect(reentryPromotionTwo.record.approvalPolicy?.missingQualifiedReviewerTeams).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.distinctQualifiedReportingChains).toBe(2)
      expect(reentryPromotionTwo.record.approvalPolicy?.missingQualifiedReportingChains).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.reportingChainCarryoverScore).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.carriedOverQualifiedReportingChains).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.approvalConcentrationBudget).toBe(0.4)
      expect(reentryPromotionTwo.record.approvalPolicy?.approvalConcentrationPreset).toBe("reviewer-heavy")
      expect(reentryPromotionTwo.record.approvalPolicy?.approvalConcentrationWeights).toEqual({
        approver: 0.5,
        team: 0.25,
        reportingChain: 0.25,
      })
      expect(reentryPromotionTwo.record.approvalPolicy?.approvalConcentrationScore).toBe(0)
      expect(reentryPromotionTwo.record.approvalPolicy?.approvalConcentrationApplicableAxes).toEqual([
        "approver",
        "team",
        "reporting_chain",
      ])
      expect(reentryPromotionTwo.record.approvalPolicy?.approvalConcentrationAppliedWeightTotal).toBe(1)
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from a decision bundle and rejects stale decision snapshots", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("decision-current-v1")
      const drift = createModel("decision-drift-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.register(drift)
      await QualityModelRegistry.activate(current.source)

      const targetBundle = createBenchmarkBundle("decision-target-v1", "pass")
      const releasePolicyResolution = await QualityPromotionReleasePolicyStore.resolve({
        policy: QualityPromotionReleasePolicy.defaults({
          watch: {
            minRecords: 25,
          },
        }),
      })
      const changedReleasePolicyResolution = await QualityPromotionReleasePolicyStore.resolve({
        policy: QualityPromotionReleasePolicy.defaults({
          watch: {
            minRecords: 40,
          },
        }),
      })
      const built = await QualityModelRegistry.buildPromotionDecisionBundle(targetBundle, {
        releasePolicyResolution,
      })
      expect(built.decisionBundle.eligibility.decision).toBe("go")
      expect(built.decisionBundle.releasePolicy?.provenance.digest).toBe(
        QualityPromotionReleasePolicyStore.provenance(releasePolicyResolution).digest,
      )

      await expect(
        QualityModelRegistry.promoteDecisionBundle(built.decisionBundle, {
          releasePolicyResolution: changedReleasePolicyResolution,
        }),
      ).rejects.toThrow("decision bundle is stale")

      const promoted = await QualityModelRegistry.promoteDecisionBundle(built.decisionBundle, {
        releasePolicyResolution,
      })
      expect(promoted.active.source).toBe("decision-target-v1")
      expect(promoted.record.decisionBundleCreatedAt).toBe(built.decisionBundle.createdAt)
      expect(promoted.record.releasePolicy?.digest).toBe(built.decisionBundle.releasePolicy?.provenance.digest)
      expect(promoted.record.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationPreset).toBe(
        built.decisionBundle.approvalPolicySuggestion?.suggestedReentryPolicy.approvalConcentrationPreset,
      )
      expect(promoted.record.approvalPolicySuggestion?.alignment?.overall).toBe(
        built.decisionBundle.approvalPolicySuggestion?.alignment?.overall,
      )
      expect(promoted.record.approvalPolicySuggestion?.adoption.status).toBe(
        built.decisionBundle.approvalPolicySuggestion?.adoption.status,
      )

      const staleDecision = QualityPromotionDecisionBundle.DecisionBundle.parse({
        ...built.decisionBundle,
        createdAt: "2026-04-20T00:00:00.000Z",
      })
      await QualityModelRegistry.activate(drift.source)

      await expect(
        QualityModelRegistry.promoteDecisionBundle(staleDecision, {
          releasePolicyResolution,
        }),
      ).rejects.toThrow("decision bundle is stale")
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from an approved decision bundle and records the approver", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("approval-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("approval-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      const insufficientAdoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com"],
      )

      await expect(
        QualityModelRegistry.promoteApprovedDecisionBundle(built.decisionBundle, approval, {
          adoptionReviews: insufficientAdoptionReviews,
        }),
      ).rejects.toThrow("adoption review consensus not satisfied")

      const approvalTargetAdoptionReview = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-2@example.com", "policy-reviewer-3@example.com"],
      )

      const promoted = await QualityModelRegistry.promoteApprovedDecisionBundle(built.decisionBundle, approval, {
        adoptionReviews: [approvalTargetAdoptionReview[0]!],
      })
      expect(promoted.active.source).toBe("approval-target-v1")
      expect(promoted.record.approval?.approver).toBe("reviewer@example.com")
      expect(promoted.record.approval?.approvalID).toBe(approval.approvalID)
      expect(promoted.record.adoptionReviewConsensus?.overallStatus).toBe("pass")
      expect(promoted.record.adoptionReviewConsensus?.requiredReviews).toBe(2)
      expect(promoted.record.adoptionReviewConsensus?.qualifyingReviews).toBe(3)
      expect(promoted.record.adoptionReviews).toHaveLength(3)
    } finally {
      await clearModelRegistry()
    }
  })

  test("blocks approved decision bundle promotion when a qualified rejection adoption review exists", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("adoption-dissent-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("adoption-dissent-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      await createAndPersistAdoptionReviews(built.decisionBundle)
      const dissent = QualityPromotionAdoptionReview.create({
        bundle: built.decisionBundle,
        reviewer: "staff-dissent@example.com",
        role: "staff-engineer",
        disposition: "rejected",
        rationale: "Policy divergence should not be accepted in the current form.",
      })
      await QualityPromotionAdoptionReview.append(dissent)

      await expect(
        QualityModelRegistry.promoteApprovedDecisionBundle(built.decisionBundle, approval),
      ).rejects.toThrow("adoption dissent handling not satisfied")

      const resolution = await createAndPersistAdoptionDissentResolution(built.decisionBundle, [dissent])
      const promoted = await QualityModelRegistry.promoteApprovedDecisionBundle(built.decisionBundle, approval, {
        dissentResolutions: resolution,
      })
      expect(promoted.active.source).toBe("adoption-dissent-target-v1")
      expect(promoted.record.adoptionDissentResolution?.overallStatus).toBe("pass")
      expect(promoted.record.adoptionDissentResolution?.coveredQualifiedRejectingReviews).toBe(1)
      expect(promoted.record.adoptionDissentResolutions).toHaveLength(1)
    } finally {
      await clearModelRegistry()
    }
  })

  test("allows approved decision bundle promotion when qualified dissent is superseded without a separate resolution", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("adoption-supersession-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("adoption-supersession-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const dissent = QualityPromotionAdoptionReview.create({
        bundle: built.decisionBundle,
        reviewer: "staff-dissent@example.com",
        role: "staff-engineer",
        disposition: "rejected",
        rationale: "Policy divergence should not be accepted in the current form.",
      })
      await QualityPromotionAdoptionReview.append(dissent)

      const supersession = await createAndPersistAdoptionDissentSupersession(
        built.decisionBundle,
        [dissent],
        {
          superseder: dissent.reviewer,
          role: "staff-engineer",
          disposition: "withdrawn",
          rationale: "The earlier dissent is withdrawn after additional review.",
        },
      )
      const promoted = await QualityModelRegistry.promoteApprovedDecisionBundle(built.decisionBundle, approval, {
        dissentSupersessions: supersession,
      })
      expect(promoted.active.source).toBe("adoption-supersession-target-v1")
      expect(promoted.record.adoptionDissentSupersession?.overallStatus).toBe("pass")
      expect(promoted.record.adoptionDissentSupersession?.coveredQualifiedRejectingReviews).toBe(1)
      expect(promoted.record.adoptionDissentSupersessions).toHaveLength(1)
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from an approved decision bundle with a dissent handling bundle snapshot", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("adoption-handling-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("adoption-handling-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      const acceptedReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const dissent = QualityPromotionAdoptionReview.create({
        bundle: built.decisionBundle,
        reviewer: "staff-dissent@example.com",
        role: "staff-engineer",
        disposition: "rejected",
        rationale: "Policy divergence should not be accepted in the current form.",
      })
      await QualityPromotionAdoptionReview.append(dissent)
      const resolution = await createAndPersistAdoptionDissentResolution(built.decisionBundle, [dissent])
      const handling = await createAndPersistAdoptionDissentHandling(built.decisionBundle, {
        reviews: [...acceptedReviews, dissent],
        resolutions: [resolution],
      })

      const promoted = await QualityModelRegistry.promoteApprovedDecisionBundle(built.decisionBundle, approval, {
        adoptionReviews: [acceptedReviews[0]!],
        dissentHandling: handling,
      })
      expect(promoted.active.source).toBe("adoption-handling-target-v1")
      expect(promoted.record.adoptionDissentHandlingBundle?.handlingID).toBe(handling.handlingID)
      expect(promoted.record.adoptionDissentHandling?.overallStatus).toBe("pass")
      expect(promoted.record.adoptionDissentHandling?.coveredQualifiedRejectingReviews).toBe(1)
      expect(promoted.record.adoptionDissentResolution?.coveredQualifiedRejectingReviews).toBe(1)
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from an approval packet without separate approval or review inputs", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("approval-packet-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("approval-packet-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      const adoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const packet = await createAndPersistApprovalPacket(built.decisionBundle, {
        approvals: [approval],
        adoptionReviews,
      })

      const promoted = await QualityModelRegistry.promoteApprovedDecisionBundle(built.decisionBundle, undefined, {
        approvalPacket: packet,
      })
      expect(promoted.active.source).toBe("approval-packet-target-v1")
      expect(promoted.record.approvalPacket?.packetID).toBe(packet.packetID)
      expect(promoted.record.approvalPacket?.overallStatus).toBe("pass")
      expect(promoted.record.approval?.approver).toBe("reviewer@example.com")
      expect(promoted.record.adoptionReviewConsensus?.overallStatus).toBe("pass")
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from a submission bundle without separate dossier inputs", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("submission-bundle-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("submission-bundle-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      const adoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const approvalPacket = await createAndPersistApprovalPacket(built.decisionBundle, {
        approvals: [approval],
        adoptionReviews,
      })
      const submissionBundle = await createAndPersistSubmissionBundle(built.decisionBundle, {
        approvalPacket,
      })

      const promoted = await QualityModelRegistry.promoteSubmissionBundle(submissionBundle)
      expect(promoted.active.source).toBe("submission-bundle-target-v1")
      expect(promoted.record.submissionBundle?.submissionID).toBe(submissionBundle.submissionID)
      expect(promoted.record.submissionBundle?.overallStatus).toBe("pass")
      expect(promoted.record.approvalPacket?.packetID).toBe(approvalPacket.packetID)
      expect(promoted.record.approval?.approver).toBe("reviewer@example.com")
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from a review dossier without separate submission inputs", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("review-dossier-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("review-dossier-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      const adoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const approvalPacket = await createAndPersistApprovalPacket(built.decisionBundle, {
        approvals: [approval],
        adoptionReviews,
      })
      const submissionBundle = await createAndPersistSubmissionBundle(built.decisionBundle, {
        approvalPacket,
      })
      const reviewDossier = await createAndPersistReviewDossier(built.decisionBundle, {
        submissionBundle,
      })

      const promoted = await QualityModelRegistry.promoteReviewDossier(reviewDossier)
      expect(promoted.active.source).toBe("review-dossier-target-v1")
      expect(promoted.record.reviewDossier?.dossierID).toBe(reviewDossier.dossierID)
      expect(promoted.record.reviewDossier?.recommendation).toBe("approve_promotion")
      expect(promoted.record.submissionBundle?.submissionID).toBe(submissionBundle.submissionID)
      expect(promoted.record.approvalPacket?.packetID).toBe(approvalPacket.packetID)
      expect(promoted.record.approval?.approver).toBe("reviewer@example.com")
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from a board decision without separate review dossier inputs", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("board-decision-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("board-decision-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      const adoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const approvalPacket = await createAndPersistApprovalPacket(built.decisionBundle, {
        approvals: [approval],
        adoptionReviews,
      })
      const submissionBundle = await createAndPersistSubmissionBundle(built.decisionBundle, {
        approvalPacket,
      })
      const reviewDossier = await createAndPersistReviewDossier(built.decisionBundle, {
        submissionBundle,
      })
      const boardDecision = await createAndPersistBoardDecision(built.decisionBundle, {
        reviewDossier,
      })

      const promoted = await QualityModelRegistry.promoteBoardDecision(boardDecision)
      expect(promoted.active.source).toBe("board-decision-target-v1")
      expect(promoted.record.boardDecision?.decisionID).toBe(boardDecision.decisionID)
      expect(promoted.record.boardDecision?.decider).toBe("board-chair@example.com")
      expect(promoted.record.reviewDossier?.dossierID).toBe(reviewDossier.dossierID)
      expect(promoted.record.submissionBundle?.submissionID).toBe(submissionBundle.submissionID)
      expect(promoted.record.approvalPacket?.packetID).toBe(approvalPacket.packetID)
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from a release decision record without separate board inputs", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("release-decision-record-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("release-decision-record-target-v1", "pass"))
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      const adoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const approvalPacket = await createAndPersistApprovalPacket(built.decisionBundle, {
        approvals: [approval],
        adoptionReviews,
      })
      const submissionBundle = await createAndPersistSubmissionBundle(built.decisionBundle, {
        approvalPacket,
      })
      const reviewDossier = await createAndPersistReviewDossier(built.decisionBundle, {
        submissionBundle,
      })
      const boardDecision = await createAndPersistBoardDecision(built.decisionBundle, {
        reviewDossier,
      })
      const releaseDecisionRecord = await createAndPersistReleaseDecisionRecord(built.decisionBundle, {
        boardDecision,
      })

      const promoted = await QualityModelRegistry.promoteReleaseDecisionRecord(releaseDecisionRecord)
      expect(promoted.active.source).toBe("release-decision-record-target-v1")
      expect(promoted.record.releaseDecisionRecord?.recordID).toBe(releaseDecisionRecord.recordID)
      expect(promoted.record.releaseDecisionRecord?.promotionMode).toBe("pass")
      expect(promoted.record.boardDecision?.decisionID).toBe(boardDecision.decisionID)
      expect(promoted.record.reviewDossier?.dossierID).toBe(reviewDossier.dossierID)
      expect(promoted.record.submissionBundle?.submissionID).toBe(submissionBundle.submissionID)
    } finally {
      await clearModelRegistry()
    }
  })

  test("promotes from a release packet without separate release decision inputs", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("release-packet-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const releasePolicyResolution = await QualityPromotionReleasePolicyStore.resolve({
        projectID: "release-packet-project-1",
      })

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(
        createBenchmarkBundle("release-packet-target-v1", "pass"),
        { releasePolicyResolution },
      )
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "reviewer@example.com",
        role: "staff-engineer",
        rationale: "Eligibility and benchmark checked.",
      })
      await QualityPromotionApproval.append(approval)
      const adoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const approvalPacket = await createAndPersistApprovalPacket(built.decisionBundle, {
        approvals: [approval],
        adoptionReviews,
      })
      const submissionBundle = await createAndPersistSubmissionBundle(built.decisionBundle, {
        approvalPacket,
      })
      const reviewDossier = await createAndPersistReviewDossier(built.decisionBundle, {
        submissionBundle,
      })
      const boardDecision = await createAndPersistBoardDecision(built.decisionBundle, {
        reviewDossier,
      })
      const releaseDecisionRecord = await createAndPersistReleaseDecisionRecord(built.decisionBundle, {
        boardDecision,
      })
      const releasePacket = await createAndPersistReleasePacket(built.decisionBundle, {
        releaseDecisionRecord,
      })
      const trust = QualityPromotionSignedArchiveTrust.create({
        scope: "project",
        projectID: "release-packet-project-1",
        signing: {
          attestedBy: "release-integrity-bot",
          keyID: "archive-key-v1",
          keySource: "env",
          keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
          keyMaterial: "quality-archive-secret-v1",
        },
        effectiveFrom: "2020-01-01T00:00:00.000Z",
      })
      await QualityPromotionSignedArchiveTrust.append(trust)
      await QualityPromotionSignedArchiveAttestationPolicyStore.setProject(
        "release-packet-project-1",
        QualityPromotionSignedArchiveAttestationPolicy.defaults({
          minimumTrustScope: "project",
        }),
      )
      const attestationPolicyResolution = await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
        projectID: "release-packet-project-1",
      })

      const promoted = await QualityModelRegistry.promoteReleasePacket(releasePacket, {
        archiveSigning: {
          attestedBy: "release-integrity-bot",
          keyID: "archive-key-v1",
          keySource: "env",
          keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
          keyMaterial: "quality-archive-secret-v1",
        },
      })
      expect(promoted.active.source).toBe("release-packet-target-v1")
      expect(promoted.record.releasePacket?.packetID).toBe(releasePacket.packetID)
      expect(promoted.record.releasePacket?.promotionMode).toBe("pass")
      expect(promoted.record.releaseDecisionRecord?.recordID).toBe(releaseDecisionRecord.recordID)
      expect(promoted.record.boardDecision?.decisionID).toBe(boardDecision.decisionID)
      expect(promoted.record.auditManifest?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.auditManifest?.packetID).toBe(releasePacket.packetID)
      expect(promoted.record.exportBundle?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.exportBundle?.manifestID).toBe(promoted.record.auditManifest?.manifestID)
      expect(promoted.record.archiveManifest?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.archiveManifest?.bundleID).toBe(promoted.record.exportBundle?.bundleID)
      expect(promoted.record.handoffPackage?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.handoffPackage?.archiveID).toBe(promoted.record.archiveManifest?.archiveID)
      expect(promoted.record.portableExport?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.portableExport?.packageID).toBe(promoted.record.handoffPackage?.packageID)
      expect(promoted.record.packagedArchive?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.packagedArchive?.exportID).toBe(promoted.record.portableExport?.exportID)
      expect(promoted.record.signedArchive?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.signedArchive?.archiveID).toBe(promoted.record.packagedArchive?.archiveID)
      expect(promoted.record.signedArchiveTrust?.overallStatus).toBe("pass")
      expect(promoted.record.signedArchiveAttestation?.overallStatus).toBe("pass")
      expect(promoted.record.signedArchiveAttestation?.policySource).toBe("project")
      expect(promoted.record.signedArchiveAttestation?.policyProjectID).toBe("release-packet-project-1")
      expect(promoted.record.signedArchiveAttestationRecord?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.signedArchiveAttestationRecord?.signedArchiveID).toBe(promoted.record.signedArchive?.signedArchiveID)
      expect(promoted.record.signedArchiveAttestationRecord?.policySource).toBe("project")
      expect(promoted.record.signedArchiveAttestationPacket?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.signedArchiveAttestationPacket?.signedArchiveID).toBe(promoted.record.signedArchive?.signedArchiveID)
      expect(promoted.record.signedArchiveAttestationPacket?.policySource).toBe("project")
      expect(promoted.record.signedArchiveGovernancePacket?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.signedArchiveGovernancePacket?.releasePacketID).toBe(promoted.record.releasePacket?.packetID)
      expect(promoted.record.signedArchiveGovernancePacket?.signedArchiveID).toBe(promoted.record.signedArchive?.signedArchiveID)
      expect(promoted.record.signedArchiveGovernancePacket?.policySource).toBe("project")
      expect(promoted.record.signedArchiveReviewDossier?.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.signedArchiveReviewDossier?.governancePacketID).toBe(promoted.record.signedArchiveGovernancePacket?.packetID)
      expect(promoted.record.signedArchiveReviewDossier?.packageID).toBe(promoted.record.handoffPackage?.packageID)
      expect(promoted.record.signedArchiveReviewDossier?.policySource).toBe("project")
      const manifests = await QualityPromotionAuditManifest.list(promoted.record.source)
      expect(manifests).toHaveLength(1)
      expect(manifests[0]?.promotion.promotionID).toBe(promoted.record.promotionID)
      const exportBundles = await QualityPromotionExportBundle.list(promoted.record.source)
      expect(exportBundles).toHaveLength(1)
      expect(exportBundles[0]?.auditManifest.promotion.promotionID).toBe(promoted.record.promotionID)
      const archiveManifests = await QualityPromotionArchiveManifest.list(promoted.record.source)
      expect(archiveManifests).toHaveLength(1)
      expect(archiveManifests[0]?.exportBundle.auditManifest.promotion.promotionID).toBe(promoted.record.promotionID)
      const handoffPackages = await QualityPromotionHandoffPackage.list(promoted.record.source)
      expect(handoffPackages).toHaveLength(1)
      expect(handoffPackages[0]?.archiveManifest.exportBundle.auditManifest.promotion.promotionID).toBe(promoted.record.promotionID)
      const portableExports = await QualityPromotionPortableExport.list(promoted.record.source)
      expect(portableExports).toHaveLength(1)
      expect(portableExports[0]?.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID).toBe(promoted.record.promotionID)
      const packagedArchives = await QualityPromotionPackagedArchive.list(promoted.record.source)
      expect(packagedArchives).toHaveLength(1)
      expect(packagedArchives[0]?.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID).toBe(promoted.record.promotionID)
      const signedArchives = await QualityPromotionSignedArchive.list(promoted.record.source)
      expect(signedArchives).toHaveLength(1)
      expect(signedArchives[0]?.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID)
        .toBe(promoted.record.promotionID)
      const attestationRecords = await QualityPromotionSignedArchiveAttestationRecord.list(promoted.record.source)
      expect(attestationRecords).toHaveLength(1)
      expect(attestationRecords[0]?.promotionID).toBe(promoted.record.promotionID)
      expect(attestationRecords[0]?.summary.acceptedByPolicy).toBe(true)
      expect(attestationRecords[0]?.summary.policyProjectID).toBe("release-packet-project-1")
      expect(attestationRecords[0]?.signedArchive.signedArchiveID).toBe(signedArchives[0]?.signedArchiveID)
      const attestationPackets = await QualityPromotionSignedArchiveAttestationPacket.list(promoted.record.source)
      expect(attestationPackets).toHaveLength(1)
      expect(attestationPackets[0]?.promotion.promotionID).toBe(promoted.record.promotionID)
      expect(attestationPackets[0]?.summary.acceptedByPolicy).toBe(true)
      expect(attestationPackets[0]?.summary.policyProjectID).toBe("release-packet-project-1")
      expect(attestationPackets[0]?.attestationRecord.recordID).toBe(attestationRecords[0]?.recordID)
      expect(attestationPackets[0]?.summary.gates.map((gate) => gate.name)).toContain("promotion-reference-alignment")
      expect(attestationPackets[0]?.summary.gates.find((gate) => gate.name === "promotion-reference-alignment")?.status).toBe("pass")
      const governancePackets = await QualityPromotionSignedArchiveGovernancePacket.list(promoted.record.source)
      expect(governancePackets).toHaveLength(1)
      expect(governancePackets[0]?.promotion.promotionID).toBe(promoted.record.promotionID)
      expect(promoted.record.releasePacket).toBeDefined()
      expect(governancePackets[0]?.summary.releasePacketID).toBe(promoted.record.releasePacket!.packetID)
      expect(governancePackets[0]?.summary.policyProjectID).toBe("release-packet-project-1")
      expect(governancePackets[0]?.attestationPacket.packetID).toBe(attestationPackets[0]?.packetID)
      expect(governancePackets[0]?.summary.gates.map((gate) => gate.name)).toContain("release-packet-linkage")
      expect(governancePackets[0]?.summary.gates.find((gate) => gate.name === "release-packet-linkage")?.status).toBe("pass")
      const reviewDossiers = await QualityPromotionSignedArchiveReviewDossier.list(promoted.record.source)
      expect(reviewDossiers).toHaveLength(1)
      expect(reviewDossiers[0]?.governancePacket.packetID).toBe(governancePackets[0]?.packetID)
      expect(promoted.record.handoffPackage).toBeDefined()
      expect(reviewDossiers[0]?.handoffPackage.packageID).toBe(promoted.record.handoffPackage!.packageID)
      expect(reviewDossiers[0]?.summary.policyProjectID).toBe("release-packet-project-1")
      expect(reviewDossiers[0]?.summary.gates.map((gate) => gate.name)).toContain("promotion-linkage")
      expect(reviewDossiers[0]?.summary.gates.find((gate) => gate.name === "promotion-linkage")?.status).toBe("pass")
      expect(attestationRecords[0]?.summary.gates.map((gate) => gate.name)).toContain("trust-identity-alignment")
      expect(attestationRecords[0]?.summary.gates.map((gate) => gate.name)).toContain("attestation-trust-consistency")
      const tamperedTrustIdentity = QualityPromotionSignedArchiveAttestationRecord.RecordArtifact.parse({
        ...attestationRecords[0]!,
        trust: {
          ...attestationRecords[0]!.trust,
          attestedBy: "tampered-attestor@example.com",
        },
      })
      expect(
        QualityPromotionSignedArchiveAttestationRecord.verify(tamperedTrustIdentity).some((reason) =>
          reason.includes("attestation record summary mismatch")
        ),
      ).toBe(true)
      const tamperedAttestationTrustDrift = QualityPromotionSignedArchiveAttestationRecord.RecordArtifact.parse({
        ...attestationRecords[0]!,
        attestation: {
          ...attestationRecords[0]!.attestation,
          trustStatus: "fail",
        },
      })
      expect(
        QualityPromotionSignedArchiveAttestationRecord.verify(tamperedAttestationTrustDrift).some((reason) =>
          reason.includes("attestation record summary mismatch")
        ),
      ).toBe(true)
      const tamperedAttestationPacketPromotion = QualityPromotionSignedArchiveAttestationPacket.PacketArtifact.parse({
        ...attestationPackets[0]!,
        promotion: {
          ...attestationPackets[0]!.promotion,
          decision: "force",
        },
      })
      expect(
        QualityPromotionSignedArchiveAttestationPacket.verify(tamperedAttestationPacketPromotion).some((reason) =>
          reason.includes("attestation packet summary mismatch")
        ),
      ).toBe(true)
      expect(QualityPromotionSignedArchive.verifySignature(signedArchives[0]!, "quality-archive-secret-v1")).toEqual([])
      const trustSummary = await QualityPromotionSignedArchiveTrust.evaluate({
        archive: signedArchives[0]!,
        keyMaterial: "quality-archive-secret-v1",
        projectID: "release-packet-project-1",
      })
      expect(trustSummary.overallStatus).toBe("pass")
      expect(trustSummary.resolution.trustID).toBe(trust.trustID)
      const attestationSummary = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
        trust: trustSummary,
        policy: attestationPolicyResolution.policy,
        policySource: attestationPolicyResolution.source,
        policyProjectID: attestationPolicyResolution.projectID,
      })
      expect(attestationSummary.overallStatus).toBe("pass")
      expect(attestationSummary.acceptedByPolicy).toBe(true)
    } finally {
      await clearModelRegistry()
    }
  })

  test("blocks release packet promotion when signed archive attestation policy is not satisfied", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("attestation-block-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(
        createBenchmarkBundle("attestation-block-target-v1", "pass"),
      )
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "attestation-block@example.com",
        role: "staff-engineer",
        rationale: "Approved for attestation policy validation coverage.",
      })
      await QualityPromotionApproval.append(approval)
      const adoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const approvalPacket = await createAndPersistApprovalPacket(built.decisionBundle, {
        approvals: [approval],
        adoptionReviews,
      })
      const submissionBundle = await createAndPersistSubmissionBundle(built.decisionBundle, {
        approvalPacket,
      })
      const reviewDossier = await createAndPersistReviewDossier(built.decisionBundle, {
        submissionBundle,
      })
      const boardDecision = await createAndPersistBoardDecision(built.decisionBundle, {
        reviewDossier,
      })
      const releaseDecisionRecord = await createAndPersistReleaseDecisionRecord(built.decisionBundle, {
        boardDecision,
      })
      const releasePacket = await createAndPersistReleasePacket(built.decisionBundle, {
        releaseDecisionRecord,
      })

      await expect(
        QualityModelRegistry.promoteReleasePacket(releasePacket, {
          archiveSigning: {
            attestedBy: "release-integrity-bot",
            keyID: "archive-key-v1",
            keySource: "env",
            keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
            keyMaterial: "quality-archive-secret-v1",
          },
        }),
      ).rejects.toThrow(/signed archive attestation policy not satisfied/)

      const active = await QualityModelRegistry.getActive()
      expect(active?.source).toBe(current.source)
      const promotions = await QualityModelRegistry.listPromotions("attestation-block-target-v1")
      expect(promotions).toHaveLength(0)
      expect(await QualityPromotionAuditManifest.list("attestation-block-target-v1")).toHaveLength(0)
      expect(await QualityPromotionExportBundle.list("attestation-block-target-v1")).toHaveLength(0)
      expect(await QualityPromotionArchiveManifest.list("attestation-block-target-v1")).toHaveLength(0)
      expect(await QualityPromotionSignedArchive.list("attestation-block-target-v1")).toHaveLength(0)
    } finally {
      await clearModelRegistry()
    }
  })

  test("rejects release packet promotion when an explicit attestation policy resolution targets a different project", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("attestation-project-mismatch-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const releasePolicyResolution = await QualityPromotionReleasePolicyStore.resolve({
        projectID: "attestation-project-a",
      })
      const built = await QualityModelRegistry.buildPromotionDecisionBundle(
        createBenchmarkBundle("attestation-project-mismatch-target-v1", "pass"),
        { releasePolicyResolution },
      )
      const approval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "attestation-project-mismatch@example.com",
        role: "staff-engineer",
        rationale: "Approved for cross-project attestation resolution coverage.",
      })
      await QualityPromotionApproval.append(approval)
      const adoptionReviews = await createAndPersistAdoptionReviews(
        built.decisionBundle,
        ["policy-reviewer-1@example.com", "policy-reviewer-2@example.com"],
      )
      const approvalPacket = await createAndPersistApprovalPacket(built.decisionBundle, {
        approvals: [approval],
        adoptionReviews,
      })
      const submissionBundle = await createAndPersistSubmissionBundle(built.decisionBundle, {
        approvalPacket,
      })
      const reviewDossier = await createAndPersistReviewDossier(built.decisionBundle, {
        submissionBundle,
      })
      const boardDecision = await createAndPersistBoardDecision(built.decisionBundle, {
        reviewDossier,
      })
      const releaseDecisionRecord = await createAndPersistReleaseDecisionRecord(built.decisionBundle, {
        boardDecision,
      })
      const releasePacket = await createAndPersistReleasePacket(built.decisionBundle, {
        releaseDecisionRecord,
      })
      const mismatchedResolution = await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
        projectID: "attestation-project-b",
      })

      await expect(
        QualityModelRegistry.promoteReleasePacket(releasePacket, {
          archiveSigning: {
            attestedBy: "release-integrity-bot",
            keyID: "archive-key-v1",
            keySource: "env",
            keyLocator: "AX_CODE_QUALITY_ARCHIVE_KEY",
            keyMaterial: "quality-archive-secret-v1",
          },
          attestationPolicyResolution: mismatchedResolution,
        }),
      ).rejects.toThrow(/attestation policy resolution project mismatch/)

      expect(await QualityModelRegistry.getActive()).toEqual(expect.objectContaining({ source: current.source }))
      expect(await QualityModelRegistry.listPromotions("attestation-project-mismatch-target-v1")).toHaveLength(0)
    } finally {
      await clearModelRegistry()
    }
  })

  test("requires policy-compliant approvals for force-path decision bundles", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("force-approval-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("force-approval-target-v1", "fail"))
      const weakApproval = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "engineer@example.com",
        role: "engineer",
      })
      await QualityPromotionApproval.append(weakApproval)
      const forcePolicyAdoptionReview = await createAndPersistAdoptionReviews(built.decisionBundle)

      await expect(
        QualityModelRegistry.promoteApprovedDecisionBundle(built.decisionBundle, weakApproval, {
          force: true,
          adoptionReviews: forcePolicyAdoptionReview,
        }),
      ).rejects.toThrow("approval policy not satisfied")

      const mgr1 = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "mgr1@example.com",
        role: "manager",
      })
      const mgr2 = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "mgr2@example.com",
        role: "director",
      })
      await QualityPromotionApproval.append(mgr1)
      await QualityPromotionApproval.append(mgr2)

      const promoted = await QualityModelRegistry.promoteApprovedDecisionBundle(
        built.decisionBundle,
        [mgr1, mgr2],
        {
          force: true,
          adoptionReviews: forcePolicyAdoptionReview,
          approvalPolicy: QualityPromotionApprovalPolicy.defaults(),
        },
      )
      expect(promoted.active.source).toBe("force-approval-target-v1")
      expect(promoted.record.approvalPolicy?.requiredApprovals).toBe(2)
      expect(promoted.record.approvalPolicy?.qualifiedApprovals).toBe(2)
      expect(promoted.record.approvals).toHaveLength(2)
    } finally {
      await clearModelRegistry()
    }
  })

  test("uses persisted project approval policy when no explicit approval policy is provided", async () => {
    await clearModelRegistry()
    try {
      const current = createModel("project-policy-current-v1")
      await QualityModelRegistry.register(current)
      await QualityModelRegistry.activate(current.source)
      await QualityPromotionApprovalPolicyStore.setProject(
        "project-policy-1",
        QualityPromotionApprovalPolicy.defaults({
          force: { minimumApprovals: 3, minimumRole: "manager" },
        }),
      )

      const built = await QualityModelRegistry.buildPromotionDecisionBundle(createBenchmarkBundle("project-policy-target-v1", "fail"))
      const mgr1 = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "mgr1@example.com",
        role: "manager",
      })
      const mgr2 = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "mgr2@example.com",
        role: "director",
      })
      await QualityPromotionApproval.append(mgr1)
      await QualityPromotionApproval.append(mgr2)
      const projectPolicyAdoptionReview = await createAndPersistAdoptionReviews(built.decisionBundle)

      await expect(
        QualityModelRegistry.promoteApprovedDecisionBundle(
          built.decisionBundle,
          [mgr1, mgr2],
          {
            force: true,
            adoptionReviews: projectPolicyAdoptionReview,
            projectID: "project-policy-1",
          },
        ),
      ).rejects.toThrow("approval policy not satisfied")

      const mgr3 = QualityPromotionApproval.create({
        bundle: built.decisionBundle,
        approver: "mgr3@example.com",
        role: "manager",
      })
      await QualityPromotionApproval.append(mgr3)

      const promoted = await QualityModelRegistry.promoteApprovedDecisionBundle(
        built.decisionBundle,
        [mgr1, mgr2, mgr3],
        {
          force: true,
          adoptionReviews: projectPolicyAdoptionReview,
          projectID: "project-policy-1",
        },
      )
      expect(promoted.active.source).toBe("project-policy-target-v1")
      expect(promoted.record.approvalPolicy?.policySource).toBe("project")
      expect(promoted.record.approvalPolicy?.policyProjectID).toBe("project-policy-1")
      expect(promoted.record.approvalPolicy?.requiredApprovals).toBe(3)
      expect(promoted.record.approvalPolicy?.qualifiedApprovals).toBe(3)
    } finally {
      await clearModelRegistry()
    }
  })

  test("captures session risk into shadow storage when runtime shadow is enabled", async () => {
    await using tmp = await tmpdir({ git: true })

    const prevEnabled = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"]
    const prevModel = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
    const prevPredictions = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.createNext({
            directory: tmp.path,
            title: "Quality Shadow Runtime",
          })

          const predictionPath = `${tmp.path}/quality-shadow-predictions.json`
          const predictionFile: ProbabilisticRollout.PredictionFile = {
            schemaVersion: 1,
            kind: "ax-code-quality-prediction-file",
            source: "candidate-live-v1",
            generatedAt: "2026-04-20T00:00:00.000Z",
            predictions: [
              {
                artifactID: `review:${session.id}`,
                sessionID: session.id,
                workflow: "review",
                artifactKind: "review_run",
                source: "candidate-live-v1",
                confidence: 0.73,
                score: 37,
                readiness: "ready",
                rank: 1,
              },
            ],
          }
          await Bun.write(predictionPath, JSON.stringify(predictionFile, null, 2))

          process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"] = "1"
          process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"] = predictionPath

          await clearSessionShadow(session.id)

          const assessment = Risk.assess({
            filesChanged: 3,
            linesChanged: 48,
            testCoverage: 1,
            apiEndpointsAffected: 0,
            crossModule: false,
            securityRelated: false,
            validationPassed: true,
            validationState: "passed",
            validationCount: 1,
            validationFailures: 0,
            validationCommands: ["bun test"],
            toolFailures: 0,
            totalTools: 2,
            diffState: "recorded",
            semanticRisk: "low",
            primaryChange: "refactor",
          })

          await QualityShadow.captureSessionRisk({ session, assessment })
          await QualityShadow.captureSessionRisk({ session, assessment })

          const records = await QualityShadowStore.list(session.id)
          expect(records).toHaveLength(1)
          expect(records[0]?.artifactID).toBe(`review:${session.id}`)
          expect(records[0]?.candidate.source).toBe("candidate-live-v1")
          expect(records[0]?.candidate.available).toBe(true)
          expect(records[0]?.disagreement.confidenceDelta).not.toBeNull()

          const exported = await QualityShadowStore.exportFile({ sessionIDs: [session.id] })
          expect(exported.records).toHaveLength(1)
          expect(exported.candidateSource).toBe("candidate-live-v1")

          await clearSessionShadow(session.id)
        },
      })
    } finally {
      if (prevEnabled === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"] = prevEnabled

      if (prevModel === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"] = prevModel

      if (prevPredictions === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"] = prevPredictions
    }
  })

  test("prefers a trained model over a raw prediction file for runtime shadow capture", async () => {
    await using tmp = await tmpdir({ git: true })

    const prevEnabled = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"]
    const prevModel = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
    const prevPredictions = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.createNext({
            directory: tmp.path,
            title: "Quality Shadow Model Runtime",
          })

          const modelPath = `${tmp.path}/quality-shadow-model.json`
          const predictionPath = `${tmp.path}/quality-shadow-predictions.json`

          const model: QualityCalibrationModel.ModelFile = {
            schemaVersion: 1,
            kind: "ax-code-quality-calibration-model",
            source: "candidate-model-v1",
            trainedAt: "2026-04-20T00:00:00.000Z",
            globalPrior: 0.61,
            laplaceAlpha: 2,
            requestedBinCount: 1,
            minBinCount: 1,
            training: {
              sessionIDs: ["ses_train_1"],
              labeledItems: 2,
              positives: 1,
              negatives: 1,
            },
            groups: [
              {
                workflow: "review",
                artifactKind: "review_run",
                totalCount: 2,
                positives: 1,
                negatives: 1,
                prior: 0.5,
                bins: [
                  {
                    start: 0,
                    end: 1,
                    count: 2,
                    positives: 1,
                    negatives: 1,
                    avgBaselineConfidence: 0.5,
                    empiricalRate: 0.5,
                    smoothedRate: 0.61,
                  },
                ],
              },
            ],
          }

          const predictionFile: ProbabilisticRollout.PredictionFile = {
            schemaVersion: 1,
            kind: "ax-code-quality-prediction-file",
            source: "candidate-prediction-fallback-v1",
            generatedAt: "2026-04-20T00:00:00.000Z",
            predictions: [
              {
                artifactID: `review:${session.id}`,
                sessionID: session.id,
                workflow: "review",
                artifactKind: "review_run",
                source: "candidate-prediction-fallback-v1",
                confidence: 0.22,
                score: 22,
                readiness: "ready",
                rank: 1,
              },
            ],
          }

          await Bun.write(modelPath, JSON.stringify(model, null, 2))
          await Bun.write(predictionPath, JSON.stringify(predictionFile, null, 2))

          process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"] = "1"
          process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"] = modelPath
          process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"] = predictionPath

          await clearSessionShadow(session.id)

          const assessment = Risk.assess({
            filesChanged: 4,
            linesChanged: 80,
            testCoverage: 1,
            apiEndpointsAffected: 0,
            crossModule: false,
            securityRelated: false,
            validationPassed: true,
            validationState: "passed",
            validationCount: 1,
            validationFailures: 0,
            validationCommands: ["bun test"],
            toolFailures: 0,
            totalTools: 3,
            diffState: "recorded",
            semanticRisk: "low",
            primaryChange: "refactor",
          })

          await QualityShadow.captureSessionRisk({ session, assessment })

          const records = await QualityShadowStore.list(session.id)
          expect(records).toHaveLength(1)
          expect(records[0]?.candidate.source).toBe("candidate-model-v1")
          expect(records[0]?.candidate.confidence).toBe(0.61)
          expect(records[0]?.candidate.source).not.toBe("candidate-prediction-fallback-v1")

          await clearSessionShadow(session.id)
        },
      })
    } finally {
      if (prevEnabled === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"] = prevEnabled

      if (prevModel === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"] = prevModel

      if (prevPredictions === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"] = prevPredictions
    }
  })

  test("uses the active registry model when no env model path is configured", async () => {
    await using tmp = await tmpdir({ git: true })

    const prevEnabled = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"]
    const prevModel = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
    const prevPredictions = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.createNext({
            directory: tmp.path,
            title: "Quality Shadow Registry Runtime",
          })

          const model: QualityCalibrationModel.ModelFile = {
            schemaVersion: 1,
            kind: "ax-code-quality-calibration-model",
            source: "registry-active-model-v1",
            trainedAt: "2026-04-20T00:00:00.000Z",
            globalPrior: 0.66,
            laplaceAlpha: 2,
            requestedBinCount: 1,
            minBinCount: 1,
            training: {
              sessionIDs: ["ses_train_1"],
              labeledItems: 2,
              positives: 1,
              negatives: 1,
            },
            groups: [
              {
                workflow: "review",
                artifactKind: "review_run",
                totalCount: 2,
                positives: 1,
                negatives: 1,
                prior: 0.5,
                bins: [
                  {
                    start: 0,
                    end: 1,
                    count: 2,
                    positives: 1,
                    negatives: 1,
                    avgBaselineConfidence: 0.5,
                    empiricalRate: 0.5,
                    smoothedRate: 0.66,
                  },
                ],
              },
            ],
          }

          await clearModelRegistry()
          await QualityModelRegistry.register(model)
          await QualityModelRegistry.activate(model.source)

          process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"] = "1"
          delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
          delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]

          await clearSessionShadow(session.id)

          const assessment = Risk.assess({
            filesChanged: 2,
            linesChanged: 20,
            testCoverage: 1,
            apiEndpointsAffected: 0,
            crossModule: false,
            securityRelated: false,
            validationPassed: true,
            validationState: "passed",
            validationCount: 1,
            validationFailures: 0,
            validationCommands: ["bun test"],
            toolFailures: 0,
            totalTools: 1,
            diffState: "recorded",
            semanticRisk: "low",
            primaryChange: "refactor",
          })

          await QualityShadow.captureSessionRisk({ session, assessment })

          const records = await QualityShadowStore.list(session.id)
          expect(records).toHaveLength(1)
          expect(records[0]?.candidate.source).toBe("registry-active-model-v1")
          expect(records[0]?.candidate.confidence).toBe(0.66)

          await clearSessionShadow(session.id)
          await clearModelRegistry()
        },
      })
    } finally {
      if (prevEnabled === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"] = prevEnabled

      if (prevModel === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"] = prevModel

      if (prevPredictions === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"] = prevPredictions

      await clearModelRegistry()
    }
  })

  test("captures debug analyze results into shadow storage when runtime shadow is enabled", async () => {
    await using tmp = await tmpdir({ git: true })

    const prevEnabled = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"]
    const prevModel = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
    const prevPredictions = process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.createNext({
            directory: tmp.path,
            title: "Quality Shadow Debug Runtime",
          })

          const predictionPath = `${tmp.path}/quality-shadow-debug-predictions.json`
          const predictionFile: ProbabilisticRollout.PredictionFile = {
            schemaVersion: 1,
            kind: "ax-code-quality-prediction-file",
            source: "candidate-debug-live-v1",
            generatedAt: "2026-04-20T00:00:00.000Z",
            predictions: [
              {
                artifactID: `debug:${session.id}:call_debug`,
                sessionID: session.id,
                workflow: "debug",
                artifactKind: "debug_hypothesis",
                source: "candidate-debug-live-v1",
                confidence: 0.77,
                score: null,
                readiness: null,
                rank: 1,
              },
            ],
          }
          await Bun.write(predictionPath, JSON.stringify(predictionFile, null, 2))

          process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"] = "1"
          process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"] = predictionPath

          await clearSessionShadow(session.id)

          await QualityShadow.captureDebugAnalyze({
            session,
            callID: "call_debug",
            error: "TypeError: undefined is not a function",
            stackTrace: "at handle (/repo/src/app.ts:10:1)",
            metadata: {
              confidence: 0.82,
              chainLength: 3,
              resolvedCount: 2,
              truncated: false,
            },
          })

          const records = await QualityShadowStore.list(session.id)
          expect(records).toHaveLength(1)
          expect(records[0]?.artifactID).toBe(`debug:${session.id}:call_debug`)
          expect(records[0]?.workflow).toBe("debug")
          expect(records[0]?.artifactKind).toBe("debug_hypothesis")
          expect(records[0]?.candidate.source).toBe("candidate-debug-live-v1")
          expect(records[0]?.candidate.available).toBe(true)

          await clearSessionShadow(session.id)
        },
      })
    } finally {
      if (prevEnabled === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW"] = prevEnabled

      if (prevModel === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_MODEL"] = prevModel

      if (prevPredictions === undefined) delete process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"]
      else process.env["AX_CODE_EXPERIMENTAL_QUALITY_SHADOW_PREDICTIONS"] = prevPredictions
    }
  })
})
