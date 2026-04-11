import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionDre } from "../../src/session/dre"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("session dre endpoint", () => {
  test("returns decision detail and timeline for a recorded session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        const file = path.join(tmp.path, "src/demo.ts")

        Recorder.begin(sid)
        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "agent.route",
          sessionID: sid,
          fromAgent: "build",
          toAgent: "debug",
          confidence: 0.92,
        })
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 1 })
        Recorder.emit({
          type: "tool.call",
          sessionID: sid,
          stepIndex: 1,
          tool: "read",
          callID: "read-1",
          input: { filePath: file },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          stepIndex: 1,
          tool: "read",
          callID: "read-1",
          status: "completed",
          output: "ok",
          durationMs: 20,
        })
        Recorder.emit({
          type: "tool.call",
          sessionID: sid,
          stepIndex: 1,
          tool: "edit",
          callID: "edit-1",
          input: { filePath: file },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          stepIndex: 1,
          tool: "edit",
          callID: "edit-1",
          status: "completed",
          output: "ok",
          durationMs: 40,
        })
        Recorder.emit({
          type: "llm.response",
          sessionID: sid,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 12, output: 8 },
          latencyMs: 120,
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 12, output: 8 },
        })
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 1 })
        Recorder.end(sid)
        await new Promise((resolve) => setTimeout(resolve, 50))

        await Storage.write(
          ["session_diff", sid],
          [
            {
              file,
              before: "export const a = 1\n",
              after: "export const a = 2\n",
              additions: 1,
              deletions: 1,
              status: "modified",
            },
          ],
        )

        const app = Server.Default()
        const res = await app.request(`/session/${sid}/dre`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as SessionDre.Snapshot
        expect(body.detail?.plan).toBe("delegated inspect-first incremental edit")
        expect(body.detail?.routes).toEqual([{ from: "build", to: "debug", confidence: 0.92 }])
        expect(body.detail?.readiness).toBe("needs_validation")
        expect(body.detail?.confidence).toBeGreaterThan(0.6)
        expect(body.detail?.unknowns).toContain("no validation command recorded for code changes")
        expect(body.detail?.semantic?.headline).toBe("refactor · demo.ts")
        expect(body.detail?.semantic?.risk).toBe("low")
        expect(body.timeline.map((item) => item.text)).toEqual([
          "Duration 0s · Risk low (0/100) · Tokens 12/8",
          "Start (build)",
          "build → debug (confidence 0.92)",
          "Step 1 · 0s · tokens 12/8",
          "read: demo.ts → ok (20ms)",
          "edit: demo.ts → ok (40ms)",
          "LLM stop (120ms)",
        ])
      },
    })
  })

  test("returns 404 for a missing session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/session/ses_missing/dre")
        expect(res.status).toBe(404)
      },
    })
  })
})
