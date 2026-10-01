import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  JUNGLE_CANOPY_BOTTOM,
  JUNGLE_COLUMNS,
  JUNGLE_COLORS,
  JUNGLE_GROUND_TOP,
  JUNGLE_MOON,
  JUNGLE_PARROT_Y,
  JUNGLE_ROWS,
  JUNGLE_SHAFTS,
  JUNGLE_TRUNKS,
  JUNGLE_VINES,
  jungleFireflies,
  jungleLeaves,
  jungleParrotX,
  jungleSkyRgb,
  jungleSway,
  type JungleStyle,
} from "./jungle-view-model"

const CANOPY = [
  [8, 2.1, 7.2, 2.3],
  [24, 3.2, 8.2, 2.5],
  [40, 1.8, 8.6, 2.6],
  [56, 3.0, 7.4, 2.3],
  [70, 2.2, 6.4, 2.1],
  [14, 5.4, 6.2, 1.7],
  [32, 5.8, 7.0, 1.85],
  [50, 5.1, 6.4, 1.7],
  [66, 5.5, 5.8, 1.6],
] as const

/**
 * Freeform HD renderer. Layered speckled canopy, swayed vines, leaf disks,
 * and the moon halo come from the shared scene model. Pure: every pixel
 * derives from `elapsedMs`.
 */
export function renderJunglePixels(width: number, height: number, style: JungleStyle, elapsedMs: number): Buffer {
  let w = Math.max(0, Math.floor(width))
  let h = Math.max(0, Math.floor(height))
  if (w > 0 && h > 0) {
    const scale = Math.min(1, 1920 / w, 1080 / h)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  const hd = createHdCanvas(w, h, JUNGLE_COLUMNS, JUNGLE_ROWS)
  if (w === 0 || h === 0) return hd.pixels
  const night = style === "jungle-night"
  const c = JUNGLE_COLORS[style]
  const leaf = hdHex(c.leaf)
  const leafDark = hdHex(c.leafDark)
  const leafLight = hdHex(c.leafLight)
  const vine = hdHex(c.vine)
  const trunk = hdHex(c.trunk)
  const ground = hdHex(c.ground)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)

  hd.sky((t) => jungleSkyRgb(style, t))
  for (const [cx, cy, rx, ry] of CANOPY) {
    if (night && cx > 52 && cy < 4) continue
    const back = cy < JUNGLE_CANOPY_BOTTOM * 0.7
    hd.blob(hd.X(cx), hd.Y(cy), hd.cw * rx, hd.ch * ry, back ? leafDark : leaf, back ? leaf : leafLight)
  }
  if (night) {
    const moon = hdHex(c.shaft)
    const around = jungleSkyRgb(style, 0.06)
    hd.halo(hd.X(JUNGLE_MOON.x), hd.Y(JUNGLE_MOON.y), coreR, moon, hdMix(moon, around, 0.45), around)
  } else {
    const shaft = hdHex(c.shaft)
    for (const ray of JUNGLE_SHAFTS) {
      hd.stroke(ray, 7.1, ray + 3.1, 16.2, Math.max(1.6, hd.cw * 0.16), hdMix(shaft, leafLight, 0.15))
    }
    for (const fallen of jungleLeaves(elapsedMs)) {
      hd.disk(hd.X(fallen.x + 0.5), hd.Y(fallen.y + 0.5), Math.max(1.6, hd.cw * 0.16), leafLight)
    }
  }

  for (const stem of JUNGLE_VINES) {
    const tip = jungleSway(elapsedMs, stem)
    hd.stroke(stem + 0.5, 7, stem + tip + 0.5, 14, Math.max(1.15, hd.cw * 0.09), vine)
    hd.disk(hd.X(stem + tip + 0.5), hd.Y(14.4), Math.max(2, hd.cw * 0.22), hdMix(vine, leafLight, 0.3))
  }
  for (const post of JUNGLE_TRUNKS) {
    hd.mass(
      post + 0.5,
      11.6,
      JUNGLE_GROUND_TOP,
      0.28,
      0.72,
      hdMix(trunk, leafDark, 0.2),
      hdDarken(trunk, 0.72),
      hdDarken(trunk, 0.55),
    )
  }

  if (!night) {
    const parrot = hdHex(c.parrot)
    const px = jungleParrotX(elapsedMs)
    hd.stroke(px - 0.15, JUNGLE_PARROT_Y + 0.15, px - 1.15, JUNGLE_PARROT_Y - 0.45, Math.max(1.2, hd.cw * 0.12), parrot)
    hd.disk(hd.X(px + 0.35), hd.Y(JUNGLE_PARROT_Y + 0.4), Math.max(2.2, hd.cw * 0.4), parrot)
    hd.disk(
      hd.X(px + 1.05),
      hd.Y(JUNGLE_PARROT_Y + 0.28),
      Math.max(1.4, hd.cw * 0.18),
      hdMix(parrot, hdHex(c.flower), 0.45),
    )
  } else {
    const firefly = hdHex(c.firefly)
    for (const mote of jungleFireflies(elapsedMs)) {
      const r = mote.char === "*" ? Math.max(2, hd.cw * 0.2) : Math.max(1, hd.cw * 0.1)
      hd.disk(hd.X(mote.x + 0.5), hd.Y(mote.y + 0.5), r, firefly)
    }
  }

  const foot = hd.Y(JUNGLE_GROUND_TOP)
  hd.rect(0, foot, hd.w, hd.h, ground)
  hd.rect(0, foot, hd.w, foot + Math.max(2, hd.ch * 0.16), hdDarken(ground, 0.8))
  const fern = hdHex(c.fern)
  for (let x = 1; x < JUNGLE_COLUMNS; x += 7) {
    hd.blob(hd.X(x + 0.5), hd.Y(JUNGLE_GROUND_TOP + 0.85), hd.cw * 0.55, hd.ch * 0.42, fern, hdDarken(fern, 0.75))
  }
  const flower = hdHex(c.flower)
  for (const bloom of [6, 30, 54]) {
    hd.disk(hd.X(bloom + 0.5), hd.Y(JUNGLE_GROUND_TOP + 1.7), Math.max(2, hd.cw * 0.28), flower)
    hd.disk(
      hd.X(bloom + 0.5),
      hd.Y(JUNGLE_GROUND_TOP + 1.7),
      Math.max(1, hd.cw * 0.1),
      hdMix(flower, [255, 255, 255], 0.4),
    )
  }
  return hd.pixels
}
