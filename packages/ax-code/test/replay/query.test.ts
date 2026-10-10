import { describe, expect, test } from "vitest"
import { EventQuery } from "../../src/replay/query"
import { SessionID } from "../../src/session/schema"
import { EventLogID } from "../../src/replay"
import type { ReplayEvent } from "../../src/replay/event"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("EventQuery.allSince", () => {
  test("rejects invalid pagination inputs", () => {
    expect(() => EventQuery.allSince({ since: -1 })).toThrow()
    expect(() => EventQuery.allSince({ since: 1.5 })).toThrow()
    expect(() => EventQuery.allSince({ since: 0, limit: 0 })).toThrow()
    expect(() => EventQuery.allSince({ since: 0, limit: 1.5 })).toThrow()
    expect(() =>
      EventQuery.allSince({
        since: 0,
        cursor: { time_created: -1, session_id: SessionID.ascending(), sequence: 0 },
      }),
    ).toThrow()
    expect(() =>
      EventQuery.allSince({
        since: 0,
        cursor: { time_created: 0, session_id: SessionID.ascending(), sequence: -1 },
      }),
    ).toThrow()
  })
})

describe("EventQuery.memoizeReads", () => {
  async function withSession(fn: (sessionID: SessionID, append: (sequence: number) => void) => void | Promise<void>) {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const append = (sequence: number) =>
          EventQuery.insert({
            id: EventLogID.ascending(),
            session_id: session.id,
            step_id: null,
            event_type: "session.start",
            event_data: { type: "session.start", sequence } as unknown as ReplayEvent,
            sequence,
          })
        try {
          await fn(session.id, append)
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  }

  test("shares one decode across bySession and bySessionWithTimestamp inside the scope", async () => {
    await withSession(async (sessionID, append) => {
      append(0)
      append(1)

      await EventQuery.memoizeReads(async () => {
        const first = EventQuery.bySession(sessionID)
        append(2)
        // Inside the scope later writes are not observed: one consistent snapshot.
        expect(EventQuery.bySession(sessionID)).toHaveLength(2)
        expect(EventQuery.bySessionWithTimestamp(sessionID).map((row) => row.event_data)).toEqual(first)
      })

      expect(EventQuery.bySession(sessionID)).toHaveLength(3)
    })
  })

  test("returns independent arrays so callers can reorder them safely", async () => {
    await withSession(async (sessionID, append) => {
      append(0)
      append(1)

      await EventQuery.memoizeReads(async () => {
        const a = EventQuery.bySession(sessionID)
        a.reverse()
        const b = EventQuery.bySession(sessionID)
        expect(b.map((event) => (event as unknown as { sequence: number }).sequence)).toEqual([0, 1])
      })
    })
  })

  test("does not memoize outside a scope and nests without resetting the outer scope", async () => {
    await withSession(async (sessionID, append) => {
      append(0)
      expect(EventQuery.bySession(sessionID)).toHaveLength(1)
      append(1)
      expect(EventQuery.bySession(sessionID)).toHaveLength(2)

      await EventQuery.memoizeReads(async () => {
        expect(EventQuery.bySession(sessionID)).toHaveLength(2)
        await EventQuery.memoizeReads(async () => {
          append(2)
          expect(EventQuery.bySession(sessionID)).toHaveLength(2)
        })
        expect(EventQuery.bySession(sessionID)).toHaveLength(2)
      })
    })
  })
})
