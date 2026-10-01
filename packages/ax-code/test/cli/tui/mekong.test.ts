import { expect, test } from "vitest"
import {
  MEKONG_COLUMNS,
  MEKONG_ROWS,
  mekongBackground,
  mekongBob,
  mekongEgrets,
  mekongMarket,
  mekongRows,
  mekongShimmer,
} from "../../../src/cli/tui/component/mekong-view-model"

test.each(["mekong-dawn", "mekong-dusk"] as const)("%s clips its river to resized screens", (style) => {
  expect([MEKONG_COLUMNS, MEKONG_ROWS]).toEqual([76, 24])
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 450, 900]) {
      const rows = mekongRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(mekongBackground("mekong-dawn")).not.toBe(mekongBackground("mekong-dusk"))
})

test("the sampan bobs while shimmer columns march", () => {
  expect(mekongBob(0)).toBe(0)
  expect(mekongBob(300)).toBe(1)
  expect(mekongBob(900)).toBe(-1)
  expect(mekongBob(-100)).toBe(0)
  expect(mekongShimmer(0)).toBe(0)
  expect(mekongShimmer(300)).toBe(1)
})

test("the long-running westbound egret wraps without leaving a negative column", () => {
  expect(mekongEgrets(66150)[1]).toEqual({ x: 75, y: 5 })
})

test.each(["mekong-dawn", "mekong-dusk"] as const)("%s renders deterministically", (style) => {
  expect(mekongRows(76, 24, style, 0)).toEqual(mekongRows(76, 24, style, 0))
  expect(mekongRows(76, 24, style, 450)).not.toEqual(mekongRows(76, 24, style, 0))
  const text = mekongRows(76, 24, style, 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("~")
  expect(text).toContain("=")
})

test("a hatted rower rides the swell", () => {
  const rows = mekongRows(76, 24, "mekong-dawn", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(16)).toContain("\\________/")
  expect(line(14)).toContain("/--\\")
})

test("a skiff, grasses, egrets, and a longer sun path fill the river", () => {
  expect(mekongEgrets(0)).toEqual([
    { x: 5, y: 7 },
    { x: 70, y: 5 },
  ])
  expect(mekongEgrets(350)[0]).toEqual({ x: 6, y: 7 })
  expect(mekongEgrets(450)[1]).toEqual({ x: 69, y: 5 })
  const rows = mekongRows(76, 24, "mekong-dawn", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(13).slice(50, 55)).toBe("\\__/ ")
  expect(line(13)[9]).toBe('"')
  expect(line(16).slice(58, 63)).toBe("~~~~~")
  expect(line(7)[5]).toBe("v")
  expect(line(5)[70]).toBe("v")
})

test("a market boat, temple, stilt house, and lilies fill the river", () => {
  expect(mekongMarket(0)).toBe(70)
  expect(mekongMarket(120)).toBe(69)
  expect(mekongMarket(-100)).toBe(70)
  const rows = mekongRows(76, 24, "mekong-dawn", 0)
  const line = (row: number) => rows[row]!.map((run) => run.text).join("")
  expect(line(15).slice(70, 76)).toBe("\\____/")
  expect(line(14).slice(71, 74)).toBe("ooo")
  expect(line(11).slice(70, 74)).toBe("|[]|")
  expect(line(12).slice(14, 19)).toBe("|___|")
  expect(line(20)[48]).toBe("o")
  expect(line(19)[48]).toBe("*")
})
