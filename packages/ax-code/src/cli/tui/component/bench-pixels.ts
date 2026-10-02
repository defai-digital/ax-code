import {
  BENCH_COLUMNS,
  BENCH_ROWS,
  BENCH_COLORS,
  BENCH_SHELLS,
  benchCanopy,
  benchCenterX,
  benchClouds,
  benchFaintStarBright,
  benchFaintStarRow,
  benchHorizon,
  benchSkyRgb,
  benchStarGlyph,
  benchStarRow,
  benchSunX,
  benchSunY,
  benchTitle,
  benchTrunk,
  type BenchStyle,
} from "./bench-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import { blitGlyphText } from "./text-scene-glyphs"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}

/**
 * Freeform HD renderer. A glowing sky, a sun or moon that sinks into the
 * sea, glittering surf, a curved palm with drooping leaflets, a driftwood
 * bench on the sand, and the title, all placed from the shared scene model so
 * the HD frame and the text fallback show the same scene for the same
 * millisecond. Pure and deterministic: everything derives from `elapsedMs`.
 * Unlike the cycling scenes, the sunset descent saturates and the surf keeps
 * moving.
 */
export function renderBenchPixels(width: number, height: number, style: BenchStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, BENCH_COLUMNS, BENCH_ROWS)
  const { w, h, cw, ch } = hd
  if (w === 0 || h === 0) return hd.pixels
  const sunset = style === "sunset-serenade"
  const c = BENCH_COLORS[style]
  const t = Math.max(0, elapsedMs) / 1000
  const light = hdHex(c.light)
  const horizon = benchHorizon(BENCH_ROWS)
  const seaTop = hd.Y(horizon - 2.4)
  const shoreTop = hd.Y(horizon + 1.6)
  const sandTop = hd.Y(horizon + 2.0)
  const sunX = hd.X(benchSunX(BENCH_COLUMNS) + 3.5)
  const sunY = hd.Y(benchSunY(style, elapsedMs, horizon) + 2.5)
  const sunR = Math.max(2, Math.min(cw * 2.6, ch * 1.4))

  const blend = (i: number, color: RGB, alpha: number) => {
    if (alpha <= 0) return
    const a = alpha > 1 ? 1 : alpha
    hd.pixels[i] = Math.round(hd.pixels[i]! + (color[0] - hd.pixels[i]!) * a)
    hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! + (color[1] - hd.pixels[i + 1]!) * a)
    hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! + (color[2] - hd.pixels[i + 2]!) * a)
  }
  const softBlob = (cx: number, cy: number, rx: number, ry: number, color: RGB, alpha: number, pow = 1) => {
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, Math.ceil(cx + rx)); x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d < 1) blend((y * w + x) * 3, color, alpha * Math.pow(1 - smooth(0, 1, d), pow))
      }
    }
  }
  /** Thick pixel-space segment with a per-step color. */
  const line = (ax: number, ay: number, bx: number, by: number, r0: number, r1: number, color: (k: number) => RGB) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)))
    for (let i = 0; i <= steps; i++) {
      const k = i / steps
      hd.disk(ax + (bx - ax) * k, ay + (by - ay) * k, Math.max(0.6, r0 + (r1 - r0) * k), color(k))
    }
  }

  // Sky gradient with a bloom that pools at the horizon below the sun or moon.
  hd.sky((v) => benchSkyRgb(style, v))
  const bloom: RGB = sunset ? [255, 150, 86] : [110, 140, 210]
  for (let y = 0; y < Math.min(h, Math.ceil(seaTop)); y++) {
    const lowness = smooth(0.1, 1, y / (seaTop || 1))
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const d = Math.hypot((x + 0.5 - sunX) / (w * 0.55), (y + 0.5 - sunY) / (h * 0.5))
      blend(i, bloom, (sunset ? 0.62 : 0.2) * Math.exp(-d * d * 3.2) * (sunset ? 0.35 + lowness * 0.65 : 1))
      if (sunset) blend(i, [255, 190, 120], lowness * lowness * 0.25)
    }
  }

  // Night: a faint Milky Way, glowing stars, and dust.
  if (!sunset) {
    for (let y = 0; y < Math.min(h, Math.ceil(seaTop)); y++) {
      for (let x = 0; x < w; x++) {
        const d = ((x + 0.5) / cw) * 0.45 - ((y + 0.5) / ch) * 1.0 + 6
        const band = Math.exp(-(d * d) / 14) * (0.55 + 0.45 * Math.sin(x * 0.07 + y * 0.11))
        blend((y * w + x) * 3, [120, 140, 200], band * 0.12)
      }
    }
    for (let i = 0; i < 90; i++) {
      const px = Math.floor((((i * 61.7 + 11) % 1000) / 1000) * w)
      const py = Math.floor((((i * 37.3 + 5) % 1000) / 1000) * seaTop * 0.85)
      if ((px - sunX) ** 2 + (py - sunY) ** 2 < (sunR * 3) ** 2) continue
      blend((py * w + px) * 3, light, 0.25 + 0.3 * ((i * 7) % 3))
    }
    const starR = Math.max(1, Math.round(Math.min(cw, ch) * 0.2))
    for (let x = 3; x < BENCH_COLUMNS; x += 9) {
      const cx = hd.X(x + 0.5)
      const cy = hd.Y(benchStarRow(x, horizon) + 0.5)
      if (benchStarGlyph(elapsedMs, x) === "*") {
        softBlob(cx, cy, starR * 5, starR * 5, light, 0.35, 2)
        hd.disk(cx, cy, starR, light)
        hd.rect(cx - starR * 3, cy - 0.5, cx + starR * 3, cy + 0.5, hdMix(light, hdHex(c.skyBottom), 0.4))
        hd.rect(cx - 0.5, cy - starR * 3, cx + 0.5, cy + starR * 3, hdMix(light, hdHex(c.skyBottom), 0.4))
      } else hd.set(Math.round(cx), Math.round(cy), hdMix(light, hdHex(c.skyBottom), 0.35))
    }
    const faintR = Math.max(1, Math.round(Math.min(cw, ch) * 0.12))
    for (let x = 7; x < BENCH_COLUMNS; x += 9) {
      if (!benchFaintStarBright(elapsedMs, x)) continue
      hd.disk(hd.X(x + 0.5), hd.Y(benchFaintStarRow(x, horizon) + 0.5), faintR, hdMix(light, hdHex(c.sky), 0.45))
    }
  }

  // Celestial body: layered glow, then the disk with craters or a bright rim.
  softBlob(sunX, sunY, sunR * 7, sunR * 7, sunset ? [255, 170, 100] : [150, 175, 235], sunset ? 0.5 : 0.28, 1.6)
  softBlob(sunX, sunY, sunR * 2.2, sunR * 2.2, light, sunset ? 0.45 : 0.4, 1.2)
  hd.disk(sunX, sunY, sunR, sunset ? hdMix(light, [255, 120, 70], 0.18) : light)
  if (sunset) hd.disk(sunX - sunR * 0.15, sunY - sunR * 0.2, sunR * 0.72, hdMix(light, [255, 245, 200], 0.55))
  else {
    const crater = hdMix(light, [150, 165, 200], 0.4)
    hd.disk(sunX - sunR * 0.3, sunY - sunR * 0.2, sunR * 0.22, crater)
    hd.disk(sunX + sunR * 0.3, sunY + sunR * 0.28, sunR * 0.16, crater)
    hd.disk(sunX + sunR * 0.1, sunY - sunR * 0.5, sunR * 0.12, crater)
  }

  // Sunset clouds: soft banks lit warm underneath.
  if (sunset) {
    const cloud = hdHex(c.cloud)
    for (const bank of benchClouds(style, elapsedMs, BENCH_COLUMNS)) {
      for (let i = 0; i <= bank.len + 1; i++) {
        const cx = hd.X(bank.x + i + 0.5)
        const cy = hd.Y(bank.y + 1.2 + Math.sin(i * 1.7) * 0.15)
        softBlob(cx, cy, ch * 1.5, ch * 0.75, hdMix(cloud, [120, 60, 100], 0.4), 0.85, 0.7)
        softBlob(cx, cy + ch * 0.25, ch * 1.3, ch * 0.4, [255, 170, 120], 0.5, 0.8)
        if (i % 2 === 1) softBlob(cx, cy - ch * 0.45, ch * 1.1, ch * 0.7, hdMix(cloud, [255, 220, 200], 0.4), 0.8, 0.7)
      }
    }
  }

  // Distant headland resting on the horizon.
  const land = hdMix(hdHex(c.skyBottom), sunset ? [60, 24, 50] : [10, 18, 40], 0.6)
  for (let x = Math.floor(w * 0.66); x < w; x++) {
    const u = (x - w * 0.66) / (w * 0.34)
    const top = seaTop - ch * (0.9 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.85) + 0.15 * Math.sin(x * 0.05))
    hd.rect(x, top, x + 1, seaTop + 1, land)
  }

  // Sea: perspective gradient, rolling crests, and a glittering path.
  const seaDeep = hdMix(hdHex(c.wave), sunset ? [60, 30, 70] : [8, 20, 50], 0.78)
  const seaFar = hdMix(seaDeep, sunset ? [255, 150, 110] : [60, 90, 150], sunset ? 0.45 : 0.3)
  for (let y = Math.floor(seaTop); y < Math.min(h, Math.ceil(shoreTop)); y++) {
    const u = (y - seaTop) / (shoreTop - seaTop || 1)
    const base = hdMix(seaFar, hdMix(seaDeep, hdHex(c.wave), 0.25), Math.pow(u, 0.7))
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      const crest = Math.sin(sx * (0.55 + u * 0.4) + t * (1.2 + u) + u * 22) * 0.5 + 0.5
      const tone = hdMix(base, hdHex(c.wave), (crest > 0.86 ? 0.28 : 0) * (0.4 + u))
      hd.set(x, y, tone)
    }
  }
  // Sun or moon glitter, wider toward the viewer and shimmering with time.
  for (let y = Math.floor(seaTop); y < Math.min(h, Math.ceil(shoreTop)); y++) {
    const u = (y - seaTop) / (shoreTop - seaTop || 1)
    const spread = cw * (2.2 + u * 5.5)
    const sky = sunset ? 1 : 0.7
    for (let x = Math.max(0, Math.floor(sunX - spread)); x < Math.min(w, Math.ceil(sunX + spread)); x++) {
      const d = Math.abs(x + 0.5 - sunX) / spread
      const noise = Math.sin(x * 0.9 + y * 1.7 + t * 3.1) * Math.sin(x * 0.31 - y * 0.6 - t * 1.7)
      const on = noise > 0.2 + d * 0.9 + (1 - u) * 0.1
      if (!on) continue
      blend((y * w + x) * 3, light, (0.85 - d * 0.5) * sky * (0.45 + 0.55 * (1 - u * 0.4)))
    }
  }
  // Horizon line catch-light.
  hd.rect(0, seaTop, w, seaTop + 1.5, hdMix(seaFar, light, sunset ? 0.35 : 0.18))
  if (sunset) {
    // The sun sinks behind the horizon line.
    hd.rect(0, seaTop - 0.5, w, seaTop + 1, hdMix(seaFar, [255, 190, 120], 0.35))
  }

  // Foam and surf: lapping wavelets that advance and retreat.
  const foam = hdHex(c.foam)
  const sandBase = sunset ? hdHex(c.sand) : hdMix(hdHex(c.sand), [70, 90, 140], 0.52)
  const wet = sunset ? hdHex(c.sandWet) : hdMix(hdHex(c.sandWet), [40, 55, 95], 0.55)
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    const lap = Math.sin(t * 1.6 + sx * 0.5) * 0.35 + Math.sin(sx * 1.3 - t * 0.9) * 0.12
    const edge = shoreTop + ch * (0.15 + lap)
    for (let y = Math.floor(shoreTop - ch * 0.5); y < Math.min(h, Math.ceil(sandTop + ch * 0.3)); y++) {
      if (y < edge - ch * 0.35) continue
      const d = (y - edge) / ch
      if (d < 0.18) hd.set(x, y, hdMix(foam, light, sunset ? 0.25 : 0.1))
      else if (d < 0.5) hd.set(x, y, hdMix(wet, foam, 0.35 * (1 - d)))
    }
  }
  for (let y = Math.floor(sandTop); y < h; y++) {
    const u = (y - sandTop) / (h - sandTop || 1)
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      const dune = Math.sin(sx * 0.6 + u * 3) * 0.04 + Math.sin(sx * 2.1 + y * 0.3) * 0.015
      const base = hdMix(wet, sandBase, smooth(0, 0.35, u + dune))
      hd.set(x, y, hdDarken(base, 1 - u * 0.22))
    }
  }
  // Glints on the wet sand line below the sun.
  for (let x = Math.max(0, Math.floor(sunX - cw * 8)); x < Math.min(w, Math.ceil(sunX + cw * 8)); x++) {
    const d = Math.abs(x - sunX) / (cw * 8)
    if (Math.sin(x * 0.6 + t * 2) > 0.2 + d) blend((Math.floor(sandTop) * w + x) * 3, light, 0.45 * (1 - d))
  }
  for (const shell of BENCH_SHELLS) {
    const cx = hd.X(shell.x + 0.5)
    const cy = hd.Y(horizon + 3.6)
    const r = Math.max(1.5, Math.min(cw, ch) * 0.3)
    hd.blob(cx, cy, r * 1.4, r, hdMix(shell.glyph === "o" ? foam : light, sandBase, 0.2))
    hd.rect(cx - r, cy + r * 0.6, cx + r, cy + r * 1.1, hdDarken(sandBase, 0.7))
  }

  // Driftwood bench seen from behind, facing the water.
  {
    const bx0 = hd.X(33)
    const bx1 = hd.X(43)
    const seatY = hd.Y(horizon + 2.55)
    const wood = sunset ? hdHex("#7b4a3a") : hdHex("#4a4f6e")
    const woodHi = hdMix(wood, light, 0.35)
    softBlob((bx0 + bx1) / 2, seatY + ch * 0.95, (bx1 - bx0) * 0.62, ch * 0.28, hdDarken(sandBase, 0.5), 0.6)
    for (const lx of [bx0 + cw * 0.5, bx1 - cw * 0.9])
      hd.rect(lx, seatY, lx + cw * 0.35, seatY + ch * 0.95, hdDarken(wood, 0.6))
    hd.rect(bx0, seatY - ch * 0.04, bx1, seatY + ch * 0.2, hdDarken(wood, 0.8))
    hd.rect(bx0, seatY - ch * 0.04, bx1, seatY + ch * 0.04, woodHi)
    for (let s = 0; s < 3; s++) {
      const y0 = seatY - ch * (0.75 - s * 0.24)
      hd.rect(bx0 - cw * 0.1, y0, bx1 + cw * 0.1, y0 + ch * 0.17, wood)
      hd.rect(bx0 - cw * 0.1, y0, bx1 + cw * 0.1, y0 + Math.max(1, ch * 0.03), woodHi)
    }
    for (const px of [bx0, bx1 - cw * 0.3]) hd.rect(px, seatY - ch * 0.8, px + cw * 0.3, seatY, hdDarken(wood, 0.68))
  }

  // Palm: curved ringed trunk, coconuts, and drooping fronds with leaflets.
  const trunkX = benchTrunk(BENCH_COLUMNS)
  const canopy = benchCanopy(horizon)
  const sway = Math.sin(t * 3) * Math.min(3, BENCH_COLUMNS / 20)
  const trunkBase = hdHex(c.trunk)
  const palmBase = hdHex(c.palm)
  const woodTone = sunset ? hdDarken(trunkBase, 0.6) : hdDarken(trunkBase, 0.62)
  const rim = sunset ? hdMix(light, [255, 180, 110], 0.4) : hdMix(light, [150, 175, 240], 0.3)
  const leaf = sunset ? hdDarken(palmBase, 0.45) : hdDarken(palmBase, 0.58)
  const leafDark = hdDarken(leaf, 0.7)
  const baseX = hd.X(trunkX - 2.2)
  const baseY = sandTop + ch * 0.2
  const crownX = hd.X(trunkX + 1 + sway * 0.55)
  const crownY = hd.Y(canopy + 2.2)
  const ctrlX = baseX - cw * 1.8
  const ctrlY = (baseY + crownY) / 2
  const trunkPoint = (k: number): [number, number] => [
    (1 - k) * (1 - k) * baseX + 2 * (1 - k) * k * ctrlX + k * k * crownX,
    (1 - k) * (1 - k) * baseY + 2 * (1 - k) * k * ctrlY + k * k * crownY,
  ]
  for (let i = 0; i <= 120; i++) {
    const k = i / 120
    const [px, py] = trunkPoint(k)
    const r = cw * (0.62 - 0.22 * k)
    const ring = Math.sin(i * 0.9) > 0.55
    hd.disk(px, py, r, ring ? hdDarken(woodTone, 0.8) : woodTone)
    hd.disk(px + r * 0.45, py, r * 0.45, hdMix(ring ? hdDarken(woodTone, 0.8) : woodTone, rim, 0.3))
  }
  const frond = (angle: number, length: number, droop: number, shade: RGB) => {
    length *= 1.45
    const dirX = Math.cos(angle)
    const dirY = -Math.sin(angle)
    const swayK = 1 + sway * 0.05
    const tipX = crownX + dirX * length * cw * swayK
    const tipY = crownY + dirY * length * ch * 0.5 + droop * ch
    const midX = crownX + dirX * length * cw * 0.5
    const midY = crownY + dirY * length * ch * 0.5 - ch * 0.7
    const at = (k: number): [number, number] => [
      (1 - k) * (1 - k) * crownX + 2 * (1 - k) * k * midX + k * k * tipX,
      (1 - k) * (1 - k) * crownY + 2 * (1 - k) * k * midY + k * k * tipY,
    ]
    for (let i = 0; i <= 28; i++) {
      const k = i / 28
      const [px, py] = at(k)
      hd.disk(px, py, Math.max(0.8, cw * 0.12 * (1 - k)), shade)
      if (i > 2 && i % 1 === 0) {
        const [nx, ny] = at(Math.min(1, k + 0.03))
        const tx = nx - px
        const ty = ny - py
        const len = Math.hypot(tx, ty) || 1
        const leafLen = ch * 1.15 * Math.sin(Math.min(1, k * 1.1 + 0.1) * Math.PI) ** 0.7 + 2
        for (const side of [-1, 1]) {
          const ox = (-ty / len) * side
          const oy = (tx / len) * side
          const ex = px + ox * leafLen * 0.55 + (tx / len) * leafLen * 0.55
          const ey = py + oy * leafLen * 0.55 + (ty / len) * leafLen * 0.55 + leafLen * 0.55
          const upper = side * (oy < 0 ? -1 : 1) > 0
          line(px, py, ex, ey, 0.9, 0.4, (q) => (upper ? hdMix(shade, rim, 0.22 * (1 - q)) : hdDarken(shade, 0.85)))
        }
      }
    }
  }
  const fronds: [number, number, number][] = [
    [Math.PI * 0.95, 4.6, 1.6],
    [Math.PI * 0.78, 4.3, 0.2],
    [Math.PI * 0.58, 3.6, -0.6],
    [Math.PI * 0.4, 3.9, -0.1],
    [Math.PI * 0.22, 4.4, 1.0],
    [Math.PI * 0.03, 4.8, 2.0],
    [Math.PI * 1.1, 3.6, 2.4],
    [-Math.PI * 0.1, 3.6, 2.4],
  ]
  fronds.forEach(([angle, length, droop], index) => frond(angle, length, droop, index % 2 === 0 ? leaf : leafDark))
  for (const dx of [-0.25, 0.35, 0.05])
    hd.disk(crownX + dx * cw * 1.6, crownY + ch * (0.35 + Math.abs(dx)), cw * 0.34, hdDarken(trunkBase, 0.55))
  hd.disk(crownX + cw * 0.15, crownY + ch * 0.25, cw * 0.18, hdMix(hdDarken(trunkBase, 0.7), rim, 0.3))

  const title = benchTitle(style)
  blitGlyphText(
    hd.pixels,
    w,
    h,
    Math.round(benchCenterX(title, BENCH_COLUMNS) * cw),
    Math.round((BENCH_ROWS - 1) * ch),
    Math.max(1, Math.round(cw)),
    Math.max(1, Math.round(ch)),
    title,
    light,
  )

  return hd.pixels
}
