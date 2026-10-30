import type { Cell } from "./cells.js";
import type { ColorInput, Marker } from "./types.js";
/** Per-cell pixel resolution of a grid. */
export interface GridResolution {
    /** Pixels per cell horizontally. */
    readonly x: number;
    /** Pixels per cell vertically. */
    readonly y: number;
}
/**
 * Pixel-addressable drawing surface over a cell area (port of the ratatui
 * `Grid` trait). Paint uses pixel coordinates with the origin at the
 * top-left; `save()` flushes painted pixels to terminal cells.
 *
 * Exported as a documented utility of `@defai-digital/ax-tui/chart` so a future Canvas
 * widget can reuse it without a new public surface commitment.
 */
export interface Grid {
    readonly cellWidth: number;
    readonly cellHeight: number;
    readonly resolution: GridResolution;
    /** Light one pixel. Out-of-range or non-integer pixels are silently ignored. */
    paint(px: number, py: number, color: ColorInput): void;
    /** Flush painted pixels to cells. Empty cells are omitted. */
    save(): Cell[];
}
/**
 * 1x1-per-cell grid for the dot and block markers (port of ratatui CharGrid).
 * `paintBg` mirrors the ratatui Block marker, which colors fg AND bg so an
 * upper layer can still overwrite the symbol.
 */
export declare class CharGrid implements Grid {
    readonly cellWidth: number;
    readonly cellHeight: number;
    private readonly char;
    private readonly paintBg;
    private readonly colors;
    constructor(cellWidth: number, cellHeight: number, char?: string, paintBg?: boolean);
    get resolution(): GridResolution;
    paint(px: number, py: number, color: ColorInput): void;
    save(): Cell[];
}
/**
 * 2x4-dots-per-cell braille grid (port of ratatui `PatternGrid<2,4>` +
 * `symbols::braille`). Bits follow the Unicode braille dot numbering directly
 * (dots 1,2,3,7 down the left column = bits 0,1,2,6; dots 4,5,6,8 down the
 * right = bits 3,4,5,7), so the character is `U+2800 + pattern`. ratatui
 * v0.30 stores row-major bits and translates them through its 256-entry
 * BRAILLE lookup table; storing the Unicode pattern directly is equivalent.
 * A braille cell carries a single fg color; colliding paints resolve
 * last-write-wins (ratatui parity).
 */
export declare class BrailleGrid implements Grid {
    readonly cellWidth: number;
    readonly cellHeight: number;
    private readonly patterns;
    private readonly colors;
    constructor(cellWidth: number, cellHeight: number);
    get resolution(): GridResolution;
    paint(px: number, py: number, color: ColorInput): void;
    save(): Cell[];
}
/** Create the grid for a marker at the given cell dimensions. */
export declare function createGrid(marker: Marker, cellWidth: number, cellHeight: number): Grid;
