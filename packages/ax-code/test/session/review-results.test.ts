import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { createReviewResult } from "../../src/quality/review-result"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { loadSessionReviewResults } from "../../src/session/review-results"
import { tmpdir } from "../fixture/fixture"

function reviewResult(sessionID: string) {
  return createReviewResult({
    sessionID,
    summary: "Review completed with no findings.",
    findings: [],
    verificationEnvelopes: [
      {
        envelopeId: "1111111111111111",
        envelope: {
          schemaVersion: 1,
          workflow: "review",
          scope: { kind: "workspace" },
          command: { runner: "typecheck", argv: [], cwd: "/tmp/work" },
          result: {
            name: "typecheck",
            type: "typecheck",
            passed: true,
            status: "passed",
            issues: [],
            duration: 1,
          },
          structuredFailures: [],
          artifactRefs: [],
          source: { tool: "verify_project", version: "4.x.x", runId: sessionID },
        },
      },
    ],
    source: { tool: "review_complete", version: "4.x.x", runId: sessionID },
    createdAt: "2026-04-29T00:00:00.000Z",
  })
}

describe("loadSessionReviewResults", () => {
  test("loads valid reviewResult metadata from completed tool results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const result = reviewResult(session.id)

        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "review_complete",
          callID: "call-review",
          status: "completed",
          output: "reviewed",
          metadata: { reviewResult: result },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(loadSessionReviewResults(session.id)).toEqual([result])
      },
    })
  })

  test("skips malformed reviewResult entries and deduplicates by reviewId", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const result = reviewResult(session.id)

        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "review_complete",
          callID: "call-bad",
          status: "completed",
          output: "bad",
          metadata: { reviewResult: { decision: "approve" } },
          durationMs: 1,
        })
        for (const callID of ["call-good-1", "call-good-2"]) {
          Recorder.emit({
            type: "tool.result",
            sessionID: session.id,
            tool: "review_complete",
            callID,
            status: "completed",
            output: "reviewed",
            metadata: { reviewResult: result },
            durationMs: 1,
          })
        }
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const results = loadSessionReviewResults(session.id)
        expect(results).toHaveLength(1)
        expect(results[0]?.reviewId).toBe(result.reviewId)
      },
    })
  })
})
