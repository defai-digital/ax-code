import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
} from "../../src/debug-engine/runtime-debug"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { SessionDebug } from "../../src/session/debug"
import { tmpdir } from "../fixture/fixture"

async function emit(sessionID: string, directory: string, payload: { kind: string; metadata: any }) {
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: payload.kind,
    callID: `call-${payload.kind}`,
    status: "completed",
    metadata: payload.metadata,
    durationMs: 1,
  })
  void directory
}

function buildCase(sessionID: string, problem: string) {
  const caseId = computeDebugCaseId({ problem, runId: sessionID })
  return {
    caseId,
    debugCase: {
      schemaVersion: 1 as const,
      caseId,
      problem,
      status: "open" as const,
      createdAt: "2026-04-26T18:00:00.000Z",
      source: { tool: "debug_open_case", version: "4.x.x", runId: sessionID },
    },
  }
}

function buildEvidence(sessionID: string, caseId: string, content: string) {
  const evidenceId = computeDebugEvidenceId({ caseId, kind: "log_capture", content })
  return {
    evidenceId,
    debugEvidence: {
      schemaVersion: 1 as const,
      evidenceId,
      caseId,
      kind: "log_capture" as const,
      capturedAt: "2026-04-26T18:01:00.000Z",
      content,
      source: { tool: "debug_capture_evidence", version: "4.x.x", runId: sessionID },
    },
  }
}

function buildHypothesis(sessionID: string, caseId: string, claim: string, status: "active" | "refuted" | "confirmed" | "unresolved" = "active") {
  const hypothesisId = computeDebugHypothesisId({ caseId, claim })
  return {
    hypothesisId,
    debugHypothesis: {
      schemaVersion: 1 as const,
      hypothesisId,
      caseId,
      claim,
      confidence: 0.6,
      evidenceRefs: [],
      status,
      source: { tool: "debug_propose_hypothesis", version: "4.x.x", runId: sessionID },
    },
  }
}

describe("SessionDebug.load", () => {
  test("returns empty arrays for a session with no debug events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const loaded = SessionDebug.load(session.id)
        expect(loaded.cases).toEqual([])
        expect(loaded.evidence).toEqual([])
        expect(loaded.hypotheses).toEqual([])
      },
    })
  })

  test("rebuilds cases / evidence / hypotheses from tool.result metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const c = buildCase(session.id, "tests time out")
        const e = buildEvidence(session.id, c.caseId, "log line")
        const h = buildHypothesis(session.id, c.caseId, "pool exhaustion")

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        await emit(session.id, tmp.path, { kind: "debug_open_case", metadata: { caseId: c.caseId, debugCase: c.debugCase } })
        await emit(session.id, tmp.path, { kind: "debug_capture_evidence", metadata: { evidenceId: e.evidenceId, debugEvidence: e.debugEvidence } })
        await emit(session.id, tmp.path, { kind: "debug_propose_hypothesis", metadata: { hypothesisId: h.hypothesisId, debugHypothesis: h.debugHypothesis } })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const loaded = SessionDebug.load(session.id)
        expect(loaded.cases).toHaveLength(1)
        expect(loaded.evidence).toHaveLength(1)
        expect(loaded.hypotheses).toHaveLength(1)
        expect(loaded.cases[0].caseId).toBe(c.caseId)
        expect(loaded.evidence[0].caseId).toBe(c.caseId)
        expect(loaded.hypotheses[0].caseId).toBe(c.caseId)
      },
    })
  })

  test("skips malformed entries instead of crashing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const good = buildCase(session.id, "tests time out")

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        // Malformed case (status not in enum)
        await emit(session.id, tmp.path, {
          kind: "debug_open_case",
          metadata: { debugCase: { ...good.debugCase, status: "in_progress" } },
        })
        // Valid case
        await emit(session.id, tmp.path, {
          kind: "debug_open_case",
          metadata: { caseId: good.caseId, debugCase: good.debugCase },
        })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const loaded = SessionDebug.load(session.id)
        expect(loaded.cases).toHaveLength(1)
        expect(loaded.cases[0].caseId).toBe(good.caseId)
      },
    })
  })

  test("ignores tool.result events with status: 'error'", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const c = buildCase(session.id, "p")

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "debug_open_case",
          callID: "call-err",
          status: "error",
          metadata: { caseId: c.caseId, debugCase: c.debugCase },
          durationMs: 1,
        })
        await new Promise((resolve) => setTimeout(resolve, 30))

        expect(SessionDebug.load(session.id).cases).toEqual([])
      },
    })
  })

  test("indexedIds returns both caseIds and evidenceIds in a single walk (matches narrow helpers)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const c = buildCase(session.id, "p")
        const e = buildEvidence(session.id, c.caseId, "log line")

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        await emit(session.id, tmp.path, { kind: "debug_open_case", metadata: { caseId: c.caseId, debugCase: c.debugCase } })
        await emit(session.id, tmp.path, { kind: "debug_capture_evidence", metadata: { evidenceId: e.evidenceId, debugEvidence: e.debugEvidence } })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const indexed = SessionDebug.indexedIds(session.id)
        expect(indexed.caseIds.has(c.caseId)).toBe(true)
        expect(indexed.evidenceIds.has(e.evidenceId)).toBe(true)
        // the narrow helpers must match what indexedIds returns
        expect([...SessionDebug.caseIdSet(session.id)].sort()).toEqual([...indexed.caseIds].sort())
        expect([...SessionDebug.evidenceIdSet(session.id)].sort()).toEqual([...indexed.evidenceIds].sort())
      },
    })
  })

  test("caseIdSet returns the full set of opened case ids", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const a = buildCase(session.id, "problem A")
        const b = buildCase(session.id, "problem B")

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        await emit(session.id, tmp.path, { kind: "debug_open_case", metadata: { caseId: a.caseId, debugCase: a.debugCase } })
        await emit(session.id, tmp.path, { kind: "debug_open_case", metadata: { caseId: b.caseId, debugCase: b.debugCase } })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const ids = SessionDebug.caseIdSet(session.id)
        expect(ids.size).toBe(2)
        expect(ids.has(a.caseId)).toBe(true)
        expect(ids.has(b.caseId)).toBe(true)
        expect(ids.has("0000aaaa1111bbbb")).toBe(false)
      },
    })
  })
})

describe("SessionDebug.rollup", () => {
  test("case with no hypotheses stays 'open'", async () => {
    const c = buildCase("ses_a", "p")
    const result = SessionDebug.rollup({ cases: [c.debugCase], evidence: [], hypotheses: [] })
    expect(result[0].effectiveStatus).toBe("open")
  })

  test("case with at least one active hypothesis is 'investigating'", async () => {
    const c = buildCase("ses_a", "p")
    const h = buildHypothesis("ses_a", c.caseId, "claim", "active")
    const result = SessionDebug.rollup({
      cases: [c.debugCase],
      evidence: [],
      hypotheses: [h.debugHypothesis],
    })
    expect(result[0].effectiveStatus).toBe("investigating")
  })

  test("case with a confirmed hypothesis is 'resolved'", async () => {
    const c = buildCase("ses_a", "p")
    const h1 = buildHypothesis("ses_a", c.caseId, "wrong claim", "refuted")
    const h2 = buildHypothesis("ses_a", c.caseId, "right claim", "confirmed")
    const result = SessionDebug.rollup({
      cases: [c.debugCase],
      evidence: [],
      hypotheses: [h1.debugHypothesis, h2.debugHypothesis],
    })
    expect(result[0].effectiveStatus).toBe("resolved")
  })

  test("case where all hypotheses are refuted/unresolved is 'unresolved'", async () => {
    const c = buildCase("ses_a", "p")
    const h1 = buildHypothesis("ses_a", c.caseId, "claim a", "refuted")
    const h2 = buildHypothesis("ses_a", c.caseId, "claim b", "refuted")
    const result = SessionDebug.rollup({
      cases: [c.debugCase],
      evidence: [],
      hypotheses: [h1.debugHypothesis, h2.debugHypothesis],
    })
    expect(result[0].effectiveStatus).toBe("unresolved")
  })

  test("declared status 'resolved' or 'unresolved' wins over hypothesis-derived status", async () => {
    const c = { ...buildCase("ses_a", "p").debugCase, status: "resolved" as const }
    const h = buildHypothesis("ses_a", c.caseId, "claim", "active")
    const result = SessionDebug.rollup({
      cases: [c],
      evidence: [],
      hypotheses: [h.debugHypothesis],
    })
    expect(result[0].effectiveStatus).toBe("resolved")
  })
})
