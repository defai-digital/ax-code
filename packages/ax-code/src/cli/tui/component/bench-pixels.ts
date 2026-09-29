import {
  BENCH_COLUMNS,
  BENCH_ROWS,
  BENCH_COLORS,
  BENCH_SHELLS,
  benchCanopy,
  benchCenterX,
  benchClouds,
  benchFaintStarBright,
  benchFaintStarRow,
  benchHorizon,
  benchReflection,
  benchSkyRgb,
  benchStarGlyph,
  benchStarRow,
  benchSunX,
  benchSunY,
  benchSway,
  benchTitle,
  benchTrunk,
  benchWavePhase,
  type BenchStyle,
} from "./bench-view-model"
import { blitGlyphText } from "./text-scene-glyphs"

type RGB = readonly [number, number, number]
const hex = (value: string): RGB =>
  [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]
const darken = (color: RGB, factor: number): RGB => [
  Math.round(color[0] * factor),
  Math.round(color[1] * factor),
  Math.round(color[2] * factor),
]
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]

/**
 * Freeform HD renderer. The shoreline (gradient sky, twinkling stars,
 * sun/moon disk, swaying palm, surf, sand, title) is painted directly from
 * the shared scene model, so the HD frame and the text fallback show the
 * same scene for the same millisecond. Pure and deterministic: no random
 * state, everything derives from `elapsedMs`. Unlike the cycling scenes,
 * the sunset descent saturates and the surf keeps moving.
 */
export function renderBenchPixels(width: number, height: number, style: BenchStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3)
  if (w === 0 || h === 0) return pixels
  const sunset = style === "sunset-serenade"
  const c = BENCH_COLORS[style]
  const cw = w / BENCH_COLUMNS,
    ch = h / BENCH_ROWS
  const X = (sceneX: number) => sceneX * cw
  const Y = (sceneY: number) => sceneY * ch

  const set = (x: number, y: number, color: RGB) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    pixels[i] = color[0]!
    pixels[i + 1] = color[1]!
    pixels[i + 2] = color[2]!
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, color: RGB) => {
    const xa = Math.max(0, Math.floor(x0)),
      xb = Math.min(w, Math.ceil(x1))
    const ya = Math.max(0, Math.floor(y0)),
      yb = Math.min(h, Math.ceil(y1))
    for (let y = ya; y < yb; y++) {
      let i = (y * w + xa) * 3
      for (let x = xa; x < xb; x++) {
        pixels[i++] = color[0]!
        pixels[i++] = color[1]!
        pixels[i++] = color[2]!
      }
    }
  }
  const disk = (cx: number, cy: number, r: number, color: RGB) => {
    if (r <= 0) return
    const xa = Math.max(0, Math.floor(cx - r)),
      xb = Math.min(w - 1, Math.ceil(cx + r))
    const ya = Math.max(0, Math.floor(cy - r)),
      yb = Math.min(h - 1, Math.ceil(cy + r))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= r * r) set(x, y, color)
      }
    }
  }

  // Sky gradient, one color per row.
  for (let y = 0; y < h; y++) {
    const [r, g, b] = benchSkyRgb(style, h <= 1 ? 0 : y / (h - 1))
    let i = y * w * 3
    for (let x = 0; x < w; x++) {
      pixels[i++] = r
      pixels[i++] = g
      pixels[i++] = b
    }
  }

  const horizon = benchHorizon(BENCH_ROWS)
  const sky = hex(c.sky),
    light = hex(c.light)
  if (!sunset) {
    const starR = Math.max(1, Math.round(Math.min(cw, ch) * 0.2))
    for (let x = 3; x < BENCH_COLUMNS; x += 9) {
      const cx = X(x + 0.5),
        cy = Y(benchStarRow(x, horizon) + 0.5)
      if (benchStarGlyph(elapsedMs, x) === "*") disk(cx, cy, starR, light)
      else set(Math.round(cx), Math.round(cy), sky)
    }
    const faintR = Math.max(1, Math.round(Math.min(cw, ch) * 0.12))
    for (let x = 7; x < BENCH_COLUMNS; x += 9) {
      if (!benchFaintStarBright(elapsedMs, x)) continue
      disk(X(x + 0.5), Y(benchFaintStarRow(x, horizon) + 0.5), faintR, sky)
    }
  } else {
    const cloud = hex(c.cloud)
    for (const bank of benchClouds(style, elapsedMs, BENCH_COLUMNS)) {
      for (let i = 0; i <= bank.len + 1; i++) {
        disk(X(bank.x + i + 0.5), Y(bank.y + 1.2), ch * 0.62, cloud)
      }
      for (let i = 1; i <= bank.len; i += 2) {
        disk(X(bank.x + i + 0.5), Y(bank.y + 0.6), ch * 0.45, cloud)
      }
    }
  }

  // Sun/moon disk at the shared scene position, wrapped in a soft halo.
  const sunX = benchSunX(BENCH_COLUMNS),
    sunY = benchSunY(style, elapsedMs, horizon)
  const sunCX = X(sunX + 3.5),
    sunCY = Y(sunY + 2.5)
  const sunR = Math.max(1, Math.round(Math.min(cw, ch) * 1.1))
  const skyAtSun = benchSkyRgb(style, h <= 1 ? 0 : sunCY / (h - 1))
  disk(sunCX, sunCY, sunR * 2.1, mix(light, skyAtSun, 0.85))
  disk(sunCX, sunCY, sunR * 1.6, mix(light, skyAtSun, 0.62))
  disk(sunCX, sunCY, sunR, light)

  // Palm trunk steps and fronds sway with the shared phase.
  const palm = hex(c.palm),
    trunkColor = hex(c.trunk)
  const trunk = benchTrunk(BENCH_COLUMNS),
    canopy = benchCanopy(horizon)
  const sway = benchSway(elapsedMs, BENCH_COLUMNS)
  const trunkShade = darken(trunkColor, 0.7)
  for (let y = canopy + 3; y < horizon; y++) {
    const tx = trunk - Math.floor((y - canopy - 3) / 2) + sway
    rect(X(tx), Y(y), X(tx + 2), Y(y + 1), trunkColor)
    rect(X(tx + 1.5), Y(y), X(tx + 2), Y(y + 1), trunkShade)
  }
  const nutR = Math.max(1, Math.round(Math.min(cw, ch) * 0.32))
  disk(X(trunk + sway - 0.5), Y(canopy + 2.5), nutR, trunkColor)
  disk(X(trunk + sway + 1.5), Y(canopy + 2.5), nutR, trunkColor)
  const frondR = Math.max(1, Math.round(Math.min(cw, ch) * 0.25))
  const frondBaseX = X(trunk + sway + 1),
    frondBaseY = Y(canopy + 2)
  for (const [dx, dy] of [
    [-1, -0.45],
    [-0.55, -1],
    [0, -1],
    [0.55, -1],
    [1, -0.45],
  ]) {
    const length = Math.hypot(dx, dy) || 1
    const steps = Math.max(2, Math.round(3 * Math.min(cw, ch)))
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 3
      const taper = Math.max(0.5, frondR * (1 - (i / steps) * 0.45))
      disk(frondBaseX + (dx / length) * t * cw, frondBaseY + (dy / length) * t * ch, taper, palm)
    }
  }

  // Surf and sand bands from the shared wave phase.
  const phase = benchWavePhase(elapsedMs)
  const wave = hex(c.wave),
    foam = hex(c.foam),
    sand = hex(c.sand),
    sandWet = hex(c.sandWet)
  for (let x = 0; x < BENCH_COLUMNS; x++) {
    if ((x + phase) % 2 === 0) rect(X(x), Y(horizon), X(x + 1), Y(horizon + 1), wave)
    if ((x + 2 - phase) % 3 === 0) rect(X(x), Y(horizon + 1), X(x + 1), Y(horizon + 2), foam)
  }
  for (const cell of benchReflection(elapsedMs, BENCH_COLUMNS, horizon)) {
    rect(X(cell.x) + cw * 0.25, Y(cell.y) + ch * 0.2, X(cell.x + 1) - cw * 0.25, Y(cell.y + 1) - ch * 0.2, light)
  }
  rect(0, Y(horizon + 2), w, Y(horizon + 3), sandWet)
  rect(0, Y(horizon + 3), w, Y(horizon + 4), sand)
  const sandDot = darken(sand, 0.72)
  for (let x = 0; x < BENCH_COLUMNS; x++) {
    if (x % 3 === 1) rect(X(x), Y(horizon + 3), X(x + 1), Y(horizon + 4), sandDot)
  }
  for (const shell of BENCH_SHELLS) {
    const color = shell.glyph === "o" ? foam : light
    disk(X(shell.x + 0.5), Y(horizon + 3.5), Math.max(1, Math.round(Math.min(cw, ch) * 0.3)), color)
  }

  const title = benchTitle(style)
  blitGlyphText(
    pixels,
    w,
    h,
    Math.round(benchCenterX(title, BENCH_COLUMNS) * cw),
    Math.round((BENCH_ROWS - 1) * ch),
    Math.max(1, Math.round(cw)),
    Math.max(1, Math.round(ch)),
    title,
    light,
  )

  return pixels
}
