import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { main, parseCompletionTable, renderSvg } from "./render-tiel-peer-chart"

const ROOT = path.resolve(import.meta.dirname, "..")

describe("render-tiel-peer-chart", () => {
  test("parses the three README completion cells", () => {
    const cells = parseCompletionTable(readFileSync(path.join(ROOT, "README.md"), "utf-8"))
    expect(cells).toHaveLength(3)
    expect(cells.map((c) => [c.axCompletion, c.mtplxCompletion])).toEqual([
      [194.88, 177.44],
      [219.43, 194.15],
      [90.46, 92.23],
    ])
    expect(cells[0]?.label).toContain("M5 Max 128 GiB")
    expect(cells[2]?.label).toContain("M4 Pro 64 GiB")
  })

  test("renders a deterministic SVG", () => {
    const cells = parseCompletionTable(readFileSync(path.join(ROOT, "README.md"), "utf-8"))
    expect(renderSvg(cells)).toBe(renderSvg(cells))
    expect(renderSvg(cells)).toContain("AX Engine vs MTPLX 2.11.3")
  })

  test("committed SVG is not stale relative to the README table", () => {
    expect(main(["--check"])).toBe(0)
  })
})
