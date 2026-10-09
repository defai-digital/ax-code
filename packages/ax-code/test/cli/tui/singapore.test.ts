import { expect, test } from "vitest"
import {
  SINGAPORE_COLORS,
  SINGAPORE_COLUMNS,
  SINGAPORE_ROWS,
  singaporeBackground,
  singaporeBoat,
  singaporeJet,
  singaporePhase,
  singaporeRows,
} from "../../../src/cli/tui/component/singapore-view-model"
import {
  isTextSceneStyle,
  textSceneBackground,
  textSceneRows,
} from "../../../src/cli/tui/component/text-scene-view-model"
import {
  DIGITAL_CODE_DURATION_MS,
  DIGITAL_CODE_REVERSE_DURATION_MS,
} from "../../../src/cli/tui/component/digital-code-view-model"

test.each(["singapore-day", "singapore-night"] as const)(
  "%s uses the existing scene and three-second defaults",
  (style) => {
    expect(isTextSceneStyle(style)).toBe(true)
    expect(textSceneRows(76, 24, style, 1000)).toEqual(singaporeRows(76, 24, style, 1000))
    expect(textSceneBackground(style)).toBe(singaporeBackground(style))
    expect([DIGITAL_CODE_DURATION_MS, DIGITAL_CODE_REVERSE_DURATION_MS]).toEqual([3000, 3000])
  },
)

test.each(["singapore-day", "singapore-night"] as const)(
  "%s clips ASCII artwork safely on resized terminals",
  (style) => {
    for (const [width, height] of [
      [0, 0],
      [0, 5],
      [5, 0],
      [1, 1],
      [36, 12],
      [76, 24],
      [120, 40],
    ]) {
      const rows = singaporeRows(width!, height!, style, 1500)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  },
)

test.each(["singapore-day", "singapore-night"] as const)(
  "%s retains landmarks while fountain and boat move",
  (style) => {
    expect([SINGAPORE_COLUMNS, SINGAPORE_ROWS]).toEqual([76, 24])
    const first = singaporeRows(76, 24, style, 0),
      moving = singaporeRows(76, 24, style, 1000)
    expect(singaporeRows(76, 24, style, -1)).toEqual(first)
    expect(singaporeRows(76, 24, style, 1000)).toEqual(moving)
    expect(moving).not.toEqual(first)
    const text = (row: number) => first[row]!.map((run) => run.text).join("")
    expect(text(7).slice(29, 65)).toBe("\\" + "=".repeat(34) + "/")
    for (const x of [35, 46, 57]) expect(text(10).slice(x - 3, x + 4)).toBe("|:::::|")
    expect(text(13)).toContain("{  >==")
    expect(text(23)).toContain("SINGAPORE")
    expect(moving.flat().some((run) => run.color === SINGAPORE_COLORS[style].fountain)).toBe(true)
  },
)

test("day and night share geometry with distinct illuminated palettes", () => {
  expect(singaporeBackground("singapore-day")).not.toBe(singaporeBackground("singapore-night"))
  const day = singaporeRows(76, 24, "singapore-day", 0),
    night = singaporeRows(76, 24, "singapore-night", 0)
  expect(day[10]!.some((run) => run.color === SINGAPORE_COLORS["singapore-day"].glass)).toBe(true)
  expect(night[10]!.some((run) => run.color === SINGAPORE_COLORS["singapore-night"].light)).toBe(true)
})

test("fountain stays anchored at the mouth while spray flutters and falls into the bay", () => {
  for (const time of [0, 1000, 2000, 2950, 6000]) {
    expect(singaporeJet(0, time)).toEqual({ x: 17, y: 12.9 })
    expect(singaporeJet(1, time).x).toBe(32)
    expect(singaporeJet(1, time).y).toBeGreaterThan(19.7)
    expect(singaporeJet(1, time).y).toBeLessThan(19.9)
  }
  expect(singaporeJet(0.5, 1000)).not.toEqual(singaporeJet(0.5, 0))
  expect(singaporePhase(6000)).toBe(singaporePhase(0))
  expect(singaporeJet(0.5, -1)).toEqual(singaporeJet(0.5, 0))
})

test("boat crosses once and holds its position at the three-second boundary", () => {
  let previous = 0
  for (let time = 0; time <= 3000; time += 50) {
    const boat = singaporeBoat(time)
    expect(boat.x).toBeGreaterThanOrEqual(previous)
    expect(boat.y).toBeGreaterThanOrEqual(20.8)
    expect(boat.y).toBeLessThanOrEqual(21.2)
    previous = boat.x
  }
  expect(singaporeBoat(3000).x).toBe(57)
  expect(singaporeBoat(6000).x).toBe(57)
  expect(singaporeBoat(-1)).toEqual(singaporeBoat(0))
})
