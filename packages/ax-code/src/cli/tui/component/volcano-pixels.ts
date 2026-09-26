import {
  VOLCANO_BASE,
  VOLCANO_COLUMNS,
  VOLCANO_CRATER,
  VOLCANO_CX,
  VOLCANO_GROUND_TOP,
  VOLCANO_LAVA_X,
  VOLCANO_MOON,
  VOLCANO_ROWS,
  VOLCANO_TOP,
  VOLCANO_COLORS,
  volcanoEmbers,
  volcanoGlow,
  volcanoHalf,
  volcanoPoolStep,
  volcanoSkyRgb,
  volcanoSmoke,
  volcanoStarBright,
  volcanoSurgeRows,
  type VolcanoStyle,
} from "./volcano-view-model"

type RGB = readonly [number, number, number]
const hex = (value: string): RGB =>
  [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]
const lerp = (from: RGB, to: RGB, t: number): RGB =>
  [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * t)) as [
    number,
    number,
    number,
  ]

/**
 * Freeform HD renderer. The cone under a heat halo, pulsing crater with
 * lit rim lips, surging lava, drifting smoke, embers, shimmering pool, and
 * ground are painted directly from the shared scene model, so the HD frame
 * and the text fallback show the same scene for the same millisecond. Pure
 * and deterministic: everything derives from `elapsedMs`.
 */
export function renderVolcanoPixels(width: number, height: number, style: VolcanoStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3)
  if (w === 0 || h === 0) return pixels
  const eruption = style === "volcano-eruption"
  const c = VOLCANO_COLORS[style]
  const cw = w / VOLCANO_COLUMNS,
    ch = h / VOLCANO_ROWS
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
    const [r, g, b] = volcanoSkyRgb(style, h <= 1 ? 0 : y / (h - 1))
    let i = y * w * 3
    for (let x = 0; x < w; x++) {
      pixels[i++] = r
      pixels[i++] = g
      pixels[i++] = b
    }
  }

  const sky = hex(c.sky)
  if (!eruption) {
    const bandH = Math.max(1, Math.floor(Y(4)))
    for (let i = 0; i < 26; i++) {
      const sx = (i * 197 + 31) % w,
        sy = (i * 131 + 7) % bandH
      if (Math.hypot(sx - X(VOLCANO_MOON.x), sy - Y(VOLCANO_MOON.y)) < 50) continue
      if (volcanoStarBright(elapsedMs, i)) disk(sx, sy, 1, sky)
      else set(sx, sy, sky)
    }
    disk(X(VOLCANO_MOON.x), Y(VOLCANO_MOON.y), Math.max(1, Math.round(Math.min(cw, ch) * 0.9)), sky)
  }

  // Heat halo behind the cone: pulsing with the crater beat in eruption, faint in calm.
  const haloDeep = hex(c.glowDeep),
    haloRock = hex(c.rock)
  const haloR = eruption ? 34 + 14 * volcanoGlow(elapsedMs) : 26
  const haloX = X(VOLCANO_CX),
    haloY = Y((VOLCANO_CRATER.y0 + VOLCANO_CRATER.y1) / 2)
  disk(haloX, haloY, haloR + 14, lerp(haloDeep, haloRock, 0.5))
  disk(haloX, haloY, haloR, haloDeep)

  const rock = hex(c.rock),
    rim = hex(c.rim)
  for (let y = VOLCANO_TOP; y <= VOLCANO_BASE; y++) {
    const half = volcanoHalf(y)
    const xa = Math.max(0, Math.floor(X(VOLCANO_CX - half))),
      xb = Math.min(w, Math.ceil(X(VOLCANO_CX + half + 1)))
    const ya = Math.max(0, Math.floor(Y(y))),
      yb = Math.min(h, Math.ceil(Y(y + 1)))
    for (let py = ya; py < yb; py++) {
      let i = (py * w + xa) * 3
      for (let px = xa; px < xb; px++) {
        const edge = px === xa || px === xb - 1
        pixels[i++] = edge ? rim[0]! : rock[0]!
        pixels[i++] = edge ? rim[1]! : rock[1]!
        pixels[i++] = edge ? rim[2]! : rock[2]!
      }
    }
  }

  const lava = hex(c.lava),
    lavaBright = hex(c.lavaBright)
  if (eruption) {
    rect(X(VOLCANO_LAVA_X), Y(10), X(VOLCANO_LAVA_X + 2), Y(18), lava)
    rect(X(VOLCANO_LAVA_X) + cw / 4, Y(10), X(VOLCANO_LAVA_X + 2) - cw / 4, Y(18), lavaBright)
    const surge = hex(c.surge)
    for (const row of volcanoSurgeRows(elapsedMs)) {
      disk(X(VOLCANO_LAVA_X + 1), Y(row + 0.5), 4, surge)
    }
    const smoke = hex(c.smoke)
    for (const puff of volcanoSmoke(elapsedMs)) {
      disk(X(puff.x + 0.5), Y(puff.y + 0.5), Math.max(2, Math.round(puff.size * Math.min(cw, ch) * 0.5)), smoke)
    }
  }

  const ember = hex(c.ember)
  for (const spark of volcanoEmbers(elapsedMs)) {
    if (!spark.visible) continue
    disk(X(spark.x + 0.5), Y(spark.y + 0.5), spark.char === "*" ? 2 : 1, ember)
  }

  const phase = eruption ? volcanoGlow(elapsedMs) : 0
  const glowDeep = hex(c.glowDeep),
    glowHot = hex(c.glowHot)
  const craterX = X((VOLCANO_CRATER.x0 + VOLCANO_CRATER.x1) / 2)
  const craterY = Y((VOLCANO_CRATER.y0 + VOLCANO_CRATER.y1) / 2)
  disk(craterX, craterY, Math.max(2, Math.round(Math.min(cw, ch) * 2.5)), lerp(glowDeep, glowHot, phase))
  disk(
    craterX,
    craterY,
    Math.max(1, Math.round(Math.min(cw, ch))),
    eruption ? lerp(glowHot, lavaBright, phase) : glowHot,
  )
  if (eruption) {
    disk(X(VOLCANO_CRATER.x0), craterY, 2, lavaBright)
    disk(X(VOLCANO_CRATER.x1), craterY, 2, lavaBright)
  }

  const ground = hex(c.ground)
  rect(0, Y(VOLCANO_GROUND_TOP), w, h, ground)
  if (eruption) {
    const pool = hex(c.pool)
    const step = volcanoPoolStep(elapsedMs)
    for (let x = 40; x <= 48; x++) {
      rect(X(x), Y(19), X(x + 1), Y(20), (x + step) % 3 === 0 ? lavaBright : pool)
    }
    rect(X(40), Y(20), X(49), Y(21), pool)
  }

  return pixels
}
