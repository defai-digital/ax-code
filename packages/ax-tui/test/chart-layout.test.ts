import { describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import { BAR_LEVELS, BLOCK_EIGHTHS, BRAILLE_BASE, symbolForHeight } from "../chart/src/symbols"
import { cellsToFrame, compositeCells, mergeCell, paintText, type Cell } from "../chart/src/cells"
import { BrailleGrid, CharGrid, createGrid } from "../chart/src/grid"
import { clipLine, forEachLinePoint, getPoint, type Bounds } from "../chart/src/painter"
import { layoutSparkline } from "../chart/src/sparkline"
import { layoutGauge } from "../chart/src/gauge"
import { layoutBarChart } from "../chart/src/barchart"
import { layoutChart } from "../chart/src/chart"

const frame = (cells: Cell[], width: number, height: number) => cellsToFrame(cells, width, height)

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

describe("chart symbols", () => {
  test("bar set has eight bottom-aligned levels plus empty", () => {
    expect(BAR_LEVELS).toEqual(["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"])
    expect(symbolForHeight(0)).toBe(" ")
    expect(symbolForHeight(-3)).toBe(" ")
    expect(symbolForHeight(NaN)).toBe(" ")
    expect(symbolForHeight(1)).toBe("▁")
    expect(symbolForHeight(4)).toBe("▄")
    expect(symbolForHeight(8)).toBe("█")
    expect(symbolForHeight(16)).toBe("█")
  })

  test("fractional ticks below one level map to empty instead of undefined", () => {
    expect(symbolForHeight(0.5)).toBe(" ")
    expect(symbolForHeight(7.9)).toBe("▇")
  })

  test("block eighths are left-aligned vertical partials", () => {
    expect(BLOCK_EIGHTHS).toEqual(["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"])
  })

  test("braille base is U+2800", () => {
    expect(BRAILLE_BASE).toBe(0x2800)
  })
})

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

describe("cells", () => {
  test("mergeCell replaces char always, fg/bg only when defined", () => {
    const target: Cell = { x: 0, y: 0, char: "a", fg: "red", bg: "blue" }
    mergeCell(target, { x: 0, y: 0, char: "b" })
    expect(target).toMatchObject({ char: "b", fg: "red", bg: "blue" })
    mergeCell(target, { x: 0, y: 0, char: "c", fg: "green" })
    expect(target).toMatchObject({ char: "c", fg: "green", bg: "blue" })
  })

  test("compositeCells merges layers in order", () => {
    const layerA: Cell[] = [{ x: 0, y: 0, char: "█", fg: "red", bg: "red" }]
    const layerB: Cell[] = [{ x: 0, y: 0, char: "⠿", fg: "cyan" }]
    const merged = compositeCells([layerA, layerB])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ char: "⠿", fg: "cyan", bg: "red" })
  })

  test("paintText truncates at maxWidth", () => {
    const out: Cell[] = []
    paintText(out, "hello", 2, 1, "white", undefined, 3)
    expect(out.map((cell) => cell.char).join("")).toBe("hel")
    expect(out[0]).toMatchObject({ x: 2, y: 1 })
  })

  test("cellsToFrame ignores out-of-area cells", () => {
    const rows = frame([{ x: 5, y: 5, char: "X" }, { x: 1, y: 0, char: "Y" }], 2, 1)
    expect(rows).toEqual([" Y"])
  })

  test("cellsToFrame ignores non-integer coordinates", () => {
    const rows = frame(
      [
        { x: "__proto__" as unknown as number, y: 0, char: "X" },
        { x: 0.5, y: 0, char: "X" },
        { x: 1, y: 0, char: "Y" },
      ],
      2,
      1,
    )
    expect(rows).toEqual([" Y"])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------

describe("BrailleGrid", () => {
  test("single dots map to the Unicode braille dot numbering", () => {
    const corners: Array<[number, number, string]> = [
      [0, 0, "⠁"], // dot 1 (bit 0)
      [1, 0, "⠈"], // dot 4 (bit 3)
      [0, 3, "⡀"], // dot 7 (bit 6)
      [1, 3, "⢀"], // dot 8 (bit 7)
    ]
    for (const [px, py, expected] of corners) {
      const grid = new BrailleGrid(1, 1)
      grid.paint(px, py, "white")
      const cells = grid.save()
      expect(cells).toHaveLength(1)
      expect(cells[0]!.char).toBe(expected)
      expect(cells[0]!.char.codePointAt(0)).toBe(
        BRAILLE_BASE + (1 << (py % 4 === 3 ? 6 + (px % 2) : (px % 2) * 3 + (py % 4))),
      )
    }
  })

  test("all eight dots produce U+28FF", () => {
    const grid = new BrailleGrid(1, 1)
    for (let px = 0; px < 2; px++) for (let py = 0; py < 4; py++) grid.paint(px, py, "white")
    expect(grid.save()[0]!.char).toBe("⣿")
  })

  test("dots accumulate across pixels in the same cell", () => {
    const grid = new BrailleGrid(2, 2)
    grid.paint(0, 0, "white") // cell (0,0) dot 1 (bit 0)
    grid.paint(3, 5, "white") // cell (1,1): dot 5 (bit 4)
    const cells = grid.save()
    expect(cells).toHaveLength(2)
    expect(cells.find((cell) => cell.x === 1 && cell.y === 1)!.char).toBe(String.fromCodePoint(0x2810))
  })

  test("colliding colors resolve last-write-wins per cell", () => {
    const grid = new BrailleGrid(1, 1)
    grid.paint(0, 0, "red")
    grid.paint(1, 1, "blue")
    expect(grid.save()[0]!.fg).toBe("blue")
  })

  test("out-of-range and non-integer paints are ignored", () => {
    const grid = new BrailleGrid(1, 1)
    grid.paint(2, 0, "white")
    grid.paint(0, 4, "white")
    grid.paint(-1, 0, "white")
    grid.paint(0.5, 0, "white")
    expect(grid.save()).toHaveLength(0)
  })

  test("empty cells are omitted from save()", () => {
    const grid = new BrailleGrid(2, 1)
    grid.paint(0, 0, "white")
    const cells = grid.save()
    expect(cells).toHaveLength(1)
    expect(cells[0]!.x).toBe(0)
  })
})

describe("CharGrid", () => {
  test("dot marker paints fg only, block marker paints fg and bg", () => {
    const dot = createGrid("dot", 2, 2)
    dot.paint(1, 1, "red")
    expect(dot.save()).toEqual([{ x: 1, y: 1, char: "•", fg: "red", bg: undefined }])

    const block = createGrid("block", 2, 2)
    block.paint(0, 0, "blue")
    expect(block.save()).toEqual([{ x: 0, y: 0, char: "█", fg: "blue", bg: "blue" }])
  })

  test("resolution is 1x1 per cell and braille is 2x4", () => {
    expect(new CharGrid(3, 4).resolution).toEqual({ x: 3, y: 4 })
    expect(new BrailleGrid(3, 4).resolution).toEqual({ x: 6, y: 16 })
  })
})

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

const UNIT: Bounds = { x: [0, 10], y: [0, 10] }

describe("getPoint", () => {
  test("maps world corners and center to pixel space with y flipped", () => {
    const res = { x: 11, y: 11 }
    expect(getPoint(0, 0, UNIT, res)).toEqual({ px: 0, py: 10 })
    expect(getPoint(10, 10, UNIT, res)).toEqual({ px: 10, py: 0 })
    expect(getPoint(5, 5, UNIT, res)).toEqual({ px: 5, py: 5 })
  })

  test("returns null outside bounds, for non-finite input, and degenerate bounds", () => {
    const res = { x: 11, y: 11 }
    expect(getPoint(11, 0, UNIT, res)).toBeNull()
    expect(getPoint(-1, 0, UNIT, res)).toBeNull()
    expect(getPoint(0, NaN, UNIT, res)).toBeNull()
    expect(getPoint(Infinity, 0, UNIT, res)).toBeNull()
    expect(getPoint(5, 5, { x: [10, 0], y: [0, 10] }, res)).toBeNull() // reversed
    expect(getPoint(5, 5, { x: [5, 5], y: [0, 10] }, res)).toBeNull() // degenerate
  })

  test("maps large finite coordinates without overflowing intermediate arithmetic", () => {
    const bounds: Bounds = { x: [-1e308, 1e308], y: [-1e308, 1e308] }
    const res = { x: 5, y: 5 }
    expect(getPoint(-1e308, -1e308, bounds, res)).toEqual({ px: 0, py: 4 })
    expect(getPoint(0, 0, bounds, res)).toEqual({ px: 2, py: 2 })
    expect(getPoint(1e308, 1e308, bounds, res)).toEqual({ px: 4, py: 0 })
    expect(getPoint(1e308, 1e308, { x: [0, 1e308], y: [0, 1e308] }, res)).toEqual({ px: 4, py: 0 })
  })

  test("rejects invalid bounds and grid resolutions", () => {
    expect(getPoint(0, 0, { x: [-Infinity, Infinity], y: [0, 1] }, { x: 5, y: 5 })).toBeNull()
    for (const invalid of [0, -1, NaN, Infinity, 1.5]) {
      expect(getPoint(0, 0, UNIT, { x: invalid, y: 5 })).toBeNull()
      expect(getPoint(0, 0, UNIT, { x: 5, y: invalid })).toBeNull()
    }
  })
})

describe("clipLine", () => {
  test("keeps fully inside segments unchanged", () => {
    expect(clipLine(1, 1, 2, 2, UNIT)).toEqual([1, 1, 2, 2])
  })

  test("rejects fully outside segments", () => {
    expect(clipLine(-5, -5, -1, -1, UNIT)).toBeNull()
    expect(clipLine(20, 5, 30, 5, UNIT)).toBeNull()
  })

  test("clips crossing segments to the bounds", () => {
    expect(clipLine(-5, 5, 15, 5, UNIT)).toEqual([0, 5, 10, 5])
  })

  test("rejects non-finite coordinates", () => {
    expect(clipLine(NaN, 0, 5, 5, UNIT)).toBeNull()
  })

  test("clips large finite segments without overflowing the intersection", () => {
    expect(clipLine(-1e308, 5, 1e308, 5, UNIT)).toEqual([0, 5, 10, 5])
    expect(clipLine(5, -1e308, 5, 1e308, UNIT)).toEqual([5, 0, 5, 10])
    expect(clipLine(-1e308, -1e308, 1e308, 1e308, UNIT)).toEqual([0, 0, 10, 10])
  })
})

describe("forEachLinePoint", () => {
  const collect = (x0: number, y0: number, x1: number, y1: number) => {
    const points: Array<[number, number]> = []
    forEachLinePoint(x0, y0, x1, y1, (x, y) => points.push([x, y]))
    return points
  }

  test("rasterizes axis-aligned and diagonal runs", () => {
    expect(collect(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]])
    expect(collect(0, 0, 0, 3)).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]])
    expect(collect(0, 0, 3, 3)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]])
  })

  test("steep lines emit max(dx, dy) + 1 points", () => {
    expect(collect(0, 0, 2, 4)).toHaveLength(5)
  })

  test.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "ignores invalid pixel endpoints (%s) without entering the raster loop",
    (invalid) => {
      const paint = () => { throw new Error("Invalid pixels must not be painted") }
      forEachLinePoint(0, 0, invalid, 1, paint)
      forEachLinePoint(invalid, 0, 1, 1, paint)
      forEachLinePoint(0, invalid, 1, 1, paint)
      forEachLinePoint(0, 0, 1, invalid, paint)
    },
  )
})

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

describe("layoutSparkline", () => {
  test("scales values to eighth blocks against max", () => {
    expect(frame(layoutSparkline({ data: [0, 4, 8] }, 3, 1), 3, 1)).toEqual([" ▄█"])
  })

  test("stacks multi-row bars bottom-up with 8 ticks per cell", () => {
    expect(frame(layoutSparkline({ data: [8], max: 8 }, 1, 2), 1, 2)).toEqual(["█", "█"])
    expect(frame(layoutSparkline({ data: [4], max: 8 }, 1, 2), 1, 2)).toEqual([" ", "█"])
  })

  test("rtl draws the first value at the right edge", () => {
    expect(frame(layoutSparkline({ data: [1, 2], max: 2, direction: "rtl" }, 2, 1), 2, 1)).toEqual(["█▄"])
  })

  test("max <= 0 renders empty bars without dividing by zero", () => {
    expect(frame(layoutSparkline({ data: [5], max: 0 }, 1, 1), 1, 1)).toEqual([" "])
  })

  test("non-finite and missing entries render as gaps", () => {
    expect(frame(layoutSparkline({ data: [NaN, 4, null], max: 8 }, 3, 1), 3, 1)).toEqual([" ▄ "])
  })

  test("negative values clamp to an empty bar", () => {
    expect(frame(layoutSparkline({ data: [-5], max: 5 }, 1, 1), 1, 1)).toEqual([" "])
  })

  test("data longer than width is truncated", () => {
    expect(frame(layoutSparkline({ data: [1, 2, 3, 4, 5], max: 5 }, 3, 1), 3, 1)).toEqual(["▁▃▄"])
  })

  test("zero size renders nothing", () => {
    expect(layoutSparkline({ data: [1] }, 0, 1)).toEqual([])
    expect(layoutSparkline({ data: [1] }, 1, 0)).toEqual([])
  })

  test("auto max uses the largest finite value", () => {
    expect(frame(layoutSparkline({ data: [1, 2] }, 2, 1), 2, 1)).toEqual(["▄█"])
  })
})

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

describe("layoutGauge", () => {
  test("renders fill and centered default label", () => {
    expect(frame(layoutGauge({ ratio: 0.5 }, 10, 1), 10, 1)).toEqual(["███50%    "])
    expect(frame(layoutGauge({ ratio: 0 }, 10, 1), 10, 1)).toEqual(["    0%    "])
    expect(frame(layoutGauge({ ratio: 1 }, 10, 1), 10, 1)).toEqual(["███100%███"])
  })

  test("clamps out-of-range ratios and treats NaN as 0 (no throw)", () => {
    expect(frame(layoutGauge({ ratio: 1.7 }, 10, 1), 10, 1)).toEqual(["███100%███"])
    expect(frame(layoutGauge({ ratio: -0.5 }, 10, 1), 10, 1)).toEqual(["    0%    "])
    expect(frame(layoutGauge({ ratio: NaN }, 10, 1), 10, 1)).toEqual(["    0%    "])
  })

  test("label null suppresses the label", () => {
    expect(frame(layoutGauge({ ratio: 0.5, label: null }, 10, 1), 10, 1)).toEqual(["█████     "])
  })

  test("unicode edge paints a vertical eighth partial", () => {
    expect(frame(layoutGauge({ ratio: 0.55, label: null, unicode: true }, 10, 1), 10, 1)).toEqual(["█████▌    "])
  })

  test("1x1 gauge truncates the label to one column", () => {
    expect(frame(layoutGauge({ ratio: 0.5 }, 1, 1), 1, 1)).toEqual(["5"])
  })

  test("label keeps the fill color as its background inside the fill (ratatui blank+swap)", () => {
    const cells = layoutGauge({ ratio: 0.5, color: "cyan" }, 10, 1)
    // "50%" spans columns 3..5; the fill ends at column 5 (end = round(5)).
    const inside = cells.find((cell) => cell.char === "5")!
    expect(inside.x).toBe(3)
    expect(inside.bg).toBe("cyan")
    expect(inside.fg).toBeUndefined()
    const outside = cells.find((cell) => cell.char === "%")!
    expect(outside.x).toBe(5)
    expect(outside.bg).toBeUndefined()
    expect(outside.fg).toBe("cyan")
  })

  test("zero size renders nothing", () => {
    expect(layoutGauge({ ratio: 0.5 }, 0, 1)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// BarChart
// ---------------------------------------------------------------------------

describe("layoutBarChart", () => {
  test("scales bars against max with gaps", () => {
    // Both values exactly cover barWidth 1 over full block rows (ticks >= 8),
    // so the values overlay the bar bottom row (ratatui rule).
    expect(frame(layoutBarChart({ data: [2, 4], max: 4 }, 3, 2), 3, 2)).toEqual(["  █", "2 4"])
  })

  test("draws labels below bars", () => {
    const cells = layoutBarChart({ data: [{ value: 2, label: "a" }, { value: 4, label: "b" }], max: 4 }, 3, 3)
    expect(frame(cells, 3, 3)).toEqual(["  █", "2 4", "a b"])
  })

  test("overlays the value on the bar bottom row when it fits", () => {
    const cells = layoutBarChart({ data: [{ value: 1 }], max: 8, barWidth: 3 }, 3, 1)
    expect(frame(cells, 3, 1)).toEqual(["▁1▁"])
  })

  test("shows the value on a full-height bar even when it exactly covers the bar width", () => {
    // ratatui rule: len == barWidth && ticks >= 8 -> shown (a full block row
    // may be replaced by the value).
    const cells = layoutBarChart({ data: [{ value: 8 }], max: 8, barWidth: 1 }, 1, 1)
    expect(frame(cells, 1, 1)).toEqual(["8"])
  })

  test("suppresses the value when it would fully cover a partial bar", () => {
    // ratatui rule: len == barWidth && ticks < 8 -> hidden, so the partial bar
    // glyph is not erased by the value.
    const cells = layoutBarChart({ data: [{ value: 4 }], max: 8, barWidth: 1 }, 1, 1)
    expect(frame(cells, 1, 1)).toEqual(["▄"])
  })

  test("drops bars that do not fit the width", () => {
    const cells = layoutBarChart({ data: [1, 1, 1], barWidth: 2, barGap: 1, showValues: false }, 4, 1)
    // Bar 1 occupies x0..x1; bar 2 would start at x3 and needs 2 cells -> dropped.
    expect(frame(cells, 4, 1)).toEqual(["██  "])
  })

  test("zero values, NaN, and negatives render empty bars without labels", () => {
    const cells = layoutBarChart({ data: [NaN, -3, 0] }, 5, 1)
    expect(frame(cells, 5, 1)).toEqual(["     "])
  })

  test("empty data, zero size, and zero barWidth render nothing", () => {
    expect(layoutBarChart({ data: [] }, 5, 5)).toEqual([])
    expect(layoutBarChart({ data: [1] }, 0, 5)).toEqual([])
    expect(layoutBarChart({ data: [1], barWidth: 0 }, 5, 5)).toEqual([])
  })

  test("textValue replaces the numeric value label", () => {
    const cells = layoutBarChart({ data: [{ value: 1, textValue: "x" }], max: 8, barWidth: 3 }, 3, 1)
    expect(frame(cells, 3, 1)).toEqual(["▁x▁"])
  })
})

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

describe("layoutChart", () => {
  test("large finite line data renders without blocking the event loop", () => {
    // Run separately so a regression in a synchronous raster loop times out
    // without hanging the entire test runner.
    const source = new URL("../chart/src/chart.ts", import.meta.url).href
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", `
      import { layoutChart } from ${JSON.stringify(source)}
      const cells = layoutChart({ datasets: [{
        data: [[-1e308, -1e308], [1e308, 1e308]], graphType: "line", marker: "dot"
      }] }, 5, 5)
      console.log(JSON.stringify(cells.map(({ x, y }) => [x, y])))
    `], { encoding: "utf8", timeout: 3000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([[4, 0], [3, 1], [2, 2], [1, 3], [0, 4]])
  })

  test("zero size renders nothing", () => {
    expect(layoutChart({ datasets: [{ data: [[0, 0]] }] }, 0, 5)).toEqual([])
    expect(layoutChart({ datasets: [{ data: [[0, 0]] }] }, 5, 0)).toEqual([])
  })

  test("throws TypeError when an axis is provided without finite bounds", () => {
    expect(() => layoutChart({ xAxis: { bounds: [0, NaN] } }, 10, 5)).toThrow(TypeError)
    expect(() => layoutChart({ xAxis: {} }, 10, 5)).toThrow(/finite/)
    expect(() => layoutChart({ yAxis: { bounds: [0, Infinity] } }, 10, 5)).toThrow(/finite/)
  })

  test("without labels no axis lines are drawn (ratatui rule)", () => {
    const cells = layoutChart({ datasets: [{ data: [[0, 0], [1, 1]], marker: "dot" }] }, 6, 3)
    const rows = frame(cells, 6, 3)
    expect(rows.join("")).not.toContain("─")
    expect(rows.join("")).not.toContain("│")
    expect(rows).toEqual(["     •", "      ", "•     "])
  })

  test("braille line dataset rasterizes the exact diagonal", () => {
    const cells = layoutChart({ datasets: [{ data: [[0, 0], [5, 10]], graphType: "line" }] }, 6, 3)
    expect(frame(cells, 6, 3)).toEqual(["    ⡠⠊", "  ⡠⠊  ", "⡠⠊    "])
  })

  test("axes with labels render lines, corner, and ratatui label placement", () => {
    const cells = layoutChart(
      {
        datasets: [],
        xAxis: { bounds: [0, 10], labels: ["0", "5", "10"] },
        yAxis: { bounds: [0, 10], labels: ["0", "5", "10"] },
      },
      20,
      8,
    )
    expect(frame(cells, 20, 8)).toEqual([
      "10│                 ",
      "  │                 ",
      "  │                 ",
      "5 │                 ",
      "  │                 ",
      "0 │                 ",
      "  └─────────────────",
      "  0       5       10",
    ])
  })

  test("axis colors apply to lines as well as their labels and titles", () => {
    const cells = layoutChart({
      color: "green",
      xAxis: { bounds: [0, 1], labels: ["0", "1"], title: "x", color: "red" },
      yAxis: { bounds: [0, 1], labels: ["0", "1"], title: "y", color: "blue" },
    }, 10, 6)
    expect(cells.filter((cell) => cell.char === "─").every((cell) => cell.fg === "red")).toBe(true)
    expect(cells.filter((cell) => cell.char === "│").every((cell) => cell.fg === "blue")).toBe(true)
    expect(cells.find((cell) => cell.char === "└")?.fg).toBe("green")
  })

  test("a single y label draws the axis line but no label text (ratatui parity)", () => {
    const cells = layoutChart(
      { xAxis: { bounds: [0, 1] }, yAxis: { bounds: [0, 1], labels: ["0"] } },
      10,
      5,
    )
    const rows = frame(cells, 10, 5)
    // ratatui draws the vertical axis line whenever labels exist, but
    // render_y_labels requires >= 2 labels.
    expect(rows[0]!.startsWith(" │")).toBe(true)
    expect(rows.join("")).not.toContain("0")
  })

  test("first x label is omitted without a y-axis slot under left alignment (ratatui rule)", () => {
    const cells = layoutChart({ xAxis: { bounds: [0, 10], labels: ["0", "10"] } }, 20, 5)
    const rows = frame(cells, 20, 5)
    // Left alignment maps to a [0, graphLeft) first-label area, which is empty
    // when no y labels reserved a slot; only the last label renders.
    expect(rows[4]).toBe("                  10")
  })

  test("middle x labels are truncated inside their tick area (ratatui rule)", () => {
    const cells = layoutChart({ xAxis: { bounds: [0, 10], labels: ["0", "middle", "10"] } }, 20, 5)
    const rows = frame(cells, 20, 5)
    // tickWidth = 6, so the middle label gets area (7, 5): "middle" -> "middl".
    expect(rows[4]).toBe("       middl      10")
  })

  test("reversed bounds draw axes but no data", () => {
    const cells = layoutChart(
      {
        datasets: [{ data: [[5, 5]], marker: "dot" }],
        xAxis: { bounds: [10, 0] },
        yAxis: { bounds: [0, 10] },
      },
      5,
      5,
    )
    expect(frame(cells, 5, 5).join("")).not.toContain("•")
  })

  test("out-of-bounds points are dropped silently", () => {
    const cells = layoutChart(
      {
        datasets: [{ data: [[20, 5], [5, 5]], marker: "dot" }],
        xAxis: { bounds: [0, 10] },
        yAxis: { bounds: [0, 10] },
      },
      5,
      5,
    )
    const dots = cells.filter((cell) => cell.char === "•")
    expect(dots).toHaveLength(1)
  })

  test("non-finite dataset points are filtered without throwing", () => {
    const cells = layoutChart(
      {
        datasets: [{ data: [[NaN, 1], [1, 1], [Infinity, 2]], marker: "dot" }],
        xAxis: { bounds: [0, 2] },
        yAxis: { bounds: [0, 2] },
      },
      5,
      5,
    )
    expect(cells.filter((cell) => cell.char === "•")).toHaveLength(1)
  })

  test("empty datasets render nothing but never throw", () => {
    expect(layoutChart({ datasets: [] }, 5, 5)).toEqual([])
    expect(layoutChart({ datasets: [{ data: [] }] }, 5, 5)).toEqual([])
  })

  test("bar graph type uses the value 0 baseline, not the y lower bound", () => {
    const cells = layoutChart(
      {
        datasets: [{ data: [[5, 5]], graphType: "bar", marker: "dot" }],
        xAxis: { bounds: [0, 10] },
        yAxis: { bounds: [-10, 10] },
      },
      5,
      5,
    )
    const dots = cells.filter((cell) => cell.char === "•")
    // baseline y=0 maps to the middle row; the bar covers it and the point row.
    expect(dots.map((cell) => cell.y).sort()).toEqual([1, 2])
    expect(dots.every((cell) => cell.x === 2)).toBe(true)
  })

  test("block marker cells carry fg and bg; dot marker cells carry fg only", () => {
    const blockCells = layoutChart(
      { datasets: [{ data: [[0, 0]], marker: "block", color: "red" }] },
      3,
      3,
    )
    const block = blockCells.find((cell) => cell.char === "█")!
    expect(block.fg).toBe("red")
    expect(block.bg).toBe("red")

    const dotCells = layoutChart({ datasets: [{ data: [[0, 0]], marker: "dot", color: "red" }] }, 3, 3)
    const dot = dotCells.find((cell) => cell.char === "•")!
    expect(dot.fg).toBe("red")
    expect(dot.bg).toBeUndefined()
  })

  test("colliding datasets in one cell resolve last-write-wins", () => {
    const cells = layoutChart(
      {
        datasets: [
          { data: [[0, 0]], marker: "dot", color: "red" },
          { data: [[0, 0]], marker: "dot", color: "blue" },
        ],
        xAxis: { bounds: [0, 1] },
        yAxis: { bounds: [0, 1] },
      },
      3,
      3,
    )
    const dots = cells.filter((cell) => cell.char === "•")
    expect(dots).toHaveLength(1)
    expect(dots[0]!.fg).toBe("blue")
  })

  test("each dataset is its own layer: a later braille dataset replaces the cell", () => {
    // ratatui v0.30 finishes the grid per dataset instead of sharing one grid
    // across adjacent same-marker datasets. (0,0) lights dot 7 (bit 6) and
    // (1,0) lights dot 8 (bit 7) of the same braille cell; a shared grid
    // would show the union "⣀", per-dataset layers show only "⢀".
    const cells = layoutChart(
      {
        datasets: [
          { data: [[0, 0]], color: "red" },
          { data: [[1, 0]], color: "blue" },
        ],
        xAxis: { bounds: [0, 1] },
        yAxis: { bounds: [0, 1] },
      },
      1,
      1,
    )
    expect(cells).toHaveLength(1)
    expect(cells[0]!.char).toBe("⢀")
    expect(cells[0]!.fg).toBe("blue")
  })

  test("legend renders top-right with a border and dataset colors", () => {
    const cells = layoutChart(
      { datasets: [{ name: "s", data: [[0, 0]], marker: "dot", color: "cyan" }] },
      40,
      20,
    )
    const rows = frame(cells, 40, 20)
    expect(rows[0]!.slice(37)).toBe("┌─┐")
    expect(rows[1]!.slice(37)).toBe("│s│")
    expect(rows[2]!.slice(37)).toBe("└─┘")
    const name = cells.find((cell) => cell.char === "s")!
    expect(name.fg).toBe("cyan")
  })

  test("legend auto-hides when it exceeds the hidden-legend constraints", () => {
    const cells = layoutChart(
      { datasets: [{ name: "x".repeat(30), data: [[0, 0]] }] },
      40,
      20,
    )
    expect(frame(cells, 40, 20).join("")).not.toContain("┌")
  })

  test("legend hides without named datasets and with position none", () => {
    const unnamed = layoutChart({ datasets: [{ data: [[0, 0]] }] }, 40, 20)
    expect(frame(unnamed, 40, 20).join("")).not.toContain("┌")
    const hidden = layoutChart(
      { datasets: [{ name: "s", data: [[0, 0]] }], legendPosition: "none" },
      40,
      20,
    )
    expect(frame(hidden, 40, 20).join("")).not.toContain("┌")
  })

  test("legend resets the style of data cells underneath", () => {
    const cells = layoutChart(
      {
        datasets: [
          { name: "a", data: [[34, 18]], marker: "dot", color: "red" },
          { name: "longname", data: [], color: "blue" },
        ],
        xAxis: { bounds: [0, 39] },
        yAxis: { bounds: [0, 19] },
      },
      40,
      20,
    )
    const rows = frame(cells, 40, 20)
    // Two names -> legend 10x4 at (30, 0); the glyph under the legend stays.
    expect(rows[1]!.slice(30)).toBe("│a  •    │")
    expect(rows[2]!.slice(30)).toBe("│longname│")
    // The data point at (34, 1) keeps its glyph but loses its dataset color
    // (ratatui set_style(legend_area, original_style)).
    const under = cells.find((cell) => cell.x === 34 && cell.y === 1)!
    expect(under.char).toBe("•")
    expect(under.fg).toBeUndefined()
    expect(under.bg).toBeUndefined()
  })

  test("top-right legend yields one row to a colliding y-axis title (ratatui golden)", () => {
    const cells = layoutChart(
      {
        datasets: [{ name: "Ds1", data: [] }],
        yAxis: { bounds: [0, 1], title: "The title overlap a legend." },
      },
      30,
      20,
    )
    const rows = frame(cells, 30, 20)
    expect(rows[0]).toBe("The title overlap a legend.   ")
    expect(rows[1]).toBe("                         ┌───┐")
    expect(rows[2]).toBe("                         │Ds1│")
    expect(rows[3]).toBe("                         └───┘")
  })

  test("1x1 chart renders data only without throwing", () => {
    const cells = layoutChart({ datasets: [{ data: [[0, 0]], marker: "dot" }] }, 1, 1)
    expect(frame(cells, 1, 1)).toEqual(["•"])
  })

  test("line datasets connect consecutive finite points across a gap", () => {
    const cells = layoutChart(
      {
        datasets: [{ data: [[0, 0], [NaN, NaN], [10, 10]], graphType: "line", marker: "dot" }],
        xAxis: { bounds: [0, 10] },
        yAxis: { bounds: [0, 10] },
      },
      5,
      5,
    )
    // The finite points are connected directly: a 5-cell diagonal.
    expect(cells.filter((cell) => cell.char === "•")).toHaveLength(5)
  })

  test("axis titles render when the graph is tall enough", () => {
    const cells = layoutChart(
      {
        xAxis: { bounds: [0, 10], labels: ["0", "10"], title: "t" },
        yAxis: { bounds: [0, 10], labels: ["0", "10"], title: "y" },
      },
      20,
      8,
    )
    const rows = frame(cells, 20, 8)
    // y title sits at the graph-area top-left corner, after the y-label slot.
    expect(rows[0]!.slice(0, 4)).toBe("10│y")
    expect(rows[6]!.endsWith("t")).toBe(true)
  })

  test("titles are skipped when the graph area is 2 rows or shorter", () => {
    const cells = layoutChart(
      { xAxis: { bounds: [0, 10], title: "t" }, yAxis: { bounds: [0, 10], title: "y" } },
      20,
      2,
    )
    expect(frame(cells, 20, 2).join("")).not.toContain("t")
    expect(frame(cells, 20, 2).join("")).not.toContain("y")
  })
})
