import {
  BRANDENBURG_COLUMNS,
  BRANDENBURG_FLAGS,
  BRANDENBURG_GROUND_TOP,
  BRANDENBURG_LINTEL,
  BRANDENBURG_MOON,
  BRANDENBURG_PILLARS,
  BRANDENBURG_PLAZA_LAMPS,
  BRANDENBURG_ROWS,
  BRANDENBURG_SHAFT_BASE,
  BRANDENBURG_SHAFT_TOP,
  BRANDENBURG_STARS,
  BRANDENBURG_SUN,
  BRANDENBURG_TOURISTS,
  BRANDENBURG_TREES,
  BRANDENBURG_COLORS,
  brandenburgDoves,
  brandenburgLamp,
  brandenburgSkyRgb,
  brandenburgWave,
  type BrandenburgStyle,
} from "./brandenburg-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"

/**
 * Freeform HD renderer. Gradient sky, a three-layer moon or dawn sun,
 * Tiergarten canopies, waving flags, a shaded quadriga, fluted columns,
 * breathing lamps, and plaza traffic are painted from the shared scene
 * model. Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderBrandenburgPixels(
  width: number,
  height: number,
  style: BrandenburgStyle,
  elapsedMs: number,
): Buffer {
  const hd = createHdCanvas(width, height, BRANDENBURG_COLUMNS, BRANDENBURG_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "brandenburg-night"
  const c = BRANDENBURG_COLORS[style]
  const wave = brandenburgWave(elapsedMs)
  const lampBright = brandenburgLamp(elapsedMs)
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const relief = hdHex(c.relief)
  const tree = hdHex(c.tree)
  const lamp = hdHex(c.lamp)
  const crowd = hdHex(c.crowd)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)

  hd.sky((t) => brandenburgSkyRgb(style, t))
  if (night) {
    hd.stars(BRANDENBURG_STARS, hdHex(c.moon), (index) => (Math.floor(Math.max(0, elapsedMs) / 400) + index) % 3 === 0)
  }
  const orb = night ? BRANDENBURG_MOON : BRANDENBURG_SUN
  const orbCore = hdHex(c.moon)
  const around = brandenburgSkyRgb(style, orb.y / BRANDENBURG_ROWS)
  hd.halo(hd.X(orb.x), hd.Y(orb.y + 0.4), coreR, orbCore, hdMix(orbCore, around, 0.35), around)

  for (const trunk of BRANDENBURG_TREES) {
    hd.blob(hd.X(trunk + 0.4), hd.Y(7.2), hd.cw * 2.3, hd.ch * 1.35, tree, hdDarken(tree, 0.72))
    hd.blob(hd.X(trunk - 0.8), hd.Y(7.8), hd.cw * 1.5, hd.ch * 0.9, tree, hdDarken(tree, 0.78))
    hd.stroke(trunk + 0.5, 9.2, trunk + 0.5, 12, Math.max(1.4, hd.cw * 0.16), hdDarken(tree, 0.62))
  }
  for (const bird of brandenburgDoves(elapsedMs)) {
    hd.disk(hd.X(bird.x + 0.5), hd.Y(bird.y + 0.5), Math.max(1.4, Math.min(hd.cw, hd.ch) * 0.16), crowd)
  }

  const flagShift = wave === 0 ? 0 : wave === 1 ? 0.28 : -0.28
  for (const flag of BRANDENBURG_FLAGS) {
    hd.stroke(flag.x + 0.25, flag.y, flag.x + 0.25, flag.y + 3.2, Math.max(1.2, hd.cw * 0.1), stoneDark)
    hd.blob(hd.X(flag.x + 2.3), hd.Y(flag.y + 0.45 + flagShift), hd.cw * 1.35, hd.ch * 0.32, hdHex(c.flag))
    hd.blob(hd.X(flag.x + 2.3), hd.Y(flag.y + 1.05 - flagShift), hd.cw * 1.35, hd.ch * 0.28, hdHex(c.flagWave))
  }

  hd.disk(hd.X(37.5), hd.Y(4.35), Math.max(2, hd.cw * 0.28), hdHex(c.victory))
  hd.stroke(34.2, 5.6, 40.8, 5.6, Math.max(1.6, hd.cw * 0.14), stoneDark)
  hd.stroke(35.2, 6.3, 33.4, 6.9, Math.max(1.3, hd.cw * 0.1), stone)
  hd.stroke(39.8, 6.3, 41.6, 6.9, Math.max(1.3, hd.cw * 0.1), stone)
  hd.mass(37.5, 5.1, 6.9, 1.1, 2.4, stone, stoneDark, relief)
  hd.mass(38, 7.15, BRANDENBURG_LINTEL + 0.85, 20.6, 21.2, stone, stoneDark, stoneDark)
  for (let x = 19; x <= 55; x += 6) {
    hd.disk(hd.X(x + 0.5), hd.Y(BRANDENBURG_LINTEL + 0.45), Math.max(1.6, hd.cw * 0.22), relief)
  }
  for (const pillar of BRANDENBURG_PILLARS) {
    hd.mass(
      pillar + 0.5,
      BRANDENBURG_SHAFT_TOP,
      BRANDENBURG_SHAFT_BASE + 0.15,
      1.05,
      1.4,
      stone,
      hdDarken(stone, 0.8),
      stoneDark,
    )
    hd.stroke(
      pillar + 0.15,
      BRANDENBURG_SHAFT_TOP + 0.2,
      pillar + 0.15,
      BRANDENBURG_SHAFT_BASE,
      Math.max(1, hd.cw * 0.08),
      stoneDark,
    )
    hd.stroke(
      pillar + 0.85,
      BRANDENBURG_SHAFT_TOP + 0.2,
      pillar + 0.85,
      BRANDENBURG_SHAFT_BASE,
      Math.max(1, hd.cw * 0.08),
      stoneDark,
    )
    hd.stroke(
      pillar + 0.5,
      BRANDENBURG_SHAFT_BASE,
      pillar + 0.5,
      BRANDENBURG_SHAFT_BASE + 1.05,
      Math.max(2, hd.cw * 0.42),
      stoneDark,
    )
  }
  for (const lx of [24, 52]) {
    const glow = night && lampBright ? hd.cw * 0.42 : hd.cw * 0.16
    hd.disk(hd.X(lx + 0.5), hd.Y(12.5), Math.max(1.2, glow), lamp)
  }

  hd.rect(0, hd.Y(BRANDENBURG_GROUND_TOP), hd.w, hd.h, hdHex(c.ground))
  const cobble = hdHex(c.cobble)
  for (let x = 0; x < BRANDENBURG_COLUMNS; x += 3) {
    hd.disk(hd.X(x + 0.5), hd.Y(BRANDENBURG_GROUND_TOP + 0.45), Math.max(1.1, hd.cw * 0.12), cobble)
  }
  for (let x = 4; x < BRANDENBURG_COLUMNS; x += 8) {
    hd.disk(hd.X(x + 0.5), hd.Y(BRANDENBURG_GROUND_TOP + 2.45), Math.max(1.6, hd.cw * 0.2), hdHex(c.flag))
    hd.stroke(
      x + 0.5,
      BRANDENBURG_GROUND_TOP + 2.8,
      x + 0.5,
      BRANDENBURG_GROUND_TOP + 3.6,
      Math.max(1, hd.cw * 0.08),
      tree,
    )
  }
  for (const visitor of BRANDENBURG_TOURISTS) {
    hd.disk(hd.X(visitor + 0.5), hd.Y(17.35), Math.max(1.8, hd.cw * 0.22), crowd)
    hd.stroke(visitor + 0.5, 17.7, visitor + 0.5, 18.7, Math.max(1.2, hd.cw * 0.1), crowd)
  }
  for (const post of BRANDENBURG_PLAZA_LAMPS) {
    hd.disk(hd.X(post + 0.5), hd.Y(16.45), Math.max(2, hd.cw * 0.32), lamp)
    hd.stroke(post + 0.5, 17, post + 0.5, 19, Math.max(3, hd.cw * 0.34), stoneDark)
  }
  return hd.pixels
}
