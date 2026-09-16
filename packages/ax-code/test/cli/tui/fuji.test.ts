import { describe, expect, test } from "vitest"
import { fujiRows, fujiBackground, fujiSkyRgb } from "../../../src/cli/tui/component/fuji-view-model"

describe("Fuji Mountain scenes", () => {
  test.each(["fuji-dawn", "fuji-night"] as const)("%s clips scenery and train to resized screens", (style) => {
    for (const [width, height] of [
      [0, 0],
      [1, 1],
      [12, 5],
      [36, 20],
      [80, 30],
      [120, 40],
    ]) {
      for (const elapsed of [0, 700, 1600, 2400]) {
        const rows = fujiRows(width!, height!, style, elapsed)
        expect(rows).toHaveLength(height!)
        for (const row of rows) {
          const text = row.map((run) => run.text).join("")
          expect(text).toHaveLength(width!)
          expect(text).toMatch(/^[\x20-\x7e]*$/)
        }
      }
    }
  })
  test("the train travels and recycles independently of frame rate", () => {
    const train = (ms: number) => fujiRows(74, 24, "fuji-dawn", ms).slice(18, 22)
    expect(train(0)).not.toEqual(train(500))
    expect(train(0)).toEqual(train(2400))
    expect(train(-100)).toEqual(train(0))
    expect(
      train(500)
        .flat()
        .some((r) => r.background === "#1d3557"),
    ).toBe(true)
    expect(
      train(1200)
        .map((r) => r.map((c) => c.text).join(""))
        .join("\n"),
    ).toContain("JR")
  })
  test("the left-facing train travels right-to-left instead of backwards", () => {
    const leftmostInk = (ms: number) => {
      let min = Number.POSITIVE_INFINITY
      for (const row of fujiRows(74, 20, "fuji-dawn", ms).slice(16)) {
        let column = 0
        for (const run of row) {
          for (let index = 0; index < run.text.length; index++) {
            if (run.text[index] !== " " && column + index < min) min = column + index
          }
          column += run.text.length
        }
      }
      return min
    }
    const early = leftmostInk(800)
    const late = leftmostInk(1600)
    expect(Number.isFinite(early)).toBe(true)
    expect(Number.isFinite(late)).toBe(true)
    expect(late).toBeLessThan(early)
  })
  test("the train fully clears the left edge before the cycle wraps", () => {
    // Regression: the cycle distance was SCENE_WIDTH + TRAIN_WIDTH, so the last
    // frame before the wrap landed the tail glyph on column 0 and the next frame
    // reset to the right edge. The train never completed its leftward journey.
    const rightmostInk = (ms: number) => {
      let max = -1
      for (const row of fujiRows(74, 20, "fuji-dawn", ms).slice(16)) {
        let column = 0
        for (const run of row) {
          for (let index = 0; index < run.text.length; index++) {
            if (run.text[index] !== " " && column + index > max) max = column + index
          }
          column += run.text.length
        }
      }
      return max
    }
    expect(rightmostInk(800)).toBeGreaterThanOrEqual(0)
    expect(rightmostInk(2400 - 1)).toBe(-1)
  })

  test("dawn and night preserve Fuji and sakura with distinct sky and celestial colors", () => {
    const dawn = fujiRows(74, 24, "fuji-dawn", 0),
      night = fujiRows(74, 24, "fuji-night", 0)
    const text = (rows: typeof dawn) => rows.map((r) => r.map((c) => c.text).join("")).join("\n")
    expect(text(dawn)).toContain(".-'     '-.")
    expect(text(night)).not.toContain(".-'     '-.")
    expect(text(dawn)).not.toContain("FUJI MOUNTAIN")
    for (const scene of [dawn, night]) {
      expect(text(scene)).toContain('"""""')
      expect(text(scene)).toContain("_.._")
      expect(text(scene)).toContain("===")
    }
    expect(fujiBackground("fuji-dawn")).toBe("#4338ca")
    expect(fujiBackground("fuji-night")).toBe("#0c1b33")
    expect(dawn.flat().some((r) => r.color === "#1e1035")).toBe(true)
    expect(night.flat().some((r) => r.color === "#3c6782")).toBe(true)
    expect(fujiSkyRgb("fuji-dawn", 0)).toEqual([0x1e, 0x1b, 0x4b])
    expect(fujiSkyRgb("fuji-dawn", 1)).toEqual([0xf4, 0x3f, 0x5e])
    expect(fujiSkyRgb("fuji-night", 0)).toEqual([0x03, 0x08, 0x14])
    expect(fujiSkyRgb("fuji-night", 1)).toEqual([0x1d, 0x35, 0x57])
  })
})

test("dawn preserves the supplied reference artwork and dawn colors at its original width", () => {
  const rows = fujiRows(74, 20, "fuji-dawn", 0)
  const text = rows.map((row) =>
    row
      .map((run) => run.text)
      .join("")
      .trimEnd(),
  )
  expect(text.slice(0, 16)).toEqual([
    "         _ ._  _ _",
    "       (  _ )_ ( _  )",
    "                               .---.",
    "                            .-'     '-.",
    '                           /"""""""""\\',
    "                          /           \\",
    "                         /             \\",
    "                        /               \\",
    "                       /                 \\",
    "                     _/                   \\_",
    "____________________/                       \\_____________________",
    "    _.._         _.._                _.._               _.._",
    "  (      )     (      )            (      )           (      )",
    "     ||           ||                  ||                 ||",
    "__________________________________________________________________________",
    "==========================================================================",
  ])
  expect(rows[2]!.some((run) => run.text.includes(".---.") && run.color === "#fbbf24")).toBe(true)
  expect(rows[11]!.some((run) => run.text.includes("_.._") && run.color === "#ffb7c5")).toBe(true)
  // At this point the complete original left-facing train fits on screen.
  const train = fujiRows(74, 20, "fuji-dawn", 1200).slice(16)
  expect(train[0]!.map((run) => run.text).join("")).toContain(
    "  _____     ____________________   ____________________ ",
  )
  expect(train[2]!.map((run) => run.text).join("")).toContain(
    "[  JR   ___  __  __  __  __  __  |   __  __  __  __  __  |",
  )
})
