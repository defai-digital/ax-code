import { RGBA } from "ax-tui"
import { MATRIX_RAIN_LEVEL_RGB } from "./matrix-rain-view-model"

// Rendered form of the shared brightness ramp: index 0 is blank and index
// MATRIX_RAIN_LEVELS is the head. Rain trails and the dropping logo both
// colorize from it, so the two startup flourishes stay on one palette.
export const MATRIX_RAIN_LEVEL_COLORS: RGBA[] = MATRIX_RAIN_LEVEL_RGB.map(([r, g, b]) => RGBA.fromInts(r, g, b))
