import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { DecisionHints } from "../../src/session/decision-hints"
import type { SessionID } from "../../src/session/schema"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Shard } from "../../src/storage/shard"
import { tmpdir } from "../fixture/fixture"

async function withSession(fn: (sessionID: SessionID) => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      try {
        await fn(session.id)
      } finally {
        await Recorder.end(session.id)
        EventQuery.deleteBySession(session.id)
        await Session.remove(session.id)
      }
    },
  })
}

afterEach(async () => {
  await Instance.disposeAll()
  Shard.closeAll()
})

function call(sessionID: SessionID, callID: string, tool: string, input: Record<string, unknown>) {
  Recorder.emit({ type: "tool.call", sessionID, tool, callID, input } as any)
}
function result(sessionID: SessionID, callID: string, tool: string, metadata?: Record<string, unknown>) {
  Recorder.emit({
    type: "tool.result",
    sessionID,
    tool,
    callID,
    status: "completed",
    output: "o".repeat(2048),
    durationMs: 1,
    ...(metadata ? { metadata } : {}),
  } as any)
}

describe("EventQuery.recentToolEventsForHints", () => {
  test("produces the same decision hints as the full event window", async () => {
    await withSession(async (sessionID) => {
      Recorder.begin(sessionID)
      Recorder.emit({ type: "step.start", sessionID, stepIndex: 0 } as any)
      call(sessionID, "c1", "edit", { filePath: "/p/a.ts", oldString: "x".repeat(4096), newString: "y" })
      result(sessionID, "c1", "edit", { filediff: { before: "x".repeat(8192), after: "y" }, diagnostics: {} })
      call(sessionID, "c2", "bash", { command: "pnpm test", description: "Run tests" })
      result(sessionID, "c2", "bash", { exit: 1, output: "fail" })
      call(sessionID, "c3", "debug_hypothesis", { claim: "z" })
      result(sessionID, "c3", "debug_hypothesis", {
        debugHypothesis: { status: "proposed", claim: "cache stale", nested: [1, true, null] },
        verificationPolicyFailed: false,
        effectiveCaseStatus: "open",
      })
      call(sessionID, "c4", "register_finding", { workflow: "review" })
      result(sessionID, "c4", "register_finding")
      Recorder.emit({ type: "step.start", sessionID, stepIndex: 1 } as any)
      await Recorder.end(sessionID)

      const full = EventQuery.recentBySession(sessionID)
      const projected = EventQuery.recentToolEventsForHints(sessionID)
      expect(projected.map((e) => e.type)).toEqual(
        full.filter((e) => e.type === "tool.call" || e.type === "tool.result").map((e) => e.type),
      )
      const hints = DecisionHints.analyzeEvents(projected)
      expect(hints).toEqual(DecisionHints.analyzeEvents(full))
      expect(hints.actionCount).toBe(4)

      // Consumed fields survive with their JSON types; unconsumed bulk does not.
      const debug = projected.find((e) => e.type === "tool.result" && e.callID === "c3") as any
      expect(debug.metadata).toEqual({
        debugHypothesis: { status: "proposed", claim: "cache stale", nested: [1, true, null] },
        verificationPolicyFailed: false,
        effectiveCaseStatus: "open",
      })
      const edit = projected.find((e) => e.type === "tool.result" && e.callID === "c1") as any
      expect(edit.metadata).toEqual({})
      expect(edit.output).toBeUndefined()
      const editCall = projected.find((e) => e.type === "tool.call" && e.callID === "c1") as any
      expect(editCall.input).toEqual({ filePath: "/p/a.ts" })
    })
  })

  test("keeps true flags as booleans", async () => {
    await withSession(async (sessionID) => {
      Recorder.begin(sessionID)
      call(sessionID, "c1", "debug_hypothesis", {})
      result(sessionID, "c1", "debug_hypothesis", { verificationPolicyFailed: true, exit: 0 })
      await Recorder.end(sessionID)
      const [, res] = EventQuery.recentToolEventsForHints(sessionID) as any[]
      expect(res.metadata.verificationPolicyFailed).toBe(true)
      expect(res.metadata.exit).toBe(0)
    })
  })

  test("returns tool events from the most recent overall event window", async () => {
    await withSession(async (sessionID) => {
      Recorder.begin(sessionID)
      for (let i = 0; i < 4; i++) {
        call(sessionID, `c${i}`, "bash", { command: `echo ${i}` })
        Recorder.emit({ type: "step.start", sessionID, stepIndex: i } as any)
        result(sessionID, `c${i}`, "bash", { exit: 0 })
      }
      await Recorder.end(sessionID)
      const recent = EventQuery.recentToolEventsForHints(sessionID, 3) as any[]
      expect(recent.map((e) => `${e.type}:${e.callID}`)).toEqual(["tool.call:c3", "tool.result:c3"])
    })
  })
})
