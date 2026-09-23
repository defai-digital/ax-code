import { describe, expect, test } from "vitest"
import { fujiRows, fujiBackground, fujiSkyRgb, fujiPetals } from "../../../src/cli/tui/component/fuji-view-model"

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
  test("the train fully clears the left edge before the cycle wraps", () => {
    // Regression: the cycle distance was SCENE_WIDTH + TRAIN_WIDTH, so the last
    // frame before the wrap landed the tail glyph on column 0 and the next frame
    // reset to the right edge. The train never completed its leftward journey.
    const rightmostInk = (ms: number) => {
      let max = -1
      for (const row of fujiRows(74, 20, "fuji-day", ms).slice(16)) {
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

  test("day and night share the sunset composition with distinct sky and celestial colors", () => {
    const day = fujiRows(74, 24, "fuji-day", 0),
      night = fujiRows(74, 24, "fuji-night", 0)
    const text = (rows: typeof day) => rows.map((r) => r.map((c) => c.text).join("")).join("\n")
    expect(text(day)).toContain(".-'     '-.")
    expect(text(night)).not.toContain(".-'     '-.")
    expect(text(night)).toContain(".-.")
    // The moon glyph must not leak into the daytime sun cap.
    const dayTop = day[2]!.map((c) => c.text).join("")
    expect(dayTop).toContain(".---.")
    expect(dayTop).not.toContain(".-.")
    for (const scene of [day, night]) {
      expect(text(scene)).toContain('"""')
      expect(text(scene)).toContain("~~~")
      expect(text(scene)).toContain("(        )")
      expect(text(scene)).toContain("||")
      expect(text(scene)).toContain("===")
    }
    expect(fujiBackground("fuji-day")).not.toBe(fujiBackground("fuji-night"))
    expect(day.flat().some((r) => r.color === "#8c5665")).toBe(true)
    expect(night.flat().some((r) => r.color === "#557a85")).toBe(true)
    expect(day.flat().some((r) => r.background === "#3a2233")).toBe(true)
    expect(night.flat().some((r) => r.background === "#2d4454")).toBe(true)
    expect(day.flat().some((r) => r.background === "#cca897")).toBe(true)
    expect(day.flat().some((r) => r.background === "#c97b91")).toBe(true)
    expect(day.flat().some((r) => r.background === "#7a4658")).toBe(true)
    expect(night.flat().some((r) => r.background === "#2c4a6e")).toBe(true)
    expect(day.flat().some((r) => r.color === "#dfb0bc")).toBe(true)
    expect(night.flat().some((r) => r.color === "#e8d5e0")).toBe(true)
    expect(fujiSkyRgb("fuji-day", 0)).toEqual([90, 32, 78])
    expect(fujiSkyRgb("fuji-day", 1)).toEqual([196, 120, 82])
    expect(fujiSkyRgb("fuji-night", 0)).toEqual([16, 27, 54])
    expect(fujiSkyRgb("fuji-night", 1)).toEqual([29, 53, 87])
  })

  test("the night ending keeps a fixed celestial band while petals fall deterministically", () => {
    const text = (rows: ReturnType<typeof fujiRows>, index: number) => rows[index]!.map((run) => run.text).join("")
    const night = fujiRows(74, 20, "fuji-night", 0)
    expect(text(night, 2)).toContain("+")
    // The moon stays beside the summit. Its pale fill and the snow cap merged
    // into a single white block when it sat directly above the peak.
    expect(text(night, 0)).toContain(".-.")
    expect(text(night, 0).indexOf(".-.")).toBeGreaterThan(40)
    // Rows 0-2 are decoration, not animation: petals stay below them.
    expect(fujiRows(74, 20, "fuji-night", 1200).slice(0, 3)).toEqual(night.slice(0, 3))
    expect(fujiRows(74, 20, "fuji-day", 1200).slice(0, 3)).toEqual(fujiRows(74, 20, "fuji-day", 0).slice(0, 3))
    // Daytime keeps the setting sun; the star band stays a night-only feature.
    const day = fujiRows(74, 20, "fuji-day", 0)
    expect(text(day, 1)).toContain(".-'")
    expect(text(day, 2)).not.toContain("+")
    // Petals and the train move with elapsed time and loop with the cycle.
    expect(fujiRows(74, 20, "fuji-night", 1200)).not.toEqual(night)
    expect(fujiRows(74, 20, "fuji-night", 2400)).toEqual(night)
    expect(fujiRows(74, 20, "fuji-day", 2400)).toEqual(day)
    // Petal paths derive from elapsed time alone and never enter rows 0-2.
    for (const ms of [0, 500, 1200, 2399, 2400, 3600]) {
      const petals = fujiPetals(ms)
      expect(petals).toHaveLength(12)
      for (const petal of petals) {
        expect(petal.x).toBeGreaterThanOrEqual(0)
        expect(petal.x).toBeLessThan(74)
        expect(petal.y).toBeGreaterThanOrEqual(3)
        expect(petal.y).toBeLessThan(16)
      }
    }
    expect(fujiPetals(2400)).toEqual(fujiPetals(0))
    expect(fujiPetals(-100)).toEqual(fujiPetals(0))
    expect(fujiPetals(1200)).not.toEqual(fujiPetals(0))
  })
})

test("daytime renders the sunset composition with petals at their cycle start", () => {
  const rows = fujiRows(74, 20, "fuji-day", 0)
  const text = rows.map((row) =>
    row
      .map((run) => run.text)
      .join("")
      .trimEnd(),
  )
  expect(text).toEqual([
    "                                   .---.",
    "                                .-'     '-.",
    "",
    '                          .        /"""\\',
    '     *                           /"""*"""\\',
    '                  .            /""*""""""""\\',
    '                             /"""""     """""\\                           .',
    "                           /                   \\       *",
    "                       /             .             \\",
    "______________/                                  .           \\____________",
    "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    "~~~~~~~~~~~~~.~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    "   (        )                                                (     .  )",
    "       ||                                                        ||",
    "____________________________________________________________._____________",
    "===========================================.==============================",
    "",
    "",
    "",
    "",
  ])
  expect(rows[0]!.some((run) => run.text.includes(".---.") && run.color === "#f5d78e")).toBe(true)
  expect(rows[12]!.some((run) => run.text.includes("(") && run.color === "#b05572")).toBe(true)
  expect(rows[10]!.some((run) => run.background === "#7a4658")).toBe(true)
  // At this point the complete left-facing shinkansen fits on screen.
  const train = fujiRows(74, 20, "fuji-day", 1200).slice(16)
  expect(train[1]!.map((run) => run.text).join("")).toContain(
    "___/ JR   []    []    []    []    []    []    []    []  |",
  )
  expect(train[1]!.some((run) => run.text === "JR" && run.color === "#ffd166")).toBe(true)
  expect(train[3]!.map((run) => run.text).join("")).toContain("(O)")
})
