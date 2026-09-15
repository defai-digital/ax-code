import { RGBA } from "ax-tui"
import { DIGITAL_CODE_LEVEL_RGB } from "./digital-code-view-model"

// Rain trails and dropping logo glyphs share the same neon brightness ramps.
export const DIGITAL_CODE_LEVEL_COLORS = {
  purple: DIGITAL_CODE_LEVEL_RGB.purple.map(([r, g, b]) => RGBA.fromInts(r, g, b)),
  blue: DIGITAL_CODE_LEVEL_RGB.blue.map(([r, g, b]) => RGBA.fromInts(r, g, b)),
  highlight: DIGITAL_CODE_LEVEL_RGB.highlight.map(([r, g, b]) => RGBA.fromInts(r, g, b)),
}
