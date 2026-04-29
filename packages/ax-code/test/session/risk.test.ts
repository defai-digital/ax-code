import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import { QualityLabelStore } from "../../src/quality/label-store"
import { computeFindingId } from "../../src/quality/finding"
import type { Finding } from "../../src/quality/finding"
import { computeEnvelopeId, type VerificationEnvelope } from "../../src/quality/verification-envelope"
import { createReviewResult } from "../../src/quality/review-result"
import {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
} from "../../src/debug-engine/runtime-debug"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Session } from "../../src/session"
import { SessionRisk } from "../../src/session/risk"
import type { SessionID } from "../../src/session/schema"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("session.risk", () => {
  async function clearSessionLabels(sessionID: string) {
    const keys = await Storage.list(["quality_label", sessionID])
    for (const parts of keys) {
      await Storage.remove(parts)
    }
  }

  test("omits quality readiness by default", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const detail = await SessionRisk.load(session.id)
        expect(detail.quality).toBeUndefined()
      },
    })
  })

  test("loads review replay readiness when requested", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        const projectID = Instance.project.id

        try {
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
            output: "3 passed, 0 failed",
            metadata: {},
            durationMs: 10,
          })
          Recorder.emit({
            type: "session.end",
            sessionID: sid,
            reason: "completed",
            totalSteps: 0,
          })
          Recorder.end(sid)

          await new Promise((resolve) => setTimeout(resolve, 50))

          const replay = await ProbabilisticRollout.exportReplay(sid, "review")
          expect(replay.items.map((item) => item.artifactKind)).toEqual(["review_run", "review_finding"])
          const qaReplay = await ProbabilisticRollout.exportReplay(sid, "qa")
          expect(qaReplay.items.map((item) => item.artifactKind)).toEqual(["qa_run"])

          await QualityLabelStore.appendMany([
            {
              labelID: `label-review-run-${sid}`,
              artifactID: replay.items[0]!.artifactID,
              artifactKind: "review_run",
              workflow: "review",
              projectID,
              sessionID: sid,
              labeledAt: "2026-04-21T00:00:00.000Z",
              labelSource: "human",
              labelVersion: 1,
              outcome: "findings_accepted",
            },
            {
              labelID: `label-review-finding-${sid}`,
              artifactID: replay.items[1]!.artifactID,
              artifactKind: "review_finding",
              workflow: "review",
              projectID,
              sessionID: sid,
              labeledAt: "2026-04-21T00:00:01.000Z",
              labelSource: "human",
              labelVersion: 1,
              outcome: "accepted",
            },
            {
              labelID: `label-qa-run-${sid}`,
              artifactID: qaReplay.items[0]!.artifactID,
              artifactKind: "qa_run",
              workflow: "qa",
              projectID,
              sessionID: sid,
              labeledAt: "2026-04-21T00:00:02.000Z",
              labelSource: "human",
              labelVersion: 1,
              outcome: "passed",
            },
          ])

          const detail = await SessionRisk.load(sid, { includeQuality: true })
          expect(detail.quality?.review).toMatchObject({
            workflow: "review",
            overallStatus: "pass",
            readyForBenchmark: true,
            totalItems: 2,
            labeledItems: 2,
            resolvedLabeledItems: 2,
            nextAction: null,
          })
          expect(detail.quality?.debug).toBeNull()
          expect(detail.quality?.qa).toMatchObject({
            workflow: "qa",
            overallStatus: "pass",
            readyForBenchmark: true,
            totalItems: 1,
            labeledItems: 1,
            resolvedLabeledItems: 1,
            nextAction: "Run targeted QA verification first: bun test test/auth.test.ts",
          })
        } finally {
          EventQuery.deleteBySession(sid)
          await clearSessionLabels(sid)
        }
      },
    })
  })

  // Integration coverage: SessionRisk.load with combinations of
  // includeQuality / includeFindings / includeEnvelopes — the same shape
  // the client sync polls via /risk?quality=true&findings=true&envelopes=true.
  function buildFinding(sessionID: string): Finding {
    const anchor = { kind: "line" as const, line: 42 }
    return {
      schemaVersion: 1,
      findingId: computeFindingId({ workflow: "review", category: "bug", file: "src/foo.ts", anchor }),
      workflow: "review",
      category: "bug",
      severity: "HIGH",
      summary: "Off-by-one in pagination loop",
      file: "src/foo.ts",
      anchor,
      rationale: "Loop runs n+1 times when limit equals total.",
      evidence: ["src/foo.ts:42"],
      suggestedNextAction: "Use `<` instead of `<=`.",
      source: { tool: "review", version: "4.x.x", runId: sessionID },
    }
  }

  function buildEnvelope(sessionID: string): VerificationEnvelope {
    return {
      schemaVersion: 1,
      workflow: "qa",
      scope: { kind: "file", paths: ["src/foo.ts"] },
      command: { runner: "typecheck", argv: [], cwd: "/tmp/work" },
      result: {
        name: "typecheck",
        type: "typecheck",
        passed: false,
        status: "failed",
        issues: [],
        duration: 0,
        output: "src/foo.ts(10,4): error TS2322: type mismatch",
      },
      structuredFailures: [
        { kind: "typecheck", file: "src/foo.ts", line: 10, column: 4, code: "TS2322", message: "type mismatch" },
      ],
      artifactRefs: [],
      source: { tool: "refactor_apply", version: "4.x.x", runId: sessionID },
    }
  }

  function buildReviewResult(sessionID: string) {
    const finding = buildFinding(sessionID)
    const envelope = buildEnvelope(sessionID)
    return createReviewResult({
      sessionID,
      summary: "Review completed with blocking findings.",
      findings: [finding],
      verificationEnvelopes: [{ envelopeId: computeEnvelopeId(envelope), envelope }],
      source: { tool: "review_complete", version: "4.x.x", runId: sessionID },
      createdAt: "2026-04-29T00:00:00.000Z",
    })
  }

  async function emitFindingAndEnvelope(sessionID: SessionID, directory: string) {
    Recorder.begin(sessionID)
    Recorder.emit({
      type: "session.start",
      sessionID,
      agent: "build",
      model: "test/model",
      directory,
    })
    Recorder.emit({
      type: "tool.result",
      sessionID,
      tool: "register_finding",
      callID: "call-finding",
      status: "completed",
      output: "registered",
      metadata: { findingId: buildFinding(sessionID).findingId, finding: buildFinding(sessionID) },
      durationMs: 1,
    })
    Recorder.emit({
      type: "tool.result",
      sessionID,
      tool: "refactor_apply",
      callID: "call-apply",
      status: "completed",
      output: "applied",
      metadata: { verificationEnvelopes: [buildEnvelope(sessionID)] },
      durationMs: 5,
    })
    Recorder.emit({
      type: "tool.result",
      sessionID,
      tool: "review_complete",
      callID: "call-review-complete",
      status: "completed",
      output: "reviewed",
      metadata: { reviewResult: buildReviewResult(sessionID) },
      durationMs: 1,
    })
    Recorder.emit({
      type: "session.end",
      sessionID,
      reason: "completed",
      totalSteps: 0,
    })
    Recorder.end(sessionID)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  async function emitEditAndFailedValidation(sessionID: SessionID, directory: string) {
    Recorder.begin(sessionID)
    Recorder.emit({
      type: "session.start",
      sessionID,
      agent: "build",
      model: "test/model",
      directory,
    })
    Recorder.emit({
      type: "tool.call",
      sessionID,
      tool: "edit",
      callID: "call-edit",
      input: { filePath: "src/foo.ts" },
    })
    Recorder.emit({
      type: "tool.result",
      sessionID,
      tool: "edit",
      callID: "call-edit",
      status: "completed",
      output: "edited",
      metadata: {},
      durationMs: 1,
    })
    Recorder.emit({
      type: "tool.call",
      sessionID,
      tool: "bash",
      callID: "call-test",
      input: { command: "bun test test/foo.test.ts", description: "Run focused test" },
    })
    Recorder.emit({
      type: "tool.result",
      sessionID,
      tool: "bash",
      callID: "call-test",
      status: "completed",
      output: "1 failed",
      metadata: { exit: 1 },
      durationMs: 1,
    })
    Recorder.emit({
      type: "session.end",
      sessionID,
      reason: "completed",
      totalSteps: 0,
    })
    Recorder.end(sessionID)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  test("default load omits all opt-in fields (quality/findings/envelopes/reviewResults/decisionHints)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await emitFindingAndEnvelope(session.id, tmp.path)
        try {
          const detail = await SessionRisk.load(session.id)
          expect(detail.quality).toBeUndefined()
          expect(detail.findings).toBeUndefined()
          expect(detail.envelopes).toBeUndefined()
          expect(detail.reviewResults).toBeUndefined()
          expect(detail.decisionHints).toBeUndefined()
        } finally {
          EventQuery.deleteBySession(session.id)
        }
      },
    })
  })

  test("includeDecisionHints: true summarizes replay evidence without changing base risk", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await emitEditAndFailedValidation(session.id, tmp.path)
        try {
          const detail = await SessionRisk.load(session.id, { includeDecisionHints: true })
          expect(detail.decisionHints).toMatchObject({
            source: "replay",
            readiness: "blocked",
            actionCount: 2,
            hintCount: 1,
          })
          expect(detail.decisionHints?.hints[0]).toMatchObject({
            id: "failed-validation-after-edit",
            category: "failed_validation",
          })
          expect(detail.decisionHints?.hints[0]?.evidence.join("\n")).toContain("src/foo.ts")
          expect(detail.assessment).toBeDefined()
        } finally {
          EventQuery.deleteBySession(session.id)
        }
      },
    })
  })

  test("includeFindings: true populates findings without affecting envelopes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await emitFindingAndEnvelope(session.id, tmp.path)
        try {
          const detail = await SessionRisk.load(session.id, { includeFindings: true })
          expect(detail.findings).toHaveLength(1)
          expect(detail.findings?.[0].severity).toBe("HIGH")
          expect(detail.findings?.[0].file).toBe("src/foo.ts")
          expect(detail.envelopes).toBeUndefined()
        } finally {
          EventQuery.deleteBySession(session.id)
        }
      },
    })
  })

  test("includeEnvelopes: true populates envelopes without affecting findings", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await emitFindingAndEnvelope(session.id, tmp.path)
        try {
          const detail = await SessionRisk.load(session.id, { includeEnvelopes: true })
          expect(detail.envelopes).toHaveLength(1)
          expect(detail.envelopes?.[0].command.runner).toBe("typecheck")
          expect(detail.envelopes?.[0].result.status).toBe("failed")
          expect(detail.findings).toBeUndefined()
        } finally {
          EventQuery.deleteBySession(session.id)
        }
      },
    })
  })

  test("includeReviewResults: true populates review results without affecting findings or envelopes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await emitFindingAndEnvelope(session.id, tmp.path)
        try {
          const detail = await SessionRisk.load(session.id, { includeReviewResults: true })
          expect(detail.reviewResults).toHaveLength(1)
          expect(detail.reviewResults?.[0].decision).toBe("request_changes")
          expect(detail.reviewResults?.[0].findingIds).toEqual([buildFinding(session.id).findingId])
          expect(detail.findings).toBeUndefined()
          expect(detail.envelopes).toBeUndefined()
        } finally {
          EventQuery.deleteBySession(session.id)
        }
      },
    })
  })

  test("matches the client sync request shape (quality + findings + envelopes simultaneously)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await emitFindingAndEnvelope(session.id, tmp.path)
        try {
          const detail = await SessionRisk.load(session.id, {
            includeQuality: true,
            includeFindings: true,
            includeEnvelopes: true,
            includeReviewResults: true,
          })
          // quality is allowed to be empty (no replay evidence yet) but the
          // field must be present (parsed object) — the client sync schema
          // validates it.
          expect(detail.quality).toBeDefined()
          expect(detail.findings).toHaveLength(1)
          expect(detail.envelopes).toHaveLength(1)
          expect(detail.reviewResults).toHaveLength(1)
        } finally {
          EventQuery.deleteBySession(session.id)
        }
      },
    })
  })

  test("matches the full client sync shape with all five opt-ins (quality + findings + envelopes + reviewResults + debug)", async () => {
    // This is the path the production client actually walks — sessionRiskURL
    // sets quality=true&findings=true&envelopes=true&reviewResults=true&debug=true on every
    // poll. Catches drift between server Detail schema and client
    // SyncedSessionRisk for the entire assurance-lane surface in one shot.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Phase 1+2+3 artefacts emitted inline within a single Recorder
        // lifecycle so the events all batch-commit together.
        const problem = "Tests fail intermittently in CI"
        const caseId = computeDebugCaseId({ problem, runId: session.id })
        const evidenceContent = "[INFO] worker pool: timeout waiting for slot"
        const evidenceId = computeDebugEvidenceId({ caseId, kind: "log_capture", content: evidenceContent })
        const claim = "Worker pool starvation under CI's reduced concurrency"
        const hypothesisId = computeDebugHypothesisId({ caseId, claim })
        const debugSource = { tool: "debug_open_case", version: "4.x.x", runId: session.id }

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        // Finding from register_finding
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "register_finding",
          callID: "call-finding",
          status: "completed",
          output: "registered",
          metadata: {
            findingId: buildFinding(session.id).findingId,
            finding: buildFinding(session.id),
          },
          durationMs: 1,
        })
        // VerificationEnvelope from refactor_apply
        const envelope = buildEnvelope(session.id)
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "refactor_apply",
          callID: "call-apply",
          status: "completed",
          output: "applied",
          metadata: { verificationEnvelopes: [envelope] },
          durationMs: 5,
        })
        // ReviewResult from review_complete
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "review_complete",
          callID: "call-review-complete",
          status: "completed",
          output: "reviewed",
          metadata: { reviewResult: buildReviewResult(session.id) },
          durationMs: 1,
        })
        // DebugCase / DebugEvidence / DebugHypothesis
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "debug_open_case",
          callID: "call-debug-open",
          status: "completed",
          metadata: {
            caseId,
            debugCase: {
              schemaVersion: 1,
              caseId,
              problem,
              status: "open",
              createdAt: "2026-04-26T18:00:00.000Z",
              source: debugSource,
            },
          },
          durationMs: 1,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "debug_capture_evidence",
          callID: "call-debug-evidence",
          status: "completed",
          metadata: {
            evidenceId,
            debugEvidence: {
              schemaVersion: 1,
              evidenceId,
              caseId,
              kind: "log_capture",
              capturedAt: "2026-04-26T18:01:00.000Z",
              content: evidenceContent,
              source: { ...debugSource, tool: "debug_capture_evidence" },
            },
          },
          durationMs: 1,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "debug_propose_hypothesis",
          callID: "call-debug-hypothesis",
          status: "completed",
          metadata: {
            hypothesisId,
            debugHypothesis: {
              schemaVersion: 1,
              hypothesisId,
              caseId,
              claim,
              confidence: 0.65,
              evidenceRefs: [evidenceId],
              status: "active",
              source: { ...debugSource, tool: "debug_propose_hypothesis" },
            },
          },
          durationMs: 1,
        })
        Recorder.emit({
          type: "session.end",
          sessionID: session.id,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        try {
          const detail = await SessionRisk.load(session.id, {
            includeQuality: true,
            includeFindings: true,
            includeEnvelopes: true,
            includeReviewResults: true,
            includeDebug: true,
          })

          expect(detail.quality).toBeDefined()
          expect(detail.findings).toHaveLength(1)
          expect(detail.envelopes).toHaveLength(1)
          expect(detail.reviewResults).toHaveLength(1)
          expect(detail.debug).toBeDefined()
          expect(detail.debug?.cases).toHaveLength(1)
          expect(detail.debug?.evidence).toHaveLength(1)
          expect(detail.debug?.hypotheses).toHaveLength(1)
          expect(detail.debug?.cases[0].caseId).toBe(caseId)
          expect(detail.debug?.evidence[0].caseId).toBe(caseId)
          expect(detail.debug?.hypotheses[0].evidenceRefs).toContain(evidenceId)
        } finally {
          EventQuery.deleteBySession(session.id)
        }
      },
    })
  })
})
