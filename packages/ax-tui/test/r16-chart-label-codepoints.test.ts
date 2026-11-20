import { expect, test } from "vitest"
import { layoutGauge } from "../chart/src/gauge.js"
import { layoutBarChart } from "../chart/src/barchart.js"
import { layoutChart } from "../chart/src/chart.js"
import type { Cell } from "../chart/src/cells.js"

// paintText counts one column per codepoint, so label truncation and
// centering must use codepoints too. UTF-16 slice/index/length splits
// surrogate pairs and paints lone surrogates into the frame.
function hasLoneSurrogate(char: string): boolean {
  for (const cp of char) {
    const code = cp.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) return true
  }
  return false
}

function expectNoLoneSurrogates(cells: readonly Cell[]): void {
  for (const cell of cells) {
    expect(hasLoneSurrogate(cell.char), `lone surrogate at (${cell.x}, ${cell.y})`).toBe(false)
  }
}

function charAt(cells: readonly Cell[], x: number, y: number): string | undefined {
  // Layout lists are paint-ordered: later entries win.
  return cells.findLast((cell) => cell.x === x && cell.y === y)?.char
}

test("gauge labels keep surrogate pairs intact when centered", () => {
  const cells = layoutGauge({ ratio: 0.5, label: "👍" }, 10, 1)
  expectNoLoneSurrogates(cells)
  expect(cells.map((cell) => cell.char)).toContain("👍")
})

test("gauge labels truncate to whole codepoints in a one-column gauge", () => {
  const cells = layoutGauge({ ratio: 0.5, label: "👍" }, 1, 1)
  expectNoLoneSurrogates(cells)
  expect(charAt(cells, 0, 0)).toBe("👍")
})

test("bar chart labels truncate to whole codepoints", () => {
  const cells = layoutBarChart({ data: [{ value: 1, label: "👍" }], barWidth: 1, showValues: false }, 1, 2)
  expectNoLoneSurrogates(cells)
  expect(charAt(cells, 0, 1)).toBe("👍")
})

test("chart middle x labels truncate and center by codepoints", () => {
  const cells = layoutChart({ xAxis: { bounds: [0, 1], labels: ["a", "👍👍", "b"] } }, 12, 4)
  expectNoLoneSurrogates(cells)
  expect(charAt(cells, 5, 3)).toBe("👍")
  expect(charAt(cells, 6, 3)).toBe("👍")
})

test("chart y labels truncate to whole codepoints", () => {
  const cells = layoutChart({ yAxis: { bounds: [0, 1], labels: ["👍👍", "ok"] } }, 5, 4)
  expectNoLoneSurrogates(cells)
  expect(charAt(cells, 0, 3)).toBe("👍")
})
