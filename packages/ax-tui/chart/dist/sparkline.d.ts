import type { Cell } from "./cells.js";
import type { ColorInput } from "./types.js";
/** Sparkline layout options. */
export interface SparklineLayoutOptions {
    /** Series values; `null`/`undefined`/non-finite entries render as gaps. */
    data: readonly (number | null | undefined)[];
    /** Explicit maximum. Default: largest finite value (1 when none). */
    max?: number;
    /** Draw direction. Default "ltr" (ratatui LeftToRight). */
    direction?: "ltr" | "rtl";
    /** Default bar color. */
    color?: ColorInput;
    /** Optional per-bar color override. */
    barColor?: (value: number, index: number) => ColorInput;
    /** Background painted across the whole widget area. */
    backgroundColor?: ColorInput;
}
/**
 * Sparkline layout (faithful port of ratatui `render_sparkline`).
 *
 * Integer tick scaling: one cell holds 8 ticks; a bar consumes ticks
 * bottom-up so multi-row sparklines stack seamlessly with bottom-aligned
 * eighth blocks. `max <= 0` renders empty bars (no division by zero).
 */
export declare function layoutSparkline(options: SparklineLayoutOptions, width: number, height: number): Cell[];
