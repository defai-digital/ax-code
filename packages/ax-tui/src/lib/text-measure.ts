import { MeasureMode } from "../yoga.js"

export interface TextMeasureView {
  measureForDimensions(width: number, height: number): { lineCount: number; widthColsMax: number } | null
}

// Shared Yoga measure func for text-backed renderables (TextBufferRenderable,
// EditBufferRenderable). `isAbsolute` is read at measure time because the
// position type can change after the func is installed.
// MeasureMode: Undefined = 0, Exactly = 1, AtMost = 2.
export function createTextMeasureFunc(
  view: TextMeasureView,
  isAbsolute: () => boolean,
): (width: number, widthMode: MeasureMode, height: number, heightMode: MeasureMode) => { width: number; height: number } {
  return (width, widthMode, height, heightMode) => {
    // When widthMode is Undefined, Yoga is asking for the intrinsic/natural width
    // Pass width=0 to measureForDimensions to signal we want max-content (no wrapping)
    // The Zig code treats width=0 with wrap_mode != none as null wrap_width,
    // which triggers no-wrap mode and returns the text's intrinsic width
    let effectiveWidth: number
    if (widthMode === MeasureMode.Undefined || isNaN(width)) {
      effectiveWidth = 0
    } else {
      effectiveWidth = width
    }

    const effectiveHeight = isNaN(height) ? 1 : height
    // Yoga passes NaN height for Undefined sizing. Keep the sentinel for the
    // native call, but do not use it to clamp an unconstrained result.
    const hasHeightBound = heightMode !== MeasureMode.Undefined && !isNaN(height)
    // A sub-column width must not fall through to the width=0 no-wrap sentinel.
    const measureWidth = effectiveWidth > 0 ? Math.max(1, Math.floor(effectiveWidth)) : 0

    const measureResult = view.measureForDimensions(measureWidth, Math.floor(effectiveHeight))

    const measuredWidth = measureResult ? Math.max(1, measureResult.widthColsMax) : 1
    const measuredHeight = measureResult ? Math.max(1, measureResult.lineCount) : 1

    if (widthMode === MeasureMode.AtMost && !isAbsolute()) {
      return {
        width: Math.min(effectiveWidth, measuredWidth),
        height: hasHeightBound ? Math.min(effectiveHeight, measuredHeight) : measuredHeight,
      }
    }

    // NOTE: Yoga may use these measurements or not.
    // If the yoga node settings and the parent allow this node to grow, it will.
    return {
      width: measuredWidth,
      height: measuredHeight,
    }
  }
}
