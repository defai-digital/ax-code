import {
  FESTIVAL_BURSTS,
  FESTIVAL_BURST_BRIGHT,
  FESTIVAL_BURST_DIM,
  FESTIVAL_BURST_HUES,
  FESTIVAL_COLUMNS,
  FESTIVAL_GROUND_TOP,
  FESTIVAL_LANTERN_COLORS,
  FESTIVAL_MOON,
  FESTIVAL_MOONLIGHT,
  FESTIVAL_ROWS,
  FESTIVAL_TOWN,
  FESTIVAL_TOWN_ROW,
  FESTIVAL_COLORS,
  festivalLanterns,
  festivalParticles,
  festivalSkyRgb,
  type FestivalStyle,
} from "./festival-view-model"

type RGB = readonly [number, number, number]
const hex = (value: string): RGB =>
  [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]

/**
 * Freeform HD renderer. Bursts, lanterns, moon, and town lights are painted
 * directly from the shared scene model, so the HD frame and the text fallback
 * show the same scene for the same millisecond. Pure and deterministic:
 * everything derives from `elapsedMs`, and both scenes loop with the cycle.
 */
export function renderFestivalPixels(width: number, height: number, style: FestivalStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3)
  if (w === 0 || h === 0) return pixels
  const fireworks = style === "festival-fireworks"
  const c = FESTIVAL_COLORS[style]
  const cw = w / FESTIVAL_COLUMNS,
    ch = h / FESTIVAL_ROWS
  const X = (sceneX: number) => (sceneX + 0.5) * cw
  const Y = (sceneY: number) => (sceneY + 0.5) * ch

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
    const [r, g, b] = festivalSkyRgb(style, h <= 1 ? 0 : y / (h - 1))
    let i = y * w * 3
    for (let x = 0; x < w; x++) {
      pixels[i++] = r
      pixels[i++] = g
      pixels[i++] = b
    }
  }

  const sky = hex(c.sky)
  const bandH = Math.max(1, Math.floor((2.5 * h) / FESTIVAL_ROWS))
  for (let i = 0; i < 24; i++) {
    const sx = (i * 197 + 31) % w,
      sy = (i * 131 + 7) % bandH
    if (!fireworks && Math.hypot(sx - X(FESTIVAL_MOON.x), sy - Y(FESTIVAL_MOON.y)) < 60) continue
    set(sx, sy, sky)
  }
  if (!fireworks) {
    disk(
      X(FESTIVAL_MOON.x),
      Y(FESTIVAL_MOON.y),
      Math.max(1, Math.round(Math.min(cw, ch) * 1.1)),
      hex(FESTIVAL_MOONLIGHT),
    )
  }

  const ground = hex(c.ground),
    townDot = hex(c.townDot)
  rect(0, (FESTIVAL_GROUND_TOP * h) / FESTIVAL_ROWS, w, h, ground)
  for (const dot of FESTIVAL_TOWN) {
    disk(X(dot), Y(FESTIVAL_TOWN_ROW), Math.max(1, Math.round(Math.min(cw, ch) * 0.3)), townDot)
  }

  if (fireworks) {
    const bright = hex(FESTIVAL_BURST_BRIGHT)
    for (let burst = 0; burst < FESTIVAL_BURSTS.length; burst++) {
      const hue = hex(FESTIVAL_BURST_HUES[burst]!),
        dim = hex(FESTIVAL_BURST_DIM[burst]!)
      for (const particle of festivalParticles(elapsedMs, burst)) {
        if (particle.stage < 0) continue
        disk(
          X(particle.x),
          Y(particle.y),
          particle.stage === 2 ? 1 : 2,
          particle.stage === 0 ? bright : particle.stage === 1 ? hue : dim,
        )
      }
    }
  } else {
    const lamp = FESTIVAL_LANTERN_COLORS
    const halo = hex(lamp.halo),
      body = hex(lamp.body),
      core = hex(lamp.core)
    const unit = Math.min(cw, ch)
    for (const lantern of festivalLanterns(elapsedMs)) {
      const cx = X(lantern.x),
        cy = Y(lantern.y)
      disk(cx, cy, Math.max(2, Math.round(unit * 1.1)), halo)
      disk(cx, cy, Math.max(2, Math.round(unit * 0.7)), body)
      disk(cx, cy, Math.max(1, Math.round(unit * 0.4)), core)
    }
  }

  return pixels
}
