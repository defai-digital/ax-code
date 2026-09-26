import {
  CITY_COLUMNS,
  CITY_LAMPS,
  CITY_MOON,
  CITY_ROWS,
  CITY_STREET_TOP,
  CITY_SUN,
  CITY_COLORS,
  cityBuildings,
  citySkyRgb,
  cityWindowLit,
  cityWindows,
  type CityStyle,
} from "./city-view-model"

type RGB = readonly [number, number, number]
const hex = (value: string): RGB =>
  [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]

/**
 * Freeform HD renderer. The skyline (gradient sky, stars, orb, towers with
 * twinkling windows, street lamps) is painted directly from the shared scene
 * model, so the HD frame and the text fallback show the same scene for the
 * same millisecond. Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderCityPixels(width: number, height: number, style: CityStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3)
  if (w === 0 || h === 0) return pixels
  const night = style === "city-night"
  const c = CITY_COLORS[style]
  const cw = w / CITY_COLUMNS,
    ch = h / CITY_ROWS
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
    const [r, g, b] = citySkyRgb(style, h <= 1 ? 0 : y / (h - 1))
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
    const bandH = Math.max(1, Math.floor(Y(5)))
    for (let i = 0; i < 28; i++) {
      const sx = (i * 197 + 31) % w,
        sy = (i * 131 + 7) % bandH
      if (Math.hypot(sx - X(CITY_MOON.x), sy - Y(CITY_MOON.y)) < 60) continue
      set(sx, sy, sky)
    }
  }
  const orbAt = night ? CITY_MOON : CITY_SUN
  disk(X(orbAt.x), Y(orbAt.y), Math.max(1, Math.round(Math.min(cw, ch) * 1.1)), orb)

  const building = hex(c.building),
    edge = hex(c.edge),
    lit = hex(c.windowLit),
    dim = hex(c.windowDim)
  cityBuildings().forEach((tower, i) => {
    rect(X(tower.x), Y(tower.top), X(tower.x + tower.w), Y(CITY_STREET_TOP - 1), building)
    rect(X(tower.x), Y(tower.top), X(tower.x + tower.w), Y(tower.top) + 2, edge)
    for (const window of cityWindows(tower)) {
      const color = cityWindowLit(style, i, window.wx, window.wy, elapsedMs) ? lit : dim
      rect(X(window.x), Y(window.y), X(window.x + 1), Y(window.y + 1), color)
    }
  })

  const street = hex(c.street),
    lamp = hex(c.lamp)
  rect(0, Y(CITY_STREET_TOP), w, h, street)
  for (const lx of CITY_LAMPS) {
    disk(X(lx + 0.5), Y(CITY_STREET_TOP + 0.5), Math.max(1, Math.round(Math.min(cw, ch) * 0.3)), lamp)
  }

  return pixels
}
