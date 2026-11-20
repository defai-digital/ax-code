import { describe, expect, test } from "vitest"
import { clipLine } from "../chart/src/painter"
import { layoutGauge } from "../chart/src/gauge"
import { layoutChart } from "../chart/src/chart"

describe("chart clipping coordinate robustness", () => {
  test("a horizontal segment on the top boundary is not collapsed by 1-ULP interpolation", () => {
    const clipped = clipLine(-0.002, 10, 9.998, 10, { x: [0, 10], y: [0, 10] })
    expect(clipped).not.toBeNull()
    expect(Math.abs(clipped![0]!)).toBeLessThan(1e-9)
    expect(clipped![1]).toBe(10)
    expect(clipped![2]).toBeCloseTo(9.998, 12)
    expect(clipped![3]).toBe(10)
  })

  test("a horizontal segment crossing both side boundaries on the top row stays visible", () => {
    const clipped = clipLine(-0.0011, 10, 10.0011, 10, { x: [0, 10], y: [0, 10] })
    expect(clipped).not.toBeNull()
    expect(Math.abs(clipped![0]!)).toBeLessThan(1e-9)
    expect(clipped![1]).toBe(10)
    expect(clipped![2]).toBe(10)
    expect(clipped![3]).toBe(10)
  })
})

describe("chart auto bounds for large-magnitude constant data", () => {
  test("a single point at 1e16 still renders", () => {
    const cells = layoutChart({ datasets: [{ data: [[1e16, 0]], marker: "dot" }] }, 5, 5)
    expect(cells.length).toBeGreaterThan(0)
  })

  test("a horizontal line at y=1e16 still renders", () => {
    const cells = layoutChart(
      { datasets: [{ data: [[0, 1e16], [10, 1e16]], graphType: "line", marker: "dot" }] },
      5,
      5,
    )
    expect(cells.length).toBeGreaterThan(0)
  })
})

describe("chart legend width constraints", () => {
  test("a constraint ratio above 1 cannot push the legend outside the widget", () => {
    const cells = layoutChart(
      { datasets: [{ name: "very-long-series-name", data: [[0, 0]] }], hiddenLegendConstraints: [Infinity, 1] },
      10,
      5,
    )
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.x).toBeLessThan(10)
    }
  })
})

describe("gauge label colors over the fill", () => {
  test("the default label foreground over the fill stays unset for the renderable default", () => {
    const cells = layoutGauge({ ratio: 1 }, 10, 1)
    const labelCells = cells.filter((c) => c.char !== "█" && c.char !== " ")
    expect(labelCells.length).toBeGreaterThan(0)
    for (const cell of labelCells) {
      expect(cell.bg).toBe("white")
      // Unset at the layout level: GaugeRenderable paints unset foregrounds
      // with default-color intent (never the fill color itself).
      expect(cell.fg).toBeUndefined()
    }
  })

  test("an explicit background color becomes the default label foreground over the fill", () => {
    const cells = layoutGauge({ ratio: 1, backgroundColor: "blue" }, 10, 1)
    const labelCells = cells.filter((c) => c.char !== "█" && c.char !== " ")
    expect(labelCells.length).toBeGreaterThan(0)
    for (const cell of labelCells) {
      expect(cell.fg).toBe("blue")
    }
  })

  test("an explicit labelColor still wins over the fill", () => {
    const cells = layoutGauge({ ratio: 1, labelColor: "red" }, 10, 1)
    const labelCells = cells.filter((c) => c.char !== "█" && c.char !== " ")
    expect(labelCells.length).toBeGreaterThan(0)
    for (const cell of labelCells) {
      expect(cell.fg).toBe("red")
    }
  })
})
