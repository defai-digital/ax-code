import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  ISLANDS,
  ISLANDS_CLOUDS,
  ISLANDS_COLUMNS,
  ISLANDS_COLORS,
  ISLANDS_DUSK_SUN,
  ISLANDS_FALLS,
  ISLANDS_ROWS,
  ISLANDS_SEA_TOP,
  ISLANDS_SUN,
  islandsBirds,
  islandsFireflies,
  islandsFlow,
  islandsSkyRgb,
  type IslandsStyle,
} from "./islands-view-model"

/**
 * Freeform HD renderer. Sun halo, cloud puffs, shaded floating masses,
 * waterfall strokes, and a still deep-water gradient come from the shared
 * scene model. Pure: every pixel derives from `elapsedMs`.
 */
export function renderIslandsPixels(width: number, height: number, style: IslandsStyle, elapsedMs: number): Buffer {
  let w = Math.max(0, Math.floor(width))
  let h = Math.max(0, Math.floor(height))
  if (w > 0 && h > 0) {
    const scale = Math.min(1, 1920 / w, 1080 / h)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  const hd = createHdCanvas(w, h, ISLANDS_COLUMNS, ISLANDS_ROWS)
  if (w === 0 || h === 0) return hd.pixels
  const night = style === "islands-dusk"
  const c = ISLANDS_COLORS[style]
  const grass = hdHex(c.grass)
  const rock = hdHex(c.rock)
  const rockDark = hdHex(c.rockDark)
  const falls = hdHex(c.falls)
  const shimmer = hdHex(c.shimmer)
  const sun = hdHex(c.sun)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const around = islandsSkyRgb(style, night ? 0.55 : 0.08)
  const flow = islandsFlow(elapsedMs)

  hd.sky((t) => islandsSkyRgb(style, t))
  if (!night) hd.halo(hd.X(ISLANDS_SUN.x), hd.Y(ISLANDS_SUN.y), coreR, sun, hdMix(sun, around, 0.35), around)
  for (const [cx, cy] of ISLANDS_CLOUDS) hd.puff(cx, cy, 6, hdHex(c.cloud))

  for (const [x0, x1, top] of ISLANDS) {
    const mid = (x0 + x1) / 2
    const half = (x1 - x0 + 1) / 2
    hd.mass(
      mid,
      top + 0.35,
      top + 5.15,
      half * 0.96,
      Math.max(0.8, half * 0.22),
      rock,
      rockDark,
      hdDarken(rockDark, 0.78),
    )
    hd.blob(hd.X(mid), hd.Y(top + 0.28), hd.cw * half * 0.98, hd.ch * 0.48, grass, hdDarken(grass, 0.72))
  }
  for (const [fallX, fallTop] of ISLANDS_FALLS) {
    const mouth = fallTop + (flow % 2) * 0.4
    hd.stroke(fallX + 0.45, mouth, fallX + 0.45, ISLANDS_SEA_TOP, Math.max(1.3, hd.cw * 0.13), falls)
    hd.stroke(
      fallX + 0.85,
      mouth + 0.3,
      fallX + 0.2,
      ISLANDS_SEA_TOP,
      Math.max(1, hd.cw * 0.08),
      hdMix(falls, shimmer, 0.45),
    )
  }
  if (night) {
    hd.halo(hd.X(ISLANDS_DUSK_SUN.x), hd.Y(ISLANDS_DUSK_SUN.y), coreR, sun, hdMix(sun, around, 0.3), around)
  }

  // Phase 0: the ripple is spatial only, so a deep sample stays put.
  hd.water(ISLANDS_SEA_TOP, ISLANDS_ROWS, hdHex(c.sea), hdHex(c.seaDeep), 0)
  const sunX = night ? ISLANDS_DUSK_SUN.x : ISLANDS_SUN.x
  hd.reflection(sunX, ISLANDS_SEA_TOP, ISLANDS_SEA_TOP + 1.55, shimmer, 0, 3)
  for (let x = flow; x < ISLANDS_COLUMNS; x += 8) {
    hd.disk(hd.X(x + 0.5), hd.Y(ISLANDS_SEA_TOP + 0.35), Math.max(1.5, hd.cw * 0.2), shimmer)
  }
  for (const [fallX] of ISLANDS_FALLS) {
    hd.disk(
      hd.X(fallX + 0.5),
      hd.Y(ISLANDS_SEA_TOP + 0.2),
      Math.max(2, hd.cw * 0.28) + (flow % 3),
      hdMix(shimmer, falls, 0.35),
    )
  }

  if (night) {
    const firefly = hdHex(c.firefly)
    for (const mote of islandsFireflies(elapsedMs)) {
      const r = mote.char === "*" ? Math.max(2, hd.cw * 0.22) : Math.max(1, hd.cw * 0.1)
      hd.disk(hd.X(mote.x + 0.5), hd.Y(mote.y + 0.5), r, firefly)
    }
  } else {
    const bird = hdHex(c.bird)
    for (const b of islandsBirds(elapsedMs)) {
      hd.disk(hd.X(b.x + 0.5), hd.Y(b.y + 0.55), Math.max(1.4, hd.cw * 0.16), bird)
      hd.disk(hd.X(b.x + 0.15), hd.Y(b.y + 0.3), Math.max(1, hd.cw * 0.11), bird)
      hd.disk(hd.X(b.x + 0.85), hd.Y(b.y + 0.3), Math.max(1, hd.cw * 0.11), bird)
    }
  }
  return hd.pixels
}
