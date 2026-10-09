import { expect, test } from "vitest"
import {
  SPACE_COLUMNS,
  SPACE_CYCLE_MS,
  SPACE_ROWS,
  spaceBackground,
  spaceFlicker,
  spaceNebulaShift,
  spaceRocketY,
  spaceRows,
  spaceSatelliteX,
  spaceTwinkle,
} from "../../../src/cli/tui/component/space-view-model"

test.each(["space-launch", "space-drift"] as const)("%s clips its scene to resized screens", (style) => {
  expect([SPACE_COLUMNS, SPACE_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = spaceRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(spaceBackground("space-launch")).not.toBe(spaceBackground("space-drift"))
})

test("the rocket ascends deterministically past twinkling stars", () => {
  expect(spaceRocketY(0)).toBe(15)
  expect(spaceRocketY(1200)).toBe(8)
  expect(spaceRocketY(SPACE_CYCLE_MS)).toBeLessThan(spaceRocketY(1200))
  expect(spaceRocketY(3000)).toBe(spaceRocketY(SPACE_CYCLE_MS))
  expect(spaceRocketY(SPACE_CYCLE_MS * 2)).toBe(spaceRocketY(SPACE_CYCLE_MS))
  expect(spaceRocketY(-100)).toBe(spaceRocketY(0))
  expect(spaceTwinkle(0, 0)).toBe(true)
  expect(spaceTwinkle(0, 1)).toBe(false)
  expect(spaceTwinkle(400, 0)).toBe(false)
  expect(spaceTwinkle(SPACE_CYCLE_MS, 0)).toBe(spaceTwinkle(0, 0))
  expect(spaceFlicker(0)).toBe(true)
  expect(spaceFlicker(200)).toBe(false)
  expect(spaceSatelliteX(0)).toBe(0)
  expect(spaceSatelliteX(1200)).toBe(38)
  expect(spaceSatelliteX(SPACE_CYCLE_MS)).toBe(0)
  expect(spaceNebulaShift(0)).toBe(0)
  expect(spaceNebulaShift(1200)).toBe(6)
  expect(spaceNebulaShift(SPACE_CYCLE_MS)).toBe(0)
})

test.each(["space-launch", "space-drift"] as const)("%s renders deterministically", (style) => {
  expect(spaceRows(76, 24, style, 0)).toEqual(spaceRows(76, 24, style, 0))
  expect(spaceRows(76, 24, style, 450)).not.toEqual(spaceRows(76, 24, style, 0))
  if (style === "space-drift") expect(spaceRows(76, 24, style, SPACE_CYCLE_MS)).toEqual(spaceRows(76, 24, style, 0))
  else {
    expect(spaceRows(76, 24, style, SPACE_CYCLE_MS)).not.toEqual(spaceRows(76, 24, style, 0))
    expect(spaceRows(76, 24, style, SPACE_CYCLE_MS * 2)).toEqual(spaceRows(76, 24, style, SPACE_CYCLE_MS))
  }
  expect(spaceRows(76, 24, style, -100)).toEqual(spaceRows(76, 24, style, 0))
})

test("the rocket lifts off over a cratered planet limb", () => {
  const rows = spaceRows(76, 24, "space-launch", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(15).slice(36, 40)).toBe(" /\\ ")
  expect(line(16).slice(36, 39)).toBe("|o|")
  expect(line(17).slice(36, 39)).toBe("|_|")
  expect(line(18)[37]).toBe("*")
  expect(line(1)[4]).toBe("*")
  expect(line(21)[12]).toBe("o")
})

test("the drift scene carries a satellite and nebulae", () => {
  const rows = spaceRows(76, 24, "space-drift", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(3).slice(0, 3)).toBe("-O-")
  expect(line(10).slice(10, 15)).toBe("~~~~~")
  expect(line(11).slice(35, 40)).toBe("~~~~~")
  expect(line(1)[4]).toBe("*")
  expect(line(21)[52]).toBe("o")
})

test("liftoff never reverses or restarts during the three-second playback", () => {
  let previous = spaceRocketY(0)
  for (let elapsed = 50; elapsed <= 3000; elapsed += 50) {
    const current = spaceRocketY(elapsed)
    expect(current).toBeLessThanOrEqual(previous)
    previous = current
  }
})
