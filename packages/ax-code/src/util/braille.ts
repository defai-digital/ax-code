/**
 * Shared braille dot-matrix encoding for the terminal-tab A/X title morph.
 *
 * A braille character (U+2800–U+28FF) is a 2-column by 4-row grid of dots and
 * has East Asian Width "Narrow", so it is CJK-safe. The Ambiguous-width block
 * glyphs (U+25A0 and friends) the old "Knight Rider" scanner used drift CJK and
 * ambiguous-width terminal layouts, so this is the only dot-matrix family the
 * terminal-tab title morph may use.
 */

/** Braille dot bit for a (row, column-within-a-2x4-cell) coordinate. */
export function brailleDotBit(row: number, column: number): number {
  if (row === 3) return column === 0 ? 0x40 : 0x80
  return (column === 0 ? 0x01 : 0x08) << row
}
