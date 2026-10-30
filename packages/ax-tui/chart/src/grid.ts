import type { Cell } from "./cells.js"
import { BRAILLE_BASE, DOT, FULL_BLOCK } from "./symbols.js"
import type { ColorInput, Marker } from "./types.js"

/** Per-cell pixel resolution of a grid. */
export interface GridResolution {
  /** Pixels per cell horizontally. */
  readonly x: number
  /** Pixels per cell vertically. */
  readonly y: number
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
  readonly cellWidth: number
  readonly cellHeight: number
  readonly resolution: GridResolution
  /** Light one pixel. Out-of-range or non-integer pixels are silently ignored. */
  paint(px: number, py: number, color: ColorInput): void
  /** Flush painted pixels to cells. Empty cells are omitted. */
  save(): Cell[]
}

/**
 * 1x1-per-cell grid for the dot and block markers (port of ratatui CharGrid).
 * `paintBg` mirrors the ratatui Block marker, which colors fg AND bg so an
 * upper layer can still overwrite the symbol.
 */
export class CharGrid implements Grid {
  private readonly colors: (ColorInput | undefined)[]

  constructor(
    readonly cellWidth: number,
    readonly cellHeight: number,
    private readonly char: string = DOT,
    private readonly paintBg: boolean = false,
  ) {
    this.colors = new Array<ColorInput | undefined>(Math.max(0, cellWidth) * Math.max(0, cellHeight)).fill(undefined)
  }

  get resolution(): GridResolution {
    return { x: this.cellWidth, y: this.cellHeight }
  }

  paint(px: number, py: number, color: ColorInput): void {
    if (!Number.isInteger(px) || !Number.isInteger(py)) return
    if (px < 0 || py < 0 || px >= this.cellWidth || py >= this.cellHeight) return
    this.colors[py * this.cellWidth + px] = color // last-write-wins
  }

  save(): Cell[] {
    const cells: Cell[] = []
    for (let y = 0; y < this.cellHeight; y++) {
      for (let x = 0; x < this.cellWidth; x++) {
        const color = this.colors[y * this.cellWidth + x]
        if (color === undefined) continue
        cells.push({ x, y, char: this.char, fg: color, bg: this.paintBg ? color : undefined })
      }
    }
    return cells
  }
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
export class BrailleGrid implements Grid {
  private readonly patterns: Uint8Array
  private readonly colors: (ColorInput | undefined)[]

  constructor(readonly cellWidth: number, readonly cellHeight: number) {
    const size = Math.max(0, cellWidth) * Math.max(0, cellHeight)
    this.patterns = new Uint8Array(size)
    this.colors = new Array<ColorInput | undefined>(size).fill(undefined)
  }

  get resolution(): GridResolution {
    return { x: this.cellWidth * 2, y: this.cellHeight * 4 }
  }

  paint(px: number, py: number, color: ColorInput): void {
    if (!Number.isInteger(px) || !Number.isInteger(py)) return
    if (px < 0 || py < 0 || px >= this.resolution.x || py >= this.resolution.y) return
    const index = Math.floor(py / 4) * this.cellWidth + Math.floor(px / 2)
    const pxInCell = px % 2
    const pyInCell = py % 4
    this.patterns[index]! |= 1 << (pyInCell === 3 ? 6 + pxInCell : pxInCell * 3 + pyInCell)
    this.colors[index] = color
  }

  save(): Cell[] {
    const cells: Cell[] = []
    for (let index = 0; index < this.patterns.length; index++) {
      const pattern = this.patterns[index]!
      if (pattern === 0) continue
      cells.push({
        x: index % this.cellWidth,
        y: Math.floor(index / this.cellWidth),
        char: String.fromCodePoint(BRAILLE_BASE + pattern),
        fg: this.colors[index],
      })
    }
    return cells
  }
}

/** Create the grid for a marker at the given cell dimensions. */
export function createGrid(marker: Marker, cellWidth: number, cellHeight: number): Grid {
  switch (marker) {
    case "dot":
      return new CharGrid(cellWidth, cellHeight, DOT, false)
    case "block":
      return new CharGrid(cellWidth, cellHeight, FULL_BLOCK, true)
    case "braille":
      return new BrailleGrid(cellWidth, cellHeight)
  }
}
