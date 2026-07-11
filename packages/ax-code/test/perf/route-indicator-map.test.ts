import { describe, expect, test } from "vitest"
import { buildRouteInfoByMessage } from "@/cli/cmd/tui/routes/session/route"
import type { ReplayEvent } from "@/replay/event"

// Perf fix (finding 1): RouteIndicator used to load the full session event
// log per message and filter for its own agent.route row. The hoisted memo
// now calls buildRouteInfoByMessage once over an indexed, agent.route-filtered
// query. These tests lock the map-building + primary-row selection so the
// per-message output stays byte-for-byte identical to the old inline logic.

function row(event: Partial<ReplayEvent> & { type: string }, time_created: number) {
  return { event_data: { sessionID: "s1", ...event } as unknown as ReplayEvent, time_created }
}

describe("buildRouteInfoByMessage", () => {
  test("keys route info by messageID", () => {
    const map = buildRouteInfoByMessage([
      row({ type: "agent.route", messageID: "m1", fromAgent: "build", toAgent: "review", confidence: 0.9 }, 100),
      row({ type: "agent.route", messageID: "m2", fromAgent: "build", toAgent: "plan", confidence: 0.8 }, 200),
    ])
    expect([...map.keys()].sort()).toEqual(["m1", "m2"])
    expect(map.get("m1")?.title).toBe("Switched to Review")
    expect(map.get("m2")?.title).toBe("Switched to Plan")
  })

  test("prefers a non-complexity (switch) event over a same-turn complexity event", () => {
    const map = buildRouteInfoByMessage([
      row({ type: "agent.route", messageID: "m1", routeMode: "complexity", fromAgent: "build", toAgent: "build", confidence: 0.5 }, 100),
      row({ type: "agent.route", messageID: "m1", routeMode: "switch", fromAgent: "build", toAgent: "review", confidence: 0.9 }, 110),
    ])
    // The switch event wins even though the complexity event came first.
    expect(map.get("m1")?.title).toBe("Switched to Review")
  })

  test("falls back to the last match when all are complexity events", () => {
    const map = buildRouteInfoByMessage([
      row({ type: "agent.route", messageID: "m1", routeMode: "complexity", fromAgent: "a", toAgent: "a", confidence: 0.5 }, 100),
      row({ type: "agent.route", messageID: "m1", routeMode: "complexity", fromAgent: "b", toAgent: "b", confidence: 0.5 }, 110),
    ])
    expect(map.get("m1")?.title).toBe("Fast model")
    // Last match's fromAgent drives the detail line.
    expect(map.get("m1")?.detail).toBe("simple task · B")
  })

  test("ignores rows without a messageID and non-route rows", () => {
    const map = buildRouteInfoByMessage([
      row({ type: "tool.call", messageID: "m1" }, 90),
      row({ type: "agent.route", fromAgent: "build", toAgent: "review", confidence: 0.9 }, 100),
      row({ type: "agent.route", messageID: "m3", fromAgent: "build", toAgent: "plan", confidence: 0.8 }, 200),
    ])
    expect([...map.keys()]).toEqual(["m3"])
  })

  test("empty input yields an empty map", () => {
    expect(buildRouteInfoByMessage([]).size).toBe(0)
  })
})
