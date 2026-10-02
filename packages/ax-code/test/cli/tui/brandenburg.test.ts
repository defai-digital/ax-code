import { expect, test } from "vitest"
import {
  BRANDENBURG_COLORS,
  BRANDENBURG_COLUMNS,
  BRANDENBURG_GATE,
  BRANDENBURG_ROWS,
  BRANDENBURG_STARS,
  brandenburgBackground,
  brandenburgBirds,
  brandenburgLights,
  brandenburgRows,
  brandenburgStarBright,
  brandenburgSun,
  brandenburgWalkers,
} from "../../../src/cli/tui/component/brandenburg-view-model"

const lines = (style: "brandenburg-night" | "brandenburg-dawn", elapsedMs: number) =>
  brandenburgRows(76, 24, style, elapsedMs).map((row) => row.map((run) => run.text).join(""))

test.each(["brandenburg-night", "brandenburg-dawn"] as const)("%s clips its gate to resized screens", (style) => {
  expect([BRANDENBURG_COLUMNS, BRANDENBURG_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = brandenburgRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(brandenburgBackground("brandenburg-night")).not.toBe(brandenburgBackground("brandenburg-dawn"))
})

test("the gate keeps the real proportions and passages", () => {
  const gate = BRANDENBURG_GATE
  // Overall width to height of the real gate is about 1.35.
  expect((2 * gate.corniceHalf) / gate.quadrigaTop).toBeGreaterThan(1.3)
  expect((2 * gate.corniceHalf) / gate.quadrigaTop).toBeLessThan(1.4)
  // Six columns, mirrored about the center, evenly sized.
  expect(gate.columns).toHaveLength(6)
  gate.columns.forEach((gx, i) => expect(gx).toBeCloseTo(-gate.columns[5 - i]!))
  // Openings and walls sit exactly between shafts.
  const [, , innerLeft, innerRight, midRight, outerRight] = gate.columns
  expect(gate.centerOpeningHalf).toBeCloseTo(innerRight - gate.shaftHalf)
  expect(gate.openings[0]![0]).toBeCloseTo(innerRight + gate.shaftHalf)
  expect(gate.openings[0]![1]).toBeCloseTo(midRight - gate.shaftHalf)
  expect(gate.wallHalfSpan[0]).toBeCloseTo(midRight + gate.shaftHalf, 0)
  expect(gate.wallHalfSpan[1]).toBeCloseTo(outerRight - gate.shaftHalf, 0)
  expect(innerLeft).toBeCloseTo(-innerRight)
  // The center opening is the widest, and the stack climbs from capital to quadriga.
  expect(2 * gate.centerOpeningHalf).toBeGreaterThan(gate.openings[0]![1] - gate.openings[0]![0])
  expect(gate.capitalBottom).toBeLessThan(gate.architraveBottom)
  expect(gate.architraveBottom).toBeLessThan(gate.friezeBottom)
  expect(gate.friezeBottom).toBeLessThan(gate.corniceBottom)
  expect(gate.corniceBottom).toBeLessThan(gate.atticBottom)
  expect(gate.atticTop).toBeLessThan(gate.centerAtticTop)
  expect(gate.centerAtticTop).toBeLessThan(gate.quadrigaTop)
})

test("the dusk is warm stone under a saturated blue sky", () => {
  const night = BRANDENBURG_COLORS["brandenburg-night"]
  expect(night.sand.slice(1, 3) > night.sand.slice(5, 7)).toBe(true)
  expect(brandenburgBackground("brandenburg-night")).toBe("#06175a")
})

test("floodlights switch on at night and the sun climbs at dawn", () => {
  expect(brandenburgLights("brandenburg-night", 0)).toBeCloseTo(0.35)
  expect(brandenburgLights("brandenburg-night", -100)).toBe(brandenburgLights("brandenburg-night", 0))
  expect(brandenburgLights("brandenburg-night", 700)).toBeGreaterThan(brandenburgLights("brandenburg-night", 0))
  expect(brandenburgLights("brandenburg-night", 1400)).toBe(1)
  expect(brandenburgLights("brandenburg-night", 60_000)).toBe(1)
  expect(brandenburgLights("brandenburg-dawn", 0)).toBeCloseTo(0.8)
  expect(brandenburgSun(0)).toBeCloseTo(2.5)
  expect(brandenburgSun(1750)).toBeGreaterThan(brandenburgSun(0))
  expect(brandenburgSun(3500)).toBeCloseTo(9)
  expect(brandenburgSun(60_000)).toBeCloseTo(9)
})

test.each(["brandenburg-night", "brandenburg-dawn"] as const)("%s renders deterministically", (style) => {
  expect(brandenburgRows(76, 24, style, 0)).toEqual(brandenburgRows(76, 24, style, 0))
  expect(brandenburgRows(76, 24, style, 450)).not.toEqual(brandenburgRows(76, 24, style, 0))
  expect(brandenburgRows(76, 24, style, -100)).toEqual(brandenburgRows(76, 24, style, 0))
})

test("the text gate stacks cornice, frieze, capitals, and six shafts", () => {
  const text = lines("brandenburg-night", 3000)
  expect(text[0]).toContain("\\v/")
  expect(text[2]).toContain("n n Y n n")
  expect(text[7]!.slice(14, 63)).toBe("=".repeat(49))
  expect(text[8]).toContain("o")
  expect(text[9]!.match(/\[===\]/g)).toHaveLength(6)
  for (const x of [17, 25, 33, 43, 51, 59]) expect(text[14]!.slice(x - 1, x + 2)).toBe("|||")
  // Medallions sit on the walled outer passages.
  expect(text[12]!.slice(20, 23)).toBe("(o)")
  expect(text[12]!.slice(54, 57)).toBe("(o)")
})

test("night shows stars and dawn shows the sun behind the gate", () => {
  expect(lines("brandenburg-night", 0)[0]).toContain("*")
  expect(lines("brandenburg-night", 0).join("\n")).not.toContain("_O_")
  expect(lines("brandenburg-dawn", 3500).join("\n")).toContain("_O_")
  expect(lines("brandenburg-dawn", 3500).join("\n")).not.toContain("*")
  expect(BRANDENBURG_STARS.every((star) => star.x < 30 || star.x > 46 || star.y < 3)).toBe(true)
  expect(brandenburgStarBright(0, 0)).toBe(false)
  expect(brandenburgStarBright(0, 1)).toBe(true)
  expect(brandenburgStarBright(400, 0)).toBe(true)
})

test("birds cross the sky and pedestrians stroll the plaza", () => {
  const first = brandenburgBirds(0)
  expect(first).toHaveLength(3)
  expect(first[0]!.up).toBe(true)
  expect(brandenburgBirds(300)[0]!.up).toBe(false)
  expect(brandenburgBirds(10_000)[0]!.x).not.toBe(first[0]!.x)
  const walkers = brandenburgWalkers(0)
  expect(walkers).toHaveLength(8)
  expect(brandenburgWalkers(5000)[0]!.x).not.toBe(walkers[0]!.x)
  for (const elapsed of [0, 12_345, 600_000]) {
    for (const walker of brandenburgWalkers(elapsed)) {
      expect(walker.x).toBeGreaterThanOrEqual(4)
      expect(walker.x).toBeLessThan(BRANDENBURG_COLUMNS - 4)
    }
  }
  // Nearer walkers loom larger.
  expect(walkers.find((walker) => walker.depth === 2)!.height).toBeGreaterThan(
    walkers.find((walker) => walker.depth === 0)!.height,
  )
})
