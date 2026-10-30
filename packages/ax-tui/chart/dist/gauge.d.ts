import type { Cell } from "./cells.js";
import type { ColorInput } from "./types.js";
/** Gauge layout options. */
export interface GaugeLayoutOptions {
    /** Progress in [0, 1]; clamped, NaN treated as 0 (ratatui panics — documented deviation). */
    ratio?: number;
    /** Label text. Default `${round(ratio * 100)}%`; pass `null` to suppress. */
    label?: string | null;
    /** Fill color. Default "white". */
    color?: ColorInput;
    /**
     * Label color. Default: the terminal default over the fill (the fill color
     * becomes the label background there); the fill color beyond the fill.
     */
    labelColor?: ColorInput;
    /** Background painted across the whole widget area. */
    backgroundColor?: ColorInput;
    /** Render the partial eighth-block at the fill edge. Default false (ratatui `use_unicode`). */
    unicode?: boolean;
}
/**
 * Gauge layout (port of ratatui `Gauge` rendering, non-unicode path plus the
 * optional unicode partial edge). Inside the filled region the label is
 * painted with the fill color as its background, mirroring ratatui's
 * blank+swap pass: the bar stays visually continuous behind the text.
 */
export declare function layoutGauge(options: GaugeLayoutOptions, width: number, height: number): Cell[];
