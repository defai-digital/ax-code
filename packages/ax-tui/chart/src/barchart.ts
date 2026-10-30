import { BAR_EMPTY, symbolForHeight } from "./symbols.js"
import type { Cell } from "./cells.js"
import { paintText } from "./cells.js"
import type { ColorInput } from "./types.js"

/** Bar input. */
export interface BarInput {
  /** Bar value; negative or non-finite values render as an empty bar. */
  value: number
  /** Label drawn below the bar (truncated to barWidth). */
  label?: string
  /** Per-bar color override. */
  color?: ColorInput
  /** Display text replacing the numeric value label. */
  textValue?: string
}

/** Bar chart layout options. */
export interface BarChartLayoutOptions {
  /** Bars; plain numbers are accepted as a shorthand. */
  data: readonly (BarInput | number)[]
  /** Bar thickness in cells. Default 1. */
  barWidth?: number
  /** Gap between bars in cells. Default 1. */
  barGap?: number
  /** Explicit maximum. Default: largest finite value; `max <= 0` renders empty bars. */
  max?: number
  /** Overlay the value on the bar bottom row. Default true. */
  showValues?: boolean
  /** Draw bar labels below the bars. Default true. */
  showLabels?: boolean
  /** Default bar/label color. */
  color?: ColorInput
  /** Background painted across the whole widget area. */
  backgroundColor?: ColorInput
}

function normalizeBar(entry: BarInput | number): Required<Pick<BarInput, "value">> & BarInput {
  if (typeof entry === "number") {
    return { value: Number.isFinite(entry) ? Math.max(entry, 0) : 0 }
  }
  const value = Number.isFinite(entry.value) ? Math.max(entry.value, 0) : 0
  return { ...entry, value }
}

/**
 * Vertical BarChart layout (port of ratatui `render_vertical` for flat bars;
 * groups and horizontal direction are deferred).
 *
 * Tick scaling matches ratatui: `maxTicks = barsHeight * 8`,
 * `ticks = min(value * maxTicks / max, maxTicks)`, consumed bottom-up.
 * Value labels overlay the BOTTOM bar row and follow ratatui's fit rule
 * (`len < barWidth || (len == barWidth && ticks >= 8)`): text that exactly
 * covers the bar is shown only when the bottom row is a full block, so a
 * partial bar glyph is never erased by the value. Bars that do not fit the
 * width are dropped.
 */
export function layoutBarChart(options: BarChartLayoutOptions, width: number, height: number): Cell[] {
  const barWidth = options.barWidth ?? 1
  const barGap = options.barGap ?? 1
  if (width <= 0 || height <= 0 || barWidth <= 0 || barGap < 0 || options.data.length === 0) return []

  const bars = options.data.map(normalizeBar)
  const showLabels = options.showLabels ?? true
  const showValues = options.showValues ?? true
  const hasLabels = showLabels && bars.some((bar) => bar.label !== undefined && bar.label.length > 0)
  const labelRows = hasLabels ? 1 : 0
  const barsHeight = height - labelRows
  if (barsHeight <= 0) return []

  const cells: Cell[] = []
  if (options.backgroundColor !== undefined) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) cells.push({ x, y, char: BAR_EMPTY, bg: options.backgroundColor })
    }
  }

  let max: number
  if (options.max !== undefined && Number.isFinite(options.max)) {
    max = options.max
  } else {
    let computed = 0
    for (const bar of bars) computed = Math.max(computed, bar.value)
    max = computed
  }

  const maxTicks = barsHeight * 8
  const defaultColor = options.color ?? "white"
  let x = 0
  for (const bar of bars) {
    if (x + barWidth > width) break
    const ticks = max > 0 ? Math.min(Math.floor((bar.value * maxTicks) / max), maxTicks) : 0
    const color = bar.color ?? defaultColor

    let remaining = ticks
    for (let row = barsHeight - 1; row >= 0; row--) {
      const char = symbolForHeight(remaining)
      if (char !== BAR_EMPTY) {
        for (let column = 0; column < barWidth; column++) cells.push({ x: x + column, y: row, char, fg: color })
      }
      remaining = remaining > 8 ? remaining - 8 : 0
    }

    if (showValues && bar.value !== 0) {
      const text = bar.textValue ?? String(bar.value)
      if (text.length < barWidth || (text.length === barWidth && ticks >= 8)) {
        const valueX = x + Math.floor((barWidth - text.length) / 2)
        paintText(cells, text, valueX, barsHeight - 1, color, options.backgroundColor)
      }
    }

    if (hasLabels && bar.label !== undefined && bar.label.length > 0) {
      const label = bar.label.length > barWidth ? bar.label.slice(0, barWidth) : bar.label
      const labelX = x + Math.floor((barWidth - label.length) / 2)
      paintText(cells, label, labelX, barsHeight, defaultColor, options.backgroundColor)
    }

    x += barWidth + barGap
  }
  return cells
}
