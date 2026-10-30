/**
 * Attribute-level override merge (ratatui LayerCell semantics): the char
 * always replaces; fg/bg replace only when defined on the source cell. This
 * is what lets a block-marker layer contribute bg while a braille layer
 * contributes symbol+fg on the same cell.
 */
export function mergeCell(target, source) {
    target.char = source.char;
    if (source.fg !== undefined)
        target.fg = source.fg;
    if (source.bg !== undefined)
        target.bg = source.bg;
}
/** Stable map key for a cell position inside a widget-sized area. */
export function cellKey(x, y) {
    return y * 0x100000 + x;
}
/**
 * Composite ordered layers of cells into a flat paint list, merging
 * per-attribute (later layers override earlier ones).
 */
export function compositeCells(layers) {
    const merged = new Map();
    for (const layer of layers) {
        for (const cell of layer) {
            const key = cellKey(cell.x, cell.y);
            const existing = merged.get(key);
            if (existing)
                mergeCell(existing, cell);
            else
                merged.set(key, { ...cell });
        }
    }
    return [...merged.values()];
}
/**
 * Append cells painting `text` starting at (x, y). Iterates codepoints and
 * counts one column per codepoint (ASCII assumption, documented deviation
 * from ratatui's unicode-width measurement). Stops after `maxWidth` columns.
 */
export function paintText(out, text, x, y, fg, bg, maxWidth = Number.POSITIVE_INFINITY) {
    let column = 0;
    for (const char of text) {
        if (column >= maxWidth)
            break;
        out.push({ x: x + column, y, char, fg, bg });
        column += 1;
    }
}
/**
 * Render a paint list into string rows for deterministic frame assertions.
 * Cells outside the area are ignored; unset cells use `fill`.
 */
export function cellsToFrame(cells, width, height, fill = " ") {
    const rows = Array.from({ length: height }, () => Array(width).fill(fill));
    for (const cell of cells) {
        // Coerce to real numbers: non-numeric input becomes NaN and is skipped, so
        // string keys can never address object properties instead of array elements.
        const x = Number(cell.x);
        const y = Number(cell.y);
        if (!Number.isInteger(x) || !Number.isInteger(y))
            continue;
        if (x < 0 || y < 0 || x >= width || y >= height)
            continue;
        rows[y][x] = cell.char;
    }
    return rows.map((row) => row.join(""));
}
