import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Recorder } from "../../src/replay/recorder"
import { Replay } from "../../src/replay/replay"
import { EventQuery } from "../../src/replay/query"
import { AuditExport } from "../../src/audit/export"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID } from "../../src/code-intelligence/id"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// Phase 2 exit gate from PRD §8: "deterministic replay succeeds on a
// session that makes code graph queries." This test records a full
// session whose only work is a code_intelligence tool call, then
// replays it through Replay.reconstructStream and Replay.summary to
// prove both event families round-trip cleanly through the recorder.
//
// Assertions cover:
//   1. code.graph.snapshot is recorded at session start and surfaces
//      in the audit export
//   2. tool.call / tool.result events for the code_intelligence tool
//      reconstruct into a step with the expected parts
//   3. Replay.summary produces a human-readable line for every event
//      type in the session, including the graph snapshot

describe("replay with code intelligence queries", () => {
  test("round-trips a session that calls code_intelligence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        // Insert real nodes so countNodes() returns the expected count.
        // status() reads live counts, not the cursor summary.
        const now = Date.now()
        for (const name of ["a", "b", "c", "d", "e"]) {
          CodeGraphQuery.insertNode({
            id: CodeNodeID.ascending(),
            project_id: projectID,
            kind: "function",
            name,
            qualified_name: name,
            file: `/tmp/${name}.ts`,
            range_start_line: 0,
            range_start_char: 0,
            range_end_line: 1,
            range_end_char: 0,
            signature: null,
            visibility: null,
            metadata: null,
            time_created: now,
            time_updated: now,
          })
        }
        CodeGraphQuery.upsertCursor(projectID, "cafed00d", 5, 0)

        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)

        // 1. session.start
        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "explore",
          model: "test/model",
          directory: tmp.path,
        })

        // 2. code.graph.snapshot — the piece wired in by cfcadbe.
        const s = CodeIntelligence.status(projectID)
        Recorder.emit({
          type: "code.graph.snapshot",
          sessionID: sid,
          projectID: s.projectID,
          commitSha: s.lastCommitSha,
          nodeCount: s.nodeCount,
          edgeCount: s.edgeCount,
          lastIndexedAt: s.lastUpdated,
        })

        // 3. step.start
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 0 })

        // 4. llm.output carrying a tool_call for code_intelligence
        Recorder.emit({
          type: "llm.output",
          sessionID: sid,
          stepIndex: 0,
          parts: [
            { type: "text", text: "Let me look up handleRequest." },
            {
              type: "tool_call",
              callID: "call_ci_1",
              tool: "code_intelligence",
              input: { operation: "findSymbol", name: "handleRequest" },
            },
          ],
        })

        // 5. tool.call and tool.result — the audit-trail surface
        // that piggybacks on the standard tool recording path.
        Recorder.emit({
          type: "tool.call",
          sessionID: sid,
          stepIndex: 0,
          tool: "code_intelligence",
          callID: "call_ci_1",
          input: { operation: "findSymbol", name: "handleRequest" },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          stepIndex: 0,
          tool: "code_intelligence",
          callID: "call_ci_1",
          status: "completed",
          output: "[function] handleRequest (/tmp/server.ts:1:1)",
          durationMs: 3,
        })

        // 6. step.finish + session.end
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 0,
          finishReason: "tool-calls",
          tokens: { input: 120, output: 30 },
        })
        Recorder.emit({
          type: "session.end",
          sessionID: sid,
          reason: "completed",
          totalSteps: 1,
        })

        Recorder.end(sid)
        // Let microtask-deferred writes flush.
        await new Promise((r) => setTimeout(r, 50))

        // ── Assertion 1: raw event log round-trip ─────────────────
        const events = EventQuery.bySession(sid)
        const types = events.map((e) => e.type)
        expect(types).toContain("session.start")
        expect(types).toContain("code.graph.snapshot")
        expect(types).toContain("step.start")
        expect(types).toContain("llm.output")
        expect(types).toContain("tool.call")
        expect(types).toContain("tool.result")
        expect(types).toContain("step.finish")
        expect(types).toContain("session.end")

        // The snapshot is in the recorded stream with the cursor data.
        const snap = events.find((e) => e.type === "code.graph.snapshot")
        expect(snap).toBeDefined()
        if (snap?.type !== "code.graph.snapshot") throw new Error("narrowing")
        expect(snap.nodeCount).toBe(5)
        expect(snap.edgeCount).toBe(0)
        expect(snap.commitSha).toBe("cafed00d")

        // ── Assertion 2: reconstructStream handles the tool call ──
        const { steps } = Replay.reconstructStream(sid)
        expect(steps).toHaveLength(1)
        expect(steps[0].stepIndex).toBe(0)
        // The text + tool_call parts from llm.output round-tripped.
        expect(steps[0].parts.length).toBe(2)
        expect(steps[0].parts[0]).toEqual({ type: "text", text: "Let me look up handleRequest." })
        const toolCallPart = steps[0].parts[1]
        expect(toolCallPart.type).toBe("tool_call")
        if (toolCallPart.type !== "tool_call") throw new Error("narrowing")
        expect(toolCallPart.tool).toBe("code_intelligence")
        expect(toolCallPart.input).toEqual({ operation: "findSymbol", name: "handleRequest" })
        // The tool result re-attached to the step.
        expect(steps[0].toolResults.length).toBe(1)
        expect(steps[0].toolResults[0].callID).toBe("call_ci_1")
        expect(steps[0].toolResults[0].output).toContain("handleRequest")
        expect(steps[0].finishReason).toBe("tool-calls")

        // ── Assertion 3: summary mentions the graph snapshot ──────
        const lines = Replay.summary(sid)
        const graphLine = lines.find((l) => l.includes("[graph]"))
        expect(graphLine).toBeDefined()
        expect(graphLine).toContain("nodes=5")
        expect(graphLine).toContain("edges=0")
        expect(graphLine).toContain("sha=cafed00d")

        // ── Assertion 4: audit export covers both families ────────
        const auditRecords = [...AuditExport.stream(sid)].map((line) => JSON.parse(line))
        const snapshotRecord = auditRecords.find((r) => r.event_type === "code.graph.snapshot")
        const toolCallRecord = auditRecords.find(
          (r) => r.event_type === "tool.call" && r.tool === "code_intelligence",
        )
        const toolResultRecord = auditRecords.find(
          (r) => r.event_type === "tool.result" && r.tool === "code_intelligence",
        )
        expect(snapshotRecord).toBeDefined()
        expect(snapshotRecord.action).toBe("snapshot")
        expect(toolCallRecord).toBeDefined()
        expect(toolCallRecord.action).toBe("call")
        expect(toolResultRecord).toBeDefined()
        expect(toolResultRecord.action).toBe("result")
        expect(toolResultRecord.result).toContain("handleRequest")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})
