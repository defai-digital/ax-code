import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionGraph } from "../../src/session/graph"
import { tmpdir } from "../fixture/fixture"

describe("session graph endpoint", () => {
  test("returns graph and topology snapshot for a recorded session", async () => {
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
        Recorder.end(sid)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const app = Server.Default()
        const res = await app.request(`/session/${sid}/graph`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as SessionGraph.Snapshot
        expect(body.graph.sessionID).toBe(sid)
        expect(body.graph.metadata.steps).toBe(1)
        expect(body.topology[0]).toEqual({
          kind: "heading",
          text: "Duration 0s | Steps 1 | Tools 1 | Errors 0",
        })
        expect(body.topology[1]).toEqual({
          kind: "path",
          text: "Critical path: Start (build) → build → debug → Step #1 → read: demo.ts → read ok → LLM stop (120ms)",
          nodes: ["Start (build)", "build → debug", "Step #1", "read: demo.ts", "read ok", "LLM stop (120ms)"],
        })
      },
    })
  })

  test("returns 404 for a missing session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/session/ses_missing/graph")
        expect(res.status).toBe(404)
      },
    })
  })
})
