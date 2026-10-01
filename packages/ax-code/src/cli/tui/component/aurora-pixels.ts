import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  AURORA_COLUMNS,
  AURORA_COLORS,
  AURORA_CURTAIN_BOTTOM,
  AURORA_CURTAINS,
  AURORA_CURTAIN_WIDTH,
  AURORA_CYCLE_MS,
  AURORA_HORIZON,
  AURORA_LAKE_TOP,
  AURORA_MIST_ROW,
  AURORA_MOON,
  AURORA_PINES,
  AURORA_ROWS,
  AURORA_STARS,
  AURORA_TREELINE,
  auroraRipple,
  auroraShimmer,
  auroraSkyRgb,
  type AuroraStyle,
} from "./aurora-view-model"

/**
 * Freeform HD aurora. Sine curtains, a star field, speckled pines, and a
 * rippled lake come from the shared scene model. The lake gradient is
 * phase-locked so open water stays put while reflections shimmer. Pure and
 * deterministic: everything derives from `elapsedMs` and loops at 2400ms.
 */
export function renderAuroraPixels(width: number, height: number, style: AuroraStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, AURORA_COLUMNS, AURORA_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const dawn = style === "aurora-dawn"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % AURORA_CYCLE_MS) / AURORA_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = AURORA_COLORS[style]
  const curtain = hdHex(c.curtain)
  const edge = hdHex(c.curtainEdge)
  const snow = hdHex(c.snow)
  const pine = hdHex(c.pine)
  const trunk = hdHex(c.trunk)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const bottom = dawn ? AURORA_CURTAIN_BOTTOM - 3 : AURORA_CURTAIN_BOTTOM

  const paintRibbon = (center: number, fill: RGB, rim: RGB, widthScene: number, y0: number, y1: number) => {
    const top = Math.max(0, Math.floor(hd.Y(y0)))
    const bot = Math.min(hd.h, Math.ceil(hd.Y(y1)))
    for (let y = top; y < bot; y++) {
      const sceneY = (y + 0.5) / hd.ch
      const sway = auroraRipple(elapsed, center + sceneY * 0.2) + Math.sin(sceneY * 0.85 + theta) * 0.85
      const taper = 0.62 + 0.38 * Math.sin(sceneY * 0.72 + center * 0.15)
      const half = Math.max(1, hd.X(widthScene * 0.5) * taper)
      const cx = hd.X(center + sway)
      const body = hdMix(fill, rim, 0.16 + 0.14 * Math.sin(sceneY * 1.35 + center))
      hd.rect(cx - half, y, cx - half * 0.64, y + 1, rim)
      hd.rect(cx - half * 0.64, y, cx + half * 0.64, y + 1, body)
      hd.rect(cx + half * 0.64, y, cx + half, y + 1, rim)
    }
  }

  hd.sky((t) => auroraSkyRgb(style, t))
  if (!dawn) {
    const moon = hdHex(c.moon)
    const around = auroraSkyRgb(style, AURORA_MOON.y / AURORA_ROWS)
    hd.stars(AURORA_STARS, hdHex(c.star), (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    hd.halo(hd.X(AURORA_MOON.x), hd.Y(AURORA_MOON.y), coreR, moon, hdMix(moon, around, 0.45), around)
  }

  const veil = dawn ? hdMix(curtain, hdHex(c.skyBottom), 0.4) : curtain
  const deep = hdDarken(veil, 0.7)
  for (const center of AURORA_CURTAINS) {
    paintRibbon(center - 1.5, deep, veil, AURORA_CURTAIN_WIDTH * 0.55, 0.4, bottom)
    paintRibbon(center + 0.2, veil, edge, AURORA_CURTAIN_WIDTH * 0.7, 0, bottom - 0.3)
    paintRibbon(center + 1.7, edge, hdMix(edge, veil, 0.45), AURORA_CURTAIN_WIDTH * 0.32, 0.8, bottom - 1.1)
  }
  if (dawn) {
    const glow = hdHex(c.skyBottom)
    for (let x = 0; x < AURORA_COLUMNS; x += 3) {
      hd.disk(hd.X(x + 1), hd.Y(AURORA_HORIZON), hd.ch * 0.42, hdMix(glow, veil, 0.35))
    }
  }

  for (const tree of AURORA_PINES) {
    hd.blob(hd.X(tree + 0.5), hd.Y(AURORA_TREELINE + 1.35), hd.cw * 1.7, hd.ch * 1.05, pine, hdDarken(pine, 0.75))
    hd.blob(hd.X(tree + 0.5), hd.Y(AURORA_TREELINE + 0.45), hd.cw * 0.85, hd.ch * 0.38, snow, hdMix(snow, pine, 0.22))
    hd.rect(hd.X(tree + 0.22), hd.Y(AURORA_TREELINE + 1.7), hd.X(tree + 0.85), hd.Y(AURORA_TREELINE + 2.7), trunk)
  }

  const drift = Math.floor(phase * AURORA_COLUMNS)
  for (let x = 0; x < AURORA_COLUMNS; x += 9) {
    hd.puff((x + drift) % AURORA_COLUMNS, AURORA_MIST_ROW, 3, snow)
  }

  for (let i = 0; i < 16; i++) {
    const x = (i * 17 + 3 + phase * AURORA_COLUMNS) % AURORA_COLUMNS
    const y = 1.2 + (i % 6) * 1.6 + Math.sin(theta + i * 0.7) * 0.25
    hd.disk(hd.X(x), hd.Y(y), i % 4 === 0 ? Math.max(1.4, hd.cw * 0.26) : 1.15, snow)
  }

  // Phase 0 keeps the open-water gradient identical at every elapsed time.
  // Moving shimmer is the reflection columns, kept clear of scene x 30.5.
  hd.water(AURORA_LAKE_TOP, AURORA_ROWS, hdHex(c.water), hdHex(c.waterDeep), 0)
  const bright = auroraShimmer(elapsed)
  const shimmer = bright ? hdHex(c.shimmer) : hdMix(hdHex(c.shimmer), hdHex(c.waterDeep), 0.5)
  for (const center of AURORA_CURTAINS) {
    hd.reflection(center + auroraRipple(elapsed, center), AURORA_LAKE_TOP, AURORA_ROWS, shimmer, theta, 3)
  }
  for (let x = 4; x < AURORA_COLUMNS; x += 17) {
    hd.stroke(x, AURORA_LAKE_TOP + 4.7, x + 1.5, AURORA_LAKE_TOP + 5.25, Math.max(1, hd.cw * 0.12), snow)
  }
  return hd.pixels
}
