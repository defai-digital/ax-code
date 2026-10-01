import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  REEF_COLUMNS,
  REEF_COLORS,
  REEF_CORALS,
  REEF_CYCLE_MS,
  REEF_KELP,
  REEF_RAYS,
  REEF_ROWS,
  REEF_SAND_TOP,
  reefBubbles,
  reefFish,
  reefPlankton,
  reefRipple,
  reefSkyRgb,
  reefSway,
  type ReefStyle,
} from "./reef-view-model"

/**
 * Freeform HD renderer. Water gradient, surface halo, coral blobs, fish,
 * and caustic disks come from the shared scene model. Pure: every pixel
 * derives from `elapsedMs`.
 */
export function renderReefPixels(width: number, height: number, style: ReefStyle, elapsedMs: number): Buffer {
  let w = Math.max(0, Math.floor(width))
  let h = Math.max(0, Math.floor(height))
  if (w > 0 && h > 0) {
    const scale = Math.min(1, 1920 / w, 1080 / h)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  const hd = createHdCanvas(w, h, REEF_COLUMNS, REEF_ROWS)
  if (w === 0 || h === 0) return hd.pixels
  const night = style === "reef-night"
  const c = REEF_COLORS[style]
  const water = hdHex(c.water)
  const deep = hdDarken(hdHex(c.skyBottom), 0.9)
  const coral = hdHex(c.coral)
  const coralDark = hdHex(c.coralDark)
  const polyp = hdHex(c.polyp)
  const bubble = hdHex(c.bubble)
  const ray = hdHex(c.ray)
  const kelp = hdHex(c.kelp)
  const sand = hdHex(c.sand)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const phase = ((Math.max(0, elapsedMs) % REEF_CYCLE_MS) / REEF_CYCLE_MS) * Math.PI * 2
  const glide = reefRipple(elapsedMs)

  hd.sky((t) => reefSkyRgb(style, t))
  const around = reefSkyRgb(style, 0.04)
  if (night) hd.halo(hd.X(58), hd.Y(1.6), coreR, polyp, hdMix(ray, around, 0.4), around)
  else hd.halo(hd.X(38), hd.Y(1.15), coreR, ray, hdMix(ray, water, 0.25), around)

  hd.water(0.7, REEF_SAND_TOP, water, deep, phase)
  if (!night) {
    for (const shaft of REEF_RAYS) {
      hd.stroke(shaft, 1.3, shaft + 3.4, 14.2, Math.max(1.5, hd.cw * 0.16), hdMix(ray, bubble, 0.2))
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = (i * 9 + glide * 4) % REEF_COLUMNS
    hd.disk(hd.X(x + 0.5), hd.Y(2.4 + (i % 3) * 1.5), Math.max(1.5, hd.cw * 0.22), hdMix(ray, bubble, 0.35))
  }
  for (let x = glide; x < REEF_COLUMNS; x += 3) {
    hd.disk(hd.X(x + 0.5), hd.Y(0.45), Math.max(1.3, hd.cw * 0.14), bubble)
  }
  for (const risen of reefBubbles(elapsedMs)) {
    const cx = hd.X(risen.x + 0.5)
    const cy = hd.Y(risen.y + 0.5)
    hd.disk(cx, cy, Math.max(1.8, hd.cw * 0.2), bubble)
    hd.disk(cx - hd.cw * 0.05, cy - hd.ch * 0.04, Math.max(1, hd.cw * 0.08), hdMix(bubble, [255, 255, 255], 0.45))
  }
  if (night) {
    const plankton = hdHex(c.plankton)
    for (const mote of reefPlankton(elapsedMs)) {
      hd.disk(hd.X(mote.x + 0.5), hd.Y(mote.y + 0.5), Math.max(1.2, hd.cw * 0.1), plankton)
    }
  }

  for (const frond of REEF_KELP) {
    const tip = reefSway(elapsedMs, frond)
    hd.stroke(frond + 0.5, 19.6, frond + tip + 0.5, 16.1, Math.max(1.2, hd.cw * 0.1), kelp)
    hd.disk(hd.X(frond + tip + 0.5), hd.Y(16.05), Math.max(2, hd.cw * 0.24), hdMix(kelp, polyp, 0.25))
  }
  REEF_CORALS.forEach((head, i) => {
    const tall = i % 2 === 0
    hd.blob(
      hd.X(head + 0.5),
      hd.Y(tall ? 17.5 : 18.3),
      hd.cw * (tall ? 1.8 : 1.4),
      hd.ch * (tall ? 1.55 : 1.15),
      coral,
      polyp,
    )
    hd.blob(hd.X(head + 0.5), hd.Y(19.7), hd.cw * 1.2, hd.ch * 0.9, coralDark, hdDarken(coral, 0.8))
    hd.disk(hd.X(head - 1.7), hd.Y(18.35), Math.max(1.7, hd.cw * 0.2), polyp)
    hd.disk(hd.X(head + 2.15), hd.Y(18.55), Math.max(1.7, hd.cw * 0.2), polyp)
  })
  if (!night) {
    const fish = hdHex(c.fish)
    for (const swimmer of reefFish(elapsedMs)) {
      hd.stroke(swimmer.x + 0.15, swimmer.y + 0.5, swimmer.x + 1.05, swimmer.y + 0.12, Math.max(1.1, hd.cw * 0.1), fish)
      hd.stroke(swimmer.x + 0.15, swimmer.y + 0.5, swimmer.x + 1.05, swimmer.y + 0.88, Math.max(1.1, hd.cw * 0.1), fish)
      hd.disk(hd.X(swimmer.x + 1.7), hd.Y(swimmer.y + 0.5), Math.max(2.1, hd.cw * 0.4), fish)
      hd.disk(hd.X(swimmer.x + 2.35), hd.Y(swimmer.y + 0.42), Math.max(1.2, hd.cw * 0.14), hdDarken(fish, 0.75))
    }
  }

  const shore = hd.Y(REEF_SAND_TOP)
  hd.rect(0, shore, hd.w, hd.h, sand)
  hd.rect(0, shore, hd.w, shore + Math.max(2, hd.ch * 0.14), hdDarken(sand, 0.86))
  const shell = hdHex(c.shell)
  for (const clam of [12, 34, 58]) {
    hd.disk(hd.X(clam + 0.5), hd.Y(REEF_SAND_TOP + 0.45), Math.max(2, hd.cw * 0.28), shell)
  }
  hd.disk(hd.X(46.5), hd.Y(REEF_SAND_TOP + 1.15), Math.max(1.6, hd.cw * 0.18), shell)
  return hd.pixels
}
