export const FEATURE_TOUR_SPOTLIGHT_PADDING = 8
export const FEATURE_TOUR_TOOLTIP_GAP = 12
export const FEATURE_TOUR_TOOLTIP_MARGIN = 16
export const FEATURE_TOUR_TOOLTIP_WIDTH = 288
export const FEATURE_TOUR_TOOLTIP_FALLBACK_HEIGHT = 160

type RectLike = Pick<DOMRectReadOnly, "top" | "right" | "bottom" | "left" | "width" | "height">

type Size = {
  width: number
  height: number
}

export type FeatureTourLayout = {
  spotlight: {
    top: number
    left: number
    width: number
    height: number
  }
  tooltip: {
    top: number
    left: number
    width: number
    maxHeight: number
  }
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

export function computeFeatureTourLayout(input: {
  targetRect: RectLike
  viewport: Size
  tooltipSize?: Partial<Size>
}): FeatureTourLayout {
  const viewportWidth = Math.max(0, input.viewport.width)
  const viewportHeight = Math.max(0, input.viewport.height)
  const margin = Math.min(FEATURE_TOUR_TOOLTIP_MARGIN, viewportWidth / 2, viewportHeight / 2)

  const spotlightLeft = clamp(input.targetRect.left - FEATURE_TOUR_SPOTLIGHT_PADDING, 0, viewportWidth)
  const spotlightTop = clamp(input.targetRect.top - FEATURE_TOUR_SPOTLIGHT_PADDING, 0, viewportHeight)
  const spotlightRight = clamp(input.targetRect.right + FEATURE_TOUR_SPOTLIGHT_PADDING, 0, viewportWidth)
  const spotlightBottom = clamp(input.targetRect.bottom + FEATURE_TOUR_SPOTLIGHT_PADDING, 0, viewportHeight)
  const spotlightWidth = Math.max(0, spotlightRight - spotlightLeft)
  const spotlightHeight = Math.max(0, spotlightBottom - spotlightTop)

  const maxTooltipWidth = Math.max(0, viewportWidth - margin * 2)
  const tooltipWidth = Math.min(input.tooltipSize?.width ?? FEATURE_TOUR_TOOLTIP_WIDTH, maxTooltipWidth)
  const maxTooltipHeight = Math.max(0, viewportHeight - margin * 2)
  const measuredTooltipHeight = input.tooltipSize?.height ?? FEATURE_TOUR_TOOLTIP_FALLBACK_HEIGHT
  const tooltipHeight = Math.min(measuredTooltipHeight, maxTooltipHeight)

  const spotlightCenterX = spotlightLeft + spotlightWidth / 2
  const tooltipLeft = clamp(spotlightCenterX - tooltipWidth / 2, margin, viewportWidth - margin - tooltipWidth)

  const spaceBelow = viewportHeight - spotlightBottom - FEATURE_TOUR_TOOLTIP_GAP - margin
  const spaceAbove = spotlightTop - FEATURE_TOUR_TOOLTIP_GAP - margin
  const placeBelow = spaceBelow >= tooltipHeight || spaceBelow >= spaceAbove
  const desiredTooltipTop = placeBelow
    ? spotlightBottom + FEATURE_TOUR_TOOLTIP_GAP
    : spotlightTop - FEATURE_TOUR_TOOLTIP_GAP - tooltipHeight
  const tooltipTop = clamp(desiredTooltipTop, margin, viewportHeight - margin - tooltipHeight)

  return {
    spotlight: {
      top: spotlightTop,
      left: spotlightLeft,
      width: spotlightWidth,
      height: spotlightHeight,
    },
    tooltip: {
      top: tooltipTop,
      left: tooltipLeft,
      width: tooltipWidth,
      maxHeight: maxTooltipHeight,
    },
  }
}
