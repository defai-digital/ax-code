import { blendPx, clamp01, fillPoly, glow, hash2, vrect } from "./atmos-paint"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  SAGRADA_BODY_TOP,
  SAGRADA_COLORS,
  SAGRADA_COLUMNS,
  SAGRADA_CROWD,
  SAGRADA_CRANE_X,
  SAGRADA_GROUND_TOP,
  SAGRADA_MOON,
  SAGRADA_ROSE,
  SAGRADA_ROWS,
  SAGRADA_SPIRE_BASE,
  SAGRADA_SPIRE_TOP,
  SAGRADA_SPIRES,
  SAGRADA_STARS,
  SAGRADA_TREES,
  sagradaDoves,
  sagradaHook,
  sagradaLightX,
  sagradaSkyRgb,
  type SagradaStyle,
} from "./sagrada-view-model"

/**
 * Freeform HD renderer. Four Gaudi-style bell towers with rounded tops are
 * shaded as cylinders (ribs, bands, lancet slots, mosaic finials). They stand
 * on a carved facade with arched portals and a rose window. Day is warm
 * limestone under a bright sky; night is floodlit with glowing glass. The
 * stained-light sweep, crane hook, and doves all derive from `elapsedMs`.
 */
export function renderSagradaPixels(width: number, height: number, style: SagradaStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, SAGRADA_COLUMNS, SAGRADA_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "sagrada-night"
  const c = SAGRADA_COLORS[style]
  const t = Math.max(0, elapsedMs)
  const S = Math.min(hd.ch, hd.cw * 2)
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, S * 0.5)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return sagradaSkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return sagradaSkyRgb(style, py / (hd.h - 1))
  }
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const rib = hdHex(c.rib)
  const glass = hdHex(c.glass)
  const glassWarm = hdHex(c.glassWarm)
  const rose = hdHex(c.rose)
  const roseLight = hdHex(c.roseLight)
  const crane = hdHex(c.crane)
  const tree = hdHex(c.tree)
  const light = hdHex(c.light)
  const ground = hdHex(c.ground)
  const crowd = hdHex(c.crowd)
  const orb = night ? SAGRADA_MOON : { x: 10, y: 1.6 }
  const baseLine = hd.Y(SAGRADA_GROUND_TOP)
  const horizon = skyAt(SAGRADA_GROUND_TOP)

  // Sky with moon or sun bloom, stars, and soft clouds.
  hd.sky((v) => sagradaSkyRgb(style, v))
  if (night) {
    hd.stars(SAGRADA_STARS, hdHex(c.sky), (i) => (Math.floor(t / 400) + i) % 3 === 0)
    for (let i = 0; i < 40; i++) {
      blendPx(
        hd,
        Math.floor(hash2(i, 2) * hd.w),
        Math.floor(hash2(i, 8) * hd.Y(11)),
        hdHex("#d8e0ff"),
        0.2 + 0.5 * hash2(i + Math.floor(t / 800), 4),
      )
    }
  }
  const ox = hd.X(orb.x)
  const oy = hd.Y(orb.y)
  glow(hd, ox, oy, coreR * 11, night ? hdHex("#8fa0e0") : hdHex("#ffe9b0"), night ? 0.4 : 0.6)
  hd.disk(ox, oy, coreR, night ? hdHex("#fff3c8") : hdHex("#fffbe8"))
  for (const [cxs, cys, w] of [
    [22, 5.2, 7],
    [50, 3.2, 9],
    [70, 7, 6],
  ] as const) {
    const drift = ((t / 900) % 3) - 1.5
    glow(
      hd,
      hd.X(cxs + drift),
      hd.Y(cys),
      hd.cw * w,
      night ? hdMix(horizon, hdHex("#3a4478"), 0.5) : hdHex("#ffffff"),
      night ? 0.18 : 0.4,
      0.14,
    )
  }
  // Warm horizon haze behind the church.
  glow(hd, hd.X(38), baseLine, hd.cw * 30, night ? hdHex("#c0824a") : hdHex("#ffe0b0"), night ? 0.22 : 0.3, 0.7)

  // Facade body: limestone volume, carved cornice, portals, and rose window.
  const bx0 = hd.X(18)
  const bx1 = hd.X(58)
  const by0 = hd.Y(SAGRADA_BODY_TOP)
  const lit = night ? hdMix(stone, hdHex("#e0b878"), 0.45) : hdMix(stone, light, 0.2)
  const shade = night ? hdDarken(stone, 0.8) : stoneDark
  const wallAt = (x: number, y: number): RGB => {
    const vx = (x - bx0) / (bx1 - bx0)
    const base = hdMix(lit, shade, clamp01(vx * 0.9))
    const v = (y - by0) / (baseLine - by0 || 1)
    const grain = (hash2(x >> 1, y >> 1) - 0.5) * 12
    const m = hdMix(base, hdDarken(base, 0.82), v * 0.7)
    return [m[0] + grain, m[1] + grain, m[2] + grain].map((n) =>
      Math.max(0, Math.min(255, Math.round(n))),
    ) as unknown as RGB
  }
  fillPoly(
    hd,
    [
      [bx0, by0],
      [bx1, by0],
      [bx1, baseLine],
      [bx0, baseLine],
    ],
    wallAt,
  )
  hd.rect(bx0 - 2, by0 - 2, bx1 + 2, by0 + Math.max(2, S * 0.18), hdMix(rib, lit, 0.35))
  hd.rect(bx0 - 2, by0 + S * 0.18, bx1 + 2, by0 + S * 0.3, hdDarken(shade, 0.8))
  // Central gable between the middle towers.
  const gx0 = hd.X(35.4)
  const gx1 = hd.X(40.6)
  const gTop = hd.Y(8.2)
  fillPoly(
    hd,
    [
      [gx0, by0],
      [gx1, by0],
      [gx1, gTop + S * 0.9],
      [(gx0 + gx1) / 2, gTop],
      [gx0, gTop + S * 0.9],
    ],
    (x, y) => hdMix(wallAt(x, y), lit, 0.1),
  )
  for (let k = 0; k < 5; k++) {
    const yy = gTop + S * (1.1 + k * 0.55)
    hd.rect(gx0, yy, gx1, yy + 1, hdDarken(stoneDark, 0.9))
  }
  // Rose window with spokes and a warm inner glow.
  const rx = hd.X(SAGRADA_ROSE.x)
  const ry = hd.Y(SAGRADA_ROSE.y - 0.6)
  const rr = Math.max(4, Math.min(hd.cw * 2.1, S * 1.05))
  hd.disk(rx, ry, rr * 1.18, hdDarken(stoneDark, 0.75))
  hd.disk(rx, ry, rr, rose)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    const px = rx + Math.cos(a) * rr * 0.62
    const py = ry + Math.sin(a) * rr * 0.62
    hd.disk(px, py, Math.max(1.4, rr * 0.2), k % 2 ? glassWarm : glass)
  }
  hd.disk(rx, ry, rr * 0.28, night ? light : roseLight)
  if (night) glow(hd, rx, ry, rr * 3, glassWarm, 0.45)
  // Arched portals.
  const arches: readonly (readonly [number, number, number])[] = [
    [38, 3.2, 4.8],
    [25.5, 2.2, 3.2],
    [50.5, 2.2, 3.2],
  ]
  for (const [ax, aw, ah] of arches) {
    const x0 = hd.X(ax - aw / 2)
    const x1 = hd.X(ax + aw / 2)
    const topY = baseLine - hd.ch * ah
    const midX = (x0 + x1) / 2
    const r = (x1 - x0) / 2
    for (let y = Math.floor(topY); y < baseLine; y++) {
      const dy = y + 0.5 - (topY + r)
      const half = dy < 0 ? Math.sqrt(Math.max(0, r * r - dy * dy)) : r
      const v = clamp01((y - topY) / (baseLine - topY || 1))
      const inner = night
        ? hdMix(glassWarm, hdHex("#2a1a10"), 0.35 + v * 0.3)
        : hdMix(hdHex("#2c241c"), hdHex("#4a3a2a"), v)
      for (let x = Math.floor(midX - half); x < Math.ceil(midX + half); x++) hd.set(x, y, inner)
      hd.set(Math.floor(midX - half) - 1, y, hdDarken(stoneDark, 0.8))
      hd.set(Math.ceil(midX + half), y, hdMix(lit, light, 0.3))
    }
    if (night) glow(hd, midX, baseLine - hd.ch * ah * 0.35, r * 3, glassWarm, 0.28, 1.2)
  }
  // Four towers: rounded tops, cylinder shading, ribs, lancet slots, mosaic finials.
  const topY = hd.Y(SAGRADA_SPIRE_TOP)
  const botY = hd.Y(SAGRADA_SPIRE_BASE)
  const Hs = botY - topY
  const Wmax = hd.cw * 3.1
  const mosaic: RGB[] = [hdHex("#e8553c"), hdHex("#f2c53d"), hdHex("#3fa7c4"), hdHex("#7bc65a")]
  SAGRADA_SPIRES.forEach((peak, ti) => {
    const px = hd.X(peak + 0.5)
    const halfAt = (f: number) => Wmax * (0.4 + 0.42 * f) * Math.min(1, Math.sqrt(f / 0.26) * 0.9 + 0.08)
    const towerLit = night ? hdMix(stone, hdHex("#f0c888"), 0.5) : hdMix(stone, light, 0.3)
    const towerDark = night ? hdDarken(stone, 0.6) : hdDarken(stoneDark, 1.05)
    for (let y = Math.floor(topY); y < Math.ceil(botY); y++) {
      const f = clamp01((y + 0.5 - topY) / (Hs || 1))
      const hw = halfAt(f)
      for (let x = Math.floor(px - hw); x < Math.ceil(px + hw); x++) {
        const u = (x + 0.5 - px) / (hw || 1)
        let col = hdMix(towerLit, towerDark, clamp01(((u + 1) / 2) * 1.05))
        if (night) col = hdMix(col, towerLit, clamp01(f * 0.35) * (1 - Math.abs(u)))
        const rb = Math.abs((((u + 1) * 2) % 1) - 0.5) < 0.045 && f > 0.1
        if (rb) col = hdMix(col, rib, 0.5)
        const band = (y - topY) % Math.max(5, S * 0.8) < 1.3 && f > 0.08
        if (band) col = hdDarken(col, 0.8)
        if (
          f > 0.3 &&
          (Math.abs(u - 0.25) < 0.1 || Math.abs(u + 0.35) < 0.08) &&
          (y - topY) % Math.max(8, S * 1.15) < Math.max(5, S * 0.8)
        ) {
          col = night
            ? hdMix(glassWarm, light, 0.3 + 0.3 * hash2(ti, y >> 3))
            : hdMix(hdDarken(stoneDark, 0.55), glass, 0.15)
        }
        hd.set(x, y, col)
      }
      hd.set(Math.floor(px - hw), y, hdDarken(stoneDark, 0.9))
    }
    // Finial: mosaic cluster and a small cross.
    const fy = topY - hd.ch * 0.3
    const fr = Math.max(1.5, hd.cw * 0.2)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.6
      hd.disk(px + Math.cos(a) * fr * 1.3, fy + Math.sin(a) * fr * 0.9, fr * 0.85, mosaic[(k + ti) % 4]!)
    }
    hd.disk(px, fy - fr * 0.3, fr * 1.05, night ? light : hdMix(glassWarm, light, 0.4))
    if (night) glow(hd, px, fy, fr * 7, light, 0.5)
    // Tower-base floodlight at night.
    if (night) glow(hd, px, botY - S * 0.5, hd.cw * 4.4, hdHex("#ffcf80"), 0.35, 2.4)
  })

  // Moving stained-light band across the facade, clipped to the body.
  const sweep = 18 + sagradaLightX(t)
  for (let y = Math.floor(by0); y < Math.ceil(baseLine); y++) {
    const cxl = hd.X(sweep - (y / hd.ch - SAGRADA_BODY_TOP) + 0.5)
    for (let dx = -hd.cw * 1.4; dx <= hd.cw * 1.4; dx++) {
      const x = Math.round(cxl + dx)
      if (x < bx0 || x >= bx1) continue
      const a = 0.4 * (1 - Math.abs(dx) / (hd.cw * 1.4))
      const tint = hash2(Math.floor(y / 6), 3) > 0.5 ? hdHex("#9be0ff") : hdHex("#ffb36a")
      blendPx(hd, x, y, hdMix(light, tint, 0.45), a)
    }
  }

  // Tower crane with lattice mast, jib, and swaying hook.
  const hook = sagradaHook(t)
  const lw = Math.max(1.1, hd.cw * 0.1)
  hd.stroke(SAGRADA_CRANE_X - 0.35, 4, SAGRADA_CRANE_X - 0.35, 12.2, lw, crane)
  hd.stroke(SAGRADA_CRANE_X + 0.35, 4, SAGRADA_CRANE_X + 0.35, 12.2, lw, crane)
  for (let y = 4.5; y < 12; y += 0.8)
    hd.stroke(SAGRADA_CRANE_X - 0.35, y, SAGRADA_CRANE_X + 0.35, y + 0.4, lw * 0.6, crane)
  hd.stroke(57, 4, 70, 4, lw * 1.1, crane)
  hd.stroke(57, 3.4, 70, 4, lw * 0.6, crane)
  hd.rect(hd.X(56.5), hd.Y(3.8), hd.X(58), hd.Y(4.8), hdDarken(crane, 0.8))
  const cableX = 68 + hook
  hd.stroke(cableX, 4.2, cableX, 9.1, Math.max(1.05, hd.cw * 0.08), crane)
  hd.rect(hd.X(cableX - 0.55), hd.Y(9.5), hd.X(cableX + 0.85), hd.Y(10.45), hdMix(crane, stone, 0.2))
  const blink = Math.floor(t / 600) % 2 === 0
  glow(hd, hd.X(SAGRADA_CRANE_X), hd.Y(3.6), dot * 3.5, hdHex("#ff4b3a"), blink ? 0.6 : 0.12)
  hd.disk(hd.X(SAGRADA_CRANE_X), hd.Y(3.6), dot * 0.5, blink ? hdHex("#ff4b3a") : crane)

  // Plaza first, so trees and visitors stand on it.
  vrect(hd, 0, baseLine, hd.w, hd.h, hdMix(ground, hdHex("#d0c090"), night ? 0 : 0.18), hdDarken(ground, 0.75))
  hd.rect(0, baseLine, hd.w, baseLine + Math.max(1, S * 0.08), hdDarken(ground, 0.6))
  if (night) glow(hd, hd.X(38), baseLine + S * 0.4, hd.cw * 18, hdHex("#ffcf80"), 0.22, 0.3)
  for (let i = 1; i < 9; i++) {
    const x = hd.X(38) + (i - 4.5) * hd.cw * 4.2
    for (let y = baseLine + S * 0.2; y < hd.h; y += 2) {
      const s = (y - baseLine) / (hd.h - baseLine || 1)
      blendPx(
        hd,
        Math.round(hd.X(38) + (x - hd.X(38)) * (0.4 + 1.6 * s)),
        Math.floor(y),
        night ? hdHex("#000000") : hdHex("#a09060"),
        0.12,
      )
    }
  }
  hd.rect(hd.X(28), hd.Y(SAGRADA_GROUND_TOP + 1.1), hd.X(33), hd.Y(SAGRADA_GROUND_TOP + 1.4), glass)
  hd.rect(hd.X(28), hd.Y(SAGRADA_GROUND_TOP + 1.4), hd.X(33), hd.Y(SAGRADA_GROUND_TOP + 1.65), hdDarken(glass, 0.6))
  hd.rect(hd.X(42), hd.Y(SAGRADA_GROUND_TOP + 1.1), hd.X(47), hd.Y(SAGRADA_GROUND_TOP + 1.4), glassWarm)
  hd.rect(hd.X(42), hd.Y(SAGRADA_GROUND_TOP + 1.4), hd.X(47), hd.Y(SAGRADA_GROUND_TOP + 1.65), hdDarken(glassWarm, 0.6))
  for (let x = 4; x < SAGRADA_COLUMNS; x += 8) {
    const fx = hd.X(x + 0.5)
    const fy = hd.Y(SAGRADA_GROUND_TOP + 3.5)
    hd.blob(fx, fy + S * 0.2, Math.max(2.4, hd.cw * 0.9), Math.max(2.4, hd.ch * 0.5), hdDarken(tree, 0.7))
    hd.blob(fx, fy, Math.max(2.4, hd.cw * 0.72), Math.max(2.4, hd.ch * 0.42), roseLight, hdDarken(roseLight, 0.72))
    hd.disk(fx + hd.cw * 0.9, fy - S * 0.1, Math.max(1.2, hd.cw * 0.2), hdMix(roseLight, light, 0.4))
    hd.disk(fx - hd.cw * 1.0, fy + S * 0.15, Math.max(1.2, hd.cw * 0.2), glassWarm)
  }

  for (const treeX of SAGRADA_TREES) {
    const tx = hd.X(treeX + 0.6)
    hd.rect(hd.X(treeX + 0.35), hd.Y(16.4), hd.X(treeX + 0.85), hd.Y(18.2), hdDarken(tree, 0.5))
    hd.blob(tx, hd.Y(15.6), hd.cw * 1.6, hd.ch * 1.4, hdDarken(tree, 0.78), hdDarken(tree, 0.6))
    hd.blob(tx - hd.cw * 0.3, hd.Y(15.4), hd.cw * 1.1, hd.ch * 1.1, tree, hdMix(tree, light, night ? 0.04 : 0.25))
  }
  for (const visitor of SAGRADA_CROWD) {
    const vx = hd.X(visitor + 0.35)
    hd.disk(vx, hd.Y(17.15), dot * 0.4, crowd)
    hd.rect(hd.X(visitor + 0.15), hd.Y(17.45), hd.X(visitor + 0.55), hd.Y(18.6), crowd)
    hd.rect(hd.X(visitor + 0.1), hd.Y(18.6), hd.X(visitor + 0.6), hd.Y(18.6) + S * 0.1, hdDarken(ground, 0.5))
  }

  const flap = Math.floor(t / 300) % 2 === 0
  for (const dove of sagradaDoves(t)) {
    const bx = hd.X(dove.x + 0.5)
    const by = hd.Y(dove.y + 0.5)
    const wing = flap ? 0.95 : 0.45
    const body = night ? hdMix(crowd, light, 0.55) : hdHex("#ffffff")
    hd.disk(bx, by, dot * 0.46, body)
    hd.disk(bx - dot * wing, by - dot * (flap ? 0.45 : 0.1), dot * 0.3, hdMix(body, horizon, 0.2))
    hd.disk(bx + dot * wing, by - dot * (flap ? 0.45 : 0.1), dot * 0.3, hdMix(body, horizon, 0.2))
    hd.disk(bx + dot * 0.5, by - dot * 0.15, dot * 0.22, body)
  }
  return hd.pixels
}
