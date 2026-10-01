import {
  BOROBUDUR_COLUMNS,
  BOROBUDUR_GROUND_TOP,
  BOROBUDUR_MIST_BANDS,
  BOROBUDUR_OFFERINGS,
  BOROBUDUR_PALMS,
  BOROBUDUR_PILGRIMS,
  BOROBUDUR_ROWS,
  BOROBUDUR_STUPA,
  BOROBUDUR_SUN,
  BOROBUDUR_TIERS,
  BOROBUDUR_VOLCANO,
  BOROBUDUR_COLORS,
  borobudurBirds,
  borobudurDrift,
  borobudurSkyRgb,
  type BorobudurStyle,
} from "./borobudur-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"

/**
 * Freeform HD renderer. A haloed sun, Merapi's lit cone, stepped terrace
 * masses, stupa ellipses, speckled palms, and drifting mist come from the
 * shared scene model. Pure and deterministic: everything derives from
 * `elapsedMs`.
 */
export function renderBorobudurPixels(width: number, height: number, style: BorobudurStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, BOROBUDUR_COLUMNS, BOROBUDUR_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const misty = style === "borobudur-mist"
  const c = BOROBUDUR_COLORS[style]
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const stupa = hdHex(c.stupa)
  const palms = hdHex(c.palms)
  const cone = hdHex(c.volcano)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const drift = borobudurDrift(elapsedMs)

  hd.sky((t) => borobudurSkyRgb(style, t))
  const around = borobudurSkyRgb(style, BOROBUDUR_SUN.y / BOROBUDUR_ROWS)
  const sun = hdHex(c.sun)
  hd.halo(hd.X(BOROBUDUR_SUN.x), hd.Y(BOROBUDUR_SUN.y + 0.45), coreR, sun, hdMix(sun, around, 0.4), around)

  const crater = BOROBUDUR_VOLCANO
  hd.mass(crater.x, crater.top, crater.base + 1, 0.7, 3.4, cone, hdDarken(cone, 0.78), hdDarken(cone, 0.62))

  const crown = BOROBUDUR_STUPA
  hd.blob(hd.X(crown.x + 0.5), hd.Y(crown.top + 1.7), hd.cw * 2.3, hd.ch * 1.15, stupa, stoneDark)
  hd.blob(hd.X(crown.x + 0.5), hd.Y(crown.top + 0.55), hd.cw * 1.15, hd.ch * 0.72, stupa)
  hd.disk(hd.X(38.5), hd.Y(4.45), Math.max(2, hd.cw * 0.26), hdHex(c.buddha))
  hd.stroke(crown.x - 2.2, crown.base, crown.x + 3.2, crown.base, Math.max(2, hd.cw * 0.22), stoneDark)

  for (const [x0, x1, y0, y1] of BOROBUDUR_TIERS) {
    const mid = (x0 + x1) / 2
    const half = (x1 - x0) / 2
    hd.mass(mid, y0, y1 + 1, half * 0.98, half, stone, hdDarken(stone, 0.82), stoneDark)
    hd.rect(hd.X(x0), hd.Y(y1 + 0.72), hd.X(x1 + 1), hd.Y(y1 + 1), stoneDark)
    for (let x = x0 + 3; x <= x1 - 3; x += 6) {
      hd.blob(hd.X(x + 0.5), hd.Y(y0 - 0.55), hd.cw * 0.48, hd.ch * 0.42, stupa, stoneDark)
    }
  }
  for (let x = 16; x <= 60; x += 5) {
    hd.disk(hd.X(x + 0.5), hd.Y(14.5), Math.max(1.5, hd.cw * 0.18), hdHex(c.relief))
  }
  for (const bloom of BOROBUDUR_OFFERINGS) {
    hd.disk(hd.X(bloom + 0.5), hd.Y(7.45), Math.max(1.6, hd.cw * 0.18), hdHex(c.offer))
  }
  for (const climber of BOROBUDUR_PILGRIMS) {
    hd.disk(hd.X(climber + 0.5), hd.Y(12.45), Math.max(1.7, hd.cw * 0.18), hdHex(c.pilgrim))
  }

  const mist = hdHex(c.mist)
  const bands = misty ? BOROBUDUR_MIST_BANDS : [BOROBUDUR_MIST_BANDS[1]!]
  for (const band of bands) {
    for (let x = 0; x < BOROBUDUR_COLUMNS; x += 8) {
      const offset = (x + drift) % BOROBUDUR_COLUMNS
      if (misty) {
        hd.rect(hd.X(offset), hd.Y(band + 0.35), hd.X(Math.min(BOROBUDUR_COLUMNS, offset + 6)), hd.Y(band + 0.62), mist)
      } else {
        hd.rect(hd.X(offset), hd.Y(band + 0.35), hd.X(offset + 3), hd.Y(band + 0.62), mist)
        hd.rect(
          hd.X(offset + 4),
          hd.Y(band + 0.35),
          hd.X(Math.min(BOROBUDUR_COLUMNS, offset + 6)),
          hd.Y(band + 0.62),
          mist,
        )
      }
    }
  }

  const leaf = hdHex(c.leaf)
  for (let x = 4; x < BOROBUDUR_COLUMNS; x += 9) {
    hd.blob(hd.X(x + 1.2), hd.Y(BOROBUDUR_GROUND_TOP - 0.7), hd.cw * 1.3, hd.ch * 0.45, leaf, hdDarken(leaf, 0.75))
  }
  for (let x = 8; x < BOROBUDUR_COLUMNS; x += 9) {
    hd.blob(hd.X(x + 1.2), hd.Y(BOROBUDUR_GROUND_TOP - 1.55), hd.cw * 1.15, hd.ch * 0.4, leaf, hdDarken(leaf, 0.78))
  }
  for (const trunk of BOROBUDUR_PALMS) {
    const lean = trunk < BOROBUDUR_COLUMNS / 2 ? -1.4 : 1.4
    hd.blob(hd.X(trunk + lean), hd.Y(12.15), hd.cw * 1.7, hd.ch * 0.62, palms, hdDarken(palms, 0.74))
    hd.blob(hd.X(trunk - lean * 0.2), hd.Y(12.35), hd.cw * 1.35, hd.ch * 0.5, palms, hdDarken(palms, 0.8))
    hd.stroke(trunk + 0.5, 13, trunk + 0.5, 16.4, Math.max(5, hd.cw * 0.5), palms)
  }
  for (const swift of borobudurBirds(elapsedMs)) {
    hd.disk(hd.X(swift.x + 0.5), hd.Y(swift.y + 0.5), Math.max(1.5, Math.min(hd.cw, hd.ch) * 0.16), hdHex(c.bird))
  }
  hd.rect(0, hd.Y(BOROBUDUR_GROUND_TOP), hd.w, hd.h, hdHex(c.ground))
  return hd.pixels
}
