import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  LIGHTHOUSE_CLIFF_TOP,
  LIGHTHOUSE_COLORS,
  LIGHTHOUSE_COLUMNS,
  LIGHTHOUSE_CYCLE_MS,
  LIGHTHOUSE_LAMP,
  LIGHTHOUSE_MOON,
  LIGHTHOUSE_ROWS,
  LIGHTHOUSE_SEA_TOP,
  LIGHTHOUSE_STARS,
  LIGHTHOUSE_TOWER,
  lighthouseBeam,
  lighthouseGulls,
  lighthouseSkyRgb,
  lighthouseSurf,
  type LighthouseStyle,
} from "./lighthouse-view-model"

/**
 * Freeform HD lighthouse. A tapered striped tower, lantern halo, rotating
 * beam, chalk headland, and rippled sea come from the shared scene model.
 * Pure and deterministic: everything derives from `elapsedMs` and loops at
 * 2400ms. The chalk band at the tower top is painted last among the stone.
 */
export function renderLighthousePixels(
  width: number,
  height: number,
  style: LighthouseStyle,
  elapsedMs: number,
): Buffer {
  const hd = createHdCanvas(width, height, LIGHTHOUSE_COLUMNS, LIGHTHOUSE_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "lighthouse-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % LIGHTHOUSE_CYCLE_MS) / LIGHTHOUSE_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = LIGHTHOUSE_COLORS[style]
  const chalk = hdHex(c.tower)
  const stripe = hdHex(c.stripe)
  const lamp = hdHex(c.lamp)
  const glass = hdHex(c.glass)
  const cliffLit = hdHex(c.cliff)
  const cliffShade = hdHex(c.cliffDark)
  const foam = hdHex(c.foam)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const center = LIGHTHOUSE_TOWER.x + 0.5
  const around = lighthouseSkyRgb(style, LIGHTHOUSE_LAMP.y / LIGHTHOUSE_ROWS)

  const beam = (originX: number, originY: number, angle: number, color: RGB, dim: RGB) => {
    for (let k = -3; k <= 3; k++) {
      const spread = angle + k * 0.11
      const len = 20 - Math.abs(k) * 2.2
      hd.stroke(
        originX,
        originY,
        originX + Math.cos(spread) * len,
        originY + Math.sin(spread) * len,
        Math.max(1.3, (3.4 - Math.abs(k)) * hd.cw * 0.2),
        k === 0 ? color : dim,
      )
    }
  }

  hd.sky((t) => lighthouseSkyRgb(style, t))
  const surf = lighthouseSurf(elapsed)
  if (night) {
    const moon = hdHex(c.foam)
    const sky = lighthouseSkyRgb(style, LIGHTHOUSE_MOON.y / LIGHTHOUSE_ROWS)
    hd.stars(LIGHTHOUSE_STARS, moon, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    hd.halo(hd.X(LIGHTHOUSE_MOON.x), hd.Y(LIGHTHOUSE_MOON.y), coreR, moon, hdMix(moon, hdHex(c.cloud), 0.35), sky)
    const quarter = lighthouseBeam(elapsed)
    const angles = [0, Math.PI / 2.35, Math.PI, -Math.PI / 3.1] as const
    beam(center, LIGHTHOUSE_LAMP.y - 0.7, angles[quarter] ?? 0, glass, hdMix(glass, around, 0.55))
  } else {
    const cloud = hdHex(c.cloud)
    for (let x = 4; x < LIGHTHOUSE_COLUMNS; x += 25) {
      hd.puff((x + surf * 2) % LIGHTHOUSE_COLUMNS, 1 + (x % 3), 4, cloud)
    }
  }

  const cliffStart = Math.floor(hd.Y(LIGHTHOUSE_CLIFF_TOP - 1))
  const cliffEnd = Math.ceil(hd.Y(LIGHTHOUSE_SEA_TOP))
  for (let y = Math.max(0, cliffStart); y < Math.min(hd.h, cliffEnd); y++) {
    const sceneY = (y + 0.5) / hd.ch
    const reach = 23.2 + Math.sin(sceneY * 2.1) * 1.25 + Math.cos(sceneY * 0.7) * 0.55
    for (let x = 0; x < hd.w; x++) {
      const sceneX = (x + 0.5) / hd.cw
      if (sceneX > reach) continue
      const crack = Math.sin(sceneX * 1.6 + sceneY * 2.4) > 0.8
      hd.set(x, y, crack ? hdDarken(cliffShade, 0.88) : sceneX < reach * 0.56 ? cliffLit : cliffShade)
    }
  }
  hd.mass(
    19.5,
    LIGHTHOUSE_CLIFF_TOP - 1.5,
    LIGHTHOUSE_SEA_TOP,
    1.1,
    3.4,
    cliffLit,
    cliffShade,
    hdDarken(cliffShade, 0.8),
  )

  hd.water(LIGHTHOUSE_SEA_TOP, LIGHTHOUSE_ROWS, hdHex(c.sea), hdHex(c.seaDeep), theta)
  if (night) hd.reflection(LIGHTHOUSE_MOON.x, LIGHTHOUSE_SEA_TOP, LIGHTHOUSE_ROWS, foam, theta, 2.2)
  for (let i = 0; i < 16; i++) {
    const x = (i * 5 + surf * 1.4) % LIGHTHOUSE_COLUMNS
    const y = LIGHTHOUSE_SEA_TOP + 0.7 + (i % 4) * 0.85
    hd.disk(hd.X(x), hd.Y(y), Math.max(1.4, hd.cw * (i % 3 === 0 ? 0.55 : 0.32)), foam)
  }

  hd.mass(center, LIGHTHOUSE_TOWER.top, LIGHTHOUSE_TOWER.base + 0.15, 2.3, 3.45, chalk, hdDarken(chalk, 0.78), stripe)
  hd.mass(center, LIGHTHOUSE_LAMP.y - 2.15, LIGHTHOUSE_LAMP.y - 1.05, 0.15, 1.35, lamp, hdDarken(lamp, 0.8), lamp)
  hd.rect(hd.X(center - 1.85), hd.Y(LIGHTHOUSE_LAMP.y - 0.2), hd.X(center + 1.85), hd.Y(LIGHTHOUSE_LAMP.y + 0.85), lamp)
  hd.halo(
    hd.X(center),
    hd.Y(LIGHTHOUSE_LAMP.y - 0.65),
    Math.max(2, coreR * (night ? 0.62 : 0.38)),
    night ? glass : hdMix(glass, chalk, 0.45),
    hdMix(glass, around, night ? 0.25 : 0.6),
    around,
  )

  // Alternating bands repaint the tower so the top chalk sample stays exact.
  for (let row = LIGHTHOUSE_TOWER.top; row <= LIGHTHOUSE_TOWER.base; row++) {
    const band = Math.floor((row - LIGHTHOUSE_TOWER.top) / 2) % 2 === 1
    const t = (row - LIGHTHOUSE_TOWER.top) / Math.max(1, LIGHTHOUSE_TOWER.base - LIGHTHOUSE_TOWER.top)
    const half = 1.95 + t * 1.05
    hd.rect(hd.X(center - half), hd.Y(row), hd.X(center + half), hd.Y(row + 1), band ? stripe : chalk)
  }
  hd.rect(
    hd.X(center - 2.6),
    hd.Y(LIGHTHOUSE_TOWER.base + 0.2),
    hd.X(center + 2.6),
    hd.Y(LIGHTHOUSE_CLIFF_TOP + 0.25),
    cliffShade,
  )

  const gull = hdHex(c.gull)
  for (const bird of lighthouseGulls(elapsed)) {
    const flap = Math.sin(theta * 2 + bird.x) * 0.28
    hd.stroke(bird.x - 0.7, bird.y + flap, bird.x, bird.y, Math.max(1.1, hd.cw * 0.16), gull)
    hd.stroke(bird.x, bird.y, bird.x + 0.7, bird.y + flap, Math.max(1.1, hd.cw * 0.16), gull)
    hd.disk(hd.X(bird.x), hd.Y(bird.y), Math.max(1.2, hd.cw * 0.18), gull)
  }
  return hd.pixels
}
