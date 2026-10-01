import {
  BALLOONS_CLOUDS,
  BALLOONS_COLUMNS,
  BALLOONS_COTTAGES,
  BALLOONS_FAR,
  BALLOONS_GROUND_TOP,
  BALLOONS_MOON,
  BALLOONS_ROWS,
  BALLOONS_SCRUB,
  BALLOONS_SPIRES,
  BALLOONS_STARS,
  BALLOONS_TETHER,
  BALLOONS_COLORS,
  balloonsAscend,
  balloonsBirds,
  balloonsCloudDrift,
  balloonsFlame,
  balloonsSkyRgb,
  type BalloonsStyle,
} from "./balloons-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"

/**
 * Freeform HD renderer. A haloed moon, drifting valley clouds, tall balloon
 * ellipses, fairy chimneys, and cottages come from the shared scene model.
 * Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderBalloonsPixels(width: number, height: number, style: BalloonsStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, BALLOONS_COLUMNS, BALLOONS_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "balloons-night"
  const c = BALLOONS_COLORS[style]
  const flameOn = balloonsFlame(elapsedMs)
  const drift = balloonsCloudDrift(elapsedMs)
  const rock = hdHex(c.rock)
  const house = hdHex(c.house)
  const basket = hdHex(c.basket)
  const envelope = hdHex(c.envelope)
  const envelopeAlt = hdHex(c.envelopeAlt)
  const flame = hdHex(c.flame)
  const glow = hdHex(c.glow)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)

  hd.sky((t) => balloonsSkyRgb(style, t))
  if (night) {
    hd.stars(BALLOONS_STARS, hdHex(c.moon), (index) => (Math.floor(Math.max(0, elapsedMs) / 400) + index) % 3 === 0)
  }
  const [cloud0, cloud1] = BALLOONS_CLOUDS
  hd.puff(cloud0![0] + drift, cloud0![1], cloud0![2], hdHex(c.cloud))
  hd.puff(cloud1![0] + ((drift + 2) % 5), cloud1![1], cloud1![2], hdHex(c.cloud))
  const moon = hdHex(c.moon)
  const around = balloonsSkyRgb(style, BALLOONS_MOON.y / BALLOONS_ROWS)
  // The sampled moon pixel sits on this core, not the mixed outer glow.
  hd.halo(hd.X(BALLOONS_MOON.x + 0.5), hd.Y(BALLOONS_MOON.y + 0.5), coreR, moon, hdMix(moon, around, 0.42), around)

  for (const distant of BALLOONS_FAR) {
    hd.blob(hd.X(distant.x + 0.5), hd.Y(distant.y + 0.7), hd.cw * 0.7, hd.ch * 0.85, hdHex(c.far))
    hd.stroke(distant.x + 0.5, distant.y + 1.3, distant.x + 0.5, distant.y + 2.1, Math.max(1, hd.cw * 0.08), basket)
  }
  for (const swift of balloonsBirds(elapsedMs)) {
    hd.disk(hd.X(swift.x + 0.5), hd.Y(swift.y + 0.5), Math.max(1.4, Math.min(hd.cw, hd.ch) * 0.14), basket)
  }
  for (const spire of BALLOONS_SPIRES) {
    hd.mass(
      spire + 0.5,
      BALLOONS_GROUND_TOP - 4,
      BALLOONS_GROUND_TOP,
      0.35,
      1.35,
      rock,
      hdDarken(rock, 0.75),
      hdDarken(rock, 0.6),
    )
  }

  const tether = BALLOONS_TETHER
  hd.blob(hd.X(tether.x + 0.5), hd.Y(tether.top + 0.8), hd.cw * 1.7, hd.ch * 1.15, envelope, hdDarken(envelope, 0.82))
  hd.disk(hd.X(tether.x), hd.Y(tether.top + 0.35), Math.max(1.6, hd.cw * 0.18), hdMix(envelope, [255, 255, 255], 0.45))
  hd.rect(hd.X(tether.x - 0.2), hd.Y(tether.top + 1.7), hd.X(tether.x + 1.2), hd.Y(tether.top + 2.3), basket)

  for (const balloon of balloonsAscend(elapsedMs)) {
    const skin = balloon.alt ? envelopeAlt : envelope
    const cx = hd.X(balloon.x + 0.5)
    const cy = hd.Y(balloon.y + 1.35)
    const rx = hd.cw * 1.65
    const ry = hd.ch * 2.05
    hd.blob(cx, cy, rx, ry, skin, hdDarken(skin, 0.8))
    hd.blob(cx, cy, rx * 0.28, ry * 0.9, hdMix(skin, [255, 255, 255], 0.28))
    hd.disk(
      hd.X(balloon.x - 0.15),
      hd.Y(balloon.y + 0.55),
      Math.max(1.8, hd.cw * 0.22),
      hdMix(skin, [255, 255, 255], 0.55),
    )
    hd.rect(hd.X(balloon.x - 0.35), hd.Y(balloon.y + 3.2), hd.X(balloon.x + 1.35), hd.Y(balloon.y + 3.9), basket)
    if (flameOn) {
      hd.disk(hd.X(balloon.x + 0.5), hd.Y(balloon.y + 2.95), Math.max(2, hd.cw * 0.24), flame)
      hd.disk(hd.X(balloon.x - 0.7), hd.Y(balloon.y + 3.55), Math.max(1.2, hd.cw * 0.12), glow)
      hd.disk(hd.X(balloon.x + 1.7), hd.Y(balloon.y + 3.55), Math.max(1.2, hd.cw * 0.12), glow)
    }
  }

  hd.rect(0, hd.Y(BALLOONS_GROUND_TOP), hd.w, hd.h, hdHex(c.ground))
  const scrub = hdHex(c.scrub)
  for (const tuft of BALLOONS_SCRUB) {
    hd.blob(hd.X(tuft + 0.8), hd.Y(BALLOONS_GROUND_TOP + 1.15), hd.cw * 1.1, hd.ch * 0.38, scrub, hdDarken(scrub, 0.8))
  }
  for (let x = 2; x < BALLOONS_COLUMNS; x += 6) {
    hd.disk(hd.X(x + 0.5), hd.Y(BALLOONS_GROUND_TOP + 3.45), Math.max(1.2, hd.cw * 0.12), scrub)
  }
  for (const cottage of BALLOONS_COTTAGES) {
    hd.mass(cottage + 1, 16.35, 17.15, 0.2, 1.25, house, hdDarken(house, 0.78), hdDarken(house, 0.65))
    hd.rect(hd.X(cottage), hd.Y(17), hd.X(cottage + 2), hd.Y(19), house)
  }
  return hd.pixels
}
