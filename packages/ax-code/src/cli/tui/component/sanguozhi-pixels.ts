import { glow, hash2, vnoise } from "./atmos-paint"
import { artLine, blendPixel, polyFill, softDisk } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type HdCanvas, type RGB } from "./scene-hd"
import { SANGUOZHI_GLYPH_SIZE, SANGUOZHI_GLYPHS } from "./sanguozhi-glyphs"
import {
  SANGUOZHI_ARMIES,
  SANGUOZHI_BOUNDS,
  SANGUOZHI_CITIES,
  SANGUOZHI_FACTIONS,
  SANGUOZHI_LAKES,
  SANGUOZHI_RIVERS,
  SANGUOZHI_ROADS,
  SANGUOZHI_UNIFIED,
  insideSea,
  sanguozhiRelief,
} from "./sanguozhi-map"
import { SANGUOZHI_COLUMNS, SANGUOZHI_ROWS, type SanguozhiStyle } from "./sanguozhi-view-model"

/**
 * Freeform HD renderer: an original campaign map of the late Han heartland in
 * the register of classic historical strategy games. A shaded relief of
 * plains, ranges, and plateau carries the rivers, roads, walled cities, and
 * historical city names; faction banners fly over every city.
 *
 * The opening is the age of rival warlords: armies march between cities under
 * their colors, cloud shadows cross the land, and the date panel turns the
 * months of 184. The ending settles the same map at dusk: city lights come up
 * and, one by one outward from Luoyang, every banner turns to a single color
 * as the realm is unified in 280. No portrait, interface, or artwork from any
 * game is reproduced.
 */

const { west, east, north, south } = SANGUOZHI_BOUNDS
/** Nominal map raster; frames scale it to cover the viewport. */
const MAP_W = 1280
const MAP_H = 720
const TERRAIN_W = 800
const TERRAIN_H = 450
const CYCLE_MS = 6000
const MAJOR = new Set(["洛陽", "長安", "成都", "建業", "許昌", "鄴"])

type Frame = { w: number; h: number; scale: number; ox: number; oy: number }

function frameFor(w: number, h: number): Frame {
  const scale = Math.max(w / MAP_W, h / MAP_H)
  return { w, h, scale, ox: (w - MAP_W * scale) / 2, oy: (h - MAP_H * scale) / 2 }
}
const projectX = (f: Frame, lon: number) => f.ox + ((lon - west) / (east - west)) * MAP_W * f.scale
const projectY = (f: Frame, lat: number) => f.oy + ((north - lat) / (north - south)) * MAP_H * f.scale

// ---------------------------------------------------------------------------
// Terrain: a shaded relief computed once per process at a fixed resolution.

const STOPS: readonly (readonly [number, RGB])[] = [
  [0.0, hdHex("#78964a")],
  [0.12, hdHex("#64853e")],
  [0.24, hdHex("#527434")],
  [0.36, hdHex("#4c6a32")],
  [0.48, hdHex("#6d6640")],
  [0.62, hdHex("#8a7552")],
  [0.78, hdHex("#ab9a7c")],
  [0.92, hdHex("#d6ccba")],
  [1.1, hdHex("#f2eee6")],
]

function elevationColor(h: number): RGB {
  for (let i = 1; i < STOPS.length; i++) {
    const [at, color] = STOPS[i]!
    if (h <= at) {
      const [from, base] = STOPS[i - 1]!
      return hdMix(base, color, (h - from) / (at - from))
    }
  }
  return STOPS.at(-1)![1]
}

type Terrain = { rgb: Uint8Array; water: Uint8Array }
let terrain: Terrain | undefined

function buildTerrain(): Terrain {
  const W = TERRAIN_W
  const H = TERRAIN_H
  const height = new Float32Array(W * H)
  const water = new Uint8Array(W * H)
  for (let gy = 0; gy < H; gy++) {
    const lat = north - ((gy + 0.5) / H) * (north - south)
    for (let gx = 0; gx < W; gx++) {
      const lon = west + ((gx + 0.5) / W) * (east - west)
      const i = gy * W + gx
      if (insideSea(lon, lat)) water[i] = 1
      else
        for (const lake of SANGUOZHI_LAKES) {
          const dx = (lon - lake.lon) / lake.rx
          const dy = (lat - lake.lat) / lake.ry
          if (dx * dx + dy * dy < 1 + (vnoise(gx * 0.08, gy * 0.08) - 0.5) * 0.5) water[i] = 2
        }
      const relief = sanguozhiRelief(lon, lat)
      const mountain = Math.max(0, Math.min(1, (relief - 0.14) / 0.36))
      // Lowlands: the North China Plain, the Sichuan basin, and the lower Yangtze.
      const plain =
        Math.exp(-((lon - 115.6) ** 2 / 7 + (lat - 35.2) ** 2 / 4.5)) * 1.4 +
        Math.exp(-((lon - 104.9) ** 2 / 1.6 + (lat - 30.4) ** 2 / 0.7)) +
        Math.exp(-((lon - 118.5) ** 2 / 3 + (lat - 31.8) ** 2 / 0.6)) +
        Math.exp(-((lon - 112.8) ** 2 / 1.2 + (lat - 30.2) ** 2 / 0.6))
      const hilly = (0.3 + 0.7 * mountain) * (1 - 0.92 * Math.min(1, plain))
      // Domain-warped ridged noise gives branching ridges and valleys everywhere.
      const wx = gx + (vnoise(gx * 0.011, gy * 0.011) - 0.5) * 60
      const wy = gy + (vnoise(gx * 0.011 + 31, gy * 0.011 + 7) - 0.5) * 60
      let ridged = 0
      let amp = 0.42
      let freq = 0.026
      for (let octave = 0; octave < 6; octave++) {
        const r = 1 - Math.abs(2 * vnoise(wx * freq + octave * 13, wy * freq + octave * 7) - 1)
        ridged += r * r * amp
        amp *= 0.62
        freq *= 2.05
      }
      height[i] = relief * 0.85 + hilly * ridged * 0.42 + (vnoise(gx * 0.25, gy * 0.25) - 0.5) * 0.012
    }
  }
  const rgb = new Uint8Array(W * H * 3)
  // Light from the north-west, as on a printed relief map.
  const lx = -0.58
  const ly = -0.62
  const lz = 0.53
  const deep = hdHex("#1f4878")
  const shallow = hdHex("#3f78ad")
  const lake = hdHex("#3b74a8")
  const put = (o: number, r: number, g: number, b: number) => {
    rgb[o] = Math.max(0, Math.min(255, Math.round(r)))
    rgb[o + 1] = Math.max(0, Math.min(255, Math.round(g)))
    rgb[o + 2] = Math.max(0, Math.min(255, Math.round(b)))
  }
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const i = gy * W + gx
      if (water[i]) {
        // Shallows brighten near the shore.
        let near = 0
        for (const [dx, dy, weight] of [
          [6, 0, 0.18],
          [-6, 0, 0.18],
          [0, 6, 0.18],
          [0, -6, 0.18],
          [12, 0, 0.08],
          [-12, 0, 0.08],
          [0, 12, 0.08],
          [0, -12, 0.08],
        ] as const) {
          const x = Math.min(W - 1, Math.max(0, gx + dx))
          const y = Math.min(H - 1, Math.max(0, gy + dy))
          if (!water[y * W + x]) near += weight
        }
        const base = water[i] === 2 ? lake : hdMix(deep, shallow, Math.min(1, near))
        const ripple = (vnoise(gx * 0.09, gy * 0.35) - 0.5) * 14
        put(i * 3, base[0] + ripple * 0.4, base[1] + ripple * 0.6, base[2] + ripple)
        continue
      }
      const x0 = Math.max(0, gx - 1)
      const x1 = Math.min(W - 1, gx + 1)
      const y0 = Math.max(0, gy - 1)
      const y1 = Math.min(H - 1, gy + 1)
      const dzdx = (height[gy * W + x1]! - height[gy * W + x0]!) * 34
      const dzdy = (height[y1 * W + gx]! - height[y0 * W + gx]!) * 34
      const slope = Math.hypot(dzdx, dzdy)
      const shade = (-dzdx * lx - dzdy * ly + lz) / Math.hypot(dzdx, dzdy, 1)
      const h = height[i]!
      // Steep faces show bare rock; gentle ground stays wooded or farmed.
      const base = hdMix(elevationColor(h), hdHex("#86704e"), Math.min(0.75, Math.max(0, slope - 0.5) * 0.45))
      const k = 0.42 + 1.0 * Math.max(0, shade) + (shade > 0.85 ? (shade - 0.85) * 1.2 : 0)
      // A hint of texture: fields on the plains, woods on the hills.
      const speck = (hash2(gx >> 1, gy >> 1) - 0.5) * (h < 0.3 ? 9 : 6)
      put(i * 3, base[0] * k + speck, base[1] * k + speck, base[2] * k + speck * 0.6)
    }
  }
  return { rgb, water }
}

// ---------------------------------------------------------------------------
// Glyphs.

const glyphCache = new Map<string, Float32Array>()
function glyph(char: string): Float32Array | undefined {
  const cached = glyphCache.get(char)
  if (cached) return cached
  const hex = SANGUOZHI_GLYPHS[char]
  if (!hex) return undefined
  const cov = new Float32Array(hex.length)
  for (let i = 0; i < hex.length; i++) cov[i] = parseInt(hex[i]!, 16) / 15
  glyphCache.set(char, cov)
  return cov
}

const advanceOf = (char: string) => (char >= "0" && char <= "9" ? 0.6 : char === " " ? 0.38 : 1)

function drawGlyph(hd: HdCanvas, char: string, x0: number, y0: number, size: number, color: RGB, alpha = 1) {
  const cov = glyph(char)
  if (!cov) return
  const G = SANGUOZHI_GLYPH_SIZE
  const advance = advanceOf(char)
  // Digits sit in a narrower cell; sample the middle of the full-width square.
  const crop = advance < 1 ? 0.2 : 0
  const span = (1 - crop * 2) * G
  const xa = Math.floor(x0)
  const ya = Math.floor(y0)
  const rows = Math.ceil(size)
  const cols = Math.ceil(size * advance)
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= G || y >= G ? 0 : cov[y * G + x]!)
  for (let ty = 0; ty < rows; ty++) {
    const v = ((ty + 0.5) / size) * G - 0.5
    const vy = Math.floor(v)
    const fy = v - vy
    for (let tx = 0; tx < cols; tx++) {
      const u = crop * G + ((tx + 0.5) / (size * advance)) * span - 0.5
      const ux = Math.floor(u)
      const fx = u - ux
      const a =
        (at(ux, vy) * (1 - fx) + at(ux + 1, vy) * fx) * (1 - fy) +
        (at(ux, vy + 1) * (1 - fx) + at(ux + 1, vy + 1) * fx) * fy
      if (a > 0.02) blendPixel(hd, xa + tx, ya + ty, color, Math.min(1, a * 1.15) * alpha)
    }
  }
}

function textWidth(text: string, size: number) {
  let width = 0
  for (const char of text) width += size * advanceOf(char)
  return width
}

/** Light lettering with a dark keyline, as printed labels on a relief map. */
function drawText(hd: HdCanvas, text: string, x: number, y: number, size: number, color: RGB, outline: RGB) {
  const ring = Math.max(1, size / 13)
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-0.7, -0.7],
    [0.7, -0.7],
    [-0.7, 0.7],
    [0.7, 0.7],
  ] as const) {
    let cx = x
    for (const char of text) {
      drawGlyph(hd, char, cx + dx * ring, y + dy * ring, size, outline, 0.85)
      cx += size * advanceOf(char)
    }
  }
  let cx = x
  for (const char of text) {
    drawGlyph(hd, char, cx, y, size, color)
    cx += size * advanceOf(char)
  }
}

// ---------------------------------------------------------------------------
// Roads, cities, banners.

/** A road is a gentle quadratic bend between its two cities. */
function roadPoint(f: Frame, road: number, u: number): [number, number] {
  const [a, b] = SANGUOZHI_ROADS[road]!
  const ca = SANGUOZHI_CITIES[a]!
  const cb = SANGUOZHI_CITIES[b]!
  const ax = projectX(f, ca.lon)
  const ay = projectY(f, ca.lat)
  const bx = projectX(f, cb.lon)
  const by = projectY(f, cb.lat)
  const bend = (hash2(road, 3) - 0.5) * 0.28
  const mx = (ax + bx) / 2 - (by - ay) * bend
  const my = (ay + by) / 2 + (bx - ax) * bend
  const v = 1 - u
  return [v * v * ax + 2 * v * u * mx + u * u * bx, v * v * ay + 2 * v * u * my + u * u * by]
}

function polyline(
  hd: HdCanvas,
  points: readonly (readonly [number, number])[],
  r0: number,
  r1: number,
  color: RGB,
  alpha = 1,
) {
  for (let i = 1; i < points.length; i++) {
    const t0 = (i - 1) / Math.max(1, points.length - 1)
    const t1 = i / Math.max(1, points.length - 1)
    const [ax, ay] = points[i - 1]!
    const [bx, by] = points[i]!
    artLine(hd, ax, ay, bx, by, r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, color, alpha)
  }
}

/** Catmull-Rom smoothing so the rivers meander instead of zig-zagging. */
function smoothPath(points: readonly (readonly [number, number])[], steps = 6) {
  const out: [number, number][] = []
  const spline = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      out.push([spline(p0[0], p1[0], p2[0], p3[0], t), spline(p0[1], p1[1], p2[1], p3[1], t)])
    }
  }
  const last = points.at(-1)!
  out.push([last[0], last[1]])
  return out
}

const citySize = (f: Frame, name: string) => Math.max(6, 15 * f.scale) * (MAJOR.has(name) ? 1.25 : 1)

/** A small walled town: crenellated stone square, a hall with a curved roof, and a gate. */
function drawCity(hd: HdCanvas, x: number, y: number, s: number) {
  const stone = hdHex("#c9c0ae")
  const stoneShade = hdHex("#8e8574")
  const roof = hdHex("#3d4452")
  glow(hd, x + s * 0.2, y + s * 0.55, s * 1.3, [0, 0, 0], 0.35, 0.45)
  const left = x - s * 0.8
  const right = x + s * 0.8
  const top = y - s * 0.25
  const bottom = y + s * 0.5
  hd.rect(left, top, right, bottom, stone)
  hd.rect(x + s * 0.35, top, right, bottom, stoneShade)
  hd.rect(left, bottom - Math.max(1, s * 0.1), right, bottom, hdDarken(stoneShade, 0.8))
  // Crenellations along the top edge.
  const step = Math.max(2, s * 0.3)
  for (let cx = left; cx < right - 1; cx += step)
    hd.rect(cx, top - Math.max(1, s * 0.14), cx + step * 0.55, top, cx > x + s * 0.3 ? stoneShade : stone)
  hd.rect(x - s * 0.16, y + s * 0.12, x + s * 0.16, bottom, hdHex("#2a2420"))
  // The hall and its roof with lifted eaves.
  hd.rect(x - s * 0.38, top - s * 0.42, x + s * 0.38, top, hdHex("#a5432c"))
  const ry = top - s * 0.42
  polyFill(
    hd,
    [
      [x - s * 0.72, ry - s * 0.06],
      [x - s * 0.55, ry + s * 0.05],
      [x + s * 0.55, ry + s * 0.05],
      [x + s * 0.72, ry - s * 0.06],
      [x + s * 0.3, ry - s * 0.36],
      [x - s * 0.3, ry - s * 0.36],
    ],
    (px) => (px > x ? hdDarken(roof, 0.8) : roof),
  )
  hd.rect(x - s * 0.32, ry - s * 0.4, x + s * 0.32, ry - s * 0.33, hdDarken(roof, 0.6))
}

/** A faction banner on a pole beside the city, its cloth rippling in the wind. */
function drawBanner(hd: HdCanvas, x: number, y: number, s: number, color: RGB, t: number, seed: number, lift = 1) {
  const poleTop = y - s * 1.95
  const poleX = x + s * 0.9
  artLine(hd, poleX, y + s * 0.3, poleX, poleTop, Math.max(0.6, s * 0.06), Math.max(0.5, s * 0.05), hdHex("#3a2a1c"))
  softDisk(hd, poleX, poleTop, Math.max(0.8, s * 0.09), hdHex("#e8c870"))
  const fw = s * 1.15
  const fh = s * 0.72 * lift
  if (fh < 0.5) return
  for (let i = 0; i < Math.ceil(fw); i++) {
    const u = i / fw
    const phase = u * 5.2 - t * 0.0075 + seed
    const wave = Math.sin(phase) * fh * 0.14 * u
    const fold = 0.82 + 0.18 * Math.cos(phase)
    // Swallowtail notch at the free end.
    const notch = u > 0.78 ? ((u - 0.78) / 0.22) * fh * 0.42 : 0
    const top = poleTop + s * 0.04 + wave
    const bottom = top + fh
    const mid = top + fh / 2
    const cloth = hdDarken(color, fold)
    const edge = hdDarken(color, fold * 0.62)
    const hem = Math.max(1, s * 0.08)
    for (let py = Math.floor(top); py < Math.ceil(bottom); py++) {
      if (notch > 0 && Math.abs(py + 0.5 - mid) < notch) continue
      hd.set(Math.floor(poleX + 1 + i), py, py - top < hem || bottom - py < hem ? edge : cloth)
    }
  }
  // A pale roundel near the hoist, where a house mark would sit.
  softDisk(
    hd,
    poleX + 1 + fw * 0.3,
    poleTop + s * 0.04 + fh / 2,
    Math.max(0.8, fh * 0.2),
    hdMix(color, [255, 255, 255], 0.65),
  )
}

// ---------------------------------------------------------------------------
// Static base per frame size and style.

const baseCache = new Map<string, Buffer>()

function composeBase(style: SanguozhiStyle, f: Frame): Buffer {
  const key = `${style}:${f.w}x${f.h}`
  const cached = baseCache.get(key)
  if (cached) return cached
  terrain ??= buildTerrain()
  const hd = createHdCanvas(f.w, f.h, SANGUOZHI_COLUMNS, SANGUOZHI_ROWS)
  const { w, h, pixels } = hd
  const src = terrain.rgb
  // Bilinear resample of the relief onto the frame.
  const gxScale = TERRAIN_W / (MAP_W * f.scale)
  const gyScale = TERRAIN_H / (MAP_H * f.scale)
  for (let y = 0; y < h; y++) {
    const gy = Math.max(0, Math.min(TERRAIN_H - 1.001, (y + 0.5 - f.oy) * gyScale - 0.5))
    const y0 = Math.floor(gy)
    const fy = gy - y0
    const r0 = y0 * TERRAIN_W * 3
    const r1 = Math.min(TERRAIN_H - 1, y0 + 1) * TERRAIN_W * 3
    for (let x = 0; x < w; x++) {
      const gx = Math.max(0, Math.min(TERRAIN_W - 1.001, (x + 0.5 - f.ox) * gxScale - 0.5))
      const x0 = Math.floor(gx)
      const fx = gx - x0
      const c0 = x0 * 3
      const c1 = Math.min(TERRAIN_W - 1, x0 + 1) * 3
      const o = (y * w + x) * 3
      for (let c = 0; c < 3; c++) {
        const top = src[r0 + c0 + c]! * (1 - fx) + src[r0 + c1 + c]! * fx
        const bottom = src[r1 + c0 + c]! * (1 - fx) + src[r1 + c1 + c]! * fx
        pixels[o + c] = top * (1 - fy) + bottom * fy
      }
    }
  }
  const k = f.scale
  // Rivers: a dark bank under a bright channel, widening downstream.
  for (const river of SANGUOZHI_RIVERS) {
    const path = smoothPath(river.points.map(([lon, lat]) => [projectX(f, lon), projectY(f, lat)] as const))
    const r = river.width * k * 1.5
    polyline(hd, path, r * 0.5 + k * 0.9, r + k * 0.9, hdHex("#2b4a5c"), 0.55)
    polyline(hd, path, r * 0.45, r, hdHex("#5d97cc"))
    polyline(hd, path, r * 0.15, r * 0.35, hdHex("#8cc0e6"), 0.6)
  }
  // Roads: packed earth over a soft shadow.
  for (let road = 0; road < SANGUOZHI_ROADS.length; road++) {
    const path = Array.from({ length: 25 }, (_, i) => roadPoint(f, road, i / 24))
    polyline(hd, path, k * 1.5, k * 1.5, hdHex("#3c3220"), 0.35)
    polyline(hd, path, k * 0.85, k * 0.85, hdHex("#e2d3a4"), 0.9)
  }
  for (const city of SANGUOZHI_CITIES)
    drawCity(hd, projectX(f, city.lon), projectY(f, city.lat), citySize(f, city.name))
  const labelSize = Math.max(8, 19 * k)
  for (const city of SANGUOZHI_CITIES) {
    const x = projectX(f, city.lon)
    const y = projectY(f, city.lat)
    const s = citySize(f, city.name)
    const beside = city.label === "left"
    drawText(
      hd,
      city.name,
      beside ? x - s * 1.1 - textWidth(city.name, labelSize) : x - textWidth(city.name, labelSize) / 2,
      beside ? y - labelSize / 2 : y + s * 0.7,
      labelSize,
      [250, 250, 244],
      [16, 14, 12],
    )
  }
  // Time of day as a grade over the whole map.
  const ending = style === "sanguozhi-dusk"
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      const r = pixels[o]!
      const g = pixels[o + 1]!
      const b = pixels[o + 2]!
      if (ending) {
        // Dusk: a low golden sun in the west, blue shadow creeping in from the east.
        const sun = Math.max(0, 1 - x / w) ** 1.6
        const luma = r * 0.3 + g * 0.59 + b * 0.11
        pixels[o] = Math.min(255, (r * 0.62 + luma * 0.18) * (0.72 + sun * 0.55) + sun * 26)
        pixels[o + 1] = Math.min(255, (g * 0.5 + luma * 0.14) * (0.72 + sun * 0.38) + sun * 10)
        pixels[o + 2] = Math.min(255, (b * 0.5 + luma * 0.1) * (0.8 + (1 - sun) * 0.3) + 12)
      } else {
        // Morning: a touch of warmth from the east.
        const sun = Math.max(0, x / w - 0.4) * 0.5
        pixels[o] = Math.min(255, r * 1.02 + 4 + sun * 18)
        pixels[o + 1] = Math.min(255, g * 1.02 + 3 + sun * 10)
        pixels[o + 2] = Math.min(255, b * 0.98)
      }
    }
  }
  if (baseCache.size >= 4) baseCache.delete(baseCache.keys().next().value!)
  const base = Buffer.from(pixels)
  baseCache.set(key, base)
  return base
}

// ---------------------------------------------------------------------------
// Frame.

const LUOYANG = SANGUOZHI_CITIES.find((city) => city.name === "洛陽")!
const FARTHEST = Math.max(...SANGUOZHI_CITIES.map((city) => Math.hypot(city.lon - LUOYANG.lon, city.lat - LUOYANG.lat)))
const FLIP_START_MS = 450
const FLIP_SPAN_MS = 1700
const FLIP_MS = 220

/** When each city's banner turns in the ending, spreading outward from Luoyang. */
export function sanguozhiFlipAt(index: number): number {
  const city = SANGUOZHI_CITIES[index]!
  return FLIP_START_MS + (Math.hypot(city.lon - LUOYANG.lon, city.lat - LUOYANG.lat) / FARTHEST) * FLIP_SPAN_MS
}

/** The date panel's year and month at `elapsedMs`. */
export function sanguozhiDate(style: SanguozhiStyle, elapsedMs: number) {
  if (style === "sanguozhi-dusk") return { year: 280, month: 3 }
  return { year: 184, month: 1 + (Math.floor(Math.max(0, elapsedMs) / 700) % 12) }
}

function drawDatePanel(hd: HdCanvas, f: Frame, style: SanguozhiStyle, t: number) {
  const { year, month } = sanguozhiDate(style, t)
  const text = `${year}年 ${month}月`
  const size = Math.max(9, 24 * f.scale)
  const pad = size * 0.5
  const x0 = Math.max(4, f.w * 0.025)
  const y0 = Math.max(4, f.h * 0.04)
  const x1 = x0 + textWidth(text, size) + pad * 2
  const y1 = y0 + size + pad * 1.6
  const top = hdHex("#23356a")
  const bottom = hdHex("#0f1a3c")
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++)
      blendPixel(hd, x, y, hdMix(top, bottom, (y - y0) / (y1 - y0)), 0.9)
  const line = Math.max(1, f.scale * 1.4)
  const gold = hdHex("#d8bd72")
  hd.rect(x0, y0, x1, y0 + line, gold)
  hd.rect(x0, y1 - line, x1, y1, gold)
  hd.rect(x0, y0, x0 + line, y1, gold)
  hd.rect(x1 - line, y0, x1, y1, gold)
  const inset = line * 2.5
  hd.rect(x0 + inset, y0 + inset, x1 - inset, y0 + inset + 1, hdDarken(gold, 0.6))
  hd.rect(x0 + inset, y1 - inset - 1, x1 - inset, y1 - inset, hdDarken(gold, 0.6))
  drawText(hd, text, x0 + pad, y0 + pad * 0.8, size, [248, 246, 236], [8, 10, 24])
}

/** A marching column: five soldiers with spears, a unit standard, and dust behind. */
function drawArmy(hd: HdCanvas, x: number, y: number, s: number, color: RGB, t: number, heading: number) {
  glow(hd, x - heading * s * 1.4, y + s * 0.2, s * 1.6, hdHex("#d8c49a"), 0.3, 0.45)
  const armor = hdDarken(color, 0.85)
  for (let j = 0; j < 5; j++) {
    const row = j % 2
    const sx = x + (j - 2) * s * 0.36 - row * heading * s * 0.25
    const sy = y + row * s * 0.32 + Math.sin(t * 0.02 + j * 1.7) * s * 0.04
    softDisk(hd, sx, sy + s * 0.22, s * 0.16, hdHex("#2a2420"), 0.45)
    hd.rect(sx - s * 0.11, sy - s * 0.18, sx + s * 0.11, sy + s * 0.18, armor)
    softDisk(hd, sx, sy - s * 0.27, s * 0.11, hdHex("#2e2a26"))
    artLine(
      hd,
      sx + s * 0.13,
      sy + s * 0.15,
      sx + s * 0.13 + heading * s * 0.18,
      sy - s * 0.75,
      Math.max(0.5, s * 0.035),
      Math.max(0.4, s * 0.025),
      hdHex("#d8d2c4"),
    )
  }
  const px = x - heading * s * 0.2
  artLine(hd, px, y + s * 0.2, px, y - s * 1.25, Math.max(0.5, s * 0.05), Math.max(0.5, s * 0.04), hdHex("#3a2a1c"))
  const wave = Math.sin(t * 0.009) * s * 0.06
  hd.rect(px + 1, y - s * 1.22 + wave, px + 1 + s * 0.62, y - s * 0.84 + wave, color)
  hd.rect(px + 1, y - s * 0.88 + wave, px + 1 + s * 0.62, y - s * 0.84 + wave, hdDarken(color, 0.6))
}

/**
 * Paint one frame. Pure and deterministic in `elapsedMs`; the static map is
 * cached per size and style, so later frames only add what moves.
 */
export function renderSanguozhiPixels(width: number, height: number, style: SanguozhiStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, SANGUOZHI_COLUMNS, SANGUOZHI_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const f = frameFor(hd.w, hd.h)
  hd.pixels.set(composeBase(style, f))
  const t = Math.max(0, elapsedMs)
  const ending = style === "sanguozhi-dusk"
  const k = f.scale

  if (!ending) {
    // Cloud shadows drifting east, with the clouds themselves above them.
    for (let i = 0; i < 3; i++) {
      const travel = ((t / CYCLE_MS) * 0.22 + hash2(i, 1)) % 1.3
      const cx = f.ox + (travel - 0.15) * MAP_W * k
      const cy = f.oy + (0.18 + i * 0.27) * MAP_H * k
      const r = (70 + hash2(i, 2) * 50) * k
      glow(hd, cx + r * 0.35, cy + r * 0.5, r * 1.1, [0, 0, 0], 0.2, 0.42)
      for (let p = 0; p < 4; p++)
        glow(hd, cx + (p - 1.5) * r * 0.42, cy + Math.sin(p * 2.1) * r * 0.12, r * 0.55, [255, 255, 252], 0.5, 0.55)
    }
    for (const army of SANGUOZHI_ARMIES) {
      const u = 0.12 + 0.76 * ((army.offset + t / CYCLE_MS) % 1)
      const along = army.reverse ? 1 - u : u
      const [x, y] = roadPoint(f, army.road, along)
      const [nx] = roadPoint(f, army.road, Math.min(1, Math.max(0, along + (army.reverse ? -0.02 : 0.02))))
      drawArmy(hd, x, y, Math.max(5, 13 * k), hdHex(SANGUOZHI_FACTIONS[army.faction]!), t, nx >= x ? 1 : -1)
    }
  } else {
    // Lamps come up in every city as dusk falls.
    for (let i = 0; i < SANGUOZHI_CITIES.length; i++) {
      const city = SANGUOZHI_CITIES[i]!
      const x = projectX(f, city.lon)
      const y = projectY(f, city.lat)
      const s = citySize(f, city.name)
      const flicker = 0.85 + 0.15 * Math.sin(t * 0.011 + i * 2.3)
      glow(hd, x, y, s * 3.2, hdHex("#ffb050"), 0.6 * flicker, 0.8)
      softDisk(hd, x - s * 0.25, y + s * 0.05, Math.max(0.7, s * 0.08), hdHex("#ffd27a"))
      softDisk(hd, x + s * 0.3, y - s * 0.02, Math.max(0.7, s * 0.08), hdHex("#ffd27a"))
    }
  }

  for (let i = 0; i < SANGUOZHI_CITIES.length; i++) {
    const city = SANGUOZHI_CITIES[i]!
    const x = projectX(f, city.lon)
    const y = projectY(f, city.lat)
    const s = citySize(f, city.name)
    let color = hdHex(SANGUOZHI_FACTIONS[city.faction]!)
    let lift = 1
    if (ending) {
      const dt = t - sanguozhiFlipAt(i)
      if (dt >= 0) color = hdHex(SANGUOZHI_UNIFIED)
      // The old banner drops and the new one rises in its place.
      if (Math.abs(dt) < FLIP_MS) lift = Math.abs(dt) / FLIP_MS
      if (dt >= 0 && dt < FLIP_MS * 3)
        glow(hd, x + s * 1.4, y - s * 1.6, s * 3.2, hdHex("#ffe9a0"), 0.6 * (1 - dt / (FLIP_MS * 3)), 1)
    }
    drawBanner(hd, x, y, s, color, t, i * 1.37, lift)
  }

  drawDatePanel(hd, f, style, t)
  return hd.pixels
}
