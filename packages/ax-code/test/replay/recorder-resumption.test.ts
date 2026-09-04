import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import type { SessionID } from "../../src/session/schema"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { EventLogID } from "../../src/replay"
import { Replay } from "../../src/replay/replay"
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
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe.each([
  { name: "global", sharded: false },
  { name: "sharded", sharded: true },
])("recorder resumption ($name store)", ({ sharded }) => {
  beforeEach(() => vi.stubEnv("AX_CODE_SHARD_SESSIONS", sharded ? "1" : "0"))

  test("continues sequence numbers across completed recording windows", async () => {
    await withSession(async (sessionID) => {
      for (let window = 0; window < 2; window++) {
        Recorder.begin(sessionID)
        for (let offset = 0; offset < 2; offset++) {
          Recorder.emit({ type: "step.start", sessionID, stepIndex: window * 2 + offset })
        }
        await Recorder.end(sessionID)
      }

      expect(EventQuery.bySessionLog(sessionID).map((row) => row.sequence)).toEqual([0, 1, 2, 3])
      expect(EventQuery.bySession(sessionID).map((event) => event.stepIndex)).toEqual([0, 1, 2, 3])
      expect(EventQuery.recentBySession(sessionID, 2).map((event) => event.stepIndex)).toEqual([2, 3])
    })
  })

  test("retains the next sequence when restarted before a pending flush", async () => {
    await withSession(async (sessionID) => {
      Recorder.begin(sessionID)
      Recorder.emit({ type: "step.start", sessionID, stepIndex: 0 })
      Recorder.emit({ type: "step.start", sessionID, stepIndex: 1 })
      const previousEnd = Recorder.end(sessionID)
      Recorder.begin(sessionID)
      Recorder.emit({ type: "step.start", sessionID, stepIndex: 2 })
      await previousEnd

      expect(Recorder.active(sessionID)).toBe(true)
      Recorder.emit({ type: "step.start", sessionID, stepIndex: 3 })
      await Recorder.end(sessionID)

      expect(EventQuery.bySessionLog(sessionID).map((row) => row.sequence)).toEqual([0, 1, 2, 3])
    })
  })

  test("resumes after the persisted maximum rather than the event count", async () => {
    await withSession(async (sessionID) => {
      EventQuery.insert({
        id: EventLogID.ascending(),
        session_id: sessionID,
        step_id: "0",
        event_type: "step.start",
        event_data: { type: "step.start", sessionID, stepIndex: 0 },
        sequence: 41,
      })

      Recorder.begin(sessionID)
      Recorder.emit({ type: "step.start", sessionID, stepIndex: 1 })
      await Recorder.end(sessionID)

      expect(EventQuery.bySessionLog(sessionID).map((row) => row.sequence)).toEqual([41, 42])
    })
  })

  test("keeps cursor pagination gapless when recording windows share a timestamp", async () => {
    await withSession(async (sessionID) => {
      const now = Date.now()
      vi.spyOn(Date, "now").mockReturnValue(now)
      for (let window = 0; window < 2; window++) {
        Recorder.begin(sessionID)
        Recorder.emit({ type: "step.start", sessionID, stepIndex: window * 2 })
        Recorder.emit({ type: "step.start", sessionID, stepIndex: window * 2 + 1 })
        await Recorder.end(sessionID)
      }

      const events: EventQuery.AllSinceRow[] = []
      let cursor: EventQuery.AllSinceRow | undefined
      for (let page = 0; page < 10; page++) {
        const rows = EventQuery.allSince({ since: now, limit: 1, cursor })
        if (rows.length === 0) break
        events.push(...rows.filter((row) => row.session_id === sessionID))
        cursor = rows.at(-1)
      }
      expect(events.map((row) => row.event_data.stepIndex)).toEqual([0, 1, 2, 3])
    })
  })

  test("reconstructs each recording window with its own output", async () => {
    await withSession(async (sessionID) => {
      for (let window = 0; window < 2; window++) {
        Recorder.begin(sessionID)
        Recorder.emit({ type: "step.start", sessionID, stepIndex: 0 })
        Recorder.emit({
          type: "llm.output",
          sessionID,
          stepIndex: 0,
          parts: [{ type: "text", text: `Round ${window}` }],
        })
        Recorder.emit({
          type: "step.finish",
          sessionID,
          stepIndex: 0,
          finishReason: "stop",
          tokens: { input: 1, output: 1 },
        })
        await Recorder.end(sessionID)
      }

      expect(Replay.reconstructStream(sessionID).steps.map((step) => step.parts)).toEqual([
        [{ type: "text", text: "Round 0" }],
        [{ type: "text", text: "Round 1" }],
      ])
    })
  })
})
