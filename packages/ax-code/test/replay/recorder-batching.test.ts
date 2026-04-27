import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { tmpdir } from "../fixture/fixture"

describe("Recorder.emit batching", () => {
  test("preserves order across many events emitted in the same tick", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Recorder.begin(session.id)

        // Emit a burst of events synchronously — these all queue into the
        // same microtask flush. The previous impl ran one INSERT per event;
        // the batched impl coalesces them into one statement.
        const N = 50
        for (let i = 0; i < N; i++) {
          Recorder.emit({
            type: "step.start",
            sessionID: session.id,
            stepIndex: i,
          } as any)
        }

        Recorder.end(session.id)
        await new Promise((r) => setTimeout(r, 50))

        const events = EventQuery.bySession(session.id)
        expect(events).toHaveLength(N)
        for (let i = 0; i < N; i++) {
          const ev = events[i] as any
          expect(ev.type).toBe("step.start")
          expect(ev.stepIndex).toBe(i)
        }

        EventQuery.deleteBySession(session.id)
        await Session.remove(session.id)
      },
    })
  })

  test("flushes events emitted across multiple ticks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Recorder.begin(session.id)

        Recorder.emit({ type: "step.start", sessionID: session.id, stepIndex: 0 } as any)
        await new Promise((r) => setTimeout(r, 10))
        Recorder.emit({ type: "step.start", sessionID: session.id, stepIndex: 1 } as any)
        await new Promise((r) => setTimeout(r, 10))
        Recorder.emit({ type: "step.start", sessionID: session.id, stepIndex: 2 } as any)

        Recorder.end(session.id)
        await new Promise((r) => setTimeout(r, 50))

        const events = EventQuery.bySession(session.id)
        expect(events).toHaveLength(3)
        expect((events[0] as any).stepIndex).toBe(0)
        expect((events[1] as any).stepIndex).toBe(1)
        expect((events[2] as any).stepIndex).toBe(2)

        EventQuery.deleteBySession(session.id)
        await Session.remove(session.id)
      },
    })
  })
})
