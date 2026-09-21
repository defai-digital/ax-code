import { describe, expect, test } from "vitest"
import { stringWidth } from "../../../src/bun/node-compat"
import {
  timelineCard,
  timelinePosition,
  timelineWindow,
  turnPreview,
} from "../../../src/cli/tui/routes/session/timeline-rail-model"

describe("transcript turn timeline", () => {
  test("hides an empty or single turn and an unusably short rail", () => {
    expect(timelineWindow(0, 24, 0)).toEqual([])
    expect(timelineWindow(1, 24, 0)).toEqual([])
    expect(timelineWindow(20, 2, 0)).toEqual([])
  })
  test("centers a compact stack instead of stretching sparse turns", () => {
    expect(timelineWindow(3, 50, 0)).toEqual([
      { index: 0, row: 23 },
      { index: 1, row: 24 },
      { index: 2, row: 25 },
    ])
    const ticks = timelineWindow(2, 24, 1)
    expect(ticks.map((tick) => tick.row)).toEqual([11, 12])
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
    expect(timelinePosition(turns, 20, true)).toEqual({ active: 1, previous: 1, next: -1 })
    expect(timelinePosition(turns, 100)).toEqual({ active: 2, previous: 2, next: -1 })
  })
})

describe("transcript turn timeline at the bottom", () => {
  test("pins the window to the tail side without excluding the active turn", () => {
    // 50 turns in 20 rows leave 18 tick rows.
    const mid = timelineWindow(50, 20, 25, true)
    expect(mid.at(0)?.index).toBe(25)
    expect(mid.at(-1)?.index).toBe(42)
    const tailActive = timelineWindow(50, 20, 40, true)
    expect(tailActive.at(0)?.index).toBe(32)
    expect(tailActive.at(-1)?.index).toBe(49)
    const last = timelineWindow(50, 20, 49, true)
    expect(last.some((tick) => tick.index === 49)).toBe(true)
  })
  test("keeps the active turn reachable at the bottom across long histories and resize", () => {
    for (const height of [3, 4, 16, 24, 40]) {
      for (const active of [0, 1, 50, 99]) {
        const ticks = timelineWindow(100, height, active, true)
        expect(ticks.some((tick) => tick.index === active)).toBe(true)
        expect(new Set(ticks.map((tick) => tick.row)).size).toBe(ticks.length)
        expect(ticks.every((tick) => tick.row > 0 && tick.row < height - 1)).toBe(true)
      }
    }
  })
  test("small conversations are unchanged at the bottom", () => {
    expect(timelineWindow(3, 50, 0, true)).toEqual(timelineWindow(3, 50, 0))
    expect(timelineWindow(2, 24, 1, true)).toEqual(timelineWindow(2, 24, 1))
  })
})

describe("turn preview", () => {
  test("takes the first non-empty line, normalized", () => {
    expect(turnPreview("\n\n  leading blanks skipped  \nsecond line")).toBe("leading blanks skipped")
    expect(turnPreview("  multiple   spaces\tand\ttabs ")).toBe("multiple spaces and tabs")
  })
  test("strips ANSI escapes and control characters", () => {
    const esc = String.fromCharCode(27)
    const bell = String.fromCharCode(7)
    expect(turnPreview(`${esc}[31mred text${esc}[0m`)).toBe("red text")
    expect(turnPreview(`bell${bell}here`)).toBe("bell here")
  })
  test("caps length in code points with an ellipsis", () => {
    const preview = turnPreview("x".repeat(500))
    expect(preview).toHaveLength(120)
    expect(preview.endsWith("…")).toBe(true)
  })
  test("does not split a surrogate pair at the cap", () => {
    expect(turnPreview("a".repeat(118) + "🙂" + "b".repeat(100))).toBe("a".repeat(118) + "🙂…")
  })
  test("empty when nothing but whitespace", () => {
    expect(turnPreview("  \n \n\t")).toBe("")
  })
})

describe("timeline hover card", () => {
  const base = { timeLabel: "12:34", termWidth: 80, tickRow: 10, railHeight: 24 }

  test("no card without a preview", () => {
    expect(timelineCard({ ...base, preview: "" })).toBeNull()
    expect(timelineCard({ ...base, preview: "   " })).toBeNull()
  })
  test("single short line stays one line and fits the time label", () => {
    const card = timelineCard({ ...base, preview: "fix the bug" })
    expect(card?.lines).toEqual(["fix the bug"])
    expect(card?.width).toBe(11 + 4)
    expect(card?.height).toBe(4)
  })
  test("wraps to two display lines and ellipsizes the remainder", () => {
    const card = timelineCard({ ...base, preview: "word ".repeat(30).trim() })
    expect(card?.lines).toHaveLength(2)
    expect(card?.lines[1].endsWith("…")).toBe(true)
    for (const line of card?.lines ?? []) expect(stringWidth(line)).toBeLessThanOrEqual(32)
  })
  test("exactly two full lines are not ellipsized", () => {
    const card = timelineCard({ ...base, preview: "x".repeat(32) + " " + "y".repeat(32) })
    expect(card?.lines).toEqual(["x".repeat(32), "y".repeat(32)])
  })
  test("wide characters wrap by display width, not code units", () => {
    const card = timelineCard({ ...base, preview: "你好世界".repeat(20) })
    expect(card?.lines).toHaveLength(2)
    for (const line of card?.lines ?? []) expect(stringWidth(line)).toBeLessThanOrEqual(32)
  })
  test("card is skipped when the rail is too short", () => {
    expect(timelineCard({ ...base, preview: "hi", railHeight: 3 })).toBeNull()
    expect(timelineCard({ ...base, preview: "hi", railHeight: 4 })).not.toBeNull()
  })
  test("top is centered on the tick row and clamped to the rail", () => {
    expect(timelineCard({ ...base, preview: "hi" })?.top).toBe(8)
    expect(timelineCard({ ...base, preview: "hi", tickRow: 0 })?.top).toBe(0)
    expect(timelineCard({ ...base, preview: "hi", tickRow: 23 })?.top).toBe(20)
  })
  test("text width follows the terminal width clamp", () => {
    const wide = timelineCard({ ...base, preview: "x".repeat(200), termWidth: 200 })
    expect(Math.max(...(wide?.lines ?? []).map(stringWidth))).toBeLessThanOrEqual(32)
    const narrow = timelineCard({ ...base, preview: "x".repeat(200), termWidth: 50 })
    expect(Math.max(...(narrow?.lines ?? []).map(stringWidth))).toBeLessThanOrEqual(20)
  })
})
