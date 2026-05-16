import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { AuditExport } from "../../src/audit/export"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeFileID } from "../../src/code-intelligence/id"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// These tests cover the replay integration for Code Intelligence: when a
// session starts, a code.graph.snapshot event is recorded alongside the
// existing session.start event. The snapshot reports the cursor state
// (node/edge counts, commit sha) so deterministic replay can see what
// the agent's view of the code looked like at the moment work began.
//
// We don't drive the full session loop here — that is covered by the
// existing session tests. Instead we exercise the Recorder + AuditExport
// plumbing directly, which is what the prompt.ts emit site relies on.

describe("replay code.graph.snapshot", () => {
  test("snapshot event records current cursor state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        // Seed two nodes and a cursor so status() returns meaningful
        // numbers — proves the snapshot reads real state, not just zeros.
        const now = Date.now()
        CodeGraphQuery.insertNode({
          id: CodeNodeID.ascending(),
          project_id: projectID,
          kind: "function",
          name: "alpha",
          qualified_name: "alpha",
          file: "/tmp/a.ts",
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
        CodeGraphQuery.upsertFile({
          id: CodeFileID.ascending(),
          project_id: projectID,
          path: "/tmp/a.ts",
          sha: "seed",
          size: 0,
          lang: "typescript",
          indexed_at: now,
          completeness: "full",
          time_created: now,
          time_updated: now,
        })
        CodeGraphQuery.upsertCursor(projectID, "abc123", 1, 0)

        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)

        // Mirror what prompt.ts does at the session.start site.
        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
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

        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        const events = EventQuery.bySession(sid)
        const snapshot = events.find((e) => e.type === "code.graph.snapshot")
        expect(snapshot).toBeDefined()
        if (snapshot?.type !== "code.graph.snapshot") throw new Error("narrowing")
        expect(snapshot.projectID).toBe(projectID)
        expect(snapshot.commitSha).toBe("abc123")
        expect(snapshot.nodeCount).toBe(1)
        expect(snapshot.edgeCount).toBe(0)
        expect(snapshot.lastIndexedAt).toBeGreaterThan(0)

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("snapshot with no indexed cursor reports zeros", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)

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

        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        const events = EventQuery.bySession(sid)
        const snapshot = events.find((e) => e.type === "code.graph.snapshot")
        expect(snapshot).toBeDefined()
        if (snapshot?.type !== "code.graph.snapshot") throw new Error("narrowing")
        expect(snapshot.nodeCount).toBe(0)
        expect(snapshot.edgeCount).toBe(0)
        expect(snapshot.commitSha).toBeNull()
        expect(snapshot.lastIndexedAt).toBeNull()

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })

  test("audit export emits a record for the snapshot event", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        // Insert a real node so countNodes() returns 1.
        // status() reads live counts, not the cursor summary.
        const now = Date.now()
        CodeGraphQuery.insertNode({
          id: CodeNodeID.ascending(),
          project_id: projectID,
          kind: "function",
          name: "beta",
          qualified_name: "beta",
          file: "/tmp/b.ts",
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
        CodeGraphQuery.upsertCursor(projectID, "deadbeef", 1, 0)

        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)

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

        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        const records = [...AuditExport.stream(sid)].map((line) => JSON.parse(line))
        const snap = records.find((r) => r.event_type === "code.graph.snapshot")
        expect(snap).toBeDefined()
        expect(snap.action).toBe("snapshot")
        expect(snap.target).toBe(projectID)
        expect(snap.result).toContain("nodes=1")
        expect(snap.result).toContain("edges=0")
        expect(snap.result).toContain("sha=deadbeef")

        CodeIntelligence.__clearProject(projectID)
      },
    })
  })
})
