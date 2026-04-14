import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { Recorder } from "../../src/replay/recorder"
import { Replay } from "../../src/replay/replay"
import { AuditExport } from "../../src/audit/export"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("replay tool.result metadata", () => {
  test("reconstructStream preserves optional metadata on tool results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id as SessionID

        Recorder.begin(sid)
        Recorder.emit({ type: "session.start", sessionID: sid, agent: "explore", model: "test/model", directory: tmp.path })
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 0 })
        Recorder.emit({
          type: "llm.output",
          sessionID: sid,
          stepIndex: 0,
          parts: [{ type: "tool_call", callID: "call_1", tool: "code_intelligence", input: { operation: "findSymbol", name: "foo" } }],
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          stepIndex: 0,
          tool: "code_intelligence",
          callID: "call_1",
          status: "completed",
          output: "ok",
          metadata: {
            envelope: {
              source: "graph",
              completeness: "full",
              timestamp: 123,
              serverIDs: [],
            },
          },
          durationMs: 1,
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 0,
          finishReason: "tool-calls",
          tokens: { input: 1, output: 1 },
        })
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 1 })
        Recorder.end(sid)
        await new Promise((resolve) => setTimeout(resolve, 20))

        const { steps } = Replay.reconstructStream(sid)
        expect(steps[0]?.toolResults[0]?.metadata).toEqual({
          envelope: {
            source: "graph",
            completeness: "full",
            timestamp: 123,
            serverIDs: [],
          },
        })

        const exported = [...AuditExport.stream(sid)].map((line) => JSON.parse(line))
        const result = exported.find((row) => row.event_type === "tool.result")
        expect(result?.metadata).toEqual({
          envelope: {
            source: "graph",
            completeness: "full",
            timestamp: 123,
            serverIDs: [],
          },
        })
      },
    })
  })
})
