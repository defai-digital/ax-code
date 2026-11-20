import { describe, expect, test } from "vitest"
import { layoutGauge } from "../chart/src/gauge"
import { layoutChart } from "../chart/src/chart"
import { transformSolidSource } from "../solid/source/scripts/solid-transform.js"
import { jsx } from "../solid/source/jsx-runtime"

describe("gauge unicode label over the full-block eighth", () => {
  test("a label on the rounding-to-full column is styled inside the fill", () => {
    const cells = layoutGauge({ ratio: 0.495, unicode: true, color: "cyan" }, 10, 2)
    // filled = 4.95: the fractional edge rounds to a full block at column 4,
    // so the "0" of "50%" on the label row keeps the fill background.
    const labelCell = cells.find((c) => c.char === "0" && c.y === 1)!
    expect(labelCell).toBeDefined()
    expect(labelCell.x).toBe(4)
    expect(labelCell.bg).toBe("cyan")
  })
})

describe("chart auto bounds at the representable extremes", () => {
  test("a constant dataset at Number.MAX_VALUE still renders", () => {
    const cells = layoutChart({ datasets: [{ data: [[Number.MAX_VALUE, 0]], marker: "dot" }] }, 5, 5)
    expect(cells.length).toBeGreaterThan(0)
  })

  test("a constant dataset at -Number.MAX_VALUE still renders", () => {
    const cells = layoutChart({ datasets: [{ data: [[-Number.MAX_VALUE, 0]], marker: "dot" }] }, 5, 5)
    expect(cells.length).toBeGreaterThan(0)
  })
})

describe("solid transform extension handling", () => {
  test(".mtsx sources parse TypeScript syntax", async () => {
    const out = await transformSolidSource("const x: number = 1; export const A = () => <box>{x}</box>", {
      filename: "test.mtsx",
    })
    expect(out).toContain("x")
  })

  test(".ctsx sources parse TypeScript syntax", async () => {
    const out = await transformSolidSource("const x: number = 1; export const A = () => <box>{x}</box>", {
      filename: "test.ctsx",
    })
    expect(out).toContain("x")
  })

  test(".ts sources keep plain TypeScript handling", async () => {
    const out = await transformSolidSource("const x: number = 1; export const v = x", { filename: "test.ts" })
    expect(out).toContain("x")
  })
})

describe("jsx-runtime normalizeProps", () => {
  test("stripping key preserves reactive getters without eager evaluation", () => {
    let received: Record<string, unknown> | undefined
    const Comp = (props: Record<string, unknown>) => {
      received = props
      return undefined
    }
    const getterCalls: string[] = []
    jsx(Comp as never, {
      key: "k1",
      get label() {
        getterCalls.push("label")
        return "L"
      },
    })
    // The getter must not run until the component actually reads the prop.
    expect(getterCalls).toEqual([])
    expect(received).toBeDefined()
    const descriptor = Object.getOwnPropertyDescriptor(received!, "label")
    expect(typeof descriptor?.get).toBe("function")
    expect(received!.label).toBe("L")
    expect(getterCalls).toEqual(["label"])
  })
})
