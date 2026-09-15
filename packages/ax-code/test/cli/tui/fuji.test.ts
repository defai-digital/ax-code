import { describe, expect, test } from "vitest"
import { fujiRows, fujiBackground } from "../../../src/cli/tui/component/fuji-view-model"

describe("Fuji Mountain scenes", () => {
  test.each(["fuji-day", "fuji-night"] as const)("%s clips scenery and train to resized screens", (style) => {
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
    const train = (ms: number) => fujiRows(74, 24, "fuji-day", ms).slice(18, 22)
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
      for (const row of fujiRows(74, 20, "fuji-day", ms).slice(16)) {
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
  test("day and night preserve Fuji and sakura with distinct sky and celestial colors", () => {
    const day = fujiRows(74, 24, "fuji-day", 0),
      night = fujiRows(74, 24, "fuji-night", 0)
    const text = (rows: typeof day) => rows.map((r) => r.map((c) => c.text).join("")).join("\n")
    expect(text(day)).toContain(".-'     '-.")
    expect(text(night)).not.toContain(".-'     '-.")
    expect(text(day)).not.toContain("FUJI MOUNTAIN")
    for (const scene of [day, night]) {
      expect(text(scene)).toContain('"""""')
      expect(text(scene)).toContain("_.._")
      expect(text(scene)).toContain("===")
    }
    expect(fujiBackground("fuji-day")).not.toBe(fujiBackground("fuji-night"))
    expect(day.flat().some((r) => r.color === "#1b4332")).toBe(true)
    expect(night.flat().some((r) => r.color === "#557a85")).toBe(true)
  })
})

test("daytime preserves the supplied reference artwork and colors at its original width", () => {
  const rows = fujiRows(74, 20, "fuji-day", 0)
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
  expect(rows[2]!.some((run) => run.text.includes(".---.") && run.color === "#ffb703")).toBe(true)
  expect(rows[11]!.some((run) => run.text.includes("_.._") && run.color === "#ffb5a7")).toBe(true)
  // At this point the complete original left-facing train fits on screen.
  const train = fujiRows(74, 20, "fuji-day", 1200).slice(16)
  expect(train[0]!.map((run) => run.text).join("")).toContain(
    "  _____     ____________________   ____________________ ",
  )
  expect(train[2]!.map((run) => run.text).join("")).toContain(
    "[  JR   ___  __  __  __  __  __  |   __  __  __  __  __  |",
  )
})
