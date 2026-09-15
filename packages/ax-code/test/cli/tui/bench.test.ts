import { describe, expect, test } from "vitest"
import { benchRows, benchBackground } from "../../../src/cli/tui/component/bench-view-model"

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
