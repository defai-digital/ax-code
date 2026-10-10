import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  JUNGLE_CANOPY_BOTTOM,
  JUNGLE_COLUMNS,
  JUNGLE_COLORS,
  JUNGLE_CYCLE_MS,
  JUNGLE_GROUND_TOP,
  JUNGLE_MOON,
  JUNGLE_PARROT_Y,
  JUNGLE_ROWS,
  JUNGLE_SHAFTS,
  JUNGLE_TRUNKS,
  JUNGLE_VINES,
  jungleFireflies,
  jungleLeaves,
  jungleParrotX,
  jungleSkyRgb,
  jungleSway,
  type JungleStyle,
} from "./jungle-view-model"
import { clamp01 } from "./atmos-paint"

const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Freeform HD renderer. A rainforest in depth: hazed far trunks and foliage,
 * a canopy of overlapping shaded leaves with gaps for the sky (or the moon),
 * buttressed trunks with moss and lianas, sun shafts and drifting motes by
 * day, fireflies, glowing mushrooms and blue mist by night, a macaw crossing
 * the clearing, and a fern-and-flower forest floor. Layout comes from the
 * shared scene model. Pure: every pixel derives from `elapsedMs`.
 */
export function renderJunglePixels(width: number, height: number, style: JungleStyle, elapsedMs: number): Buffer {
  let w = Math.max(0, Math.floor(width))
  let h = Math.max(0, Math.floor(height))
  if (w > 0 && h > 0) {
    const scale = Math.min(1, 1920 / w, 1080 / h)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  const hd = createHdCanvas(w, h, JUNGLE_COLUMNS, JUNGLE_ROWS)
  const { cw, ch, X, Y } = hd
  if (w === 0 || h === 0) return hd.pixels
  const night = style === "jungle-night"
  const c = JUNGLE_COLORS[style]
  const unit = Math.max(1, Math.min(cw, ch / 2))
  const phase = (Math.max(0, elapsedMs) % JUNGLE_CYCLE_MS) / JUNGLE_CYCLE_MS
  const theta = phase * Math.PI * 2
  const leaf = hdHex(c.leaf),
    leafDark = hdHex(c.leafDark),
    leafLight = hdHex(c.leafLight)
  const vine = hdHex(c.vine),
    trunk = hdHex(c.trunk),
    ground = hdHex(c.ground)
  const fern = hdHex(c.fern),
    flower = hdHex(c.flower)
  const skyAt = (y: number): RGB => jungleSkyRgb(style, h <= 1 ? 0 : y / (h - 1))
  const canopyY = Y(JUNGLE_CANOPY_BOTTOM)
  const floorY = Y(JUNGLE_GROUND_TOP)
  const mist = night ? hdHex("#3a5a8a") : hdHex("#e8f4d0")

  const tint = (x: number, y: number, color: RGB, a: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return
    const i = (y * w + x) * 3
    for (let k = 0; k < 3; k++) hd.pixels[i + k] = Math.round(hd.pixels[i + k]! + (color[k]! - hd.pixels[i + k]!) * a)
  }
  const glow = (cx: number, cy: number, radius: number, color: RGB, strength: number) => {
    const xa = Math.max(0, Math.floor(cx - radius)),
      xb = Math.min(w - 1, Math.ceil(cx + radius))
    const ya = Math.max(0, Math.floor(cy - radius)),
      yb = Math.min(h - 1, Math.ceil(cy + radius))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
        if (d < 1) tint(x, y, color, strength * (1 - d) * (1 - d))
      }
    }
  }
  /** Pointed leaf of `len` along `angle`, width `wid`, shaded across its width. */
  const leafShape = (
    cx: number,
    cy: number,
    len: number,
    wid: number,
    angle: number,
    base: RGB,
    hi: RGB,
    rib = true,
  ) => {
    const ca = Math.cos(angle),
      sa = Math.sin(angle)
    const reach = Math.ceil(Math.max(len, wid) + 1)
    const xa = Math.max(0, Math.floor(cx - reach)),
      xb = Math.min(w - 1, Math.ceil(cx + reach))
    const ya = Math.max(0, Math.floor(cy - reach)),
      yb = Math.min(h - 1, Math.ceil(cy + reach))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5 - cx,
          py = y + 0.5 - cy
        const u = (px * ca + py * sa) / len
        if (u < -1 || u > 1) continue
        const v = (-px * sa + py * ca) / wid
        const prof = Math.pow(1 - u * u, 0.75)
        if (Math.abs(v) > prof) continue
        const lit = clamp01(0.5 - v * 0.5 + (1 - Math.abs(u)) * 0.1)
        let col = hdMix(base, hi, lit * 0.8)
        if (rib && Math.abs(v) < 0.07) col = hdDarken(col, 0.82)
        hd.set(x, y, col)
      }
    }
  }

  // --- Sky and far forest ---------------------------------------------------------
  hd.sky((t) => skyAt(t * (h - 1)))
  glow(w * 0.55, floorY - ch * 3, w * 0.6, night ? hdHex("#274a78") : hdHex("#fff6c8"), night ? 0.28 : 0.3)
  const farTone = hdMix(leafDark, skyAt(floorY - ch * 3), night ? 0.55 : 0.65)
  const farTone2 = hdMix(leaf, skyAt(floorY - ch * 3), night ? 0.5 : 0.55)
  for (const [layer, tone, count] of [
    [0, farTone, 9],
    [1, farTone2, 7],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const tx = X(((i + hash(i + layer * 20)) / count) * JUNGLE_COLUMNS)
      const tw = unit * (0.9 + hash(i + 3) * 0.8) * (layer === 0 ? 0.8 : 1.1)
      hd.rect(tx - tw / 2, canopyY - ch * 0.3, tx + tw / 2, floorY, tone)
      const crown = unit * (6 + hash(i + 40) * 5)
      hd.blob(tx, canopyY + ch * (layer === 0 ? 1.4 : 3 + hash(i) * 1.5), crown, ch * (1.4 + hash(i + 8) * 0.8), tone)
    }
  }
  // Mist layers lying between the far and mid forest.
  for (let y = Math.floor(floorY - ch * 7); y < floorY; y++) {
    const a =
      smooth(floorY - ch * 7, floorY - ch * 1.5, y) *
      (night ? 0.38 : 0.3) *
      (1 - smooth(floorY - ch * 1.5, floorY, y) * 0.4)
    for (let x = 0; x < w; x++) tint(x, y, mist, a * (0.8 + 0.2 * Math.sin(x * 0.012 + theta)))
  }

  // --- Mid trunks ---------------------------------------------------------------------
  const drawTrunk = (xCell: number, half0: number, flare: number, lean: number, lit: number, tone: number) => {
    const cx0 = X(xCell + 0.5)
    const top = -ch
    for (let y = Math.max(0, Math.floor(top)); y < Math.ceil(floorY + ch * 0.3); y++) {
      const t = (y - top) / (floorY - top)
      const bend = Math.sin(t * 3 + xCell) * unit * 0.5 + lean * unit * t * 2
      const half = (half0 + Math.pow(t, 6) * flare) * cw * 0.9
      const cx = cx0 + bend
      for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
        const u = (x + 0.5 - (cx - half)) / (2 * half || 1)
        const bark = Math.sin(u * 17 + Math.sin(y * 0.04) * 2) * 0.5 + Math.sin(u * 41 + y * 0.01) * 0.25
        let col = hdMix(hdDarken(trunk, 0.65 * tone), hdDarken(trunk, 1.15 * tone), clamp01(lit - u * 0.9 + 0.35))
        col = hdDarken(col, 1 + bark * 0.09)
        // Moss climbs the shaded trunk base and clings in patches.
        const moss = Math.sin(y * 0.05 + xCell) * 0.5 + 0.5 + (1 - t) * -0.2
        if (moss > 0.62 && u > 0.55) col = hdMix(col, hdDarken(leaf, 1.1), 0.5)
        hd.set(x, y, col)
      }
    }
    // Buttress roots splaying over the ground.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 16; i++) {
        const u = i / 15
        const rx = cx0 + side * (half0 * cw * 0.9 + u * unit * 3.5 * flare)
        const ry = floorY - ch * 1.1 * (1 - u) * (1 - u) + ch * 0.1
        hd.disk(rx, ry, Math.max(1.5, unit * (1.0 - u * 0.7)), hdDarken(trunk, 0.7 * tone))
      }
    }
  }
  const trunkInfo: [number, number, number, number, number][] = [
    // x, half, flare, lean, tone
    [JUNGLE_TRUNKS[0]!, 0.7, 1.0, 0.3, 0.9],
    [JUNGLE_TRUNKS[1]!, 0.85, 1.3, -0.15, 1.0],
    [JUNGLE_TRUNKS[2]!, 0.7, 1.0, -0.3, 0.9],
  ]
  for (const [x, half, flare, lean, tone] of trunkInfo) drawTrunk(x, half, flare, lean, 0.9, tone * (night ? 0.7 : 1))

  // --- Canopy with sky gaps ---------------------------------------------------------------
  const moonX = X(JUNGLE_MOON.x),
    moonY = Y(JUNGLE_MOON.y + 0.6)
  const gaps: { x: number; y: number; rx: number; ry: number }[] = night
    ? [{ x: moonX, y: moonY, rx: cw * 8.5, ry: ch * 3.2 }]
    : JUNGLE_SHAFTS.map((s) => ({ x: X(s), y: canopyY - ch * 1.2, rx: cw * 3.6, ry: ch * 1.4 }))
  const inGap = (x: number, y: number, margin = 0) =>
    gaps.some((g) => ((x - g.x) / (g.rx + margin)) ** 2 + ((y - g.y) / (g.ry + margin * 0.6)) ** 2 < 1)
  if (night) {
    const moon = hdHex(c.shaft)
    glow(moonX, moonY, unit * 16, hdHex("#5a78b8"), 0.5)
    glow(moonX, moonY, unit * 6, moon, 0.4)
    hd.disk(moonX, moonY, Math.max(3, unit * 1.9), hdMix(moon, [255, 255, 255], 0.45))
    hd.disk(moonX - unit * 0.5, moonY - unit * 0.2, unit * 0.5, hdMix(moon, hdHex("#7088b8"), 0.5))
  } else {
    for (const g of gaps) {
      glow(g.x, g.y, g.rx * 1.6, hdHex("#fff6c8"), 0.6)
    }
  }
  const layers: [number, number, number, number, RGB, RGB][] = [
    // count, spread below canopy line (rows), size, brightness, base, highlight
    [190, 1.6, 8.5, 0.5, hdDarken(leafDark, 0.8), leafDark],
    [210, 0.9, 7.5, 0.85, leafDark, leaf],
    [170, 0.2, 6.5, 1.0, leaf, leafLight],
  ]
  layers.forEach(([count, spread, size, bright, base, hi], li) => {
    for (let i = 0; i < count; i++) {
      const sx = hash(i * 3.1 + li * 71) * (w + unit * 6) - unit * 3
      const baseY = canopyY + (hash(i * 5.7 + li * 13) - 0.55) * (canopyY + ch * spread)
      // Ragged lower edge: each layer reaches lower under the hanging fringe.
      const ragged = Math.sin((sx / cw) * 0.55 + li) * ch * 0.35
      const sy = Math.max(-ch, Math.min(baseY + ragged, canopyY + ch * spread))
      const len = unit * size * 0.62 * (0.7 + hash(i + 9 + li) * 0.7)
      if (inGap(sx, sy, len * 0.9)) continue
      const angle = (li === 2 ? Math.PI / 2 : 0) + (hash(i * 2.3 + li) - 0.5) * (li === 2 ? 2.1 : 5.5)
      const sway = Math.sin(theta + i * 0.7) * 0.05 * (li + 1)
      const lightness = bright * (night ? 0.7 : 1)
      leafShape(
        sx,
        sy,
        len,
        len * (0.3 + hash(i + 31) * 0.1),
        angle + sway,
        hdDarken(base, lightness),
        hdDarken(hi, lightness),
      )
    }
  })
  // Light spills from each gap onto the surrounding leaves.
  for (const g of gaps) glow(g.x, g.y, g.rx * 1.7, night ? hdHex("#8aa8d8") : hdHex("#fff6c8"), night ? 0.22 : 0.35)

  // --- Lianas --------------------------------------------------------------------------
  for (const stem of JUNGLE_VINES) {
    const tip = jungleSway(elapsedMs, stem)
    const x0 = X(stem + 0.5)
    const y0 = canopyY - ch * 0.4
    const y1 = Y(14.4)
    const steps = 40
    let prevX = x0
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x =
        x0 +
        X(tip) * t * t +
        Math.sin(t * 5 + stem) * unit * 0.6 * (1 - t) +
        Math.sin(theta + stem + t * 3) * unit * 0.4 * t
      const y = y0 + (y1 - y0) * t
      hd.disk(x, y, Math.max(1, unit * (0.28 - t * 0.1)), hdMix(vine, leafDark, 0.25 * t))
      if (i % 5 === 3) {
        const side = i % 10 === 3 ? 1 : -1
        leafShape(
          x + side * unit * 1.1,
          y + unit * 0.4,
          unit * 2.2,
          unit * 0.8,
          side > 0 ? 0.5 : Math.PI - 0.5,
          vine,
          leafLight,
        )
      }
      prevX = x
    }
    // Bulb or blossom at the tip.
    hd.disk(prevX, y1 + unit * 0.4, Math.max(2, unit * 0.65), hdMix(vine, leafLight, 0.3))
    hd.disk(prevX, y1 + unit * 0.6, Math.max(1.5, unit * 0.4), hdMix(flower, vine, 0.2))
  }

  // --- Light shafts and dust (day) / mist glow (night) ---------------------------------------------------------------
  if (!night) {
    JUNGLE_SHAFTS.forEach((s, k) => {
      const ox = X(s),
        oy = canopyY - ch * 0.8
      const dx = unit * 0.45,
        dy = 1
      const len = floorY - oy + ch * 0.5
      const pulse = 0.85 + 0.15 * Math.sin(theta + k * 2)
      const nrm = Math.hypot(dx, dy)
      for (let y = Math.max(0, Math.floor(oy)); y < Math.min(h, Math.ceil(oy + len)); y++) {
        const t = (y - oy) / len
        const cx = ox + (((y - oy) * dx) / dy) * 1.0
        const half = unit * (1.8 + t * 7.5)
        for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(w, Math.ceil(cx + half)); x++) {
          const edge = 1 - Math.abs(x + 0.5 - cx) / half
          tint(x, y, hdHex("#fff2b0"), 0.3 * edge * edge * (1 - t * 0.6) * pulse)
        }
      }
      void nrm
      // Sunlit patch on the forest floor.
      glow(ox + len * dx, floorY + ch * 0.7, unit * 9, hdHex("#fff6b0"), 0.35 * pulse)
    })
    for (let i = 0; i < 26; i++) {
      const s = JUNGLE_SHAFTS[i % 3]!
      const t = (hash(i + 5) + phase * (0.3 + (i % 3) * 0.1)) % 1
      const mx = X(s) + (floorY - canopyY) * t * 0.45 + (hash(i + 70) - 0.5) * unit * 8 * (0.3 + t)
      const my = canopyY + t * (floorY - canopyY)
      const tw = 0.5 + 0.5 * Math.sin(theta * 2 + i)
      glow(mx, my, unit * 1.2, hdHex("#fffbd0"), 0.5 * tw)
    }
  } else {
    // Cool moonbeam slanting down from the gap.
    const dir = 0.35
    for (let y = Math.floor(moonY); y < floorY; y++) {
      const t = (y - moonY) / (floorY - moonY)
      const cx = moonX - (y - moonY) * dir
      const half = unit * (3 + t * 12)
      for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(w, Math.ceil(cx + half)); x++) {
        const edge = 1 - Math.abs(x + 0.5 - cx) / half
        tint(x, y, hdHex("#8aa8d8"), 0.14 * edge * edge * (1 - t * 0.6))
      }
    }
  }

  // --- Falling leaves (day) / fireflies (night) / parrot ---------------------------------------------------
  if (!night) {
    jungleLeaves(elapsedMs).forEach((fallen, i) => {
      const ang = theta * 1.5 + i
      leafShape(
        X(fallen.x + 0.5),
        Y(fallen.y + 0.5),
        unit * 1.1,
        unit * 0.45,
        ang,
        hdDarken(leafLight, 0.85),
        hdMix(leafLight, hdHex("#fff2b0"), 0.35),
      )
    })
    // Macaw in flight.
    const px = X(jungleParrotX(elapsedMs) + 0.5)
    const py = Y(JUNGLE_PARROT_Y + 0.4) + Math.sin(theta * 2) * unit * 0.6
    const red = hdHex(c.parrot)
    const blue = hdHex("#2a62c8"),
      gold = hdHex("#f2c53a"),
      beak = hdHex("#f4ecd8")
    const flap = Math.sin(theta * 4)
    // Tail feathers trail behind.
    leafShape(px - unit * 3.4, py + unit * 0.5, unit * 2.8, unit * 0.45, 0.25, hdDarken(red, 0.85), blue, false)
    leafShape(px - unit * 3.1, py + unit * 0.9, unit * 2.4, unit * 0.4, 0.4, hdDarken(red, 0.85), gold, false)
    // Wings: two feathered arcs that flap.
    for (const [off, scale] of [
      [-1, 0.8],
      [1, 1],
    ] as const) {
      const lift = flap * unit * 1.6 * scale
      leafShape(
        px - unit * 0.4 + off * unit * 0.6,
        py - unit * 0.5 - lift * 0.55,
        unit * 2.8,
        unit * 0.9,
        -Math.PI / 2 - 0.3 * off - flap * 0.4,
        off > 0 ? red : hdDarken(red, 0.8),
        off > 0 ? blue : gold,
      )
    }
    hd.blob(px, py, unit * 1.9, unit * 0.9, red)
    hd.blob(px - unit * 0.3, py + unit * 0.2, unit * 1.4, unit * 0.5, hdDarken(red, 0.82))
    hd.disk(px + unit * 1.7, py - unit * 0.35, unit * 0.75, red)
    hd.disk(px + unit * 1.9, py - unit * 0.5, Math.max(1, unit * 0.22), hdHex("#fff6e0"))
    hd.disk(px + unit * 1.95, py - unit * 0.5, Math.max(0.8, unit * 0.1), hdHex("#101010"))
    leafShape(
      px + unit * 2.5,
      py - unit * 0.1,
      unit * 0.9,
      unit * 0.45,
      0.6,
      beak,
      hdMix(beak, [255, 255, 255], 0.3),
      false,
    )
    // Butterflies fluttering through the clearing.
    for (let i = 0; i < 3; i++) {
      const bx = X(14 + i * 22 + Math.sin(theta + i * 2) * 3)
      const by = Y(11 + i * 2 + Math.cos(theta * 2 + i) * 0.8)
      const fl = 0.6 + 0.4 * Math.sin(theta * 8 + i)
      const col = i === 1 ? hdHex("#ff9ac8") : hdHex("#ffd23a")
      hd.blob(bx - unit * 0.5, by, unit * 0.5 * fl, unit * 0.45, col)
      hd.blob(bx + unit * 0.5, by, unit * 0.5 * fl, unit * 0.45, col)
    }
  } else {
    const firefly = hdHex(c.firefly)
    const moteList = jungleFireflies(elapsedMs)
    moteList.forEach((mote, i) => {
      const on = mote.char === "*"
      const cx = X(mote.x + 0.5),
        cy = Y(mote.y + 0.5)
      glow(cx, cy, unit * (on ? 5 : 2.4), firefly, on ? 0.7 : 0.35)
      hd.disk(cx, cy, Math.max(on ? 1.8 : 1, unit * (on ? 0.35 : 0.2)), hdMix(firefly, [255, 255, 255], on ? 0.5 : 0.1))
      void i
    })
    // Extra distant fireflies for depth.
    for (let i = 0; i < 24; i++) {
      const fx = X(hash(i + 1) * JUNGLE_COLUMNS) + Math.sin(theta + i) * unit * 2
      const fy = canopyY + ch * 2 + hash(i + 50) * (floorY - canopyY - ch * 3) + Math.cos(theta * 2 + i) * unit
      const blink = Math.sin(theta * 3 + i * 2.1)
      if (blink > 0.1) glow(fx, fy, unit * 1.8, firefly, 0.35 * blink)
    }
  }

  // --- Forest floor ----------------------------------------------------------------------------------
  for (let y = Math.floor(floorY); y < h; y++) {
    const v = (y - floorY) / (h - floorY || 1)
    for (let x = 0; x < w; x++) {
      const n = hash(x * 0.17 + y * 0.31)
      const col = hdMix(hdDarken(ground, 1.1), hdDarken(ground, 0.55), v)
      hd.set(x, y, hdDarken(col, 0.95 + n * 0.1))
    }
  }
  hd.rect(0, floorY, w, floorY + Math.max(2, ch * 0.14), hdDarken(ground, 0.7))
  // Ground mist drifting at the base of the trunks.
  for (let y = Math.floor(floorY - ch * 1.2); y < Math.floor(floorY + ch * 1.4); y++) {
    const a = (1 - Math.abs(y - floorY) / (ch * 1.3)) * (night ? 0.25 : 0.22)
    for (let x = 0; x < w; x++) tint(x, y, mist, Math.max(0, a) * (0.7 + 0.3 * Math.sin(x * 0.01 + theta)))
  }
  // Fallen leaves and root tangles.
  for (let i = 0; i < 18; i++) {
    const lx = hash(i + 11) * w,
      ly = floorY + ch * (0.5 + hash(i + 33) * 3)
    leafShape(
      lx,
      ly,
      unit * 1.4,
      unit * 0.5,
      hash(i) * 6.28,
      hdDarken(hdMix(ground, trunk, 0.6), 0.9),
      hdMix(trunk, ground, 0.4),
      false,
    )
  }
  // Ferns: arching fronds of paired leaflets.
  const frond = (bx: number, by: number, dir: number, len: number, shade: number) => {
    const steps = 9
    for (let i = 1; i <= steps; i++) {
      const u = i / steps
      const fx = bx + dir * len * u * 1.0
      const fy = by - Math.sin(u * Math.PI * 0.8) * len * 0.55
      const ang = Math.atan2(-Math.cos(u * Math.PI * 0.8) * 0.55, dir)
      const size = unit * 1.6 * (1 - u * 0.6)
      for (const side of [-1, 1]) {
        leafShape(
          fx,
          fy,
          size,
          size * 0.34,
          ang + side * 1.1,
          hdDarken(fern, shade * 0.8),
          hdDarken(fern, shade * 1.15),
          false,
        )
      }
    }
  }
  const fernAmb = night ? 0.5 : 1
  for (let i = 0; i < 9; i++) {
    const bx = X(2 + i * 8.6 + hash(i) * 2)
    const by = floorY + ch * (0.9 + (i % 3) * 0.6)
    for (const dir of [-1, 1]) frond(bx, by, dir, unit * (7 + (i % 3) * 2), fernAmb * (0.8 + (i % 2) * 0.2))
  }
  // Big foreground leaves at the frame corners.
  const big = night ? hdDarken(leafDark, 0.9) : hdDarken(leaf, 0.85)
  for (const [bx, by, a, s] of [
    [X(-1), h - ch * 0.4, -0.9, 1],
    [X(2), h + ch * 0.2, -1.15, 0.8],
    [X(JUNGLE_COLUMNS + 1), h - ch * 0.4, Math.PI + 0.9, 1],
    [X(JUNGLE_COLUMNS - 3), h + ch * 0.2, Math.PI + 1.15, 0.8],
  ] as const) {
    leafShape(
      bx + Math.cos(a) * unit * 9 * s,
      by + Math.sin(a) * unit * 9 * s,
      unit * 11 * s,
      unit * 3.4 * s,
      a,
      big,
      hdMix(big, leafLight, night ? 0.15 : 0.35),
    )
  }
  // Flowers and, at night, glowing mushrooms.
  for (const bloom of [6, 30, 54]) {
    const bx = X(bloom + 0.5),
      by = Y(JUNGLE_GROUND_TOP + 1.7)
    hd.rect(bx - 0.5, by, bx + 1, by + ch * 0.6, hdDarken(fern, 0.7))
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2 + 0.3
      hd.blob(
        bx + Math.cos(a) * unit * 0.8,
        by + Math.sin(a) * unit * 0.6,
        unit * 0.6,
        unit * 0.5,
        hdDarken(flower, night ? 0.7 : 1),
      )
    }
    hd.disk(bx, by, Math.max(1.4, unit * 0.45), night ? hdHex("#d8c8ff") : hdHex("#ffe88a"))
  }
  if (night) {
    const shroom = hdHex("#7affd0")
    for (const [sx, sy, sz] of [
      [12, 21.5, 1],
      [21, 22.3, 0.7],
      [43, 21.6, 1.15],
      [62, 22.2, 0.8],
      [47, 22.7, 0.6],
    ] as const) {
      const bx = X(sx),
        by = Y(sy)
      const pulse = 0.75 + 0.25 * Math.sin(theta + sx)
      glow(bx, by, unit * 6 * sz, shroom, 0.5 * pulse)
      hd.rect(
        bx - unit * 0.25 * sz,
        by,
        bx + unit * 0.25 * sz,
        by + unit * 1.0 * sz,
        hdMix(shroom, hdHex("#bfffe8"), 0.5),
      )
      hd.blob(bx, by, unit * 1.2 * sz, unit * 0.75 * sz, hdMix(shroom, hdHex("#2a8a78"), 0.35))
      hd.disk(bx - unit * 0.4 * sz, by - unit * 0.1, Math.max(1, unit * 0.18), hdHex("#e8fff6"))
    }
  }
  return hd.pixels
}
