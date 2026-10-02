import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  DUNGEON_CHEST,
  DUNGEON_COIN_PILES,
  DUNGEON_COLUMNS,
  DUNGEON_COLORS,
  DUNGEON_DRIPS,
  DUNGEON_FLOOR_TOP,
  DUNGEON_GLINTS,
  DUNGEON_LANDING,
  DUNGEON_PILLARS,
  DUNGEON_PILLAR_BASE,
  DUNGEON_PILLAR_TOP,
  DUNGEON_ROWS,
  DUNGEON_STEP_COUNT,
  DUNGEON_STEP_DX,
  DUNGEON_STEP_DY,
  DUNGEON_STEP_X,
  DUNGEON_STEP_Y,
  DUNGEON_TORCHES,
  DUNGEON_TORCH_Y,
  dungeonDripY,
  dungeonFlicker,
  dungeonPhase,
  dungeonTwinkle,
  type DungeonStyle,
} from "./dungeon-view-model"

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
 * Freeform HD dungeon. A torch-lit chamber of irregular masonry: each torch
 * and the treasure cast a warm, flickering light that falls off across the
 * wall, so depth comes from light rather than outlines. The descent shows a
 * cantilevered stone stair with lit treads and shadowed risers; the vault
 * shows fluted pillars and an open chest spilling gold light over coin heaps.
 * Pure and deterministic: every pixel derives from `elapsedMs`.
 */
export function renderDungeonPixels(width: number, height: number, style: DungeonStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const hd = createHdCanvas(w, h, DUNGEON_COLUMNS, DUNGEON_ROWS)
  if (w === 0 || h === 0) return hd.pixels
  const descent = style === "dungeon-descent"
  const c = DUNGEON_COLORS[style]
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const flame = hdHex(c.flame)
  const wood = hdHex(c.wood)
  const drip = hdHex(c.drip)
  const step = hdHex(c.step)
  const gold = hdHex(c.gold)
  const coin = hdHex(c.coin)
  const glint = hdHex(c.glint)
  const floorC = hdHex(c.floor)
  const px = hd.pixels
  const s = Math.max(1, Math.min(hd.cw, hd.ch / 2))
  const t = Math.max(0, elapsedMs)
  const phase = dungeonPhase(t)
  const TAU = Math.PI * 2
  const beat = dungeonFlicker(t)

  // Light sources: torches and, in the vault, the chest.
  type Light = { x: number; y: number; r: number; k: number; color: RGB }
  const lights: Light[] = DUNGEON_TORCHES.map((torch, i) => {
    const flick =
      0.82 + 0.1 * Math.sin(phase * TAU * 7 + i * 2) + 0.06 * Math.sin(phase * TAU * 13 + i) + (beat ? 0.05 : -0.03)
    return { x: hd.X(torch + 0.5), y: hd.Y(DUNGEON_TORCH_Y + 0.4), r: s * 34, k: flick, color: [255, 160, 70] as RGB }
  })
  const chest = DUNGEON_CHEST
  if (!descent) {
    const pulse = 0.9 + 0.1 * Math.sin(phase * TAU * 3)
    lights.push({ x: hd.X(chest.x + 4), y: hd.Y(chest.y + 1), r: s * 26, k: 1.05 * pulse, color: [255, 200, 90] })
  }
  const ambient: RGB = descent ? [0.16, 0.17, 0.26] : [0.24, 0.19, 0.15]
  /** Per-pixel light multiplier (r, g, b), shared by every lit surface. */
  const lightMap = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = ambient[0]
      let g = ambient[1]
      let b = ambient[2]
      for (const l of lights) {
        const dx = (x - l.x) / l.r
        const dy = (y - l.y) / (l.r * 0.85)
        const q = l.k / (1 + 9 * (dx * dx + dy * dy)) - 0.02
        if (q <= 0) continue
        r += (q * l.color[0]) / 255
        g += (q * l.color[1]) / 255
        b += (q * l.color[2]) / 255
      }
      const i = (y * w + x) * 3
      lightMap[i] = r
      lightMap[i + 1] = g
      lightMap[i + 2] = b
    }
  }
  const put = (x: number, y: number, albedo: RGB, lightBoost = 1, alpha = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    const r = Math.min(255, albedo[0] * lightMap[i]! * lightBoost)
    const g = Math.min(255, albedo[1] * lightMap[i + 1]! * lightBoost)
    const b = Math.min(255, albedo[2] * lightMap[i + 2]! * lightBoost)
    if (alpha >= 1) {
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
    } else {
      px[i] = Math.round(px[i]! + (r - px[i]!) * alpha)
      px[i + 1] = Math.round(px[i + 1]! + (g - px[i + 1]!) * alpha)
      px[i + 2] = Math.round(px[i + 2]! + (b - px[i + 2]!) * alpha)
    }
  }
  const putRect = (x0: number, y0: number, x1: number, y1: number, albedo: RGB, boost = 1, alpha = 1) => {
    const xa = Math.max(0, Math.floor(Math.min(x0, x1)))
    const xb = Math.min(w, Math.ceil(Math.max(x0, x1)))
    const ya = Math.max(0, Math.floor(Math.min(y0, y1)))
    const yb = Math.min(h, Math.ceil(Math.max(y0, y1)))
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) put(x, y, albedo, boost, alpha)
  }
  const add = (x: number, y: number, color: RGB, a: number) => {
    if (a <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    px[i] = Math.min(255, Math.round(px[i]! + color[0] * a))
    px[i + 1] = Math.min(255, Math.round(px[i + 1]! + color[1] * a))
    px[i + 2] = Math.min(255, Math.round(px[i + 2]! + color[2] * a))
  }
  const addGlow = (gx: number, gy: number, r: number, color: RGB, peak: number) => {
    const xa = Math.max(0, Math.floor(gx - r))
    const xb = Math.min(w - 1, Math.ceil(gx + r))
    const ya = Math.max(0, Math.floor(gy - r))
    const yb = Math.min(h - 1, Math.ceil(gy + r))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy) / r
        if (d < 1) add(x, y, color, peak * (1 - d) * (1 - d))
      }
    }
  }

  // Back wall: staggered masonry with bevels, mortar, grain, damp stains.
  const bh = Math.max(4, s * 1.7)
  const bw = bh * 2.3
  const capY = hd.Y(1)
  const footY = hd.Y(DUNGEON_FLOOR_TOP)
  for (let y = 0; y < Math.min(h, Math.ceil(footY)); y++) {
    const row = Math.floor(y / bh)
    const ly = y - row * bh
    for (let x = 0; x < w; x++) {
      const off = (row % 2) * bw * 0.5
      const col = Math.floor((x + off) / bw)
      const lx = x + off - col * bw
      const tone = 0.7 + 0.5 * hash(col, row) + 0.18 * (vnoise((x / s) * 0.6, (y / s) * 0.6) - 0.5)
      let albedo = hdDarken(hdMix(stoneDark, stone, 0.35 + 0.5 * hash(col + 9, row)), tone)
      const mortar = lx < 1.3 || ly < 1.3
      if (mortar) albedo = hdDarken(albedo, 0.45)
      else if (ly < 2.6 || lx < 2.6) albedo = hdDarken(albedo, 1.18)
      else if (ly > bh - 2 || lx > bw - 2) albedo = hdDarken(albedo, 0.85)
      // Damp, mossy lower wall.
      const damp = clamp01((y / (footY || 1) - 0.62) * 3) * vnoise((x / s) * 0.35, (y / s) * 0.5 + 3)
      if (damp > 0.35) albedo = hdMix(albedo, descent ? [40, 70, 60] : [60, 80, 40], (damp - 0.35) * 0.9)
      put(x, y, albedo)
    }
  }
  // Vaulted ceiling: a stone lintel with deep shadow bleeding down the wall.
  putRect(0, 0, w, capY, hdDarken(stoneDark, 0.8), 0.7)
  for (let y = 0; y < Math.floor(capY + s * 6); y++) {
    const a = y < capY ? 0.5 : 0.6 * (1 - (y - capY) / (s * 6))
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      px[i] = Math.round(px[i]! * (1 - a))
      px[i + 1] = Math.round(px[i + 1]! * (1 - a))
      px[i + 2] = Math.round(px[i + 2]! * (1 - a))
    }
  }
  putRect(0, hd.Y(0.84), w, capY, hdDarken(stoneDark, 0.55), 1)
  // Moisture streaks under each drip.
  for (const dx of DUNGEON_DRIPS) {
    const sx = hd.X(dx + 0.5)
    for (let y = Math.floor(capY); y < footY; y++) {
      const a = 0.16 * (1 - (y - capY) / (footY - capY)) * (0.6 + 0.4 * vnoise(y / s, dx))
      for (let k = -1; k <= 1; k++) put(Math.round(sx + k), y, drip, 0.9, a * (k === 0 ? 1 : 0.4))
    }
  }

  // Foreground piers frame the chamber.
  const pierW = hd.X(2.25)
  const drawPier = (x0: number, x1: number, side: number) => {
    for (let y = Math.floor(capY); y < Math.ceil(footY); y++) {
      const row = Math.floor(y / (bh * 1.4))
      const ly = y - row * bh * 1.4
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const f = (x - x0) / (x1 - x0 || 1)
        const inner = side < 0 ? f : 1 - f
        const edgeLight = 0.55 + 0.55 * inner
        const tone = 0.8 + 0.3 * hash(row, Math.floor(x / (pierW * 0.6)))
        let a = hdDarken(hdMix(stoneDark, stone, 0.5), tone * edgeLight)
        if (ly < 1.4) a = hdDarken(a, 0.5)
        put(x, y, a, 1.0)
      }
    }
    // Inner edge catches torchlight.
    const ex = side < 0 ? x1 - 1 : x0
    for (let y = Math.floor(capY); y < Math.ceil(footY); y++) put(Math.round(ex), y, hdDarken(stone, 1.5), 1.3)
  }
  drawPier(0, pierW, -1)
  drawPier(w - pierW, w, 1)

  // Drips: elongated falling drop, soft trail, a ripple where it lands.
  const dripR = Math.max(1.6, s * 0.2)
  DUNGEON_DRIPS.forEach((dx, i) => {
    const dy = dungeonDripY(t, i)
    const sx = hd.X(dx + 0.5)
    const sy = hd.Y(dy + 0.62)
    for (let k = 0; k < 7; k++)
      add(Math.round(sx), Math.round(sy - k * dripR * 0.9), [90, 140, 180], 0.35 * (1 - k / 7))
    hd.disk(sx, sy, dripR, hdMix(drip, [255, 255, 255], 0.15))
    hd.disk(sx - dripR * 0.3, sy - dripR * 0.35, dripR * 0.4, [230, 246, 255])
    if (dy > 12) {
      const rr = (dy - 12) * s * 0.9
      for (let a = 0; a < 360; a += 2) {
        const rad = (a * Math.PI) / 180
        add(
          Math.round(sx + Math.cos(rad) * rr),
          Math.round(hd.Y(DUNGEON_FLOOR_TOP) + 3 + Math.sin(rad) * rr * 0.25),
          [120, 160, 200],
          0.3,
        )
      }
    }
  })

  // Stone slab used by treads and landings: lit top, brick front.
  const slab = (x0: number, y0: number, x1: number, y1: number, topH: number) => {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const lyy = y - y0
        const onTop = lyy < topH
        const col = Math.floor((x - x0) / (s * 3.4))
        let a = onTop
          ? hdDarken(step, 1.25)
          : hdDarken(hdMix(step, stoneDark, 0.55), 0.85 + 0.25 * hash(col, Math.floor(y0)))
        if (!onTop && ((x - x0) % (s * 3.4) < 1.2 || lyy > y1 - y0 - 1.3)) a = hdDarken(a, 0.55)
        if (!onTop && x - x0 < 2) a = hdDarken(a, 1.3)
        put(x, y, a, descent ? 1.9 : 1.2)
      }
    }
    // Contact shadow on the wall below the slab.
    for (let k = 0; k < s * 2.6; k++) {
      const fade = 1 - k / (s * 2.6)
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const i = (Math.floor(y1 + k) * w + x) * 3
        if (x < 0 || x >= w || y1 + k >= h || y1 + k >= footY) continue
        const f = 1 - 0.55 * fade
        px[i] = Math.round(px[i]! * f)
        px[i + 1] = Math.round(px[i + 1]! * f)
        px[i + 2] = Math.round(px[i + 2]! * f)
      }
    }
  }

  if (descent) {
    for (let k = 0; k < DUNGEON_STEP_COUNT; k++) {
      const sx = DUNGEON_STEP_X + k * DUNGEON_STEP_DX
      const sy = DUNGEON_STEP_Y + k * DUNGEON_STEP_DY
      slab(hd.X(sx), hd.Y(sy + 0.32), hd.X(sx + DUNGEON_STEP_DX), hd.Y(sy + 1.35), s * 0.55)
      // Riser dropping to the next tread.
      putRect(
        hd.X(sx + DUNGEON_STEP_DX),
        hd.Y(sy + 1.35),
        hd.X(sx + DUNGEON_STEP_DX + 0.85),
        hd.Y(sy + 2.32),
        stoneDark,
        0.8,
      )
    }
    const land = DUNGEON_LANDING
    slab(hd.X(land.x), hd.Y(land.y + 0.32), hd.X(land.x + 15), hd.Y(DUNGEON_FLOOR_TOP), s * 0.6)
    // Cold light from the shaft at the stairhead.
    const hx = hd.X(DUNGEON_STEP_X + 3.5)
    addGlow(hx, hd.Y(DUNGEON_STEP_Y), s * 9, [90, 120, 190], 0.2)
    // Dust motes drifting through the torch beams.
    for (let i = 0; i < 24; i++) {
      const mx = (((hash(i, 1) * w + Math.sin(phase * TAU + i) * s * 1.5 + phase * s * 4) % w) + w) % w
      const my = hash(i, 2) * footY * 0.9 + capY
      add(Math.round(mx), Math.round(my), [200, 190, 230], 0.28 + 0.15 * Math.sin(phase * TAU * 2 + i))
    }
  } else {
    for (const pillar of DUNGEON_PILLARS) {
      const pcx = hd.X(pillar + 1)
      const topY = hd.Y(DUNGEON_PILLAR_TOP)
      const baseY = hd.Y(DUNGEON_PILLAR_BASE)
      const halfT = s * 1.7
      const halfB = s * 2.1
      for (let y = Math.floor(topY); y < Math.ceil(baseY); y++) {
        const f = (y - topY) / (baseY - topY || 1)
        const half = halfT + (halfB - halfT) * f
        for (let x = Math.floor(pcx - half); x < Math.ceil(pcx + half); x++) {
          const u = (x + 0.5 - pcx) / half
          // Cylinder: normal faces the chest side.
          const toward = pillar < 38 ? 1 : -1
          const lam = clamp01(0.45 + 0.6 * (Math.sqrt(Math.max(0, 1 - u * u)) * 0.6 + u * toward * 0.55))
          const flute = 0.88 + 0.12 * Math.cos(u * Math.PI * 4.5)
          const grain = 0.9 + 0.2 * vnoise((x / s) * 0.7, (y / s) * 0.25)
          put(x, y, hdDarken(hdMix(stoneDark, stone, lam), flute * grain * 1.2), 1.1)
        }
      }
      // Capital and base with moulding and a lit upper edge.
      for (const [y0, y1, ext] of [
        [DUNGEON_PILLAR_TOP - 0.7, DUNGEON_PILLAR_TOP, 2.7],
        [DUNGEON_PILLAR_TOP - 0.2, DUNGEON_PILLAR_TOP + 0.3, 2.2],
        [DUNGEON_PILLAR_BASE - 0.3, DUNGEON_PILLAR_BASE + 0.7, 2.7],
      ] as const) {
        putRect(pcx - s * ext, hd.Y(y0), pcx + s * ext, hd.Y(y1), hdDarken(hdMix(stoneDark, stone, 0.6), 1.05), 1.1)
        putRect(pcx - s * ext, hd.Y(y0), pcx + s * ext, hd.Y(y0) + 1.6, hdDarken(stone, 1.3), 1.2)
        putRect(pcx - s * ext, hd.Y(y1) - 1.6, pcx + s * ext, hd.Y(y1), hdDarken(stoneDark, 0.5), 1)
      }
    }
    // Golden light spilling upward from the open chest.
    const ccx = hd.X(chest.x + 4)
    for (let k = -2; k <= 2; k++) {
      const sway = Math.sin(phase * TAU * 2 + k) * s * 0.6
      for (let st = 0; st < 60; st++) {
        const f = st / 60
        addGlow(
          ccx + k * s * 1.8 * f + sway * f,
          hd.Y(chest.y) - f * s * 11,
          s * (1.4 + f * 3),
          [255, 200, 90],
          0.07 * (1 - f),
        )
      }
    }
    addGlow(ccx, hd.Y(chest.y + 1), s * 14, [255, 190, 80], 0.38)
    // Chest: planked body, iron bands, rivets, propped-open lid, heaped gold.
    const cx0 = hd.X(chest.x)
    const cx1 = hd.X(chest.x + 8)
    const bodyTop = hd.Y(chest.y + 0.9)
    const bodyBot = hd.Y(chest.y + 3)
    // Open lid, seen from inside, hinged at the back.
    for (let y = Math.floor(hd.Y(chest.y - 1.4)); y < Math.ceil(hd.Y(chest.y + 0.5)); y++) {
      const f = (y - hd.Y(chest.y - 1.4)) / (hd.Y(chest.y + 0.5) - hd.Y(chest.y - 1.4))
      const inset = (1 - f) * s * 0.7
      for (let x = Math.floor(cx0 + inset); x < Math.ceil(cx1 - inset); x++) {
        const plank = Math.floor((x - cx0) / (s * 1.6))
        put(x, y, hdDarken(hdMix(wood, hdHex(c.chest), 0.6), 0.5 + 0.18 * hash(plank, 3)), 1.6)
        if ((x - cx0) % (s * 1.6) < 1) put(x, y, hdDarken(wood, 0.3), 1)
      }
    }
    putRect(cx0, hd.Y(chest.y - 1.4), cx1, hd.Y(chest.y - 1.4) + 2.4, hdDarken(gold, 0.8), 1.3)
    // Interior glow of the pile.
    for (let y = Math.floor(hd.Y(chest.y + 0.35)); y < Math.ceil(bodyTop + s * 0.4); y++) {
      for (let x = Math.floor(cx0 + 2); x < Math.ceil(cx1 - 2); x++) {
        const mound = Math.sin(((x - cx0) / (cx1 - cx0)) * Math.PI)
        if (y < hd.Y(chest.y + 0.9) - mound * s * 1.1) continue
        const sparkle = 0.85 + 0.3 * hash(x >> 1, y >> 1)
        put(x, y, hdMix(coin, glint, 0.25 * hash(x, y)), 2.2 * sparkle)
      }
    }
    for (let y = Math.floor(bodyTop); y < Math.ceil(bodyBot); y++) {
      for (let x = Math.floor(cx0); x < Math.ceil(cx1); x++) {
        const plank = Math.floor((y - bodyTop) / (s * 1.35))
        const grain = 0.85 + 0.3 * vnoise((x / s) * 0.35, (y / s) * 1.8 + plank * 4)
        let a = hdDarken(hdHex(c.chest), grain * (1 - 0.15 * plank))
        if ((y - bodyTop) % (s * 1.35) < 1.1) a = hdDarken(a, 0.55)
        if (x - cx0 < 2 || cx1 - x <= 2) a = hdDarken(a, 0.65)
        put(x, y, a, 1.35)
      }
    }
    for (const bx of [cx0 + s * 0.4, cx1 - s * 1.5]) {
      putRect(bx, bodyTop - 1, bx + s * 1.1, bodyBot, hdDarken(stoneDark, 0.9), 1.4)
      putRect(bx, bodyTop - 1, bx + 1.5, bodyBot, hdDarken(step, 1.2), 1.4)
      for (const ry of [bodyTop + s * 0.6, bodyBot - s * 0.7])
        hd.disk(bx + s * 0.55, ry, Math.max(1, s * 0.16), hdDarken(gold, 1.1))
    }
    putRect(cx0, bodyTop - 1, cx1, bodyTop + 2.5, hdDarken(gold, 0.95), 1.5)
    putRect(cx0 + s * 3.4, bodyTop + s * 0.5, cx1 - s * 3.4, bodyTop + s * 1.9, gold, 1.5) // clasp plate
    hd.disk((cx0 + cx1) / 2, bodyTop + s * 1.2, Math.max(1.2, s * 0.22), [40, 24, 10])
    // Coin heaps: stacked discs with specular edges.
    for (const [pi, pile] of DUNGEON_COIN_PILES.entries()) {
      const hx = hd.X(pile + 1.5)
      const baseLine = hd.Y(chest.y + 3.7)
      for (let k = 0; k < 90; k++) {
        const a = hash(k, pi + 50)
        const b = hash(k, pi + 70)
        const spread = (a - 0.5) * s * 6.5
        const height = Math.max(0, 1 - Math.abs(spread) / (s * 3.5)) * s * 2.2
        const y = baseLine - b * height
        const r = Math.max(1.6, s * 0.34)
        hd.disk(hx + spread, y, r, hdDarken(hdMix(coin, gold, hash(k, 4)), 0.55 + 0.6 * b))
        hd.disk(hx + spread - r * 0.25, y - r * 0.3, r * 0.45, hdMix(coin, glint, 0.6))
      }
    }
    // Scattered coins on the floor in front of the chest.
    for (let k = 0; k < 14; k++) {
      const gx = hd.X(chest.x - 3) + hash(k, 90) * (hd.X(chest.x + 11) - hd.X(chest.x - 3))
      const gy = hd.Y(chest.y + 3.8) + hash(k, 91) * s * 1.6
      hd.blob(gx, gy, Math.max(1.5, s * 0.3), Math.max(1, s * 0.15), hdMix(coin, gold, hash(k, 6)))
    }
    DUNGEON_GLINTS.forEach((point, i) => {
      if (!dungeonTwinkle(t, i)) return
      const gx = hd.X(point.x + 0.5)
      const gy = hd.Y(point.y + 0.5)
      addGlow(gx, gy, s * 2.6, glint, 0.5)
      for (let k = -4; k <= 4; k++) {
        add(Math.round(gx + k * s * 0.35), Math.round(gy), glint, 0.8 * (1 - Math.abs(k) / 5))
        add(Math.round(gx), Math.round(gy + k * s * 0.35), glint, 0.8 * (1 - Math.abs(k) / 5))
      }
    })
  }

  // Torches: iron bracket, wrapped wooden handle, layered animated flame.
  for (const [i, torch] of DUNGEON_TORCHES.entries()) {
    const tx = hd.X(torch + 0.5)
    const ty = hd.Y(DUNGEON_TORCH_Y + 0.5)
    addGlow(tx, ty, s * 8, flame, 0.3)
    hd.stroke(
      torch + 0.5,
      DUNGEON_TORCH_Y + 0.9,
      torch + 0.5,
      DUNGEON_TORCH_Y + 2.7,
      Math.max(1.5, s * 0.22),
      hdDarken(wood, 0.85),
    )
    hd.stroke(
      torch + 0.5,
      DUNGEON_TORCH_Y + 2.7,
      torch + 0.5,
      DUNGEON_TORCH_Y + 2.9,
      Math.max(1.5, s * 0.3),
      hdDarken(stoneDark, 0.8),
    )
    hd.rect(
      tx - s * 0.7,
      hd.Y(DUNGEON_TORCH_Y + 0.85),
      tx + s * 0.7,
      hd.Y(DUNGEON_TORCH_Y + 0.85) + 2.2,
      hdDarken(stoneDark, 0.7),
    )
    const sway = Math.sin(phase * TAU * 5 + i * 1.7) * s * 0.28 + (beat ? s * 0.1 : -s * 0.1)
    const lift = 1 + 0.18 * Math.sin(phase * TAU * 7 + i) + (beat ? 0.08 : -0.05)
    for (const [layer, color, rr, hh] of [
      [0, [255, 120, 30], 0.95, 2.6],
      [1, flame, 0.68, 2.2],
      [2, [255, 236, 170], 0.38, 1.5],
    ] as const) {
      for (let y = 0; y < s * hh * lift; y++) {
        const f = y / (s * hh * lift)
        const half = rr * s * 0.62 * Math.sin(Math.PI * Math.pow(1 - f, 0.7)) * (1 - f * 0.3)
        const cxx = tx + sway * f * f * 1.4
        for (let xx = Math.floor(cxx - half); xx <= Math.ceil(cxx + half); xx++) {
          const edge = 1 - Math.abs(xx - cxx) / (half || 1)
          add(xx, Math.round(ty + s * 0.3 - y), color as RGB, (layer === 2 ? 0.85 : 0.55) * clamp01(edge * 1.6))
        }
      }
    }
    // Sparks.
    for (let k = 0; k < 3; k++) {
      const f = (phase * 2 + k / 3 + i * 0.37) % 1
      add(Math.round(tx + Math.sin(f * 9 + k) * s * 0.7), Math.round(ty - f * s * 5), [255, 200, 110], 0.8 * (1 - f))
    }
  }

  // Flagstone floor in perspective, lit by the same lights, with a wet sheen.
  const floorH = h - footY
  for (let y = Math.floor(footY); y < h; y++) {
    const f = clamp01((y - footY) / (floorH || 1))
    const rowH = s * (1.4 + f * 3.2)
    const row = Math.floor((y - footY) / rowH + 20)
    for (let x = 0; x < w; x++) {
      const cxp = w / 2
      const spread = 1 + f * 1.4
      const col = Math.floor((x - cxp) / (s * 6 * spread) + 40 + (row % 2) * 0.5)
      const lx = ((x - cxp) / (s * 6 * spread) + 40 + (row % 2) * 0.5) % 1
      const ly = ((y - footY) / rowH) % 1
      let a = hdDarken(hdMix(floorC, stone, 0.12), 0.7 + 0.5 * hash(col, row))
      if (lx < 0.04 || ly < 0.08) a = hdDarken(a, 0.45)
      put(x, y, a, 1.1 - f * 0.2)
    }
    // Contact shadow at the wall's foot.
  }
  for (let k = 0; k < s * 1.8; k++) {
    const f = 1 - k / (s * 1.8)
    for (let x = 0; x < w; x++) {
      const y = Math.floor(footY) + k
      if (y >= h) break
      const i = (y * w + x) * 3
      px[i] = Math.round(px[i]! * (1 - 0.5 * f))
      px[i + 1] = Math.round(px[i + 1]! * (1 - 0.5 * f))
      px[i + 2] = Math.round(px[i + 2]! * (1 - 0.5 * f))
    }
  }
  // Torchlight pooling on the flagstones.
  for (const l of lights) addGlow(l.x, footY + s * 1.2, s * 10, descent ? [150, 100, 60] : l.color, 0.12 * l.k)

  // Vignette to focus the eye.
  for (let y = 0; y < h; y++) {
    const vy = Math.abs(y / h - 0.5) * 2
    for (let x = 0; x < w; x++) {
      const vx = Math.abs(x / w - 0.5) * 2
      const v = 1 - 0.38 * Math.pow(Math.max(0, Math.max(vx, vy) - 0.55) / 0.45, 1.7) - 0.18 * vx * vx
      const i = (y * w + x) * 3
      px[i] = Math.round(px[i]! * v)
      px[i + 1] = Math.round(px[i + 1]! * v)
      px[i + 2] = Math.round(px[i + 2]! * v)
    }
  }
  return px
}
