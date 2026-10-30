/**
 * Shared glyph tables for the chart widgets.
 *
 * Ported from ratatui-core `symbols` (v0.30.2): `bar` (nine levels),
 * `block` (vertical eighths), `line`, `braille`, and the dot/full-block
 * marker glyphs. One source of truth so Sparkline, BarChart, Gauge, and
 * Chart never diverge visually (external design review finding).
 */
/** Bottom-aligned eighth blocks (`symbols::bar::NINE_LEVELS`), one_eighth..full. */
export const BAR_LEVELS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
/** Empty cell of the nine-level bar set (`symbols::shade::EMPTY`). */
export const BAR_EMPTY = " ";
/** Left-aligned vertical eighth blocks (`symbols::block`), used by the unicode Gauge edge. */
export const BLOCK_EIGHTHS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
/** LINE HORIZONTAL. */
export const LINE_HORIZONTAL = "─";
/** LINE VERTICAL. */
export const LINE_VERTICAL = "│";
/** LINE BOTTOM LEFT. */
export const LINE_BOTTOM_LEFT = "└";
/** BOX TOP LEFT. */
export const BOX_TOP_LEFT = "┌";
/** BOX TOP RIGHT. */
export const BOX_TOP_RIGHT = "┐";
/** BOX BOTTOM LEFT. */
export const BOX_BOTTOM_LEFT = "└";
/** BOX BOTTOM RIGHT. */
export const BOX_BOTTOM_RIGHT = "┘";
/** Dot marker glyph (`symbols::DOT`). */
export const DOT = "•";
/** Full block used by the block marker and Gauge fill (`symbols::block::FULL`). */
export const FULL_BLOCK = "█";
/** Base codepoint of the Unicode Braille Patterns block; char = base + 8-bit pattern. */
export const BRAILLE_BASE = 0x2800;
/**
 * Map a remaining tick count to a bar glyph. One cell holds 8 ticks
 * (ratatui `symbol_for_height`): 0 -> empty, 1..8 -> one_eighth..full.
 */
export function symbolForHeight(ticks) {
    const level = Math.floor(ticks);
    if (!(level > 0))
        return BAR_EMPTY;
    if (level >= 8)
        return BAR_LEVELS[7];
    return BAR_LEVELS[level - 1];
}
