import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import { QualityLabelStore } from "../../src/quality/label-store"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Session } from "../../src/session"
import { SessionRisk } from "../../src/session/risk"
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
})
