import type { Cell } from "./cells.js";
import type { ColorInput } from "./types.js";
/** Bar input. */
export interface BarInput {
    /** Bar value; negative or non-finite values render as an empty bar. */
    value: number;
    /** Label drawn below the bar (truncated to barWidth). */
    label?: string;
    /** Per-bar color override. */
    color?: ColorInput;
    /** Display text replacing the numeric value label. */
    textValue?: string;
}
/** Bar chart layout options. */
export interface BarChartLayoutOptions {
    /** Bars; plain numbers are accepted as a shorthand. */
    data: readonly (BarInput | number)[];
    /** Bar thickness in cells. Default 1. */
    barWidth?: number;
    /** Gap between bars in cells. Default 1. */
    barGap?: number;
    /** Explicit maximum. Default: largest finite value; `max <= 0` renders empty bars. */
    max?: number;
    /** Overlay the value on the bar bottom row. Default true. */
    showValues?: boolean;
    /** Draw bar labels below the bars. Default true. */
    showLabels?: boolean;
    /** Default bar/label color. */
    color?: ColorInput;
    /** Background painted across the whole widget area. */
    backgroundColor?: ColorInput;
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
export declare function layoutBarChart(options: BarChartLayoutOptions, width: number, height: number): Cell[];
