import {
  FESTIVAL_BURSTS,
  FESTIVAL_BURST_BRIGHT,
  FESTIVAL_BURST_DIM,
  FESTIVAL_BURST_HUES,
  FESTIVAL_COLUMNS,
  FESTIVAL_CYCLE_MS,
  FESTIVAL_GROUND_TOP,
  FESTIVAL_LANTERN_COLORS,
  FESTIVAL_MOON,
  FESTIVAL_MOONLIGHT,
  FESTIVAL_ROWS,
  FESTIVAL_TOWN,
  FESTIVAL_TOWN_ROW,
  FESTIVAL_COLORS,
  festivalBurstAge,
  festivalLanternBright,
  festivalLanterns,
  festivalParticles,
  festivalRocket,
  festivalSkyRgb,
  type FestivalStyle,
} from "./festival-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import { clamp01 } from "./atmos-paint"

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
/** Burst sparks reach this many cells in the shared model. */
const SPARK_REACH = 5

/**
 * Freeform HD renderer. Fireworks: rockets with trails, white-hot ignition,
 * two spark shells with comet tails and falling embers, sky and rooftops lit
 * by each burst, and a river that mirrors them. Lanterns: paper lanterns
 * rising over the same town, each with its own halo and river reflection,
 * under a bloomed moon. Rooftops, the pagoda, and window lights come from
 * the shared model. Pure and deterministic: everything derives from
 * `elapsedMs`, and both scenes loop with the cycle.
 */
export function renderFestivalPixels(width: number, height: number, style: FestivalStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, FESTIVAL_COLUMNS, FESTIVAL_ROWS)
  const { w, h, cw, ch } = hd
  if (w === 0 || h === 0) return hd.pixels
  const fireworks = style === "festival-fireworks"
  const c = FESTIVAL_COLORS[style]
  const unit = Math.max(1, Math.min(cw, ch))
  const t = Math.max(0, elapsedMs) % FESTIVAL_CYCLE_MS
  const phase = t / FESTIVAL_CYCLE_MS
  /** Cell-center scene coordinates, matching the text path. */
  const X = (sx: number) => (sx + 0.5) * cw
  const Y = (sy: number) => (sy + 0.5) * ch

  const tint = (x: number, y: number, color: RGB, a: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return
    const i = (y * w + x) * 3
    for (let k = 0; k < 3; k++) hd.pixels[i + k] = Math.round(hd.pixels[i + k]! + (color[k]! - hd.pixels[i + k]!) * a)
  }
  /** Soft additive radial light. */
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
  const dot = (cx: number, cy: number, r: number, color: RGB, a: number) => {
    const xa = Math.floor(cx - r),
      xb = Math.ceil(cx + r),
      ya = Math.floor(cy - r),
      yb = Math.ceil(cy + r)
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (d <= r) tint(x, y, color, a * (d < r - 1 ? 1 : 0.6))
      }
    }
  }
  /** Fading streak from (x0,y0) (tail) to (x1,y1) (head). */
  const streak = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    color: RGB,
    aTail: number,
    aHead: number,
  ) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, r * 0.8)))
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      dot(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, r * (0.55 + 0.45 * u), color, aTail + (aHead - aTail) * u)
    }
  }

  // --- Sky --------------------------------------------------------------------
  const horizon = Y(FESTIVAL_TOWN_ROW - 1.5)
  hd.sky((v) => festivalSkyRgb(style, v))
  const townWarm = hdHex(c.townDot)
  // The town's light hazes the lower sky.
  glow(w / 2, horizon, w * 0.6, hdMix(townWarm, hdHex("#c8553d"), 0.5), fireworks ? 0.22 : 0.3, Math.ceil(horizon))
  const starColor = hdHex(c.sky)
  for (let i = 0; i < 90; i++) {
    const sx = Math.floor(hash(i + 1) * w),
      sy = Math.floor(Math.pow(hash(i + 70), 1.5) * horizon * 0.9)
    if (!fireworks && Math.hypot(sx - X(FESTIVAL_MOON.x), sy - Y(FESTIVAL_MOON.y)) < unit * 6) continue
    const tw = 0.5 + 0.5 * Math.sin(2 * Math.PI * (phase * (1 + (i % 3)) + hash(i + 140)))
    hd.set(sx, sy, hdMix(festivalSkyRgb(style, sy / h), starColor, 0.35 + 0.55 * tw))
  }
  if (!fireworks) {
    const mx = X(FESTIVAL_MOON.x),
      my = Y(FESTIVAL_MOON.y)
    const moon = hdHex(FESTIVAL_MOONLIGHT)
    const mr = Math.max(2, unit * 1.9)
    glow(mx, my, mr * 7, hdMix(moon, hdHex("#5a6aa8"), 0.5), 0.5)
    glow(mx, my, mr * 2.8, moon, 0.35)
    hd.disk(mx, my, mr, moon)
    const mare = hdMix(moon, hdHex("#8b97c0"), 0.5)
    hd.disk(mx - mr * 0.3, my - mr * 0.15, mr * 0.28, mare)
    hd.disk(mx + mr * 0.28, my + mr * 0.25, mr * 0.2, mare)
    hd.disk(mx + mr * 0.2, my - mr * 0.5, mr * 0.12, mare)
    // Wispy clouds catching moonlight.
    for (let i = 0; i < 3; i++) {
      const cx = X(14 + i * 24 + Math.sin(phase * 2 * Math.PI + i) * 0.6),
        cy = Y(5 + (i % 2) * 3)
      for (let k = 0; k < 6; k++) {
        hd.blob(
          cx + k * unit * 4,
          cy + Math.sin(k * 1.1 + i) * unit * 0.6,
          unit * 8,
          unit * 0.9,
          hdMix(festivalSkyRgb(style, cy / h), moon, 0.07),
        )
      }
    }
  }

  // --- Distant hills, town, pagoda ---------------------------------------------------------------
  const groundY = Y(FESTIVAL_GROUND_TOP - 0.5)
  const hillA = hdMix(festivalSkyRgb(style, horizon / h), hdHex(c.ground), 0.7)
  for (let x = 0; x < w; x++) {
    const s = x / cw
    const top = horizon - ch * (1.2 + Math.sin(s * 0.13 + 1) * 0.8 + Math.sin(s * 0.41) * 0.35)
    for (let y = Math.max(0, Math.floor(top)); y < groundY; y++)
      hd.set(x, y, hdMix(hillA, hdDarken(hillA, 0.7), clamp01((y - top) / (groundY - top))))
  }
  const roof = hdDarken(hdHex(c.ground), 1.9)
  const wall = hdDarken(hdHex(c.ground), 1.35)
  const windowCol = hdMix(townWarm, hdHex("#fff0c0"), 0.25)
  const house = (cxCells: number, widthCells: number, rowsHigh: number, seed: number) => {
    const x0 = X(cxCells - widthCells / 2),
      x1 = X(cxCells + widthCells / 2)
    const base = groundY,
      topY = base - rowsHigh * ch
    hd.rect(x0, topY, x1, base, wall)
    // Gabled roof with an overhang.
    const rh = ch * 0.8
    for (let y = 0; y < rh; y++) {
      const u = y / rh
      const mid = (x0 + x1) / 2
      const half = ((x1 - x0) / 2) * (0.25 + 0.75 * u) + unit * 0.8 * u
      hd.rect(mid - half, topY - rh + y, mid + half, topY - rh + y + 1, y < 2 ? hdDarken(roof, 1.25) : roof)
    }
    // Lit windows.
    const cols = Math.max(1, Math.floor(widthCells / 1.4))
    for (let k = 0; k < cols; k++) {
      for (let r = 0; r < Math.max(1, Math.floor(rowsHigh)); r++) {
        if (hash(seed * 7 + k * 3 + r) < 0.35) continue
        const wx = x0 + ((k + 0.5) * (x1 - x0)) / cols
        const wy = topY + (r + 0.5) * ch * 0.7 + ch * 0.1
        const flick = 0.85 + 0.15 * Math.sin(phase * 2 * Math.PI * (1 + (k % 2)) + seed + k)
        hd.rect(wx - unit * 0.3, wy, wx + unit * 0.3, wy + unit * 0.55, hdDarken(windowCol, flick))
      }
    }
  }
  for (const [cx, wd, hi, seed] of [
    [3, 5, 1.6, 1],
    [17, 6, 1.4, 2],
    [31, 4, 1.7, 3],
    [45, 6, 1.5, 4],
    [60, 5, 1.8, 5],
    [72, 6, 1.5, 6],
  ] as const) {
    house(cx, wd, hi, seed)
  }
  // Pagoda at the center: three tiers with upturned eaves and a finial.
  const pagodaX = X(FESTIVAL_TOWN[2]!)
  const tiers = 3
  for (let i = 0; i < tiers; i++) {
    const half = unit * (3.3 - i * 0.7)
    const yB = groundY - ch * (0.1 + i * 1.15)
    hd.rect(pagodaX - half * 0.6, yB - ch * 0.75, pagodaX + half * 0.6, yB, wall)
    hd.rect(pagodaX - half * 0.12, yB - ch * 0.62, pagodaX + half * 0.12, yB - ch * 0.12, windowCol)
    for (let y = 0; y < ch * 0.4; y++) {
      const u = y / (ch * 0.4)
      hd.rect(
        pagodaX - half * (1.1 + u * 0.1) - (1 - u) * unit * 0.6,
        yB - ch * 0.75 - ch * 0.4 + y,
        pagodaX + half * (1.1 + u * 0.1) + (1 - u) * unit * 0.6,
        yB - ch * 0.75 - ch * 0.4 + y + 1,
        roof,
      )
    }
  }
  hd.rect(pagodaX - 1, groundY - ch * 4.4, pagodaX + 1, groundY - ch * 3.4, roof)
  // Town lights from the shared model: lantern strings at each marker.
  for (const dx of FESTIVAL_TOWN) {
    const cx = X(dx),
      cy = Y(FESTIVAL_TOWN_ROW)
    const flick = 0.8 + 0.2 * Math.sin(phase * 2 * Math.PI * 3 + dx)
    glow(cx, cy, unit * 5, townWarm, 0.35 * flick, Math.ceil(groundY))
    hd.disk(cx, cy, Math.max(1.5, unit * 0.4), hdMix(townWarm, [255, 255, 255], 0.3))
  }

  // --- River -------------------------------------------------------------------------------------
  const riverTop = groundY
  const riverA = hdMix(hdHex(c.ground), hdHex(fireworks ? "#1a2a4a" : "#233868"), 0.55)
  const riverB = hdHex(c.ground)
  for (let y = Math.floor(riverTop); y < h; y++) {
    const v = (y - riverTop) / (h - riverTop || 1)
    for (let x = 0; x < w; x++) {
      const ripple = Math.sin(x * 0.08 + y * 0.9 + phase * 2 * Math.PI * 2) * 0.5 + 0.5
      hd.set(x, y, hdDarken(hdMix(riverA, riverB, v), 0.9 + ripple * 0.18))
    }
  }
  // Mirrored town lights.
  for (const dx of FESTIVAL_TOWN) {
    for (let y = Math.floor(riverTop); y < h; y += 2) {
      const v = (y - riverTop) / (h - riverTop || 1)
      const wob = Math.sin(y * 0.7 + phase * 2 * Math.PI * 2 + dx) * unit * 0.8
      hd.rect(X(dx) + wob - unit * 0.5, y, X(dx) + wob + unit * 0.5, y + 1, hdMix(townWarm, riverB, 0.4 + v * 0.5))
    }
  }

  // --- Fireworks -------------------------------------------------------------------------------------
  if (fireworks) {
    const bright = hdHex(FESTIVAL_BURST_BRIGHT)
    for (let burst = 0; burst < FESTIVAL_BURSTS.length; burst++) {
      const center = FESTIVAL_BURSTS[burst]!
      const hue = hdHex(FESTIVAL_BURST_HUES[burst]!),
        dim = hdHex(FESTIVAL_BURST_DIM[burst]!)
      const alt = hdHex(FESTIVAL_BURST_HUES[(burst + 1) % FESTIVAL_BURSTS.length]!)
      const age = festivalBurstAge(elapsedMs, burst)
      const cx = X(center.x),
        cy = Y(center.y)
      const life = clamp01(1 - age / 2200)
      // Sky and rooftop light from the burst.
      if (age < 2200) {
        const flash = age < 250 ? 1 - age / 250 : 0
        glow(cx, cy, unit * 24, hue, 0.26 * life + 0.3 * flash, Math.ceil(groundY))
        glow(cx, cy, unit * 9, hdMix(hue, bright, 0.5), 0.3 * life + 0.4 * flash, Math.ceil(groundY))
      }
      const rocket = festivalRocket(elapsedMs, burst)
      if (rocket) {
        const rx = X(rocket.x),
          ry = Y(rocket.y)
        streak(rx, ry + ch * 5, rx, ry, Math.max(1, unit * 0.25), dim, 0, 0.9)
        dot(rx, ry, Math.max(1.5, unit * 0.35), bright, 1)
        glow(rx, ry, unit * 3, bright, 0.5)
      }
      if (age >= 2200) continue
      // Outer shell with comet tails and gravity.
      const grow = 1 - Math.pow(1 - clamp01(age / 1500), 2)
      const R = grow * SPARK_REACH * 2.4 * cw
      const drop = Math.pow(age / 1000, 2) * ch * 1.4
      const heat = clamp01(age / 1100)
      for (let k = 0; k < 30; k++) {
        const a = (2 * Math.PI * k) / 30 + burst * 0.3
        const wob = 1 + (hash(k + burst * 40) - 0.5) * 0.25
        const hx = cx + Math.cos(a) * R * wob,
          hy = cy + Math.sin(a) * R * wob * 0.85 + drop
        const tailR = Math.max(0, R * wob - unit * (3.5 + 6 * (1 - grow)))
        const tx = cx + Math.cos(a) * tailR,
          ty = cy + Math.sin(a) * tailR * 0.85 + drop * 0.5
        const col = hdMix(bright, k % 3 === 0 ? alt : hue, heat)
        const tw = 0.7 + 0.3 * Math.sin(age * 0.03 + k)
        streak(tx, ty, hx, hy, Math.max(1, unit * 0.28), col, 0.0, 0.95 * life * tw)
        dot(hx, hy, Math.max(1, unit * 0.34), hdMix(col, bright, 0.35), life * tw)
      }
      // Inner ring straight from the shared particle model.
      for (const p of festivalParticles(elapsedMs, burst)) {
        if (p.stage < 0) continue
        const px = X(p.x),
          py = Y(p.y)
        const col = p.stage === 0 ? bright : p.stage === 1 ? hue : dim
        dot(px, py, Math.max(1.2, unit * 0.4), col, 1)
        glow(px, py, unit * 2.2, col, 0.4)
      }
      // Falling embers after the shell expands.
      if (age > 700) {
        for (let k = 0; k < 14; k++) {
          const a = hash(k + burst * 17) * Math.PI * 2
          const r = R * (0.4 + hash(k + 90) * 0.6)
          const ex = cx + Math.cos(a) * r,
            ey = cy + Math.sin(a) * r * 0.85 + drop + ((age - 700) / 1000) * ch * 3 * (0.5 + hash(k + 5))
          const flick = Math.sin(age * 0.05 + k * 2) > -0.4 ? 1 : 0.2
          dot(ex, ey, Math.max(1, unit * 0.2), hdMix(hue, townWarm, 0.5), 0.6 * life * flick)
        }
      }
      // Mirrored in the river.
      for (let k = 0; k < 18; k++) {
        const a = (2 * Math.PI * k) / 18
        const sx = cx + Math.cos(a) * R * 0.9
        const sy = riverTop + (riverTop - (cy + Math.sin(a) * R * 0.8)) * 0.18 + ch * 0.2
        if (sy > riverTop && sy < h) {
          const wob = Math.sin(sy * 0.6 + age * 0.01) * unit
          hd.rect(sx + wob, sy, sx + wob + unit * 1.4, sy + 1, hdMix(riverB, hue, 0.7 * life))
        }
      }
    }
  } else {
    // --- Lanterns ----------------------------------------------------------------------------------
    const lamp = FESTIVAL_LANTERN_COLORS
    const body = hdHex(lamp.body),
      core = hdHex(lamp.core),
      dark = hdHex(lamp.dark)
    const flameOn = festivalLanternBright(elapsedMs)
    const list = festivalLanterns(elapsedMs)
    // Far lanterns first so near ones overlap them.
    const order = list.map((l, i) => ({ l, i })).sort((a, b) => ((a.i * 7) % 3) - ((b.i * 7) % 3))
    for (const { l, i } of order) {
      const depth = [0.7, 1, 1.35][(i * 7) % 3]!
      const cx = X(l.x),
        cy = Y(l.y)
      const bw = unit * 1.15 * depth,
        bh = unit * 1.55 * depth
      const flicker = flameOn ? 1 : 0.82
      glow(cx, cy, unit * 7 * depth, body, 0.38 * flicker * (0.6 + depth * 0.4))
      // Paper body: wider at the shoulder, glowing core, ribbed.
      for (let y = -bh; y <= bh; y++) {
        const u = (y + bh) / (2 * bh)
        const half = bw * (0.78 + 0.22 * Math.sin(u * Math.PI))
        for (let x = -Math.ceil(half); x <= Math.ceil(half); x++) {
          const ux = Math.abs(x) / half
          if (ux > 1) continue
          const heat = (1 - ux * 0.8) * (0.55 + 0.45 * u)
          let col = hdMix(hdDarken(body, 0.8), core, heat * (flameOn ? 1 : 0.7))
          if (Math.abs(((u * 4) % 1) - 0.5) > 0.46) col = hdDarken(col, 0.7)
          hd.set(Math.round(cx + x), Math.round(cy + y), col)
        }
      }
      hd.rect(cx - bw * 0.65, cy - bh - 1, cx + bw * 0.65, cy - bh + 1, dark)
      hd.rect(cx - bw * 0.55, cy + bh - 1, cx + bw * 0.55, cy + bh + 1, dark)
      // Flame at the base.
      dot(cx, cy + bh * 0.55, Math.max(1, unit * 0.38 * depth), core, flameOn ? 1 : 0.7)
      // Mirrored lantern light in the river.
      const wob = Math.sin(phase * 2 * Math.PI * 2 + i) * unit * 0.6
      for (let y = Math.floor(riverTop); y < h; y += 2) {
        const v = (y - riverTop) / (h - riverTop || 1)
        const reach = (1 - Math.max(0, (cy - riverTop + ch * 8) / (ch * 40))) * 0.4
        if (reach <= 0) continue
        const jig = Math.sin(y * 0.8 + phase * 12 + i) * unit * 0.6
        hd.rect(
          cx + wob + jig - bw * 0.3,
          y,
          cx + wob + jig + bw * 0.3,
          y + 1,
          hdMix(riverB, body, reach * (1 - v * 0.6)),
        )
      }
    }
    // Small floating river lanterns, bobbing with the loop.
    for (let i = 0; i < 7; i++) {
      const fx = X(5 + i * 10.5 + Math.sin(phase * 2 * Math.PI + i) * 0.6)
      const fy = riverTop + ch * (0.7 + (i % 3) * 0.55) + Math.sin(phase * 2 * Math.PI * 2 + i * 1.7) * unit * 0.2
      glow(fx, fy, unit * 3, body, 0.5)
      hd.rect(fx - unit * 0.55, fy - unit * 0.35, fx + unit * 0.55, fy + unit * 0.2, hdMix(body, core, 0.45))
      hd.rect(fx - unit * 0.7, fy + unit * 0.2, fx + unit * 0.7, fy + unit * 0.4, dark)
    }
  }

  return hd.pixels
}
