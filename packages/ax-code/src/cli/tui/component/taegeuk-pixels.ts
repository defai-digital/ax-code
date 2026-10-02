import {
  TAEGEUK_CENTER,
  TAEGEUK_COLUMNS,
  TAEGEUK_FIELD,
  TAEGEUK_FLAG,
  TAEGEUK_GROUND_TOP,
  TAEGEUK_PYLONS,
  TAEGEUK_ROWS,
  TAEGEUK_COLORS,
  taegeukBar,
  taegeukConfetti,
  taegeukEmblem,
  taegeukSkyRgb,
  taegeukSparks,
  taegeukSpin,
  taegeukWave,
  type TaegeukStyle,
} from "./taegeuk-view-model"
import { createHdCanvas, hdHex, type RGB } from "./scene-hd"

/** Trigram bounding box in flag units, mirrored into each corner. */
const TRIGRAM_BOX = { x0: 23, x1: 50, y0: 9, y1: 39 } as const

/**
 * Freeform HD renderer. The flag follows the official construction sheet:
 * a white 3:2 field, the tilted red-over-blue taegeuk, and four diagonal
 * trigrams. Sparks, confetti, pylons, and the crowd wave stay off the field.
 * Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderTaegeukPixels(width: number, height: number, style: TaegeukStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, TAEGEUK_COLUMNS, TAEGEUK_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const c = TAEGEUK_COLORS[style]
  const mast = hdHex(c.mast)
  const red = hdHex(c.red)
  const blue = hdHex(c.blue)

  hd.sky((t) => taegeukSkyRgb(style, t))
  // Confetti and sparks stay behind the flag so the field is never marked.
  for (const bit of taegeukConfetti(elapsedMs)) {
    hd.disk(hd.X(bit.x + 0.5), hd.Y(bit.y + 0.5), Math.max(1.5, Math.min(hd.cw, hd.ch) * 0.16), bit.red ? red : blue)
  }
  const spark = hdHex(c.spark)
  for (const star of taegeukSparks(elapsedMs)) {
    hd.disk(hd.X(star.x + 0.5), hd.Y(star.y + 0.5), Math.max(1.8, Math.min(hd.cw, hd.ch) * 0.2), spark)
  }

  // The field keeps 3:2 whatever the cell shape. `unit` is pixels per flag unit.
  const field = TAEGEUK_FIELD
  const unit = Math.min(hd.X(field.x1 - field.x0) / TAEGEUK_FLAG.width, hd.Y(field.y1 - field.y0) / TAEGEUK_FLAG.height)
  const cx = hd.X(TAEGEUK_CENTER.x)
  const cy = hd.Y(TAEGEUK_CENTER.y)
  const halfW = (TAEGEUK_FLAG.width / 2) * unit
  const halfH = (TAEGEUK_FLAG.height / 2) * unit
  hd.rect(cx - halfW, cy - halfH, cx + halfW, cy + halfH, hdHex(c.field))
  const region = (x0: number, y0: number, x1: number, y1: number, ink: (x: number, y: number) => RGB | undefined) => {
    const xa = Math.max(0, Math.floor(cx + x0 * unit))
    const xb = Math.min(hd.w - 1, Math.ceil(cx + x1 * unit))
    const ya = Math.max(0, Math.floor(cy + y0 * unit))
    const yb = Math.min(hd.h - 1, Math.ceil(cy + y1 * unit))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const color = ink((x + 0.5 - cx) / unit, (y + 0.5 - cy) / unit)
        if (color) hd.set(x, y, color)
      }
    }
  }
  const emblem = taegeukEmblem(taegeukSpin(elapsedMs))
  const radius = TAEGEUK_FLAG.radius
  region(-radius, -radius, radius, radius, (x, y) => {
    const side = emblem(x, y)
    return side && (side === "red" ? red : blue)
  })
  const trigram = hdHex(c.trigram)
  const bar = (x: number, y: number) => (taegeukBar(x, y) ? trigram : undefined)
  const box = TRIGRAM_BOX
  region(-box.x1, -box.y1, -box.x0, -box.y0, bar)
  region(box.x0, -box.y1, box.x1, -box.y0, bar)
  region(-box.x1, box.y0, -box.x0, box.y1, bar)
  region(box.x0, box.y0, box.x1, box.y1, bar)

  const flood = hdHex(c.flood)
  for (const pylon of TAEGEUK_PYLONS) {
    hd.disk(hd.X(pylon + 0.5), hd.Y(14.45), Math.max(2.2, hd.cw * 0.28), flood)
    hd.rect(hd.X(pylon), hd.Y(15), hd.X(pylon + 1), hd.Y(20), mast)
  }
  hd.rect(0, hd.Y(TAEGEUK_GROUND_TOP), hd.w, hd.h, hdHex(c.ground))
  const crowd = hdHex(c.crowd)
  const wave = taegeukWave(elapsedMs)
  for (let x = 0; x < TAEGEUK_COLUMNS; x++) {
    if ((x + wave) % 4 === 0) {
      hd.disk(hd.X(x + 0.5), hd.Y(TAEGEUK_GROUND_TOP + 0.5), Math.max(1.6, hd.cw * 0.18), crowd)
    }
    if ((x + wave + 2) % 4 === 0) {
      hd.disk(hd.X(x + 0.5), hd.Y(TAEGEUK_GROUND_TOP + 1.5), Math.max(1.6, hd.cw * 0.18), crowd)
    }
  }
  return hd.pixels
}
