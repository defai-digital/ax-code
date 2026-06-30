import { describe, expect, test } from "vitest"
import { computeFeatureTourLayout, FEATURE_TOUR_TOOLTIP_MARGIN } from "./featureTourLayout"

const rect = (input: { top: number; left: number; width: number; height: number }) => ({
  top: input.top,
  left: input.left,
  width: input.width,
  height: input.height,
  right: input.left + input.width,
  bottom: input.top + input.height,
})

describe("computeFeatureTourLayout", () => {
  test("keeps the tooltip visible when the tour target fills the viewport", () => {
    const layout = computeFeatureTourLayout({
      targetRect: rect({ top: 0, left: 240, width: 960, height: 700 }),
      viewport: { width: 1200, height: 700 },
      tooltipSize: { width: 288, height: 160 },
    })

    expect(layout.tooltip.top).toBeGreaterThanOrEqual(FEATURE_TOUR_TOOLTIP_MARGIN)
    expect(layout.tooltip.top + 160).toBeLessThanOrEqual(700 - FEATURE_TOUR_TOOLTIP_MARGIN)
    expect(layout.tooltip.left).toBeGreaterThanOrEqual(FEATURE_TOUR_TOOLTIP_MARGIN)
    expect(layout.tooltip.left + layout.tooltip.width).toBeLessThanOrEqual(1200 - FEATURE_TOUR_TOOLTIP_MARGIN)
  })

  test("clamps the tooltip horizontally on narrow screens", () => {
    const layout = computeFeatureTourLayout({
      targetRect: rect({ top: 20, left: 0, width: 48, height: 48 }),
      viewport: { width: 260, height: 480 },
      tooltipSize: { width: 288, height: 150 },
    })

    expect(layout.tooltip.left).toBeGreaterThanOrEqual(FEATURE_TOUR_TOOLTIP_MARGIN)
    expect(layout.tooltip.left + layout.tooltip.width).toBeLessThanOrEqual(260 - FEATURE_TOUR_TOOLTIP_MARGIN)
    expect(layout.tooltip.width).toBeLessThan(288)
  })
})
