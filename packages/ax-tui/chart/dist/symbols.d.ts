/**
 * Shared glyph tables for the chart widgets.
 *
 * Ported from ratatui-core `symbols` (v0.30.2): `bar` (nine levels),
 * `block` (vertical eighths), `line`, `braille`, and the dot/full-block
 * marker glyphs. One source of truth so Sparkline, BarChart, Gauge, and
 * Chart never diverge visually (external design review finding).
 */
/** Bottom-aligned eighth blocks (`symbols::bar::NINE_LEVELS`), one_eighth..full. */
export declare const BAR_LEVELS: readonly ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
/** Empty cell of the nine-level bar set (`symbols::shade::EMPTY`). */
export declare const BAR_EMPTY = " ";
/** Left-aligned vertical eighth blocks (`symbols::block`), used by the unicode Gauge edge. */
export declare const BLOCK_EIGHTHS: readonly ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
/** LINE HORIZONTAL. */
export declare const LINE_HORIZONTAL = "\u2500";
/** LINE VERTICAL. */
export declare const LINE_VERTICAL = "\u2502";
/** LINE BOTTOM LEFT. */
export declare const LINE_BOTTOM_LEFT = "\u2514";
/** BOX TOP LEFT. */
export declare const BOX_TOP_LEFT = "\u250C";
/** BOX TOP RIGHT. */
export declare const BOX_TOP_RIGHT = "\u2510";
/** BOX BOTTOM LEFT. */
export declare const BOX_BOTTOM_LEFT = "\u2514";
/** BOX BOTTOM RIGHT. */
export declare const BOX_BOTTOM_RIGHT = "\u2518";
/** Dot marker glyph (`symbols::DOT`). */
export declare const DOT = "\u2022";
/** Full block used by the block marker and Gauge fill (`symbols::block::FULL`). */
export declare const FULL_BLOCK = "\u2588";
/** Base codepoint of the Unicode Braille Patterns block; char = base + 8-bit pattern. */
export declare const BRAILLE_BASE = 10240;
/**
 * Map a remaining tick count to a bar glyph. One cell holds 8 ticks
 * (ratatui `symbol_for_height`): 0 -> empty, 1..8 -> one_eighth..full.
 */
export declare function symbolForHeight(ticks: number): string;
