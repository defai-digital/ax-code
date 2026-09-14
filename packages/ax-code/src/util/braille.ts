/**
 * Shared braille dot-matrix encoding for the TUI busy indicator.
 *
 * A braille character (U+2800–U+28FF) is a 2-column by 4-row grid of dots and
 * has East Asian Width "Narrow", so it is CJK-safe. The Ambiguous-width block
 * glyphs (U+25A0 and friends) the old "Knight Rider" scanner used drift CJK and
 * ambiguous-width terminal layouts, so this is the only dot-matrix family the
 * busy indicator may use.
 */

export const BRAILLE_BASE = 0x2800

/** Braille dot bit for a (row, column-within-a-2x4-cell) coordinate. */
export function brailleDotBit(row: number, column: number): number {
  if (row === 3) return column === 0 ? 0x40 : 0x80
  return (column === 0 ? 0x01 : 0x08) << row
}

/**
 * Encode a row-major "#"/"." dot matrix into braille lines. Every 2 columns
 * become one cell and every 4 rows become one output line, so a matrix taller
 * than four rows yields multiple lines — a 6-row glyph becomes two terminal
 * rows. Rows may be ragged or short; missing dots stay blank.
 */
export function encodeBrailleLines(rows: readonly string[]): string[] {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const lines: string[] = []
  for (let start = 0; start < rows.length; start += 4) {
    let line = ""
    for (let column = 0; column < columns; column += 2) {
      let mask = 0
      for (let row = 0; row < 4; row++) {
        const source = rows[start + row]
        if (!source) continue
        if (source.charAt(column) === "#") mask |= brailleDotBit(row, 0)
        if (source.charAt(column + 1) === "#") mask |= brailleDotBit(row, 1)
      }
      line += String.fromCharCode(BRAILLE_BASE + mask)
    }
    lines.push(line)
  }
  return lines
}
