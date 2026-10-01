import { expect, test } from "vitest"
import {
  GREATWALL_COLUMNS,
  GREATWALL_ROWS,
  greatwallBackground,
  greatwallBirds,
  greatwallClouds,
  greatwallEagle,
  greatwallFlag,
  greatwallRidgeY,
  greatwallRows,
  greatwallSmoke,
  greatwallTorch,
} from "../../../src/cli/tui/component/greatwall-view-model"

test.each(["greatwall-dawn", "greatwall-dusk"] as const)("%s clips its wall to resized screens", (style) => {
  expect([GREATWALL_COLUMNS, GREATWALL_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 500, 900]) {
      const rows = greatwallRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(greatwallBackground("greatwall-dawn")).not.toBe(greatwallBackground("greatwall-dusk"))
})

test("the wall dips through the middle ridge while clouds drift", () => {
  expect(greatwallRidgeY(0)).toBe(14)
  expect(greatwallRidgeY(30)).toBe(10)
  expect(greatwallRidgeY(60)).toBe(14)
  const first = greatwallClouds(0)
  expect(first).toHaveLength(3)
  expect(greatwallClouds(0)).toEqual(first)
  expect(greatwallClouds(500)).not.toEqual(first)
  expect(greatwallClouds(-100)).toEqual(first)
})

test.each(["greatwall-dawn", "greatwall-dusk"] as const)("%s renders deterministically", (style) => {
  expect(greatwallRows(76, 24, style, 0)).toEqual(greatwallRows(76, 24, style, 0))
  expect(greatwallRows(76, 24, style, 500)).not.toEqual(greatwallRows(76, 24, style, 0))
  const text = greatwallRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("#")
  expect(text).toContain("|")
})

test("the watchtower straddles the middle ridge", () => {
  const rows = greatwallRows(76, 24, "greatwall-dawn", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(4)).toContain("/________\\")
  expect(line(7)).toContain("[]")
})

test("the flag ripples over pines while swifts cross", () => {
  expect(greatwallFlag(0)).toBe(0)
  expect(greatwallFlag(300)).toBe(1)
  const birds = greatwallBirds(0)
  expect(birds).toHaveLength(3)
  expect(greatwallBirds(450)).not.toEqual(birds)
  const rows = greatwallRows(76, 24, "greatwall-dawn", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(1).slice(45, 48)).toBe(">>>")
  expect(line(6)).toContain("/\\")
})

test("smoke, an eagle, a far tower, braziers, and scrub dress the ridge", () => {
  expect(greatwallSmoke(0)).toEqual([
    { x: 37, y: 3 },
    { x: 37, y: 2 },
    { x: 37, y: 1 },
  ])
  expect(greatwallTorch(0)).toBe(true)
  expect(greatwallTorch(250)).toBe(false)
  expect(greatwallEagle(0)).toEqual({ x: 36, y: 5 })
  const rows = greatwallRows(76, 24, "greatwall-dawn", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(2)[37]).toBe("o")
  expect(line(5)[36]).toBe("V")
  expect(line(12)[8]).toBe("*")
  expect(line(6).slice(59, 62)).toBe("|||")
  expect(line(22)[3]).toBe("^")
})
