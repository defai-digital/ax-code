import { describe, expect, test } from "vitest"
import {
  BENCH_COLUMNS,
  BENCH_ROWS,
  benchBackground,
  benchCenterX,
  benchClouds,
  benchFaintStarBright,
  benchFaintStarRow,
  benchHaloTicks,
  benchHorizon,
  benchReflection,
  benchRows,
  benchStarGlyph,
  benchStarRow,
  benchSunX,
  benchSunY,
  benchSway,
  benchTitle,
  benchWavePhase,
} from "../../../src/cli/tui/component/bench-view-model"

describe("Bench ASCII scenes", () => {
  test.each(["midnight-dream", "sunset-serenade"] as const)(
    "%s fits tiny, narrow, normal, and resized screens",
    (style) => {
      for (const [width, height] of [
        [0, 0],
        [1, 1],
        [12, 5],
        [36, 20],
        [80, 30],
        [120, 40],
      ]) {
        const rows = benchRows(width!, height!, style, 250)
        expect(rows).toHaveLength(height!)
        for (const row of rows) {
          const text = row.map((run) => run.text).join("")
          expect(text).toHaveLength(width!)
          expect(text).toMatch(/^[\x20-\x7e]*$/)
        }
      }
    },
  )
  test("the pair has distinct palettes and names, with animated waves and fronds", () => {
    const opening = benchRows(70, 23, "midnight-dream", 0)
    const ending = benchRows(70, 23, "sunset-serenade", 0)
    const text = (rows: typeof opening) => rows.map((r) => r.map((c) => c.text).join("")).join("\n")
    expect(text(opening)).toContain("MIDNIGHT DREAM")
    expect(text(ending)).toContain("SUNSET SERENADE")
    expect(text(opening)).toContain(".---.")
    expect(text(opening)).toContain("//")
    expect(text(opening)).toContain("~")
    expect(text(opening)).toContain("___")
    expect(benchBackground("midnight-dream")).not.toBe(benchBackground("sunset-serenade"))
    expect(opening.flat().some((run) => run.color === "#00b4d8")).toBe(true)
    expect(ending.flat().some((run) => run.color === "#c36b9b")).toBe(true)
    const advanced = text(benchRows(70, 23, "midnight-dream", 250))
    expect(advanced).not.toBe(text(opening))
    expect(advanced.split("\n")[18]).not.toBe(text(opening).split("\n")[18])
    expect(advanced.split("\n")[11]).not.toBe(text(opening).split("\n")[11])
    expect(text(benchRows(70, 23, "sunset-serenade", 2900))).not.toBe(text(ending))
  })
})

describe("Bench shared scene model", () => {
  test("reference size and phases derive from elapsed time alone", () => {
    expect([BENCH_COLUMNS, BENCH_ROWS]).toEqual([70, 23])
    expect(benchHorizon(23)).toBe(18)
    expect(benchHorizon(3)).toBe(0)
    expect(benchSunX(70)).toBe(49)
    expect(benchSunX(10)).toBe(3)
    expect(benchSunY("midnight-dream", 99999, 18)).toBe(1)
    expect(benchSunY("sunset-serenade", 0, 18)).toBe(12)
    expect(benchSunY("sunset-serenade", 3000, 18)).toBe(14)
    expect(benchSunY("sunset-serenade", 99999, 18)).toBe(14)
    expect(benchSunY("sunset-serenade", -100, 18)).toBe(12)
    expect(benchSway(0, 70)).toBe(0)
    expect(benchSway(500, 70)).toBe(3)
    expect(benchWavePhase(0)).toBe(0)
    expect(benchWavePhase(300)).toBe(1)
    expect(benchWavePhase(400)).toBe(0)
    expect(benchStarGlyph(0, 3)).toBe("*")
    expect(benchStarGlyph(600, 3)).toBe(".")
    expect(benchStarRow(3, 18)).toBe(1)
    expect(benchTitle("midnight-dream")).toBe("MIDNIGHT DREAM")
    expect(benchTitle("sunset-serenade")).toBe("SUNSET SERENADE")
    expect(benchCenterX("MIDNIGHT DREAM", 70)).toBe(28)
  })

  test.each(["midnight-dream", "sunset-serenade"] as const)("%s renders deterministic frames", (style) => {
    expect(benchRows(70, 23, style, 1000)).toEqual(benchRows(70, 23, style, 1000))
    expect(benchRows(70, 23, style, 0)).not.toEqual(benchRows(70, 23, style, 1000))
  })
})

describe("Bench beautification", () => {
  test("sunset clouds drift deterministically while midnight has none", () => {
    expect(benchClouds("midnight-dream", 0, 70)).toEqual([])
    const first = benchClouds("sunset-serenade", 0, 70)
    expect(first).toHaveLength(2)
    expect(benchClouds("sunset-serenade", 0, 70)).toEqual(first)
    expect(benchClouds("sunset-serenade", 2000, 70)).not.toEqual(first)
    expect(benchClouds("sunset-serenade", -100, 70)).toEqual(first)
    const rows = benchRows(70, 23, "sunset-serenade", 0)
    expect(rows.flat().some((run) => run.color === "#f5b8a8")).toBe(true)
    expect(
      benchRows(70, 23, "midnight-dream", 0)
        .flat()
        .some((run) => run.color === "#f5b8a8"),
    ).toBe(false)
  })
  test("midnight faint stars interleave the main field on an offset phase", () => {
    expect(benchFaintStarRow(7, 18)).toBe(2)
    expect(benchFaintStarBright(0, 7)).toBe(true)
    expect(benchFaintStarBright(100, 7)).toBe(false)
    const night = benchRows(70, 23, "midnight-dream", 0)
    const line = (row: number) => night[row]!.map((run) => run.text).join("")
    expect(line(2)[7]).toBe("*")
    const day = benchRows(70, 23, "sunset-serenade", 0)
    expect(day[2]!.map((run) => run.text).join("")[7]).not.toBe("*")
  })
  test("sun reflection shimmers under the body with the wave phase", () => {
    const cells = benchReflection(0, 70, 18)
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(51)
      expect(cell.x).toBeLessThanOrEqual(53)
      expect(cell.y).toBeGreaterThanOrEqual(18)
      expect(cell.y).toBeLessThanOrEqual(19)
    }
    expect(benchReflection(300, 70, 18)).not.toEqual(cells)
    expect(benchHaloTicks(49, 1)).toContainEqual({ x: 48, y: 3 })
    const rows = benchRows(70, 23, "midnight-dream", 0)
    expect(rows[3]!.map((run) => run.text).join("")[48]).toBe(":")
  })
  test("palm coconuts, shells, and wet sand decorate both styles", () => {
    for (const style of ["midnight-dream", "sunset-serenade"] as const) {
      const rows = benchRows(70, 23, style, 0)
      const text = rows.map((r) => r.map((c) => c.text).join("")).join("\n")
      expect(text).toContain("o")
      const line = (row: number) => rows[row]!.map((run) => run.text).join("")
      expect(line(21)[10]).toBe("o")
      expect(line(21)[45]).toBe("*")
      expect(rows.flat().some((run) => run.color === (style === "midnight-dream" ? "#a8824f" : "#c08a5a"))).toBe(true)
    }
  })
})
