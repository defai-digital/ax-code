import type { ColorInput } from "./types.js";
/**
 * A single painted terminal cell produced by a widget layout function.
 * Layout functions return paint-ordered cell lists; later entries win.
 */
export interface Cell {
    x: number;
    y: number;
    char: string;
    fg?: ColorInput;
    bg?: ColorInput;
}
/**
 * Attribute-level override merge (ratatui LayerCell semantics): the char
 * always replaces; fg/bg replace only when defined on the source cell. This
 * is what lets a block-marker layer contribute bg while a braille layer
 * contributes symbol+fg on the same cell.
 */
export declare function mergeCell(target: Cell, source: Cell): void;
/** Stable map key for a cell position inside a widget-sized area. */
export declare function cellKey(x: number, y: number): number;
/**
 * Composite ordered layers of cells into a flat paint list, merging
 * per-attribute (later layers override earlier ones).
 */
export declare function compositeCells(layers: readonly (readonly Cell[])[]): Cell[];
/**
 * Append cells painting `text` starting at (x, y). Iterates codepoints and
 * counts one column per codepoint (ASCII assumption, documented deviation
 * from ratatui's unicode-width measurement). Stops after `maxWidth` columns.
 */
export declare function paintText(out: Cell[], text: string, x: number, y: number, fg?: ColorInput, bg?: ColorInput, maxWidth?: number): void;
/**
 * Render a paint list into string rows for deterministic frame assertions.
 * Cells outside the area are ignored; unset cells use `fill`.
 */
export declare function cellsToFrame(cells: readonly Cell[], width: number, height: number, fill?: string): string[];
