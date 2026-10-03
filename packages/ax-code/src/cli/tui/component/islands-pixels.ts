import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  ISLANDS,
  ISLANDS_CLOUDS,
  ISLANDS_COLUMNS,
  ISLANDS_COLORS,
  ISLANDS_CYCLE_MS,
  ISLANDS_DUSK_SUN,
  ISLANDS_FALLS,
  ISLANDS_ROWS,
  ISLANDS_SEA_TOP,
  ISLANDS_SUN,
  islandsBirds,
  islandsFireflies,
  islandsSkyRgb,
  type IslandsStyle,
} from "./islands-view-model"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Freeform HD renderer. Hazed far islets with their own falls, three floating
 * islands with domed turf, strata-cut rock, stalactite undersides, hanging
 * roots, trees and a ruin; layered clouds; waterfalls with moving strands,
 * source foam and sea mist; a perspective sea with swell lines and a
 * sun reflection. Day is high sun and gulls; dusk is a backlit sunset with
 * rim-lit rock and fireflies. Layout and animation phase come from the shared
 * scene model. Pure: every pixel derives from `elapsedMs`.
 */
export function renderIslandsPixels(width: number, height: number, style: IslandsStyle, elapsedMs: number): Buffer {
  let w = Math.max(0, Math.floor(width))
  let h = Math.max(0, Math.floor(height))
  if (w > 0 && h > 0) {
    const scale = Math.min(1, 1920 / w, 1080 / h)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  const hd = createHdCanvas(w, h, ISLANDS_COLUMNS, ISLANDS_ROWS)
  const { cw, ch, X, Y } = hd
  if (w === 0 || h === 0) return hd.pixels
  const night = style === "islands-dusk"
  const c = ISLANDS_COLORS[style]
  const unit = Math.max(1, Math.min(cw, ch / 2))
  const phase = (Math.max(0, elapsedMs) % ISLANDS_CYCLE_MS) / ISLANDS_CYCLE_MS
  const theta = phase * Math.PI * 2
  const grass = hdHex(c.grass),
    rock = hdHex(c.rock),
    rockDark = hdHex(c.rockDark)
  const falls = hdHex(c.falls),
    shimmer = hdHex(c.shimmer),
    sun = hdHex(c.sun)
  const sunCell = night ? ISLANDS_DUSK_SUN : ISLANDS_SUN
  const sunX = X(sunCell.x + 0.5),
    sunY = Y(sunCell.y + 0.5)
  const seaY = Y(ISLANDS_SEA_TOP)
  const skyAt = (y: number): RGB => islandsSkyRgb(style, h <= 1 ? 0 : y / (h - 1))

  const tint = (x: number, y: number, color: RGB, a: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return
    const i = (y * w + x) * 3
    for (let k = 0; k < 3; k++) hd.pixels[i + k] = Math.round(hd.pixels[i + k]! + (color[k]! - hd.pixels[i + k]!) * a)
  }
  const glow = (cx: number, cy: number, radius: number, color: RGB, strength: number, floor = h) => {
    const xa = Math.max(0, Math.floor(cx - radius)),
      xb = Math.min(w - 1, Math.ceil(cx + radius))
    const ya = Math.max(0, Math.floor(cy - radius)),
      yb = Math.min(floor - 1, Math.ceil(cy + radius))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
        if (d < 1) tint(x, y, color, strength * (1 - d) * (1 - d))
      }
    }
  }
  const cloud = (cx: number, cy: number, size: number, lit: RGB, shade: RGB) => {
    for (let k = 0; k < 6; k++) {
      const bx = cx + (k - 2.5) * size * 0.8
      const lift = Math.sin(((k + 0.5) / 6) * Math.PI)
      const r = size * (0.55 + lift * 0.5)
      hd.blob(bx, cy - lift * size * 0.25 + r * 0.25, r, r * 0.55, shade)
    }
    for (let k = 0; k < 6; k++) {
      const bx = cx + (k - 2.5) * size * 0.8
      const lift = Math.sin(((k + 0.5) / 6) * Math.PI)
      const r = size * (0.55 + lift * 0.5)
      hd.blob(bx - r * 0.08, cy - lift * size * 0.25, r * 0.92, r * 0.5, lit)
    }
  }

  // --- Sky --------------------------------------------------------------------
  hd.sky((t) => skyAt(t * (h - 1)))
  if (night) {
    // Sunset: a wide fiery bloom, then the disk sinking toward the sea.
    glow(sunX, sunY, w * 0.7, hdHex("#ff8a4a"), 0.5, Math.ceil(seaY))
    glow(sunX, sunY, unit * 22, hdHex("#ffc070"), 0.55, Math.ceil(seaY))
    for (let i = 0; i < 14; i++) {
      // Faint god rays fan out above the horizon.
      const a = -Math.PI + (i / 13) * Math.PI
      for (let r = unit * 4; r < unit * 60; r += 2) {
        tint(
          Math.round(sunX + Math.cos(a) * r),
          Math.round(sunY + Math.sin(a) * r),
          hdHex("#ffd090"),
          0.05 * (1 - r / (unit * 60)) * (i % 2 ? 0.7 : 1),
        )
      }
    }
    hd.disk(sunX, sunY, unit * 3.4, hdMix(sun, hdHex("#fff0c0"), 0.4))
    hd.disk(sunX, sunY, unit * 2.5, hdMix(sun, hdHex("#fff6d8"), 0.7))
    // Stars emerge in the violet zenith.
    for (let i = 0; i < 40; i++) {
      const sx = Math.floor(hash(i + 2) * w),
        sy = Math.floor(Math.pow(hash(i + 40), 1.6) * seaY * 0.3)
      hd.set(sx, sy, hdMix(skyAt(sy), hdHex("#ffe8e0"), 0.4 + 0.4 * Math.sin(theta * 2 + i)))
    }
  } else {
    glow(sunX, sunY, w * 0.5, hdHex("#fffbe0"), 0.4, Math.ceil(seaY))
    glow(sunX, sunY, unit * 14, hdHex("#fffbe0"), 0.6, Math.ceil(seaY))
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + theta * 0.1
      for (let r = unit * 3; r < unit * 28; r += 2) {
        tint(
          Math.round(sunX + Math.cos(a) * r),
          Math.round(sunY + Math.sin(a) * r),
          hdHex("#fffbe0"),
          0.1 * (1 - r / (unit * 28)),
        )
      }
    }
    hd.disk(sunX, sunY, unit * 2.4, hdHex("#fffbea"))
  }
  const cloudLit = hdHex(c.cloud)
  const cloudShade = hdMix(cloudLit, night ? hdHex("#7a3a5a") : hdHex("#9cc0da"), 0.6)
  // Clouds drift slowly and loop with the cycle.
  const clouds: [number, number, number][] = [
    ...ISLANDS_CLOUDS.map(([x, y], i) => [x + 3, y + 0.3, 3.4 + i * 0.6] as [number, number, number]),
    [30, 5.8, 2.2],
    [68, 4.5, 2.6],
    [8, 14.5, 2.2],
  ]
  clouds.forEach(([x, y, size], i) => {
    const drift = Math.sin(theta + i * 1.7) * 1.2
    cloud(X(x + drift), Y(y), unit * size * 1.4, cloudLit, cloudShade)
  })

  // --- Far islets, hazed into the sky ------------------------------------------------
  const haze = hdMix(skyAt(Y(15)), night ? hdHex("#c4607a") : hdHex("#cfe6f0"), 0.5)
  for (const [ix, iy, iw, seed] of [
    [22, 15.5, 4.5, 1],
    [43, 14.8, 3.2, 2],
    [54, 17.2, 2.4, 3],
  ] as const) {
    const cx = X(ix),
      top = Y(iy)
    const tone = hdMix(hdDarken(rockDark, 1.4), haze, 0.55)
    for (let x = Math.floor(cx - cw * iw); x < Math.ceil(cx + cw * iw); x++) {
      const u = (x + 0.5 - cx) / (cw * iw)
      if (Math.abs(u) > 1) continue
      const bottom =
        top + ch * 1.4 * Math.pow(1 - Math.abs(u), 0.7) + hash(Math.floor(x / (unit * 2)) + seed) * ch * 0.3
      for (let y = Math.floor(top - ch * 0.2 * (1 - u * u)); y < bottom; y++)
        hd.set(x, y, y < top + ch * 0.12 ? hdMix(tone, grass, 0.4) : tone)
    }
    // Hairline fall from each islet.
    hd.rect(cx + cw * iw * 0.2, top + ch * 0.7, cx + cw * iw * 0.2 + 1.2, seaY, hdMix(haze, falls, 0.3))
  }

  // --- Floating islands -------------------------------------------------------------------
  const topAtList: ((x: number) => number)[] = []
  ISLANDS.forEach(([x0, x1, top], idx) => {
    const mid = (x0 + x1 + 1) / 2,
      half = (x1 - x0 + 1) / 2
    const cx = X(mid),
      halfPx = X(half)
    const dir = Math.sign(sunX - cx) || 1
    const topAt = (x: number) => {
      const u = (x + 0.5 - cx) / halfPx
      return Y(top + 0.3) - ch * 0.32 * (1 - u * u) + Math.sin(x * 0.09 + idx * 2) * ch * 0.05
    }
    topAtList[idx] = topAt
    const depth = ch * (5.6 + (idx === 0 ? 0.3 : 0))
    const grassTone = night ? hdDarken(grass, 1.15) : grass
    for (let x = Math.floor(cx - halfPx); x < Math.ceil(cx + halfPx); x++) {
      const u = (x + 0.5 - cx) / halfPx
      const au = Math.abs(u)
      if (au >= 1) continue
      const tY = topAt(x)
      let bottom = Y(top + 0.5) + depth * Math.pow(1 - Math.pow(au, 1.7), 0.85)
      const seg = Math.floor(x / (unit * 2.6))
      const frac = (x / (unit * 2.6)) % 1
      bottom += (hash(seg + idx * 17) - 0.5) * ch * 0.9 * (1 - au)
      if (hash(seg * 3 + idx * 5) > 0.62)
        bottom += ch * (0.9 + hash(seg + 4) * 1.5) * (1 - Math.abs(frac - 0.5) * 2) * (1 - au * 0.6)
      const lit = clamp01(0.5 + 0.55 * u * dir)
      for (let y = Math.floor(tY); y < bottom; y++) {
        const t = clamp01((y - tY) / (bottom - tY || 1))
        const strata = Math.sin(y * 0.26 + Math.sin(x * 0.05 + idx) * 1.8)
        let col = hdMix(hdDarken(rockDark, 1.15), hdDarken(rock, 1.05), clamp01(lit * 0.75 + 0.15 - t * 0.35))
        col = hdDarken(col, 0.93 + strata * 0.06)
        if (strata > 0.92) col = hdMix(col, hdDarken(rock, 1.25), night ? 0.1 : 0.25)
        if (Math.sin(x * 0.23 + y * 0.11 + idx) > 0.93) col = hdDarken(col, 0.78)
        // Warm rim where rock faces the low sun.
        if (night) {
          const rim = clamp01(1 - Math.abs(x - sunX) / (w * 0.4)) * (1 - t) * 0.4 + (au > 0.8 ? 0.25 * lit : 0)
          col = hdMix(col, hdHex("#ff9a58"), clamp01(rim) * 0.6)
        }
        // Turf: ragged lip, brighter on the lit side.
        const lip = ch * (0.4 + 0.25 * Math.sin(x * 0.27 + idx * 3)) * (1 - au * 0.5)
        if (y < tY + lip) {
          col = hdMix(
            hdDarken(grassTone, 0.8),
            hdMix(grassTone, hdHex("#bde07a"), night ? 0.1 : 0.4),
            clamp01(lit * 0.9 - ((y - tY) / lip) * 0.4 + 0.2),
          )
          if (hash(x * 0.4 + y) > 0.88) col = hdDarken(col, 0.8)
        }
        hd.set(x, y, col)
      }
      // Hanging roots and vines under the turf lip.
      if (hash(seg * 7 + idx) > 0.55 && Math.abs(frac - 0.5) < 0.1) {
        const len = ch * (0.9 + hash(seg + 30) * 1.7) * (1 - au * 0.5)
        const sway = Math.sin(theta + seg) * unit * 0.3
        for (let y = 0; y < len; y++)
          hd.set(
            Math.round(x + sway * (y / len)),
            Math.floor(tY + ch * 0.5 + y),
            hdMix(grassTone, hdHex("#6a4a2c"), 0.5),
          )
      }
    }
    // Trees and a ruin on the turf.
    const count = Math.max(2, Math.round(half / 3.2))
    for (let k = 0; k < count; k++) {
      const tx = cx + (hash(idx * 13 + k * 3) - 0.5) * halfPx * 1.55
      const ty = topAt(tx) + ch * 0.2
      const sc = unit * (1.2 + hash(idx + k * 7) * 0.9) * (idx === 1 ? 1.1 : 1)
      const crownA = hdMix(hdDarken(grassTone, 0.7), hdHex(night ? "#1a2e24" : "#2a6a34"), 0.5)
      const crownB = hdMix(grassTone, hdHex(night ? "#e89a58" : "#9ed068"), night ? 0.18 : 0.3)
      if (k % 3 === 2) {
        // Pine: stacked triangles.
        hd.rect(tx - sc * 0.15, ty - sc * 1.0, tx + sc * 0.15, ty, hdDarken(rockDark, 1.1))
        for (let tier = 0; tier < 3; tier++) {
          const ty0 = ty - sc * (0.8 + tier * 1.2)
          for (let y = 0; y < sc * 1.6; y++) {
            const u = y / (sc * 1.6)
            const half2 = sc * (0.25 + u * 0.95) * (1 - tier * 0.18)
            hd.rect(
              tx - half2,
              ty0 - sc * 1.0 + y * 0.9 + sc * 0.3,
              tx + half2,
              ty0 - sc * 1.0 + y * 0.9 + sc * 0.3 + 1,
              hdMix(crownA, crownB, (1 - u) * 0.5 + (tx > cx ? 0.2 : 0)),
            )
          }
        }
      } else {
        hd.rect(tx - sc * 0.14, ty - sc * 1.7, tx + sc * 0.14, ty, hdDarken(rockDark, 1.25))
        hd.blob(tx, ty - sc * 2.1, sc * 1.35, sc * 1.1, crownA)
        hd.blob(tx - sc * 0.4, ty - sc * 2.2, sc * 0.95, sc * 0.8, hdMix(crownA, crownB, 0.4))
        hd.blob(tx + sc * 0.5, ty - sc * 2.5, sc * 0.8, sc * 0.65, hdMix(crownA, crownB, 0.65))
      }
      hd.blob(tx + sc * 0.4, ty + 1, sc * 1.2, ch * 0.08, hdDarken(grassTone, 0.65))
    }
    if (idx === 0) {
      // Ancient arch and a pair of pillars on the main island.
      const ax = cx + halfPx * 0.1
      const ay = topAt(ax) + ch * 0.2
      const stone = hdMix(hdDarken(rock, 1.3), night ? hdHex("#ffb07a") : hdHex("#f2eada"), night ? 0.1 : 0.25)
      for (const side of [-1, 1]) {
        hd.rect(
          ax + side * unit * 2.6 - unit * 0.55,
          ay - ch * 2.1,
          ax + side * unit * 2.6 + unit * 0.55,
          ay,
          hdDarken(stone, side > 0 ? 1 : 0.8),
        )
        hd.rect(
          ax + side * unit * 2.6 - unit * 0.75,
          ay - ch * 2.2,
          ax + side * unit * 2.6 + unit * 0.75,
          ay - ch * 1.95,
          stone,
        )
      }
      hd.rect(ax - unit * 3.4, ay - ch * 2.5, ax + unit * 3.4, ay - ch * 2.15, stone)
      hd.rect(ax - unit * 3.4, ay - ch * 2.15, ax + unit * 3.4, ay - ch * 2.07, hdDarken(stone, 0.7))
      if (night) glow(ax, ay - ch * 1.0, unit * 3, hdHex("#ffb860"), 0.45)
    }
  })

  // --- Waterfalls --------------------------------------------------------------------------------
  const sheet = hdMix(falls, hdHex("#ffffff"), 0.35)
  ISLANDS_FALLS.forEach(([fallX, fallTop], i) => {
    const x0 = X(fallX + 0.5)
    const y0 = Y(fallTop + 0.2)
    const len = seaY - y0
    for (let y = Math.floor(y0); y < Math.ceil(seaY); y++) {
      const t = (y - y0) / (len || 1)
      const wobble = Math.sin(y * 0.05 + i) * unit * 0.25 * t
      const half = unit * (0.5 + t * 0.55)
      const cx = x0 + wobble
      for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
        const u = Math.abs(x + 0.5 - cx) / half
        // Streaks run downward with the loop (three periods per cycle).
        const streak = Math.sin(y * 0.11 + Math.floor((x - cx) / (unit * 0.28)) * 2.3 - theta * 3) * 0.5 + 0.5
        const a = (0.62 - u * 0.28) * (0.75 + 0.25 * t)
        tint(x, y, hdMix(falls, sheet, streak * 0.8), a + streak * 0.15)
      }
    }
    // Foam lip where the water leaves the island.
    hd.blob(x0, y0, unit * 1.3, unit * 0.45, sheet)
    // Mist plume and ripples where the fall meets the sea.
    const pulse = 0.5 + 0.5 * Math.sin(theta * 2 + i)
    glow(x0, seaY, unit * 6 + pulse * unit * 2, sheet, 0.45)
    for (let k = 0; k < 10; k++) {
      const rise = ((k / 10 + phase * (1 + (k % 2) * 0.5)) % 1) * ch * 3
      const sx = x0 + Math.sin(k * 2.1 + i) * unit * (0.5 + rise / ch)
      glow(sx, seaY - rise, unit * 1.6, sheet, 0.3 * (1 - rise / (ch * 3)))
    }
  })

  // --- Sea -------------------------------------------------------------------------------------
  hd.water(ISLANDS_SEA_TOP, ISLANDS_ROWS, hdHex(c.sea), hdHex(c.seaDeep), theta)
  const hazeSea = night ? hdHex("#e07a60") : hdHex("#d8f0f6")
  for (let y = Math.floor(seaY); y < Math.min(h, Math.ceil(seaY + ch * 1.4)); y++) {
    const a = (1 - (y - seaY) / (ch * 1.4)) * (night ? 0.45 : 0.4)
    for (let x = 0; x < w; x++) tint(x, y, hazeSea, a)
  }
  // Reflect the islands' dark undersides and falls faintly.
  for (let y = Math.floor(seaY); y < h; y++) {
    const v = (y - seaY) / (h - seaY || 1)
    for (let x = 0; x < w; x++) {
      const dx = Math.sin(y * 0.45 + x * 0.01 + theta) * unit * 0.8
      const si = Math.max(0, Math.floor(seaY - (y - seaY) * 1.6 - 1))
      const j = (si * w + Math.max(0, Math.min(w - 1, Math.round(x + dx)))) * 3
      const src: RGB = [hd.pixels[j]!, hd.pixels[j + 1]!, hd.pixels[j + 2]!]
      tint(x, y, src, 0.28 * (1 - v * 0.7))
    }
  }
  hd.reflection(
    sunCell.x + 0.5,
    ISLANDS_SEA_TOP,
    ISLANDS_ROWS,
    night ? hdHex("#ffb870") : shimmer,
    theta,
    night ? 5 : 3.5,
  )
  const swell = night ? hdMix(hdHex(c.sea), hdHex("#ff9a6a"), 0.5) : hdMix(hdHex(c.sea), shimmer, 0.5)
  for (let k = 0; k < 11; k++) {
    const v = Math.pow((k + 0.4) / 11, 1.7)
    const y = Math.round(seaY + ch * 0.3 + v * (h - seaY - ch * 0.4))
    const len = unit * (3 + v * 14),
      gap = unit * (8 + v * 24)
    const drift = (phase * gap * (k % 2 ? 1 : -1) + hash(k + 3) * gap) % gap
    for (let x0 = -gap + drift; x0 < w; x0 += gap) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, x0 + len); x++) {
        const edge = Math.min(x - x0, x0 + len - x) / (len * 0.5)
        tint(x, y, swell, 0.5 * clamp01(edge * 2))
      }
    }
  }
  for (const [fallX] of ISLANDS_FALLS) {
    const fx = X(fallX + 0.5)
    for (let r = 1; r <= 3; r++) {
      const ring = (phase * 1.5 + r / 3) % 1
      const rx = unit * (1.5 + ring * 6),
        ry = unit * (0.3 + ring * 1.2)
      for (let a = 0; a < 40; a++) {
        const ang = (a / 40) * Math.PI * 2
        tint(
          Math.round(fx + Math.cos(ang) * rx),
          Math.round(seaY + ch * 0.35 + Math.sin(ang) * ry),
          sheet,
          0.5 * (1 - ring),
        )
      }
    }
  }

  // --- Birds / fireflies ---------------------------------------------------------------------
  if (night) {
    const firefly = hdHex(c.firefly)
    for (const mote of islandsFireflies(elapsedMs)) {
      const on = mote.char === "*"
      const fx = X(mote.x + 0.5),
        fy = Y(mote.y + 0.5)
      glow(fx, fy, unit * (on ? 5 : 2.2), firefly, on ? 0.7 : 0.3)
      hd.disk(fx, fy, Math.max(on ? 1.8 : 1, unit * (on ? 0.35 : 0.2)), hdMix(firefly, [255, 255, 255], on ? 0.5 : 0))
    }
    // Birds as silhouettes against the sunset.
    for (let i = 0; i < 3; i++) {
      const bx = X(((20 + i * 6 + phase * 40) % (ISLANDS_COLUMNS + 6)) - 3),
        by = Y(5 + i * 1.2 + Math.sin(theta + i) * 0.4)
      const flap = Math.sin(theta * 4 + i) * unit * 0.5
      for (const side of [-1, 1]) {
        for (let k = 0; k <= 12; k++) {
          const u = k / 12
          hd.disk(
            bx + side * u * unit * 1.9,
            by - Math.sin(u * Math.PI * 0.8) * (unit * 0.5 + flap) + u * flap * 0.5,
            Math.max(0.8, unit * 0.1),
            hdHex(c.bird),
          )
        }
      }
    }
  } else {
    const bird = hdHex(c.bird)
    islandsBirds(elapsedMs).forEach((b, i) => {
      const bx = X(b.x + 0.5),
        by = Y(b.y + 0.5)
      const flap = Math.sin(theta * 4 + i * 1.5) * unit * 0.6
      for (const side of [-1, 1]) {
        for (let k = 0; k <= 12; k++) {
          const u = k / 12
          hd.disk(
            bx + side * u * unit * 2,
            by - Math.sin(u * Math.PI * 0.8) * (unit * 0.5 + flap) + u * flap * 0.5,
            Math.max(0.9, unit * 0.11),
            bird,
          )
        }
      }
      hd.disk(bx, by, Math.max(1.2, unit * 0.2), bird)
    })
  }
  return hd.pixels
}
