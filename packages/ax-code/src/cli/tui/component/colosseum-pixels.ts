import {
  COLOSSEUM_BANNERS,
  COLOSSEUM_COLUMNS,
  COLOSSEUM_CYPRESS,
  COLOSSEUM_FLASH,
  COLOSSEUM_GLADIATORS,
  COLOSSEUM_GROUND_TOP,
  COLOSSEUM_MOON,
  COLOSSEUM_PINES,
  COLOSSEUM_ROWS,
  COLOSSEUM_STARS,
  COLOSSEUM_STATUES,
  COLOSSEUM_WALL,
  COLOSSEUM_COLORS,
  colosseumBirds,
  colosseumFlash,
  colosseumSkyRgb,
  colosseumTorch,
  type ColosseumStyle,
} from "./colosseum-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import { hash } from "./atmos-paint"

/** Deterministic hash in [0, 1). */
/** Bays across the visible front half of the ellipse, odd so the gate sits in the middle. */
const BAYS = 29
const RIM_CURVE = 0.55
/** Tier boundaries in rows, before the ellipse curve is added. */
const TIER_EDGES = [8.0, 9.4, 12.0, 14.6, 17.35] as const

/**
 * Freeform HD renderer. A travertine ellipse seen from the forecourt: four
 * tiers of arches wrapped around the bowl so the bays foreshorten toward
 * the ends, half-columns, cornices, an attic with windows, the inside of the
 * far wall showing over the broken rim, banners, crown statues, umbrella
 * pines, cypresses, gladiators, and flashing cameras. The night opening
 * lights every arch from within. Pure and deterministic: everything derives
 * from `elapsedMs`.
 */
export function renderColosseumPixels(width: number, height: number, style: ColosseumStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, COLOSSEUM_COLUMNS, COLOSSEUM_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "colosseum-night"
  const c = COLOSSEUM_COLORS[style]
  const { w, h, cw, ch, X, Y } = hd
  const px = hd.pixels
  const t = Math.max(0, elapsedMs)
  const theta = ((t % 2400) / 2400) * Math.PI * 2
  const wall = COLOSSEUM_WALL
  const travertine = hdHex(c.travertine)
  const dark = hdHex(c.travertineDark)
  const arch = hdHex(c.arch)
  const torch = hdHex(c.torch)
  const cypress = hdHex(c.cypress)
  const pine = hdHex(c.pine)
  const crowd = hdHex(c.crowd)
  const coreR = Math.max(3, Math.min(cw, ch) * 0.9)
  const torchOn = colosseumTorch(t)
  const blend = (x: number, y: number, color: RGB, alpha: number) => {
    if (alpha <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const a = Math.min(1, alpha)
    const i = (y * w + x) * 3
    px[i] = Math.round(px[i]! + (color[0] - px[i]!) * a)
    px[i + 1] = Math.round(px[i + 1]! + (color[1] - px[i + 1]!) * a)
    px[i + 2] = Math.round(px[i + 2]! + (color[2] - px[i + 2]!) * a)
  }
  const glow = (cx: number, cy: number, rx: number, ry: number, color: RGB, strength: number) => {
    const xa = Math.max(0, Math.floor(cx - rx))
    const xb = Math.min(w - 1, Math.ceil(cx + rx))
    const ya = Math.max(0, Math.floor(cy - ry))
    const yb = Math.min(h - 1, Math.ceil(cy + ry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d < 1) blend(x, y, color, strength * (1 - d) * (1 - d))
      }
    }
  }
  const around = colosseumSkyRgb(style, 0.2)
  const warm = hdHex("#ffb25a")
  const uplight = night ? hdHex("#ffc070") : hdHex("#fff2cc")

  // Sky, sun or moon, stars, soft clouds.
  hd.sky((v) => colosseumSkyRgb(style, v))
  const midX = (wall.x0 + wall.x1) / 2
  const halfSpan = (wall.x1 - wall.x0) / 2
  if (night) {
    glow(X(midX), Y(10), cw * 36, ch * 9, warm, 0.22)
    hd.stars(COLOSSEUM_STARS, hdMix(torch, [255, 255, 255], 0.35), (index) => (Math.floor(t / 400) + index) % 3 === 0)
    for (let i = 0; i < 38; i++) {
      const sx = Math.floor(hash(i, 1) * w)
      const sy = Math.floor(hash(i, 2) * Y(8))
      blend(sx, sy, hdHex("#dfe6ff"), (Math.floor(t / 400) + i) % 3 === 0 ? 0.85 : 0.35)
    }
    const mx = X(COLOSSEUM_MOON.x)
    const my = Y(COLOSSEUM_MOON.y + 0.4)
    glow(mx, my, cw * 12, ch * 6, hdHex("#ffe3a0"), 0.35)
    hd.disk(mx, my, coreR * 1.5, hdMix(torch, around, 0.5))
    hd.disk(mx, my, coreR, hdHex("#fff0c0"))
    hd.disk(mx - coreR * 0.3, my - coreR * 0.2, coreR * 0.26, hdHex("#e8cf90"))
  } else {
    glow(X(24), Y(3), cw * 24, ch * 9, hdHex("#fff6d8"), 0.35)
    const cloud = hdHex(c.cloud)
    for (const [cx, cy, n] of [
      [8, 2, 4],
      [40, 1, 6],
      [58, 4, 6],
    ] as const) {
      for (let k = 0; k < n; k++) {
        const bx = X(cx + 0.5 + k * 1.05)
        const lift = Math.sin(k * 1.9 + cx) * ch * 0.18
        hd.blob(bx, Y(cy + 0.5) + ch * 0.1, cw * 1.6, ch * 0.5, hdDarken(cloud, 0.92))
        hd.blob(bx, Y(cy + 0.4) - lift * 0.5, cw * 1.5, ch * 0.5 + Math.abs(lift) * 0.4, cloud)
      }
    }
  }
  // Doves with beating wings.
  const dove = hdHex(c.bird)
  for (const [i, bird] of colosseumBirds(t).entries()) {
    const bx = X(bird.x + 0.5)
    const by = Y(bird.y + 0.5)
    const flap = Math.sin(theta * 8 + i * 1.7) * ch * 0.2
    for (const dir of [-1, 1]) {
      hd.stroke(
        bx / cw,
        by / ch,
        (bx + dir * cw * 0.6) / cw,
        (by - ch * 0.1 + flap) / ch,
        Math.max(1.1, cw * 0.1),
        dove,
      )
      hd.stroke(
        (bx + dir * cw * 0.6) / cw,
        (by - ch * 0.1 + flap) / ch,
        (bx + dir * cw * 1.1) / cw,
        (by + ch * 0.06 + flap) / ch,
        Math.max(1, cw * 0.07),
        dove,
      )
    }
    hd.blob(bx, by, cw * 0.22, ch * 0.1, dove)
  }

  // Distant Roman hills and umbrella pines on the horizon.
  const hazeHill = hdMix(hdHex(c.pine), around, night ? 0.65 : 0.6)
  for (let x = 0; x < w; x++) {
    const sx = x / cw
    const top = 16.7 - Math.sin(sx * 0.17 + 1) * 0.8 - Math.sin(sx * 0.41) * 0.25
    for (let y = Math.max(0, Math.floor(Y(top))); y < Math.ceil(Y(COLOSSEUM_GROUND_TOP)); y++) {
      const u = (y - Y(top)) / (ch * 2.5)
      const color = hdMix(hazeHill, hdDarken(hazeHill, 0.82), Math.min(1, u))
      hd.set(x, y, color)
    }
  }

  // ---------- The ellipse ----------
  const topEdge = (sx: number): number => {
    // Gaps in the crown and the broken east end.
    const gap = (sx > wall.x0 + 20 && sx < wall.x0 + 22) || (sx > wall.x0 + 36 && sx < wall.x0 + 40)
    if (gap) return TIER_EDGES[1] + hash(Math.floor(sx * 4), 3) * 0.25
    if (sx > wall.x0 + 45) {
      const step = Math.floor((sx - (wall.x0 + 45)) / 1.15)
      return TIER_EDGES[1] + step * 0.38 + hash(step, 8) * 0.28
    }
    return TIER_EDGES[0]
  }
  const stoneColor = (x: number, y: number, factor: number, tone: RGB): RGB => {
    const course = Math.floor(y / 6)
    const off = (course % 2) * 8
    const mortar = y % 6 === 0 || Math.floor(x + off) % 16 === 0
    const variation = 0.93 + hash(Math.floor((x + off) / 16), course) * 0.14
    const stain = 0.97 + hash(x >> 3, y >> 5) * 0.06
    return hdDarken(tone, factor * variation * stain * (mortar ? 0.9 : 1))
  }
  const delta = Math.PI / BAYS
  const x0 = Math.max(0, Math.floor(X(wall.x0 - 0.3)))
  const x1 = Math.min(w, Math.ceil(X(wall.x1 + 0.3)))
  const baseBottom = (s: number) => TIER_EDGES[4] + RIM_CURVE * s
  for (let x = x0; x < x1; x++) {
    const sx = (x + 0.5) / cw
    const dx = (sx - midX) / halfSpan
    if (Math.abs(dx) >= 1) continue
    const s = Math.sqrt(1 - dx * dx)
    const ang = Math.asin(dx)
    const bay = Math.round(ang / delta)
    const bayCx = X(midX + halfSpan * Math.sin(bay * delta))
    const bayW = X(halfSpan) * delta * Math.cos(bay * delta)
    const ox = x + 0.5 - bayCx
    const frac = ox / bayW
    // Light: sun from the left by day; the moon from the right plus floodlights at night.
    const lam = day() ? -0.55 * dx + 0.83 * s : 0.5 * dx + 0.83 * s
    const base = Math.max(0.5, Math.min(1.15, 0.5 + 0.55 * lam)) * (night ? 0.55 : 1)
    const farTop = 8.0 - 1.6 * s
    const yTop = Y(Math.min(farTop, topEdge(sx) + RIM_CURVE * s))
    const yFrontTop = Y(topEdge(sx) + RIM_CURVE * s)
    const yBottom = Y(baseBottom(s))
    for (let y = Math.max(0, Math.floor(yTop)); y < Math.min(h, Math.ceil(yBottom)); y++) {
      const cy = (y + 0.5) / ch
      if (y < yFrontTop) {
        // Inside face of the far wall seen over the rim: dim, cool, arcaded at a half-bay offset.
        const fox = ox - bayW * 0.5
        const inner = hdMix(dark, hdHex(day() ? "#8c8266" : "#2a2820"), 0.3)
        const v = (cy - farTop) / (topEdge(sx) + RIM_CURVE * s - farTop || 1)
        let color = stoneColor(x, y, 0.62 + 0.18 * v, inner)
        const half = bayW * 0.22
        if (Math.abs(fox) < half && v > 0.18 && v < 0.92) {
          const k = Math.sqrt(Math.max(0, 1 - (fox / half) ** 2))
          if (v > 0.18 + (1 - k) * 0.22)
            color = night ? hdMix(hdHex("#5a3a1c"), hdHex("#a0642a"), v) : hdDarken(arch, 0.7 + v * 0.2)
        }
        if (y - yTop < 2) color = hdMix(color, uplight, 0.35)
        hd.set(x, y, color)
        continue
      }
      const yp = cy - RIM_CURVE * s
      const tier = yp < TIER_EDGES[1] ? 0 : yp < TIER_EDGES[2] ? 1 : yp < TIER_EDGES[3] ? 2 : 3
      const ta = TIER_EDGES[tier]!
      const tb = TIER_EDGES[tier + 1]!
      const hh = tb - ta
      const local = (yp - ta) / hh
      const tone = travertine
      // Floodlights lift the lower tiers; the dawn sun warms the whole face.
      let factor = base
      if (night) factor += 0.55 * s * (1 - Math.min(1, (yp - 8) / 10) * 0.5)
      let color: RGB
      let open = false
      // Openings.
      const gateBay = bay === 0 && tier === 3
      const archHalf = gateBay ? bayW * 1.0 : bayW * 0.31
      const oTop = gateBay ? 0.0 : tier === 0 ? 0.28 : 0.15
      const oBot = tier === 0 ? 0.74 : 1 - 0.1
      const topY = ta + oTop * hh
      const botY = tb - (gateBay ? 0 : 0.0) - (tier === 0 ? 0 : (1 - oBot) * hh)
      if (!(tier === 0 && bay % 2 !== 0)) {
        const arcR = archHalf
        const arcTopY = topY + arcR / ch
        if (yp >= topY && yp <= (tier === 0 ? ta + 0.72 * hh : botY)) {
          let inside = Math.abs(ox) <= archHalf
          if (inside && tier !== 0 && yp < arcTopY) {
            const dyp = (arcTopY - yp) * ch
            inside = ox * ox + dyp * dyp <= arcR * arcR
          }
          if (inside) open = true
        }
      }
      if (open) {
        const depth = Math.abs(ox) / (archHalf || 1)
        const v = Math.max(0, Math.min(1, (yp - topY) / (botY - topY || 1)))
        if (night) {
          const flicker = 0.9 + 0.1 * Math.sin(theta * 3 + bay * 1.9 + tier)
          color = hdMix(
            hdMix(hdHex("#ffe19a"), hdHex("#e8892c"), v * 0.8 + depth * 0.4),
            hdHex("#4a2a14"),
            depth * depth * 0.5,
          )
          color = hdDarken(color, flicker * (0.75 + 0.25 * hash(bay, tier)))
        } else {
          color = hdMix(hdDarken(arch, 0.55), hdDarken(arch, 1.05), v * 0.5 + depth * 0.5)
          // Sunlit back wall peeking through the far openings.
          if (hash(bay + 40, tier + 3) > 0.7 && v > 0.5) color = hdMix(color, hdDarken(travertine, 0.7), 0.4)
        }
        // Reveal: lit edge on the light side.
        const lit = ((day() ? -1 : 1) * ox) / archHalf
        if (Math.abs(depth - 1) < 0.1 && lit > 0.5) color = hdMix(color, uplight, 0.25)
      } else {
        // Pier face with half-columns between the bays.
        color = stoneColor(x, y, factor, tone)
        const colDist = Math.abs(Math.abs(frac) - 0.5)
        const colW = 0.1
        if (tier > 0 && colDist < colW) {
          const u = 1 - colDist / colW
          color = hdMix(color, uplight, 0.1 * u)
          if (frac > 0 === (!day() ? false : true)) color = hdDarken(color, 0.9)
        }
        // Cornice highlight at the top edge of a tier and a deep shadow beneath it.
        const pxFromTop = (yp - ta) * ch
        if (tier > 0) {
          if (pxFromTop < 2) color = hdMix(color, uplight, 0.28)
          else if (pxFromTop < ch * 0.38) color = hdDarken(color, 0.82 + (pxFromTop / (ch * 0.38)) * 0.18)
        }
        // Weathering streaks beneath every opening.
        if (local > 0.15 && hash(bay * 3 + tier, x >> 4) > 0.82) color = hdDarken(color, 0.95)
        // Attic windows.
        if (tier === 0 && bay % 2 === 0 && Math.abs(ox) < bayW * 0.14 && local > 0.3 && local < 0.78) {
          color = night ? hdMix(hdHex("#c8803a"), hdHex("#ffcf80"), hash(bay, 4)) : hdDarken(arch, 0.8)
        }
        if (night) {
          // Warm spill from the arches on the nearby stone.
          const spill = Math.max(0, 1 - Math.abs(Math.abs(frac) - 0.33) * 5) * 0.12
          color = hdMix(color, hdHex("#ffb25a"), spill)
        }
      }
      // Soft contact shadow along the base.
      if (y > yBottom - ch * 0.5) {
        const k = (y - (yBottom - ch * 0.5)) / (ch * 0.5)
        color = hdDarken(color, 1 - k * 0.3)
      }
      hd.set(x, y, color)
    }
    // Rim light along the broken top edge.
    hd.rect(
      x,
      yFrontTop,
      x + 1,
      yFrontTop + 2,
      hdMix(stoneColor(x, Math.round(yFrontTop), 1, travertine), uplight, night ? 0.4 : 0.35),
    )
  }

  // Banners draped between the arches.
  for (const [i, drape] of COLOSSEUM_BANNERS.entries()) {
    const dx = (drape + 0.5 - midX) / halfSpan
    const s = Math.sqrt(Math.max(0, 1 - dx * dx))
    const bx = X(drape + 0.5)
    const top = Y(wall.top + 0.4 + RIM_CURVE * s)
    const len = ch * 3.1
    const half = cw * 0.42
    const red = hdHex(c.banner)
    for (let y = Math.floor(top); y < top + len; y++) {
      const v = (y - top) / len
      const sway = Math.sin(theta * 2 + v * 4 + i * 1.5) * cw * 0.12 * v
      const hw = half * (1 - (v > 0.82 ? (v - 0.82) * 2.4 : 0) - Math.abs(v - 0.5) * 0.0)
      for (let x = Math.floor(bx - hw + sway); x < bx + hw + sway; x++) {
        let color = hdDarken(red, 0.86 + 0.18 * Math.sin((x - bx) * 0.9 + v * 5))
        if (y - top < 2) color = hdHex("#d8b050")
        hd.set(x, y, color)
      }
    }
    hd.rect(bx - cw * 0.6, top - 2, bx + cw * 0.6, top + 1, hdDarken(hdHex("#6e4a2a"), 0.9))
  }

  // Crown statues standing on the cornice in the gaps.
  for (const figure of COLOSSEUM_STATUES) {
    const dx = (figure + 0.5 - midX) / halfSpan
    const s = Math.sqrt(Math.max(0, 1 - dx * dx))
    const sx = X(figure + 0.5)
    const ground = Y(TIER_EDGES[1] + RIM_CURVE * s) + 1
    const stone = night ? hdMix(hdHex("#c8a070"), arch, 0.35) : hdMix(hdDarken(travertine, 0.8), arch, 0.35)
    hd.rect(sx - cw * 0.55, ground - ch * 0.35, sx + cw * 0.55, ground, hdDarken(stone, 0.8))
    hd.blob(sx, ground - ch * 1.0, cw * 0.38, ch * 0.7, stone)
    hd.disk(sx, ground - ch * 1.8, Math.max(2.5, cw * 0.26), stone)
    hd.stroke(
      figure + 0.5,
      (ground - ch * 1.1) / ch,
      figure + 1.2,
      (ground - ch * 2.3) / ch,
      Math.max(1, cw * 0.09),
      stone,
    )
    hd.disk(sx + cw * 0.7, ground - ch * 2.3, Math.max(1.4, cw * 0.1), hdMix(stone, uplight, 0.4))
  }

  // ---------- Forecourt ----------
  const gTop = Y(COLOSSEUM_GROUND_TOP)
  const wallBase = Y(baseBottom(1))
  // Podium strip between the wall base and the lawn.
  for (let y = Math.floor(wallBase); y < gTop; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x / cw
      const dx = (sx - midX) / halfSpan
      if (Math.abs(dx) < 1.04 && y < Y(baseBottom(Math.sqrt(Math.max(0, 1 - Math.min(1, dx * dx)))))) continue
      const u = (y - wallBase) / (gTop - wallBase || 1)
      hd.set(x, y, hdDarken(hdMix(hdMix(dark, hdHex(c.ground), 0.5), travertine, 0.2 - u * 0.1), night ? 0.8 : 1))
    }
  }
  const ground = hdHex(c.ground)
  for (let y = Math.floor(gTop); y < h; y++) {
    const u = (y - gTop) / (h - gTop || 1)
    for (let x = 0; x < w; x++) {
      const sx = x / cw
      // Paved Roman plaza converging on the gate, grass at the sides.
      const reach = 10 + u * 36
      const paved = Math.abs(sx - midX) < reach
      const base = night
        ? hdMix(ground, hdHex("#0a0e08"), u * 0.5)
        : hdMix(hdMix(ground, hdHex("#8a9a60"), 0.2), hdDarken(ground, 0.8), u)
      let color = base
      if (paved) {
        const slabRow = Math.floor(Math.pow(u, 0.6) * 9)
        const edgeY = Math.abs(Math.pow(u, 0.6) * 9 - slabRow) < 0.08
        const lane = ((sx - midX) / (reach || 1)) * 7
        const edgeX = Math.abs(lane - Math.round(lane)) < 0.05 + 0.02
        color = hdMix(base, night ? hdHex("#3a362c") : hdMix(travertine, hdHex("#e8dcb8"), 0.2), 0.62 - u * 0.12)
        color = hdDarken(color, 0.95 + hash(slabRow, Math.round(lane) + 40) * 0.1)
        if (edgeY || edgeX) color = hdDarken(color, 0.85)
        const edgeDist = 1 - Math.abs(sx - midX) / reach
        if (edgeDist < 0.04) color = hdMix(color, base, 0.7)
      } else {
        color = hdDarken(color, 0.93 + hash(x >> 1, y >> 1) * 0.14)
      }
      if (night) {
        // Warm light spills from the gate across the plaza.
        const spill = Math.max(0, 1 - Math.hypot((sx - midX) / 13, (y - gTop) / (ch * 4.5))) * 0.55
        color = hdMix(color, hdHex("#ffb25a"), spill * (paved ? 0.7 : 0.35))
      }
      hd.set(x, y, color)
    }
  }
  // Steps below the gate.
  for (let k = 0; k < 3; k++) {
    const sx0 = X(34 - k * 0.7)
    const sx1 = X(42 + k * 0.7)
    const sy = Y(COLOSSEUM_GROUND_TOP - 1 + k * 0.33)
    hd.rect(sx0, sy, sx1, sy + ch * 0.33, hdDarken(dark, 0.8 + k * 0.08))
    hd.rect(sx0, sy, sx1, sy + 2, hdMix(travertine, uplight, 0.3))
  }
  if (night) glow(X(38), Y(COLOSSEUM_GROUND_TOP - 0.5), cw * 7, ch * 2.2, hdHex("#ffcf80"), 0.5)

  // Cypresses, umbrella pines.
  for (const tree of COLOSSEUM_CYPRESS) {
    const tx = X(tree + 1)
    const ty = Y(15.1)
    hd.rect(tx - cw * 0.12, Y(17.3), tx + cw * 0.12, Y(COLOSSEUM_GROUND_TOP - 0.3), hdDarken(cypress, 0.5))
    for (let y = Math.floor(ty - ch * 3.4); y < Y(17.5); y++) {
      const v = (y - (ty - ch * 3.4)) / (ch * 5.1)
      const half = cw * 1.25 * Math.sin(Math.min(1, v * 1.1) * Math.PI * 0.55) * (1 - Math.max(0, v - 0.85) * 3)
      for (let x = Math.floor(tx - half); x < tx + half; x++) {
        const u = (x + 0.5 - tx) / (half || 1)
        const lam = 0.75 + (day() ? -u : u) * 0.35
        hd.set(x, y, hdDarken(cypress, lam * (0.8 + hash(x, y >> 1) * 0.35)))
      }
    }
  }
  for (const tree of COLOSSEUM_PINES) {
    const tx = X(tree + 0.5)
    const lean = tree < midX ? 1 : -1
    hd.stroke(tree + 0.5, 17.8, tree + 0.5 + lean * 0.3, 12.5, Math.max(1.6, cw * 0.14), hdDarken(pine, 0.45))
    for (const [dx, dy, sc] of [
      [0, 0, 1.0],
      [-1.8, 0.35, 0.8],
      [1.8, 0.35, 0.8],
      [-0.9, -0.3, 0.8],
      [1.0, -0.28, 0.78],
    ] as const) {
      const cx = tx + dx * cw * 1.1 + lean * cw * 0.4
      const cy = Y(11.6 + dy * 0.9)
      hd.blob(cx, cy + ch * 0.12, cw * 2.1 * sc, ch * 0.55 * sc, hdDarken(pine, 0.62))
      hd.blob(cx, cy, cw * 2.0 * sc, ch * 0.5 * sc, pine, hdDarken(pine, 0.8))
      hd.blob(cx - cw * 0.2, cy - ch * 0.15, cw * 1.1 * sc, ch * 0.2 * sc, hdMix(pine, uplight, 0.18))
    }
  }

  // Braziers with flames.
  for (const brazier of [10, 65]) {
    const bx = X(brazier + 0.5)
    const by = Y(COLOSSEUM_GROUND_TOP - 0.35)
    hd.rect(bx - cw * 0.3, by - ch * 0.5, bx + cw * 0.3, by, hdDarken(dark, 0.7))
    hd.rect(bx - cw * 0.05, by - ch * 0.2, bx + cw * 0.05, by + ch * 0.3, hdDarken(dark, 0.6))
    hd.blob(bx, by - ch * 0.5, cw * 0.4, ch * 0.12, hdDarken(dark, 0.5))
    const flameH = ch * (torchOn ? 0.95 : 0.55) * (0.9 + 0.1 * Math.sin(theta * 6 + brazier))
    glow(bx, by - ch * 0.9, cw * 3.8, ch * 2.4, hdHex("#ff8a30"), night ? 0.55 : 0.25)
    hd.blob(bx, by - ch * 0.5 - flameH * 0.5, cw * 0.36, flameH * 0.6, hdHex("#e88a3a"))
    hd.blob(bx, by - ch * 0.5 - flameH * 0.4, cw * 0.2, flameH * 0.4, hdHex("#ffe19a"))
  }

  // Gladiators: helmet, shield, spear.
  for (const [i, gladiator] of COLOSSEUM_GLADIATORS.entries()) {
    const gx = X(gladiator + 0.5)
    const gy = Y(COLOSSEUM_GROUND_TOP - 0.1)
    const body = night ? hdMix(crowd, hdHex("#c08040"), 0.25) : hdMix(crowd, hdHex("#9a5a3a"), 0.4)
    hd.rect(gx - cw * 0.22, gy - ch * 0.75, gx - cw * 0.03, gy, hdDarken(body, 0.6))
    hd.rect(gx + cw * 0.03, gy - ch * 0.75, gx + cw * 0.22, gy, hdDarken(body, 0.6))
    hd.blob(gx, gy - ch * 1.1, cw * 0.32, ch * 0.5, body)
    hd.disk(gx, gy - ch * 1.8, Math.max(3, cw * 0.26), hdMix(body, hdHex("#e0b090"), 0.4))
    hd.rect(gx - cw * 0.3, gy - ch * 2.15, gx + cw * 0.3, gy - ch * 1.9, hdHex("#9aa0b0"))
    hd.stroke(
      gladiator + 0.5 + (i === 0 ? 0.6 : -0.6),
      (gy - ch * 2.8) / ch,
      gladiator + 0.5 + (i === 0 ? 0.6 : -0.6),
      gy / ch,
      Math.max(1, cw * 0.06),
      hdHex("#c8c8d4"),
    )
    hd.disk(gx + (i === 0 ? -1 : 1) * cw * 0.4, gy - ch * 1.1, Math.max(2.5, cw * 0.26), hdHex("#a83a3a"))
  }
  // Tourists with cameras; the active one flashes.
  const flash = colosseumFlash(t)
  COLOSSEUM_FLASH.forEach((camera, index) => {
    const cx = X(camera + 0.5)
    const cy = Y(COLOSSEUM_GROUND_TOP + 0.35)
    const cloth = hdMix(crowd, hdHex(["#8a5a5a", "#5a7a9a", "#7a9a5a", "#9a8a5a", "#7a5a9a", "#5a9a8a"][index]!), 0.5)
    hd.rect(cx - cw * 0.2, cy - ch * 0.4, cx + cw * 0.2, cy + ch * 0.35, hdDarken(cloth, 0.7))
    hd.blob(cx, cy - ch * 0.75, cw * 0.28, ch * 0.45, cloth)
    hd.disk(cx, cy - ch * 1.35, Math.max(2.2, cw * 0.19), hdMix(cloth, hdHex("#e0b090"), 0.6))
    if (index === flash) {
      glow(cx, cy - ch * 1.0, cw * 3.2, ch * 1.6, hdHex("#ffffff"), 0.7)
      hd.disk(cx + cw * 0.15, cy - ch * 1.0, Math.max(2.6, cw * 0.26), torch)
      hd.disk(cx + cw * 0.15, cy - ch * 1.0, Math.max(1.5, cw * 0.14), hdHex("#ffffff"))
    } else {
      hd.disk(cx + cw * 0.15, cy - ch * 1.0, Math.max(1.3, cw * 0.1), hdHex("#1e1e28"))
    }
  })
  return hd.pixels

  function day() {
    return !night
  }
}
