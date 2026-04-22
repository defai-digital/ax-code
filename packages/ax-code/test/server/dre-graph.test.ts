import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import { QualityLabelStore } from "../../src/quality/label-store"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("dre graph quality readiness", () => {
  async function clearSessionLabels(sessionID: string) {
    const keys = await Storage.list(["quality_label", sessionID])
    for (const parts of keys) {
      await Storage.remove(parts)
    }
  }

  test("keeps quality readiness opt-in for dre graph session pages", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        const projectID = Instance.project.id
        const app = Server.Default()

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
          const qaReplay = await ProbabilisticRollout.exportReplay(sid, "qa")
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

          const base = await app.request(`/dre-graph/session/${sid}`)
          expect(base.status).toBe(200)
          const baseHtml = await base.text()
          expect(baseHtml).not.toContain("Quality Readiness")

          const enriched = await app.request(`/dre-graph/session/${sid}?quality=true`)
          expect(enriched.status).toBe(200)
          const enrichedHtml = await enriched.text()
          expect(enrichedHtml).toContain("Quality Readiness")
          expect(enrichedHtml).toContain("review")
          expect(enrichedHtml).toContain("qa")
          expect(enrichedHtml).toContain("review</strong> · ready · benchmark ready")
          expect(enrichedHtml).toContain("qa</strong> · ready · benchmark ready")
          expect(enrichedHtml).not.toContain(">pass<")
          expect(enrichedHtml).toContain("first: bun test test/auth.test.ts")

          const baseFingerprint = await app.request(`/dre-graph/session/${sid}/fingerprint`)
          const enrichedFingerprint = await app.request(`/dre-graph/session/${sid}/fingerprint?quality=true`)
          expect(baseFingerprint.status).toBe(200)
          expect(enrichedFingerprint.status).toBe(200)

          const baseFingerprintBody = await baseFingerprint.json() as any
          const enrichedFingerprintBody = await enrichedFingerprint.json() as any
          expect(baseFingerprintBody.risk.quality).toBeNull()
          expect(enrichedFingerprintBody.risk.quality.review).toMatchObject({
            status: "pass",
            ready: true,
            resolvedLabels: 2,
          })
          expect(enrichedFingerprintBody.risk.quality.qa).toMatchObject({
            status: "pass",
            ready: true,
            resolvedLabels: 1,
          })
        } finally {
          EventQuery.deleteBySession(sid)
          await clearSessionLabels(sid)
          await Session.remove(sid)
        }
      },
    })
  })
})
