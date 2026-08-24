import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// Autonomous mode auto-answers Question.ask instead of leaving it pending;
// these route tests exercise the human path.
const ORIGINAL_AUTONOMOUS = process.env.AX_CODE_AUTONOMOUS
beforeAll(() => {
  process.env.AX_CODE_AUTONOMOUS = "false"
})
afterAll(() => {
  if (ORIGINAL_AUTONOMOUS === undefined) delete process.env.AX_CODE_AUTONOMOUS
  else process.env.AX_CODE_AUTONOMOUS = ORIGINAL_AUTONOMOUS
})

function askSample() {
  return Question.ask({
    sessionID: SessionID.make("ses_route_test"),
    questions: [
      {
        question: "Which approach?",
        header: "Approach",
        options: [
          { label: "Fast", description: "Use the fast path" },
          { label: "Safe", description: "Use the safe path" },
        ],
      },
    ],
  })
}

describe("question routes", () => {
  test("second reply for an already-resolved request returns 404, not silent success", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promise = askSample()
        // Question.ask registers the pending entry asynchronously — poll
        // until it is visible (same pattern as route-validation.test.ts).
        let pending = await Question.list()
        for (let attempt = 0; pending.length === 0 && attempt < 10; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          pending = await Question.list()
        }
        expect(pending).toHaveLength(1)
        const requestID = pending[0]!.id
        const app = Server.Default()
        // The request-directory middleware resolves the instance from the
        // directory query param — without it the route sees a different
        // (cwd-based) instance whose question state is empty.
        const base = `?directory=${encodeURIComponent(tmp.path)}`

        // Resolve the pending question via the route, then settle the ask
        // promise BEFORE issuing the retry — an unresolved deferred would
        // otherwise keep the Instance alive and hang dispose.
        const first = await app.request(`/question/${requestID}/reply${base}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: [["Fast"]] }),
        })
        expect(first.status).toBe(200)
        const answers = await promise
        expect(answers).toEqual([["Fast"]])

        // A client retry (e.g. after a timed-out first attempt) must see
        // 404 — reporting success here would hide that the answer was
        // dropped. Same race guard as the permission route (#341).
        const retry = await app.request(`/question/${requestID}/reply${base}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: [["Safe"]] }),
        })
        expect(retry.status).toBe(404)

        const rejectRetry = await app.request(`/question/${requestID}/reject${base}`, { method: "POST" })
        expect(rejectRetry.status).toBe(404)
      },
    })
  })
})
