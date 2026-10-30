import { expect, test } from "vitest"
import { createTextMeasureFunc } from "../src/lib/text-measure.js"
import { MeasureMode } from "../src/yoga.js"

function measureWith(view: { measureForDimensions: (width: number, height: number) => { lineCount: number; widthColsMax: number } | null }) {
  return createTextMeasureFunc(view, () => false)
}

test("AtMost width with undefined height keeps the full measured height", () => {
  const measure = measureWith({
    measureForDimensions: () => ({ lineCount: 5, widthColsMax: 20 }),
  })

  expect(measure(40, MeasureMode.AtMost, Number.NaN, MeasureMode.Undefined)).toEqual({ width: 20, height: 5 })
})

test("AtMost width still clamps to a real height bound", () => {
  const measure = measureWith({
    measureForDimensions: () => ({ lineCount: 5, widthColsMax: 20 }),
  })

  expect(measure(40, MeasureMode.AtMost, 3, MeasureMode.AtMost)).toEqual({ width: 20, height: 3 })
})

test("a fractional width below one column wraps at one column instead of no-wrap", () => {
  const widths: number[] = []
  const measure = measureWith({
    measureForDimensions: (width) => {
      widths.push(width)
      return { lineCount: 2, widthColsMax: 5 }
    },
  })

  measure(0.5, MeasureMode.AtMost, Number.NaN, MeasureMode.Undefined)
  measure(0, MeasureMode.Undefined, Number.NaN, MeasureMode.Undefined)

  expect(widths).toEqual([1, 0])
})
