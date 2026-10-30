import { BLOCK_EIGHTHS, FULL_BLOCK } from "./symbols.js"
import type { Cell } from "./cells.js"
import type { ColorInput } from "./types.js"

/** Gauge layout options. */
export interface GaugeLayoutOptions {
  /** Progress in [0, 1]; clamped, NaN treated as 0 (ratatui panics — documented deviation). */
  ratio?: number
  /** Label text. Default `${round(ratio * 100)}%`; pass `null` to suppress. */
  label?: string | null
  /** Fill color. Default "white". */
  color?: ColorInput
  /**
   * Label color. Default: the terminal default over the fill (the fill color
   * becomes the label background there); the fill color beyond the fill.
   */
  labelColor?: ColorInput
  /** Background painted across the whole widget area. */
  backgroundColor?: ColorInput
  /** Render the partial eighth-block at the fill edge. Default false (ratatui `use_unicode`). */
  unicode?: boolean
}

/**
 * Gauge layout (port of ratatui `Gauge` rendering, non-unicode path plus the
 * optional unicode partial edge). Inside the filled region the label is
 * painted with the fill color as its background, mirroring ratatui's
 * blank+swap pass: the bar stays visually continuous behind the text.
 */
export function layoutGauge(options: GaugeLayoutOptions, width: number, height: number): Cell[] {
  if (width <= 0 || height <= 0) return []
  const cells: Cell[] = []

  const raw = options.ratio
  const ratio = typeof raw === "number" && Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0
  const color = options.color ?? "white"
  const filled = width * ratio
  const end = options.unicode ? Math.floor(filled) : Math.round(filled)

  if (options.backgroundColor !== undefined) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) cells.push({ x, y, char: " ", bg: options.backgroundColor })
    }
  }

  for (let row = 0; row < height; row++) {
    for (let x = 0; x < end && x < width; x++) {
      cells.push({ x, y: row, char: FULL_BLOCK, fg: color, bg: options.backgroundColor })
    }
    if (options.unicode && ratio < 1 && end < width) {
      const index = Math.round(filled % 1 * 8)
      if (index >= 1 && index <= 8) {
        cells.push({ x: end, y: row, char: BLOCK_EIGHTHS[index - 1]!, fg: color, bg: options.backgroundColor })
      }
    }
  }

  const label = options.label === undefined ? `${Math.round(ratio * 100)}%` : options.label
  if (label !== null && label.length > 0) {
    const text = label.length > width ? label.slice(0, width) : label
    const col = Math.floor((width - text.length) / 2)
    const row = Math.floor(height / 2)
    for (let i = 0; i < text.length; i++) {
      const x = col + i
      if (x < end) {
        // Inside the fill the fill color becomes the label background, so the
        // bar stays visually continuous behind the text (ratatui blank+swap).
        cells.push({ x, y: row, char: text[i]!, fg: options.labelColor, bg: color })
      } else {
        cells.push({ x, y: row, char: text[i]!, fg: options.labelColor ?? color, bg: options.backgroundColor })
      }
    }
  }
  return cells
}
