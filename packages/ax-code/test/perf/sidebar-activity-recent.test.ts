import { describe, expect, test } from "vitest"
import { activityItems } from "@/cli/cmd/tui/routes/session/activity"
import type { ReplayEvent } from "@/replay/event"
import type { Part } from "@ax-code/sdk/v2"

// Perf fix (finding 2): the sidebar activity memo used to load the ENTIRE
// session event log (up to 10k rows) on every streamed part update. It now
// fetches only the most recent ~100 rows (recentBySessionWithTimestamp),
// because the activity list only ever renders the 10 newest items. This test
// proves the visible output (top 10) is identical whether we feed activityItems
// the full log or just the most recent 100 rows — the justification for the
// LIMITed query.

function routeRow(messageID: string, time: number) {
  return {
    event_data: {
      sessionID: "s1",
      type: "agent.route",
      messageID,
      routeMode: "switch",
      fromAgent: "build",
      toAgent: "review",
      confidence: 0.9,
    } as unknown as ReplayEvent,
    time_created: time,
  }
}

function toolPart(id: string, start: number): Part {
  return {
    id,
    type: "tool",
    tool: "read",
    state: { status: "completed", time: { start } },
  } as unknown as Part
}

describe("sidebar activity recent-rows equivalence", () => {
  test("top 10 items are identical from the full log vs the most recent 100 rows", () => {
    // 150 route events in ascending time/sequence order — larger than the
    // 100-row window the sidebar now requests.
    const fullRows = Array.from({ length: 150 }, (_, i) => routeRow(`m${i}`, i + 1))
    // A handful of older tool parts that are passed identically in both cases.
    const parts = [toolPart("p1", 5), toolPart("p2", 12)]

    // recentBySessionWithTimestamp returns the newest `limit` rows in ascending
    // sequence order — i.e. the tail of the log.
    const recentRows = fullRows.slice(-100)

    const fromFull = activityItems(parts, fullRows, []).slice(0, 10)
    const fromRecent = activityItems(parts, recentRows, []).slice(0, 10)

    expect(fromRecent).toEqual(fromFull)
    // Sanity: the visible items really are the newest ones.
    expect(fromFull[0].time).toBe(150)
    expect(fromFull.length).toBe(10)
  })

  test("short sessions (fewer than the window) are unaffected", () => {
    const rows = Array.from({ length: 8 }, (_, i) => routeRow(`m${i}`, i + 1))
    const fromFull = activityItems([], rows, []).slice(0, 10)
    const fromRecent = activityItems([], rows.slice(-100), []).slice(0, 10)
    expect(fromRecent).toEqual(fromFull)
  })
})
