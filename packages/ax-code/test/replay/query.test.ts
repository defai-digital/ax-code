import { describe, expect, test } from "vitest"
import { EventQuery } from "../../src/replay/query"
import { SessionID } from "../../src/session/schema"

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
