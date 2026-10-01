import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  CANYON_COLORS,
  CANYON_COLUMNS,
  CANYON_CYCLE_MS,
  CANYON_FIRE,
  CANYON_FLOOR_TOP,
  CANYON_MOON,
  CANYON_RIVER_TOP,
  CANYON_ROWS,
  CANYON_STARS,
  CANYON_STRATA_TOP,
  CANYON_SUN,
  canyonEagle,
  canyonFlicker,
  canyonSkyRgb,
  canyonTick,
  type CanyonStyle,
} from "./canyon-view-model"

/**
 * Freeform HD canyon. Sine-edged strata, a rippled river, a soaring eagle,
 * and a night campfire come from the shared scene model. Pure and
 * deterministic: everything derives from `elapsedMs` and loops at 2400ms.
 * The top strata sample stays on the unshaded first band.
 */
export function renderCanyonPixels(width: number, height: number, style: CanyonStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, CANYON_COLUMNS, CANYON_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "canyon-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % CANYON_CYCLE_MS) / CANYON_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = CANYON_COLORS[style]
  const strata = [hdHex(c.strata1), hdHex(c.strata2), hdHex(c.strata3)] as const
  const rim = hdHex(c.rim)
  const rimShade = hdHex(c.rimBg)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const orb = night ? CANYON_MOON : CANYON_SUN
  const core = night ? hdHex(c.glint) : hdHex(c.sun)
  const body = night ? hdHex(c.stone) : hdMix(hdHex(c.sun), hdHex(c.strata3), 0.35)
  const around = canyonSkyRgb(style, orb.y / CANYON_ROWS)
  const tick = canyonTick(elapsed)

  hd.sky((t) => canyonSkyRgb(style, t))
  if (night) hd.stars(CANYON_STARS, hdHex(c.glint), (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
  hd.halo(hd.X(orb.x), hd.Y(orb.y), coreR, core, body, around)

  const band = (CANYON_RIVER_TOP - CANYON_STRATA_TOP) / strata.length
  const y0 = Math.floor(hd.Y(CANYON_STRATA_TOP - 0.35))
  const y1 = Math.ceil(hd.Y(CANYON_RIVER_TOP))
  for (let y = Math.max(0, y0); y < Math.min(hd.h, y1); y++) {
    const sceneY = (y + 0.5) / hd.ch
    for (let x = 0; x < hd.w; x++) {
      const sceneX = (x + 0.5) / hd.cw
      const wave = Math.sin(sceneX * 0.55) * 0.42 + Math.cos(sceneX * 0.27) * 0.28 + Math.sin(sceneX * 1.3) * 0.12
      const depth = sceneY - CANYON_STRATA_TOP + wave
      if (depth < 0) continue
      const index = Math.max(0, Math.min(strata.length - 1, Math.floor(depth / band)))
      const color = strata[index]!
      const face = 48 + Math.sin(sceneY * 0.65) * 3
      const speck = (x * 13 + y * 17) % 47 === 0 && sceneX > 8 && sceneX < 68
      hd.set(x, y, speck ? hdDarken(color, 0.9) : sceneX < face ? color : hdDarken(color, 0.84))
    }
  }
  hd.mass(3.2, CANYON_STRATA_TOP, CANYON_RIVER_TOP, 2.2, 4.4, rim, rimShade, hdDarken(rimShade, 0.75))
  hd.mass(CANYON_COLUMNS - 3.2, CANYON_STRATA_TOP, CANYON_RIVER_TOP, 2.2, 4.4, rim, rimShade, hdDarken(rimShade, 0.75))

  hd.water(CANYON_RIVER_TOP, CANYON_FLOOR_TOP, hdHex(c.water), hdHex(c.riverBg), theta)
  hd.reflection(orb.x, CANYON_RIVER_TOP, CANYON_FLOOR_TOP, hdHex(c.glint), theta, 2.4)
  for (let i = 0; i < 5; i++) {
    const x = (i * 15 + tick * 2) % CANYON_COLUMNS
    hd.disk(hd.X(x + 0.5), hd.Y(CANYON_RIVER_TOP + 0.7), Math.max(1.2, hd.cw * 0.22), hdHex(c.glint))
  }

  hd.rect(0, hd.Y(CANYON_FLOOR_TOP), hd.w, hd.h, hdHex(c.ground))
  const stone = hdHex(c.stone)
  hd.disk(hd.X(CANYON_FIRE.x - 1.3), hd.Y(CANYON_FIRE.y + 1.15), Math.max(1.5, hd.cw * 0.34), stone)
  hd.disk(hd.X(CANYON_FIRE.x + 2.5), hd.Y(CANYON_FIRE.y + 1.15), Math.max(1.5, hd.cw * 0.34), stone)
  if (night && canyonFlicker(elapsed)) {
    const flame = hdHex(c.flame)
    hd.halo(
      hd.X(CANYON_FIRE.x + 1),
      hd.Y(CANYON_FIRE.y + 0.25),
      Math.max(2, coreR * 0.5),
      flame,
      hdMix(flame, hdHex(c.sun), 0.4),
      around,
    )
  } else {
    hd.disk(hd.X(CANYON_FIRE.x + 1), hd.Y(CANYON_FIRE.y + 0.45), Math.max(1.4, hd.cw * 0.3), hdHex(c.ash))
  }

  const eagle = canyonEagle(elapsed)
  const wing = tick % 2 === 0 ? -0.32 : 0.28
  const feather = hdHex(c.eagle)
  hd.stroke(eagle.x - 1.3, eagle.y + wing, eagle.x + 0.15, eagle.y, Math.max(1.2, hd.cw * 0.2), feather)
  hd.stroke(eagle.x + 0.15, eagle.y, eagle.x + 1.55, eagle.y + wing, Math.max(1.2, hd.cw * 0.2), feather)
  hd.disk(hd.X(eagle.x + 0.15), hd.Y(eagle.y), Math.max(1.3, hd.cw * 0.24), feather)

  const spark = night ? hdHex(c.flame) : hdHex(c.strata3)
  for (let i = 0; i < 8; i++) {
    const x = 8 + ((i * 9 + Math.floor(phase * 20)) % 60)
    const y = 5.2 + (i % 3) * 0.55 + Math.sin(theta + i) * 0.15
    hd.disk(hd.X(x), hd.Y(y), Math.max(1, hd.cw * 0.16), spark)
  }
  return hd.pixels
}
