import {
  SNOW_BASE,
  SNOW_COLUMNS,
  SNOW_GROUND_TOP,
  SNOW_MOON,
  SNOW_PINES,
  SNOW_RIDGE,
  SNOW_ROWS,
  SNOW_SPARKS,
  SNOW_SUN,
  SNOW_COLORS,
  snowFlakes,
  snowPineHalf,
  snowSkyRgb,
  snowSparkBright,
  type SnowStyle,
} from "./snow-view-model"

type RGB = readonly [number, number, number]
const hex = (value: string): RGB =>
  [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]

/**
 * Freeform HD renderer. The forest (gradient sky, orb, distant ridge,
 * snow-laden pines, gusting snowfall, glinting ground) is painted directly
 * from the shared scene model, so the HD frame and the text fallback show
 * the same scene for the same millisecond. Pure and deterministic:
 * everything derives from `elapsedMs`, and the full sky loops with the
 * cycle.
 */
export function renderSnowPixels(width: number, height: number, style: SnowStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3)
  if (w === 0 || h === 0) return pixels
  const night = style === "winter-night"
  const c = SNOW_COLORS[style]
  const cw = w / SNOW_COLUMNS,
    ch = h / SNOW_ROWS
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

  for (let y = 0; y < h; y++) {
    const [r, g, b] = snowSkyRgb(style, h <= 1 ? 0 : y / (h - 1))
    let i = y * w * 3
    for (let x = 0; x < w; x++) {
      pixels[i++] = r
      pixels[i++] = g
      pixels[i++] = b
    }
  }

  const orb = hex(c.orb)
  if (night) {
    const sky = hex(c.sky)
    const bandH = Math.max(1, Math.floor(Y(3)))
    for (let i = 0; i < 26; i++) {
      const sx = (i * 197 + 31) % w,
        sy = (i * 131 + 7) % bandH
      if (Math.hypot(sx - X(SNOW_MOON.x), sy - Y(SNOW_MOON.y)) < 60) continue
      set(sx, sy, sky)
    }
  }
  const orbAt = night ? SNOW_MOON : SNOW_SUN
  disk(X(orbAt.x), Y(orbAt.y), Math.max(1, Math.round(Math.min(cw, ch) * 1.1)), orb)

  const ground = hex(c.ground),
    snow = hex(c.snow)
  rect(0, Y(SNOW_GROUND_TOP), w, h, ground)
  const sparkDim = hex(c.sparkDim)
  SNOW_SPARKS.forEach((spark, i) => {
    if (snowSparkBright(elapsedMs, i)) disk(X(spark.x + 0.5), Y(spark.y + 0.5), 2, snow)
    else disk(X(spark.x + 0.5), Y(spark.y + 0.5), 1, sparkDim)
  })

  const ridge = hex(c.ridge)
  const triangle = (ax: number, ay: number, bx: number, by: number, color: RGB) => {
    const ya = Math.max(0, Math.floor(Y(ay))),
      yb = Math.min(h, Math.ceil(Y(by)))
    for (let y = ya; y < yb; y++) {
      const p = by <= ay ? 0 : (y / ch - ay) / (by - ay)
      const half = Math.max(0, bx * p)
      const xa = Math.max(0, Math.floor(X(ax - half))),
        xb = Math.min(w, Math.ceil(X(ax + half)))
      let i = (y * w + xa) * 3
      for (let x = xa; x < xb; x++) {
        pixels[i++] = color[0]!
        pixels[i++] = color[1]!
        pixels[i++] = color[2]!
      }
    }
  }
  for (const peak of SNOW_RIDGE) {
    triangle(peak.ax, peak.ay, peak.rows, peak.ay + peak.rows, ridge)
    triangle(peak.ax, peak.ay, 1.5, peak.ay + 2, snow)
  }

  const pine = hex(c.pine),
    trunk = hex(c.trunk)
  for (const tree of SNOW_PINES) {
    const apex = SNOW_BASE - tree.h + 1
    for (let r = 0; r < tree.h; r++) {
      const half = snowPineHalf(r)
      rect(X(tree.x - half), Y(apex + r), X(tree.x + half + 1), Y(apex + r + 1), pine)
    }
    rect(X(tree.x - 2), Y(apex), X(tree.x + 3), Y(apex + 2), snow)
    disk(X(tree.x - 1.5), Y(apex + 4), 2, snow)
    disk(X(tree.x + 2), Y(apex + 6), 2, snow)
    rect(X(tree.x - 1), Y(SNOW_BASE + 1), X(tree.x + 1), Y(SNOW_BASE + 3), trunk)
  }

  const flake = hex(c.flake)
  for (const drop of snowFlakes(elapsedMs)) {
    disk(X(drop.x + 0.5), Y(drop.y + 0.5), drop.char === "@" ? 3 : drop.char === "*" ? 2 : 1, flake)
  }

  return pixels
}
