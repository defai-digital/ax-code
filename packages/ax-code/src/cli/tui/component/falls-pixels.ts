import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  FALLS_COLORS,
  FALLS_COLUMNS,
  FALLS_CYCLE_MS,
  FALLS_FALLS,
  FALLS_GROUND_TOP,
  FALLS_MOON,
  FALLS_POOL_TOP,
  FALLS_ROWS,
  FALLS_STARS,
  fallsCliffTopF,
  fallsFireflies,
  fallsMist,
  fallsSkyRgb,
  type FallsStyle,
} from "./falls-view-model"

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Freeform HD falls. A gorge of stratified, mossy rock walls frames a
 * streaked cascade that plunges into a misty pool. Day adds distant hills,
 * clouds, and a rainbow in the spray; night adds a moon with its reflection,
 * stars, and fireflies. Pure and deterministic: everything derives from
 * `elapsedMs` and loops at 2400ms.
 */
export function renderFallsPixels(width: number, height: number, style: FallsStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, FALLS_COLUMNS, FALLS_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "falls-moon"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % FALLS_CYCLE_MS) / FALLS_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = FALLS_COLORS[style]
  const rock = hdHex(c.cliff)
  const rockDeep = hdHex(c.cliffBg)
  const foam = hdHex(c.water)
  const flow = hdHex(c.waterBg)
  const mist = hdHex(c.mist)
  const grass = hdHex(c.grass)
  const ground = hdHex(c.ground)
  const w = hd.w
  const h = hd.h
  const s = Math.max(1, Math.min(hd.cw, hd.ch / 2))
  const falls = FALLS_FALLS
  const poolY = hd.Y(FALLS_POOL_TOP)
  const groundY = hd.Y(FALLS_GROUND_TOP)
  const fx0 = hd.X(falls.x0)
  const fx1 = hd.X(falls.x1 + 1)
  const fcx = (fx0 + fx1) / 2
  const lipY = hd.Y(falls.top)
  const around = fallsSkyRgb(style, 0.2)
  const px = hd.pixels

  const blend = (x: number, y: number, color: RGB, a: number) => {
    if (a <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    px[i] = Math.round(px[i]! + (color[0] - px[i]!) * a)
    px[i + 1] = Math.round(px[i + 1]! + (color[1] - px[i + 1]!) * a)
    px[i + 2] = Math.round(px[i + 2]! + (color[2] - px[i + 2]!) * a)
  }
  /** Soft round glow, alpha falls off to zero at `r`. */
  const glow = (cx: number, cy: number, r: number, color: RGB, peak: number) => {
    const xa = Math.max(0, Math.floor(cx - r))
    const xb = Math.min(w - 1, Math.ceil(cx + r))
    const ya = Math.max(0, Math.floor(cy - r))
    const yb = Math.min(h - 1, Math.ceil(cy + r))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
        if (d < 1) blend(x, y, color, peak * (1 - d) * (1 - d))
      }
    }
  }

  hd.sky((t) => fallsSkyRgb(style, t))
  const skyEnd = Math.min(h, Math.ceil(poolY))
  if (night) {
    const moon = hdMix(mist, foam, 0.35)
    hd.stars(FALLS_STARS, mist, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    const mx = hd.X(FALLS_MOON.x)
    const my = hd.Y(FALLS_MOON.y)
    glow(mx, my, s * 9, hdMix(moon, around, 0.2), 0.5)
    hd.disk(mx, my, s * 2.1, moon)
    hd.disk(mx - s * 0.5, my - s * 0.4, s * 0.45, hdMix(moon, rock, 0.18))
    hd.disk(mx + s * 0.6, my + s * 0.5, s * 0.35, hdMix(moon, rock, 0.12))
  } else {
    glow(hd.X(14), hd.Y(1.5), s * 11, [255, 244, 210], 0.55)
    // Soft clouds.
    for (const [cx, cy, rw] of [
      [38, 2.2, 8],
      [58, 4.2, 6],
      [20, 3.6, 5],
    ] as const) {
      for (let k = 0; k < 7; k++) {
        const ox = (k - 3) * rw * 0.14
        const oy = Math.sin(k * 1.9) * 0.35
        const r = s * (2.2 + 1.8 * Math.cos((k - 3) * 0.5))
        glow(hd.X(cx + ox + 0.5), hd.Y(cy + oy), r * 1.3, [255, 255, 255], 0.5)
      }
    }
  }

  // Distant forested ridges, hazed toward the sky.
  const haze = hdMix(around, mist, night ? 0.1 : 0.35)
  for (let x = 0; x < w; x++) {
    const u = x / hd.cw
    for (let layer = 0; layer < 2; layer++) {
      const top =
        hd.Y(layer === 0 ? 5.2 : 6.4) -
        (vnoise(u * (0.22 + layer * 0.16) + layer * 9, 3) * 2.4 + vnoise(u * 0.9, layer) * 0.5) * hd.ch
      const tint = hdMix(haze, rockDeep, night ? 0.55 + layer * 0.2 : 0.2 + layer * 0.25)
      const bottom = Math.min(h, Math.ceil(poolY))
      for (let y = Math.max(0, Math.floor(top)); y < bottom; y++) {
        const f = (y - top) / (bottom - top || 1)
        const tree = hdDarken(tint, 1 - 0.1 * vnoise((x / s) * 1.3, (y / s) * 1.3) - f * 0.1)
        blend(x, y, tree, 1)
      }
    }
  }

  // Back wall behind the falls, a darker rock band under the lip.
  for (let y = Math.floor(lipY); y < Math.min(h, Math.ceil(poolY)); y++) {
    for (let x = Math.floor(hd.X(26)); x < Math.min(w, Math.ceil(hd.X(50))); x++) {
      const n = vnoise((x / s) * 0.7, (y / s) * 0.9)
      blend(x, y, hdDarken(rockDeep, 0.65 + 0.35 * n), 1)
    }
  }

  // Gorge walls: strata, cracks, a lit crest, moss, wet darkening near the spray.
  const rockAt = (x: number, y: number, side: number, wallEdge: number): RGB => {
    const u = x / hd.cw
    const v = y / hd.ch
    const depth = Math.abs(x - wallEdge) / hd.cw // cells from the falls-side edge
    const strata = Math.sin(v * 3.1 + vnoise(u * 0.4, v * 0.6) * 4) * 0.5 + 0.5
    const grain = vnoise((x / s) * 1.6, (y / s) * 0.9)
    const crack = vnoise((x / s) * 0.45 + side * 7, (y / s) * 0.08)
    // Light comes from the upper left: the right wall's inner face is in shade.
    const face = side < 0 ? 1 : 0.78
    const edgeLit = Math.exp(-depth / 2.2) * (side < 0 ? 0.22 : 0.08)
    let k = (0.62 + 0.3 * strata + 0.22 * grain - (crack < 0.2 ? 0.28 : 0)) * face + edgeLit
    k *= 0.55 + 0.45 * clamp01(1 - (v - 4) / 15)
    let color = hdMix(rockDeep, rock, clamp01(k * 0.95))
    color = hdDarken(color, 0.78 + 0.35 * clamp01(k - 0.4))
    // Spray-darkened rock near the base of the falls.
    const wet = clamp01((v - 11) / 6) * Math.exp(-depth / 9)
    color = hdMix(color, flow, wet * 0.28)
    return color
  }
  for (const side of [-1, 1] as const) {
    const edgeCell = side < 0 ? 31.5 : 44.5
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / hd.cw
      const inside = side < 0 ? u < edgeCell : u > edgeCell
      if (!inside) continue
      const crest = hd.Y(fallsCliffTopF(u)) + (vnoise((x / s) * 0.9, 5) - 0.5) * s * 1.1
      const wallEdgeX = hd.X(edgeCell)
      for (let y = Math.max(0, Math.floor(crest)); y < Math.min(h, Math.ceil(poolY)); y++) {
        // Ragged inner face near the falls.
        const inner = Math.abs(x - wallEdgeX) / hd.cw
        const jag = vnoise((y / s) * 0.5 + side * 3, 11) * 1.8
        if (inner < jag - 0.9 && y > lipY) continue
        let color = rockAt(x, y, side, wallEdgeX)
        const dTop = y - crest
        if (dTop < s * 0.9) color = hdMix(color, hdDarken(rock, 1.35), 0.6 * (1 - dTop / (s * 0.9)))
        px[(y * w + x) * 3] = color[0]
        px[(y * w + x) * 3 + 1] = color[1]
        px[(y * w + x) * 3 + 2] = color[2]
      }
      // Moss mat and a few hanging ferns along the crest.
      const mossDepth = s * (0.8 + vnoise((x / s) * 0.8, 21) * 1.3)
      for (let y = Math.max(0, Math.floor(crest) - 1); y < Math.min(h, Math.floor(crest + mossDepth)); y++) {
        const f = (y - crest) / mossDepth
        blend(x, y, hdMix(grass, hdDarken(grass, 0.55), f), 0.95 * (1 - f * 0.5))
      }
    }
  }
  // Pines on the crests.
  const pine = hdDarken(hdMix(grass, ground, 0.45), night ? 0.65 : 0.9)
  for (let i = 0; i < 26; i++) {
    const u = 0.8 + i * 2.9 + hash(i, 4) * 1.5
    if (u > 29.5 && u < 46.5) continue
    const x = hd.X(u)
    const base = hd.Y(fallsCliffTopF(u)) + s * 0.8
    const hgt = s * (3.2 + hash(i, 9) * 3.2)
    const wd = hgt * 0.22
    const tone = hdDarken(pine, 0.85 + hash(i, 2) * 0.3)
    for (let tier = 0; tier < 4; tier++) {
      const ty = base - hgt * (tier / 4)
      for (let y = Math.floor(ty - hgt * 0.4); y < Math.ceil(ty); y++) {
        const f = (y - (ty - hgt * 0.4)) / (hgt * 0.4)
        const half = wd * (0.2 + f * 0.85) * (1 - tier * 0.15)
        for (let xx = Math.floor(x - half); xx <= Math.ceil(x + half); xx++)
          blend(xx, y, hdMix(tone, grass, xx > x ? 0.05 : 0.22 * (1 - f)), 1)
      }
    }
  }

  // The cascade: an apron of streaks scrolling downward, brighter near the lip.
  const fallsBottom = Math.min(poolY, hd.Y(falls.base + 1.2))
  const fallTop = lipY - s * 0.2
  for (let y = Math.max(0, Math.floor(fallTop)); y < Math.min(h, Math.ceil(fallsBottom)); y++) {
    const v = (y - fallTop) / (fallsBottom - fallTop || 1)
    for (let x = Math.floor(fx0 - s * 0.4); x < Math.ceil(fx1 + s * 0.4); x++) {
      const along = (x + 0.5 - fx0) / (fx1 - fx0)
      // Narrower at the lip, widening as it falls.
      const flare = 0.55 + 0.45 * Math.min(1, v * 1.6)
      const half = 0.5 * flare
      const lateral = Math.abs(along - 0.5)
      if (lateral > half + 0.02) continue
      const edgeSoft = clamp01((half - lateral) / 0.08)
      const col = Math.floor((x - fx0) / Math.max(1, s * 0.35))
      const ph = hash(col, 3) * Math.PI * 2
      const l1 = Math.sin((y / (s * 3.4)) * Math.PI * 2 - theta * 3 + ph)
      const l2 = Math.sin((y / (s * 1.7)) * Math.PI * 2 - theta * 6 + ph * 1.7)
      const streak = clamp01(0.55 + 0.28 * l1 + 0.17 * l2 + (hash(col, 8) - 0.5) * 0.4)
      let color = hdMix(hdMix(flow, foam, 0.35), foam, streak)
      // Water thickens to white with spray at the base.
      color = hdMix(color, mist, clamp01((v - 0.72) / 0.28) * 0.6)
      // Shadow from the right wall rim.
      color = hdDarken(color, 0.86 + 0.14 * (1 - lateral * 0.4) + (along < 0.5 ? 0.04 : 0))
      blend(x, y, color, 0.96 * edgeSoft)
    }
  }
  // Foam lip with a smooth crest line.
  for (let x = Math.floor(fx0 + s); x < Math.ceil(fx1 - s); x++) {
    for (let k = 0; k < s * 0.9; k++) blend(x, Math.floor(lipY - s * 0.35 + k), foam, 0.8 * (1 - k / (s * 0.9)))
  }

  // Rainbow in the spray (day only), then plunge-pool water and rings.
  const bowCx = hd.X(51)
  const bowCy = poolY + s * 0.8
  if (!night) {
    const bands = [c.rainbow1, c.rainbow2, "#d6d45a", c.rainbow3, "#4a8ac8", "#7a5ab8"].map(hdHex)
    const outer = s * 8.4
    const bandW = s * 0.5
    for (let y = Math.max(0, Math.floor(bowCy - outer - 2)); y < Math.min(h, Math.ceil(poolY)); y++) {
      for (let x = Math.max(0, Math.floor(bowCx - outer - 2)); x < Math.min(w, Math.ceil(bowCx + outer + 2)); x++) {
        const d = Math.hypot(x + 0.5 - bowCx, y + 0.5 - bowCy)
        const t = (outer - d) / bandW
        if (t < 0 || t >= bands.length) continue
        const edge = Math.min(t % 1, 1 - (t % 1)) * 4
        const fade = clamp01((poolY - y) / (s * 1.4))
        blend(x, y, bands[Math.floor(t)]!, 0.34 * clamp01(edge + 0.5) * fade)
      }
    }
  }
  hd.water(FALLS_POOL_TOP, FALLS_GROUND_TOP, hdHex(c.pool), hdHex(c.poolBg), theta)
  // Wall and pine reflections darken the pool edges; the falls reflect as a pale column.
  for (let y = Math.ceil(poolY); y < Math.min(h, Math.ceil(groundY)); y++) {
    const v = (y - poolY) / (groundY - poolY || 1)
    for (let x = 0; x < w; x++) {
      const dx = (x - fcx) / (hd.cw * 24)
      const rim = clamp01(Math.abs(dx) - 0.35)
      blend(x, y, rockDeep, rim * 0.6 * (1 - v * 0.4))
      const col = Math.exp(-Math.pow((x - fcx) / (s * 4.2), 2))
      const shimmer = 0.5 + 0.5 * Math.sin(y * 0.55 + theta + Math.sin(x * 0.07) * 2)
      blend(x, y, foam, col * (0.35 - v * 0.2) * shimmer)
    }
  }
  if (night) {
    for (let y = Math.ceil(poolY); y < Math.min(h, Math.ceil(groundY)); y++) {
      const v = (y - poolY) / (groundY - poolY || 1)
      const mx = hd.X(FALLS_MOON.x)
      const halfW = s * (1.2 + v * 1.8)
      for (let x = Math.floor(mx - halfW * 2); x < Math.ceil(mx + halfW * 2); x++) {
        const sway = Math.sin(y * 0.5 + theta) * s * 0.4
        const d = Math.abs(x - mx - sway) / halfW
        if (d < 1 && (x + y) % 3 !== 0) blend(x, y, mist, 0.5 * (1 - d) * (1 - v * 0.5))
      }
    }
  }
  // Concentric rings spreading from the plunge point.
  for (let ring = 0; ring < 3; ring++) {
    const r = ((phase + ring / 3) % 1) * s * 14
    const alpha = (1 - r / (s * 14)) * 0.38
    const ry = r * 0.16
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180
      blend(Math.round(fcx + Math.cos(rad) * r), Math.round(poolY + s * 0.8 + Math.sin(rad) * ry), foam, alpha)
    }
  }
  // Whitewater churn at the base.
  for (let i = 0; i < 26; i++) {
    const a = hash(i, 17)
    const x = fcx + (a - 0.5) * (fx1 - fx0) * 1.35
    const y = poolY - s * 0.2 + hash(i, 5) * s * 1.6 + Math.sin(theta + i) * s * 0.2
    glow(x, y, s * (0.9 + hash(i, 7) * 1.2), foam, 0.55)
  }

  // Mist billows rising from the plunge and drifting over the pool.
  const plumeBase = poolY + s * 0.2
  for (let i = 0; i < 9; i++) {
    const t0 = (phase + i / 9) % 1
    const x = fcx + (hash(i, 31) - 0.5) * s * 12 + Math.sin(theta + i * 1.3) * s * 1.4
    const y = plumeBase - t0 * s * 8
    glow(x, y, s * (3.4 + t0 * 2.8), mist, 0.24 * (1 - t0))
  }
  for (const puff of fallsMist(elapsed)) {
    glow(hd.X(puff.x + 0.5), hd.Y(puff.y + 0.45), s * 3.2, mist, night ? 0.22 : 0.3)
  }

  // Foreground bank: shaded earth, reeds, and tufts.
  const bankTop = groundY
  for (let y = Math.floor(bankTop); y < h; y++) {
    const f = (y - bankTop) / (h - bankTop || 1)
    for (let x = 0; x < w; x++) {
      const n = vnoise((x / s) * 0.8, (y / s) * 0.8)
      const color = hdMix(hdMix(grass, ground, 0.25), hdDarken(ground, 0.7), clamp01(f * 1.1 + n * 0.25 - 0.12))
      px[(y * w + x) * 3] = color[0]
      px[(y * w + x) * 3 + 1] = color[1]
      px[(y * w + x) * 3 + 2] = color[2]
    }
  }
  // Wet shoreline blends into the pool.
  for (let k = 0; k < s * 1.1; k++) {
    for (let x = 0; x < w; x += 1) {
      blend(x, Math.floor(groundY) - 1 + k, hdMix(flow, ground, 0.5), 0.45 * (1 - k / (s * 1.1)))
    }
  }
  const blade = night ? hdDarken(grass, 0.8) : hdDarken(grass, 1.15)
  for (let i = 0; i < Math.floor(w / (s * 1.2)); i++) {
    const x = hash(i, 41) * w
    const hgt = s * (1.2 + hash(i, 43) * 2.2)
    const sway = Math.sin(theta + i) * s * 0.25
    for (let k = 0; k < hgt; k++) {
      const f = k / hgt
      hd.set(
        Math.round(x + sway * f * f),
        Math.floor(groundY + s * 0.4 + hash(i, 47) * (h - groundY) * 0.7 - k),
        hdMix(blade, hdDarken(blade, 0.7), 1 - f),
      )
    }
  }
  // Foreground boulders at the shoreline.
  for (const [u, r] of [
    [6, 2.2],
    [24, 1.5],
    [66, 2.4],
  ] as const) {
    const x = hd.X(u)
    const y = groundY + s * 0.2
    hd.blob(x, y, s * r * 1.5, s * r * 0.85, hdDarken(rock, 0.7))
    hd.blob(x - s * r * 0.25, y - s * r * 0.25, s * r * 1.0, s * r * 0.5, hdMix(rock, foam, 0.12))
  }

  if (night) {
    const glowColor = hdHex(c.glow)
    for (const fly of fallsFireflies(elapsed)) {
      const fx = hd.X(fly.x + 0.5)
      const fy = hd.Y(fly.y + 0.5)
      glow(fx, fy, s * 2.6, glowColor, 0.45)
      hd.disk(fx, fy, Math.max(1.3, s * 0.2), hdMix(glowColor, [255, 255, 255], 0.5))
    }
  }
  return hd.pixels
}
