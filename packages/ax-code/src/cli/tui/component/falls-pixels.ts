import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  FALLS_CLIFF_LEFT,
  FALLS_CLIFF_RIGHT,
  FALLS_COLORS,
  FALLS_COLUMNS,
  FALLS_CYCLE_MS,
  FALLS_FALLS,
  FALLS_GROUND_TOP,
  FALLS_MOON,
  FALLS_POOL_TOP,
  FALLS_ROWS,
  FALLS_STARS,
  fallsFireflies,
  fallsMist,
  fallsSkyRgb,
  fallsTick,
  type FallsStyle,
} from "./falls-view-model"

/**
 * Freeform HD falls. Shaded cliff masses, a bright waterfall, mist disks,
 * a moon halo, and fireflies come from the shared scene model. Pure and
 * deterministic: everything derives from `elapsedMs` and loops at 2400ms.
 * The left cliff's lit face stays the flat cliff color.
 */
export function renderFallsPixels(width: number, height: number, style: FallsStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, FALLS_COLUMNS, FALLS_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "falls-moon"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % FALLS_CYCLE_MS) / FALLS_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = FALLS_COLORS[style]
  const rock = hdHex(c.cliff)
  const rockShade = hdHex(c.cliffBg)
  const edge = hdDarken(rockShade, 0.78)
  const foam = hdHex(c.water)
  const flow = hdHex(c.waterBg)
  const mist = hdHex(c.mist)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const around = fallsSkyRgb(style, 0.15)

  hd.sky((t) => fallsSkyRgb(style, t))
  if (night) {
    const moon = hdMix(mist, hdHex(c.water), 0.35)
    hd.stars(FALLS_STARS, mist, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    hd.halo(hd.X(FALLS_MOON.x), hd.Y(FALLS_MOON.y), coreR, moon, hdMix(moon, rock, 0.4), around)
  }

  for (const cliff of [FALLS_CLIFF_LEFT, FALLS_CLIFF_RIGHT]) {
    const apex = (cliff.x0 + cliff.x1) / 2
    const half = (cliff.x1 - cliff.x0) / 2
    hd.mass(apex, cliff.top, FALLS_POOL_TOP, half * 0.9, half * 1.02, rock, rockShade, edge)
  }
  const falls = FALLS_FALLS
  hd.rect(hd.X(falls.x0), hd.Y(falls.top), hd.X(falls.x1 + 1), hd.Y(falls.base + 1), flow)
  const sway = (fallsTick(elapsed) - 5) * 0.07
  const streams: ReadonlyArray<readonly [number, number]> = [
    [0.7, 0.42],
    [2.2, 0.85],
    [4.1, 0.62],
    [6.4, 0.38],
  ]
  for (const [offset, radius] of streams) {
    hd.stroke(
      falls.x0 + offset,
      falls.top + 0.2,
      falls.x0 + offset + sway,
      falls.base + 0.9,
      Math.max(1.5, hd.cw * radius),
      foam,
    )
  }

  if (!night) {
    const bow = [hdHex(c.rainbow1), hdHex(c.rainbow2), hdHex(c.rainbow3)]
    for (let i = 0; i < 18; i++) {
      const t = i / 17
      const ang = Math.PI * (1.2 - t * 0.75)
      hd.disk(
        hd.X(50 + Math.cos(ang) * 7.5),
        hd.Y(14.6 + Math.sin(ang) * 2.4),
        Math.max(1.8, hd.cw * 0.55),
        bow[i % 3]!,
      )
    }
  }

  hd.water(FALLS_POOL_TOP, FALLS_GROUND_TOP, hdHex(c.pool), hdHex(c.poolBg), theta)
  hd.reflection((falls.x0 + falls.x1) / 2, FALLS_POOL_TOP, FALLS_GROUND_TOP, foam, theta, 3.2)
  if (night) hd.reflection(FALLS_MOON.x, FALLS_POOL_TOP, FALLS_GROUND_TOP, mist, theta, 2)

  for (const puff of fallsMist(elapsed)) {
    const radius = Math.max(2, hd.cw * (0.65 + (puff.x % 3) * 0.12))
    hd.disk(hd.X(puff.x + 0.5), hd.Y(puff.y + 0.45), radius, mist)
    hd.disk(hd.X(puff.x + 0.15), hd.Y(puff.y + 0.15), radius * 0.55, hdMix(mist, foam, 0.45))
  }

  hd.rect(0, hd.Y(FALLS_GROUND_TOP), hd.w, hd.h, hdHex(c.ground))
  const grass = hdHex(c.grass)
  for (let x = 1; x < FALLS_COLUMNS; x += 6) {
    hd.rect(hd.X(x + 0.25), hd.Y(FALLS_GROUND_TOP + 0.7), hd.X(x + 0.55), hd.Y(FALLS_GROUND_TOP + 1.35), grass)
  }

  if (night) {
    const glow = hdHex(c.glow)
    for (const fly of fallsFireflies(elapsed)) {
      hd.disk(hd.X(fly.x + 0.5), hd.Y(fly.y + 0.5), Math.max(2.2, hd.cw * 0.45), hdMix(glow, around, 0.55))
      hd.disk(hd.X(fly.x + 0.5), hd.Y(fly.y + 0.5), Math.max(1.2, hd.cw * 0.2), glow)
    }
  }

  for (let i = 0; i < 8; i++) {
    const x = falls.x0 + ((i * 3 + fallsTick(elapsed)) % 10)
    const y = falls.base + 0.4 + (i % 3) * 0.35
    hd.disk(hd.X(x), hd.Y(y), Math.max(1.2, hd.cw * 0.24), hdMix(foam, mist, i % 2 === 0 ? 0.2 : 0.6))
  }
  return hd.pixels
}
