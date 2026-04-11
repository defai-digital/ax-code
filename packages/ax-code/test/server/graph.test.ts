import { describe, expect, test } from "bun:test"
import path from "path"
import { ExecutionGraph } from "../../src/graph"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("graph endpoint", () => {
  test("returns a structured execution graph for a recorded session", async () => {
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
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 1 })
        Recorder.end(sid)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const app = Server.Default()
        const res = await app.request(`/graph/${sid}`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as { data: ExecutionGraph.Graph }
        expect(body.data.sessionID).toBe(sid)
        expect(body.data.metadata.steps).toBe(1)
        expect(body.data.metadata.tools).toEqual(["read"])
        expect(body.data.nodes.some((item) => item.type === "tool_call" && item.label === "read: demo.ts")).toBe(true)
      },
    })
  })

  test("returns a timeline text view when requested", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id

        Recorder.begin(sid)
        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 1 })
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 1, output: 1 },
        })
        Recorder.end(sid)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const app = Server.Default()
        const res = await app.request(`/graph/${sid}?format=timeline`)

        expect(res.status).toBe(200)
        expect(await res.text()).toContain("Step 1")
      },
    })
  })

  test("returns a topology text view when requested", async () => {
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
        const res = await app.request(`/graph/${sid}?format=topology`)

        expect(res.status).toBe(200)
        const body = await res.text()
        expect(body).toContain("Critical path:")
        expect(body).toContain("read: demo.ts")
      },
    })
  })

  test("returns an ascii text view when requested", async () => {
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
          type: "step.finish",
          sessionID: sid,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 12, output: 8 },
        })
        Recorder.end(sid)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const app = Server.Default()
        const res = await app.request(`/graph/${sid}?format=ascii`)

        expect(res.status).toBe(200)
        const body = await res.text()
        expect(body).toContain("[Start (build)] -> [build → debug] -> [Step #1]")
        expect(body).toContain("[read: demo.ts] => [read ok]")
      },
    })
  })

  test("returns a structured topology view", async () => {
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
        const res = await app.request(`/graph/${sid}/topology`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as {
          data: Array<
            | { kind: "heading"; text: string }
            | { kind: "path"; text: string; nodes: string[] }
            | { kind: "step"; text: string; stepIndex: number; nodes: string[] }
            | { kind: "pair"; text: string; call: string; result: string }
          >
        }
        expect(body.data[0]).toEqual({
          kind: "heading",
          text: "Duration 0s | Steps 1 | Tools 1 | Errors 0",
        })
        expect(body.data[1]).toEqual({
          kind: "path",
          text: "Critical path: Start (build) → build → debug → Step #1 → read: demo.ts → read ok → LLM stop (120ms)",
          nodes: ["Start (build)", "build → debug", "Step #1", "read: demo.ts", "read ok", "LLM stop (120ms)"],
        })
        expect(body.data[2]).toEqual({
          kind: "step",
          stepIndex: 1,
          text: "Step 1 flow: read: demo.ts → read ok → LLM stop (120ms)",
          nodes: ["read: demo.ts", "read ok", "LLM stop (120ms)"],
        })
        expect(body.data[3]).toEqual({
          kind: "pair",
          text: "Call/result: read: demo.ts → read ok",
          call: "read: demo.ts",
          result: "read ok",
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
        const res = await app.request("/graph/ses_missing")
        expect(res.status).toBe(404)
      },
    })
  })
})
