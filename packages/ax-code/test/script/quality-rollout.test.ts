import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Session } from "../../src/session"
import { QualityRolloutProjectScope } from "../../script/quality-rollout"
import { QualityModelRegistry } from "../../src/quality/model-registry"
import { QualityLabelStore } from "../../src/quality/label-store"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("script.quality-rollout project scope", () => {
  test("reconciles explicit and artifact project ids when they match", () => {
    expect(QualityRolloutProjectScope.reconcile({
      explicitProjectID: "project-a",
      artifactProjectID: "project-a",
    })).toBe("project-a")
    expect(QualityRolloutProjectScope.reconcile({
      explicitProjectID: null,
      artifactProjectID: "project-a",
    })).toBe("project-a")
  })

  test("rejects explicit project ids that conflict with artifact provenance", () => {
    expect(() => QualityRolloutProjectScope.reconcile({
      explicitProjectID: "project-a",
      artifactProjectID: "project-b",
    })).toThrow(/does not match artifact project id/)
  })

  test("derives project ids from nested promotion artifacts", () => {
    const releasePacket = {
      releaseDecisionRecord: {
        boardDecision: {
          reviewDossier: {
            submissionBundle: {
              decisionBundle: {
                releasePolicy: {
                  provenance: {
                    policyProjectID: "project-release-packet",
                  },
                },
              },
            },
          },
        },
      },
    } as any

    expect(QualityRolloutProjectScope.fromReleasePacket(releasePacket)).toBe("project-release-packet")
  })

  test("prefers promotion attestation project id before trust or release policy fallbacks", () => {
    const promotion = {
      signedArchiveAttestation: {
        policyProjectID: "project-attestation",
      },
      signedArchiveTrust: {
        resolution: {
          projectID: "project-trust",
        },
      },
      releasePolicy: {
        policyProjectID: "project-release-policy",
      },
    } as any

    expect(QualityRolloutProjectScope.fromPromotionRecord(promotion)).toBe("project-attestation")
  })

  test("falls back to attestation record project id before trust or release policy", () => {
    const promotion = {
      signedArchiveAttestationRecord: {
        policyProjectID: "project-attestation-record",
      },
      signedArchiveTrust: {
        resolution: {
          projectID: "project-trust",
        },
      },
      releasePolicy: {
        policyProjectID: "project-release-policy",
      },
    } as any

    expect(QualityRolloutProjectScope.fromPromotionRecord(promotion)).toBe("project-attestation-record")
  })

  test("falls back to attestation packet project id before trust or release policy", () => {
    const promotion = {
      signedArchiveAttestationPacket: {
        policyProjectID: "project-attestation-packet",
      },
      signedArchiveTrust: {
        resolution: {
          projectID: "project-trust",
        },
      },
      releasePolicy: {
        policyProjectID: "project-release-policy",
      },
    } as any

    expect(QualityRolloutProjectScope.fromPromotionRecord(promotion)).toBe("project-attestation-packet")
  })
})

describe("script.quality-rollout promotion summary", () => {
  test("renders the canonical promotion summary for a persisted promotion record", async () => {
    const promotionID = "quality-rollout-summary-promotion"
    const record = QualityModelRegistry.PromotionRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-promotion",
      promotionID,
      source: "quality-rollout-summary-source",
      promotedAt: "2026-04-21T00:00:00.000Z",
      previousActiveSource: null,
      decision: "pass",
      benchmark: {
        baselineSource: "baseline",
        overallStatus: "pass",
        trainSessions: 1,
        evalSessions: 1,
        labeledTrainingItems: 1,
        gates: [
          {
            name: "dataset-consistency",
            status: "pass",
            detail: "ok",
          },
        ],
      },
      reviewDossier: {
        dossierID: "pre-release-review-dossier",
        createdAt: "2026-04-21T00:01:00.000Z",
        submissionID: "submission-1",
        submissionCreatedAt: "2026-04-21T00:00:30.000Z",
        decisionBundleCreatedAt: "2026-04-21T00:00:10.000Z",
        approvalPacketID: "approval-packet-1",
        overallStatus: "pass",
        recommendation: "approve_promotion",
      },
      releasePacket: {
        packetID: "release-packet-1",
        createdAt: "2026-04-21T00:02:00.000Z",
        recordID: "release-record-1",
        decisionID: "board-decision-1",
        authorizedPromotion: true,
        promotionMode: "pass",
        overallStatus: "pass",
      },
      signedArchive: {
        signedArchiveID: "signed-archive-1",
        createdAt: "2026-04-21T00:03:00.000Z",
        archiveID: "packaged-archive-1",
        exportID: "portable-export-1",
        promotionID,
        keyID: "archive-key-v1",
        attestedBy: "release-integrity-bot",
        algorithm: "hmac-sha256",
        overallStatus: "pass",
      },
      signedArchiveAttestationRecord: {
        recordID: "attestation-record-1",
        createdAt: "2026-04-21T00:03:30.000Z",
        signedArchiveID: "signed-archive-1",
        promotionID,
        trustStatus: "pass",
        attestationStatus: "pass",
        trusted: true,
        acceptedByPolicy: true,
        policySource: "project",
        policyProjectID: "project-1",
        overallStatus: "pass",
      },
      signedArchiveReviewDossier: {
        dossierID: "signed-review-dossier-1",
        createdAt: "2026-04-21T00:04:00.000Z",
        promotionID,
        governancePacketID: "governance-packet-1",
        packageID: "handoff-package-1",
        releasePacketID: "release-packet-1",
        signedArchiveID: "signed-archive-1",
        authorizedPromotion: true,
        promotionMode: "pass",
        policySource: "project",
        policyProjectID: "project-1",
        overallStatus: "pass",
      },
    })
    await Storage.write(["quality_model_promotion", promotionID], record)
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "quality-rollout-summary-"))
    const summaryOut = path.join(tmp, "promotion-summary.json")
    const reportOut = path.join(tmp, "promotion-summary.md")

    try {
      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "run",
          path.join(import.meta.dir, "../../script/quality-rollout.ts"),
          "--mode",
          "model-promotion-summary",
          "--promotion-id",
          promotionID,
          "--summary-out",
          summaryOut,
          "--report-out",
          reportOut,
        ],
        cwd: path.join(import.meta.dir, "../.."),
        env: process.env,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain("current stage: post_signing_reviewed")
      const summary = JSON.parse(await Bun.file(summaryOut).text())
      expect(summary.canonicalArtifactKind).toBe("signed_archive_review_dossier")
      expect(summary.canonicalArtifactID).toBe("signed-review-dossier-1")
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("script.quality-rollout replay readiness", () => {
  test("renders replay readiness from a real session export and stored labels", async () => {
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
          type: "tool.call",
          sessionID: sid,
          tool: "security_scan",
          callID: "call-security",
          input: { patterns: ["path_traversal"] },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          tool: "security_scan",
          callID: "call-security",
          status: "completed",
          output: "Findings: 1",
          metadata: {
            findingCount: 1,
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
          durationMs: 9,
        })
        Recorder.emit({
          type: "session.end",
          sessionID: sid,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(sid)
        await new Promise((resolve) => setTimeout(resolve, 50))

        await QualityLabelStore.append({
          labelID: `label-${sid}-run`,
          artifactID: `review:${sid}`,
          artifactKind: "review_run",
          workflow: "review",
          projectID,
          sessionID: sid,
          labeledAt: "2026-04-21T00:10:00.000Z",
          labelSource: "human",
          labelVersion: 1,
          outcome: "findings_accepted",
        })

        const summaryOut = path.join(tmp.path, "replay-readiness.json")
        const result = Bun.spawnSync({
          cmd: [
            "bun",
            "run",
            path.join(import.meta.dir, "../../script/quality-rollout.ts"),
            "--mode",
            "replay-readiness",
            "--workflow",
            "review",
            "--session",
            sid,
            "--out",
            summaryOut,
          ],
          cwd: path.join(import.meta.dir, "../.."),
          env: process.env,
        })

        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString()).toContain("workflow: review")
        expect(result.stdout.toString()).toContain("overall status: warn")
        expect(result.stdout.toString()).toContain("Finish label coverage")
        const file = JSON.parse(await Bun.file(summaryOut).text())
        expect(file.summaries).toHaveLength(1)
        expect(file.summaries[0].missingLabels).toBe(1)

        EventQuery.deleteBySession(sid)
      },
    })
  })

  test("supports qa replay readiness from recorded test evidence", async () => {
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
          agent: "qa",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.call",
          sessionID: sid,
          tool: "bash",
          callID: "call-qa",
          input: { command: "bun test test/auth.test.ts" },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          tool: "bash",
          callID: "call-qa",
          status: "completed",
          output: "1 failed, 2 passed",
          metadata: {},
          durationMs: 9,
        })
        Recorder.emit({
          type: "session.end",
          sessionID: sid,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(sid)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const replay = await ProbabilisticRollout.exportReplay(sid, "qa")
        await QualityLabelStore.append({
          labelID: `label-${sid}-qa-run`,
          artifactID: replay.items[0]!.artifactID,
          artifactKind: "qa_run",
          workflow: "qa",
          projectID,
          sessionID: sid,
          labeledAt: "2026-04-21T00:20:00.000Z",
          labelSource: "human",
          labelVersion: 1,
          outcome: "failed",
        })

        const summaryOut = path.join(tmp.path, "qa-replay-readiness.json")
        const result = Bun.spawnSync({
          cmd: [
            "bun",
            "run",
            path.join(import.meta.dir, "../../script/quality-rollout.ts"),
            "--mode",
            "replay-readiness",
            "--workflow",
            "qa",
            "--session",
            sid,
            "--out",
            summaryOut,
          ],
          cwd: path.join(import.meta.dir, "../.."),
          env: process.env,
        })

        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString()).toContain("workflow: qa")
        expect(result.stdout.toString()).toContain("targeted-test-recommendation")
        expect(result.stdout.toString()).toContain("bun test test/auth.test.ts")
        const file = JSON.parse(await Bun.file(summaryOut).text())
        expect(file.summaries).toHaveLength(1)
        expect(file.summaries[0].workflow).toBe("qa")

        EventQuery.deleteBySession(sid)
      },
    })
  })
})
