import { describe, expect, test } from "vitest"

import { ExecutionGraph } from "../../src/graph"
import { Instance } from "../../src/project/instance"
import { EventQuery } from "../../src/replay/query"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("ExecutionGraph.build", () => {
  test("updates step nodes and pending calls through indexed lookups", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 0 })
        Recorder.emit({
          type: "tool.call",
          sessionID: sid,
          tool: "read",
          callID: "call_pending",
          input: { file_path: "a.ts" },
          stepIndex: 0,
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 0,
          finishReason: "stop",
          tokens: { input: 11, output: 7 },
        })
        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        const graph = ExecutionGraph.build(sid)
        const step = graph.nodes.find((node) => node.type === "step")
        const call = graph.nodes.find((node) => node.type === "tool_call" && node.callID === "call_pending")

        expect(step).toBeDefined()
        expect(call).toBeDefined()
        if (!step || !call) throw new Error("expected graph nodes were not built")
        expect(step).toMatchObject({ tokens: { input: 11, output: 7 } })
        expect(step.duration).toBeGreaterThanOrEqual(0)
        expect(call).toMatchObject({ status: "pending" })
        expect(graph.edges).toContainEqual({ from: step.id, to: call.id, type: "step_contains" })

        EventQuery.deleteBySession(sid)
      },
    })
  })
})
