import { describe, expect, test } from "vitest"
import { timelinePosition, timelineWindow } from "../../../src/cli/tui/routes/session/timeline-rail-model"

describe("transcript turn timeline", () => {
  test("hides an empty or single turn and an unusably short rail", () => {
    expect(timelineWindow(0, 24, 0)).toEqual([])
    expect(timelineWindow(1, 24, 0)).toEqual([])
    expect(timelineWindow(20, 2, 0)).toEqual([])
  })
  test("keeps the active turn reachable across long histories and resize", () => {
    for (const height of [3, 4, 16, 24, 40]) {
      for (const active of [0, 1, 50, 99]) {
        const ticks = timelineWindow(100, height, active)
        expect(ticks.some((tick) => tick.index === active)).toBe(true)
        expect(new Set(ticks.map((tick) => tick.row)).size).toBe(ticks.length)
        expect(ticks.every((tick) => tick.row > 0 && tick.row < height - 1)).toBe(true)
      }
    }
  })
  test("previous arrow returns to the beginning of a partially visible turn", () => {
    const turns = [{ y: -15 }, { y: 10 }, { y: 80 }]
    expect(timelinePosition(turns, 20)).toEqual({ active: 1, previous: 1, next: 2 })
    expect(timelinePosition(turns, 10)).toEqual({ active: 1, previous: 0, next: 2 })
    expect(timelinePosition(turns, -20)).toEqual({ active: 0, previous: -1, next: 0 })
    expect(timelinePosition(turns, 100)).toEqual({ active: 2, previous: 2, next: -1 })
  })
})
