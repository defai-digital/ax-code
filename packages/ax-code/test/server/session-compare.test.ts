import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionCompare } from "../../src/session/compare"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

async function seed(input: {
  sessionID: string
  directory: string
  route: { from: string; to: string; confidence: number }
  files: string[]
  validate?: boolean
  fail?: boolean
}) {
  Recorder.begin(input.sessionID as Parameters<typeof Recorder.begin>[0])
  Recorder.emit({
    type: "session.start",
    sessionID: input.sessionID,
    agent: input.route.from,
    model: "test/model",
    directory: input.directory,
  })
  Recorder.emit({
    type: "agent.route",
    sessionID: input.sessionID,
    fromAgent: input.route.from,
    toAgent: input.route.to,
    confidence: input.route.confidence,
  })
  Recorder.emit({ type: "step.start", sessionID: input.sessionID, stepIndex: 1 })
  Recorder.emit({
    type: "llm.output",
    sessionID: input.sessionID,
    stepIndex: 1,
    parts: [
      ...input.files.flatMap((file, idx) => [
        { type: "tool_call" as const, callID: `read-${idx}`, tool: "read", input: { filePath: file } },
        { type: "tool_call" as const, callID: `edit-${idx}`, tool: "edit", input: { filePath: file } },
      ]),
      ...(input.validate
        ? [{ type: "tool_call" as const, callID: "bash-0", tool: "bash", input: { command: "bun test" } }]
        : []),
    ],
  })

  for (const [idx, file] of input.files.entries()) {
    Recorder.emit({
      type: "tool.call",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "read",
      callID: `read-${idx}`,
      input: { filePath: file },
    })
    Recorder.emit({
      type: "tool.result",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "read",
      callID: `read-${idx}`,
      status: "completed",
      output: "ok",
      durationMs: 20 + idx,
    })
    Recorder.emit({
      type: "tool.call",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "edit",
      callID: `edit-${idx}`,
      input: { filePath: file },
    })
    Recorder.emit({
      type: "tool.result",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "edit",
      callID: `edit-${idx}`,
      status: input.fail ? "error" : "completed",
      output: input.fail ? undefined : "ok",
      error: input.fail ? "edit failed" : undefined,
      durationMs: 40 + idx,
    })
  }

  if (input.validate) {
    Recorder.emit({
      type: "tool.call",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "bash",
      callID: "bash-0",
      input: { command: "bun test" },
    })
    Recorder.emit({
      type: "tool.result",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "bash",
      callID: "bash-0",
      status: "completed",
      output: "bun test 1 passed",
      durationMs: 80,
    })
  }

  Recorder.emit({
    type: "step.finish",
    sessionID: input.sessionID,
    stepIndex: 1,
    finishReason: "stop",
    tokens: { input: 12, output: 8 },
  })
  Recorder.emit({ type: "session.end", sessionID: input.sessionID, reason: "completed", totalSteps: 1 })
  Recorder.end(input.sessionID as Parameters<typeof Recorder.end>[0])

  await Storage.write(
    ["session_diff", input.sessionID],
    input.files.map((file, idx) => ({
      file,
      before: "export const a = 1\n",
      after:
        idx === 0
          ? Array.from({ length: 130 }, (_, i) => `export const v${i} = ${i}\n`).join("")
          : "export const a = 2\n",
      additions: idx === 0 ? 130 : 1,
      deletions: 1,
      status: "modified" as const,
    })),
  )
}

describe("session compare endpoint", () => {
  test("returns risk, decision, and replay comparison for two sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const safe = await Session.create({ title: "safe" })
        const risky = await Session.create({ title: "risky" })

        await seed({
          sessionID: safe.id,
          directory: tmp.path,
          route: { from: "build", to: "debug", confidence: 0.92 },
          files: [path.join(tmp.path, "src/demo.ts")],
          validate: true,
        })

        await seed({
          sessionID: risky.id,
          directory: tmp.path,
          route: { from: "build", to: "security", confidence: 0.71 },
          files: [
            path.join(tmp.path, "src/server/routes/risky.ts"),
            path.join(tmp.path, "src/lib/a.ts"),
            path.join(tmp.path, "src/lib/b.ts"),
            path.join(tmp.path, "src/lib/c.ts"),
          ],
          fail: true,
        })

        await new Promise((resolve) => setTimeout(resolve, 50))

        const app = Server.Default()
        const res = await app.request(`/session/${safe.id}/compare/${risky.id}?deep=true`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as SessionCompare.Result
        expect(body.advisory.winner).toBe("A")
        expect(body.decision.winner).toBe("A")
        expect(body.decision.recommendation).toBe("Prefer safe")
        expect(body.decision.reasons).toContain("validation passed")
        expect(body.decision.differences).toContain("routing diverged")
        expect(body.differences.routeDiffers).toBe(true)
        expect(body.session1.risk.score).toBeLessThan(body.session2.risk.score)
        expect(body.session1.semantic?.primary).toBe("rewrite")
        expect(body.session2.semantic?.primary).toBe("rewrite")
        expect(body.analysis.session1.plan).toBe("delegated inspect-first incremental edit")
        expect(body.analysis.session2.plan).toBe("delegated inspect-first multi-file edit")
        expect(body.replay?.session1.stepsCompared).toBe(1)
        expect(body.replay?.session2.divergences).toBe(0)
      },
    })
  })

  test("returns 404 when one session is missing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()
        const res = await app.request(`/session/${session.id}/compare/ses_missing`)
        expect(res.status).toBe(404)
      },
    })
  })
})
