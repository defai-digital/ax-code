import { artHash, artLine, blendPixel, glow, polyFill, softDisk, vignette } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  MEKONG_BOAT_X,
  MEKONG_COLORS,
  MEKONG_COLUMNS,
  MEKONG_DISTANT_X,
  MEKONG_GRASS,
  MEKONG_HUT_X,
  MEKONG_LILIES,
  MEKONG_PALMS,
  MEKONG_ROWS,
  MEKONG_SUN,
  MEKONG_TEMPLE_X,
  MEKONG_WATER_TOP,
  mekongBob,
  mekongEgrets,
  mekongMarket,
  mekongShimmer,
  mekongSkyRgb,
  type MekongStyle,
} from "./mekong-view-model"

/**
 * Freeform HD renderer. A glowing sun over layered haze, a tiered temple, a
 * stilt hut, curved palms, a misty tree line, rippled river with a sun
 * glitter path, a rowing sampan, the drifting floating-market boat, lotus
 * pads, and flapping egrets come from the shared scene model. Pure and
 * deterministic: everything derives from `elapsedMs`.
 */
export function renderMekongPixels(width: number, height: number, style: MekongStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, MEKONG_COLUMNS, MEKONG_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const c = MEKONG_COLORS[style]
  const dawn = style === "mekong-dawn"
  const elapsed = Math.max(0, elapsedMs)
  const phase = ((elapsed % 2400) / 2400) * Math.PI * 2
  const u = Math.min(hd.cw, hd.ch / 2)
  const bob = mekongBob(elapsed)
  const shimmer = mekongShimmer(elapsed)
  const palm = hdHex(c.palm)
  const hut = hdHex(c.hut)
  const boat = hdHex(c.boat)
  const hat = hdHex(c.hat)
  const goods = hdHex(c.goods)
  const lily = hdHex(c.lily)
  const sun = hdHex(c.sun)
  const sunGlow = hdHex(c.sunGlow)
  const shimmerColor = hdHex(c.shimmer)
  const waterTop = hdHex(c.water)
  const waterDeep = hdHex(c.waterDeep)
  const waterY = hd.Y(MEKONG_WATER_TOP)
  const horizon = mekongSkyRgb(style, 1)
  const sx = hd.X(MEKONG_SUN.x)
  const sy = hd.Y(MEKONG_SUN.y + 0.5)
  const sunR = Math.max(4, u * 1.7)

  // Sky grades to the warm horizon at the waterline.
  hd.sky((t) => mekongSkyRgb(style, Math.min(1, (t * hd.h) / (waterY || 1))))
  glow(hd, sx, sy, sunR * 14, sunGlow, dawn ? 0.5 : 0.65)
  glow(hd, sx, sy, sunR * 5, hdMix(sun, [255, 255, 255], 0.3), 0.6)
  softDisk(hd, sx, sy, sunR, hdMix(sun, [255, 255, 255], 0.35))
  // Cloud streaks lit from below, drifting slowly and wrapping off-screen.
  for (let i = 0; i < 5; i++) {
    const span = MEKONG_COLUMNS + 30
    const cx = hd.X(((i * 21 + (phase / (Math.PI * 2)) * span) % span) - 15)
    const cy = hd.Y(1.5 + (i % 4) * 2.1)
    const lit = hdMix(sunGlow, [255, 255, 255], 0.35)
    for (let k = 0; k < 18; k++) {
      const ex = cx + k * hd.cw * 0.55
      const ey = cy + Math.sin(k * 0.6 + i) * hd.ch * 0.1
      softDisk(hd, ex, ey, hd.ch * 0.34, lit, 0.2)
      softDisk(hd, ex, ey + hd.ch * 0.18, hd.ch * 0.2, hdDarken(lit, 0.8), 0.14)
    }
  }

  // Far hills and a hazy tree line on the opposite bank.
  for (let layer = 0; layer < 2; layer++) {
    const base = hd.Y(MEKONG_WATER_TOP - 1.4 - layer * 0.7)
    const mist = layer === 0 ? 0.35 : 0.58
    const treeColor = hdMix(hdDarken(palm, layer === 0 ? 0.55 : 0.75), horizon, mist)
    for (let x = 0; x < hd.w; x++) {
      const px = x / hd.cw
      const bump =
        Math.sin(px * 0.31 + layer * 2) * hd.ch * 0.4 +
        Math.sin(px * 1.9 + layer) * hd.ch * 0.12 +
        artHash(Math.floor(px * 2), layer) * hd.ch * 0.25
      for (let y = Math.max(0, Math.floor(base - bump - hd.ch * 0.4)); y < waterY; y++) {
        hd.set(x, y, treeColor)
      }
    }
  }
  for (let y = Math.floor(waterY - hd.ch * 2); y < waterY; y++) {
    const k = ((y - (waterY - hd.ch * 2)) / (hd.ch * 2)) * 0.55
    for (let x = 0; x < hd.w; x++) blendPixel(hd, x, y, horizon, k)
  }

  // Riverbank strip.
  const bankTop = hd.Y(MEKONG_WATER_TOP - 0.7)
  for (let y = Math.floor(bankTop); y < waterY; y++) {
    for (let x = 0; x < hd.w; x++) {
      const v = (y - bankTop) / (waterY - bankTop || 1)
      hd.set(x, y, hdMix(hdDarken(palm, 0.6), hdDarken(hut, 0.7), v * 0.6 + artHash(x, y) * 0.1))
    }
  }

  // Temple: three stacked roofs with upswept eaves, gold spire, columned hall.
  {
    const tx = hd.X(MEKONG_TEMPLE_X + 2.5)
    const hallW = hd.X(4.6)
    const hallTop = hd.Y(11.1)
    const hallBottom = waterY - hd.ch * 0.3
    const lit = hdMix(hut, sunGlow, 0.18)
    polyFill(
      hd,
      [
        [tx - hallW / 2, hallTop],
        [tx + hallW / 2, hallTop],
        [tx + hallW / 2, hallBottom],
        [tx - hallW / 2, hallBottom],
      ],
      (x, y) => {
        const col = (x - (tx - hallW / 2)) / hd.cw
        const post = col % 1.15 < 0.22
        return post
          ? hdDarken(lit, 0.6)
          : hdMix(hdDarken(lit, 0.75), [20, 12, 8], ((y - hallTop) / (hallBottom - hallTop)) * 0.4)
      },
    )
    const tiers = [
      { w: 6.2, y: 10.5, h: 0.9 },
      { w: 4.8, y: 9.7, h: 0.8 },
      { w: 3.2, y: 9.0, h: 0.75 },
    ]
    for (const tier of tiers) {
      const half = hd.X(tier.w / 2)
      const top = hd.Y(tier.y)
      const bot = top + hd.Y(tier.h)
      polyFill(
        hd,
        [
          [tx, top - hd.ch * 0.2],
          [tx + half, bot],
          [tx + half + hd.cw * 0.5, bot + hd.ch * 0.1],
          [tx - half - hd.cw * 0.5, bot + hd.ch * 0.1],
          [tx - half, bot],
        ],
        (x, y) => {
          const side = (x - tx) * (dawn ? 1 : 1) > 0
          const k = (y - top) / (bot - top || 1)
          let col = hdMix(hdDarken(hut, 0.5), hdDarken(hut, 1.1), side ? 0.7 : 0.2)
          col = hdMix(col, [150, 60, 40], 0.25)
          if (k > 0.82) col = hdMix(col, [230, 190, 90], 0.55)
          return col
        },
      )
    }
    artLine(hd, tx, hd.Y(8.1), tx, hd.Y(9.0), 1.1, 0.7, [236, 196, 90])
    softDisk(hd, tx, hd.Y(8.1), 1.4, [250, 214, 120])
  }

  // Stilt hut with a thatched roof.
  {
    const hx = hd.X(MEKONG_HUT_X + 2)
    const roofTop = hd.Y(10.2)
    const floor = hd.Y(12.3)
    polyFill(
      hd,
      [
        [hx, roofTop],
        [hx + hd.cw * 2.8, floor - hd.ch * 0.5],
        [hx - hd.cw * 2.8, floor - hd.ch * 0.5],
      ],
      (x, y) => hdDarken(hdMix(hut, [200, 160, 80], 0.2), 0.75 + artHash(x >> 1, y >> 1) * 0.3),
    )
    hd.rect(hx - hd.cw * 1.8, floor - hd.ch * 0.5, hx + hd.cw * 1.8, floor, hdDarken(hut, 0.7))
    if (!dawn) hd.rect(hx - hd.cw * 0.4, floor - hd.ch * 0.4, hx + hd.cw * 0.5, floor - hd.ch * 0.1, [255, 190, 90])
    for (const px of [-1.6, 1.6])
      hd.rect(hx + hd.cw * px - 1.5, floor, hx + hd.cw * px + 1.5, waterY + hd.ch * 0.3, hdDarken(hut, 0.55))
  }

  // Palms: curved trunks and long arching fronds that sway on the cycle.
  for (const trunkX of MEKONG_PALMS) {
    const bx = hd.X(trunkX + 1.5)
    const by = waterY + hd.ch * 0.1
    const lean = hd.X(trunkX < MEKONG_COLUMNS / 2 ? 1.6 : -1.6)
    const tx = bx + lean
    const ty = hd.Y(7.4)
    for (let i = 0; i <= 64; i++) {
      const t = i / 64
      softDisk(
        hd,
        bx + lean * t * t + Math.sin(t * Math.PI) * hd.cw * 0.5 * Math.sign(lean),
        by + (ty - by) * t,
        u * (0.2 - t * 0.07),
        hdMix(hdDarken(palm, 0.5), hut, 0.35),
      )
    }
    for (let f = 0; f < 9; f++) {
      const ang = -Math.PI * 0.95 + (f / 8) * Math.PI * 0.9
      const len = hd.X(3.1 + (f % 3) * 0.4)
      const sway = Math.sin(phase + trunkX + f * 0.7) * u * 0.16
      const mx = tx + Math.cos(ang) * len * 0.6
      const my = ty - Math.abs(Math.sin(ang)) * len * 0.5
      const ex = tx + Math.cos(ang) * len + sway
      const ey = ty + len * 0.34 - Math.abs(Math.sin(ang)) * len * 0.15
      const col = hdMix(hdDarken(palm, 0.7), hdMix(palm, sunGlow, dawn ? 0.15 : 0.25), f / 8)
      artLine(hd, tx, ty, mx, my, u * 0.15, u * 0.13, col)
      artLine(hd, mx, my, ex, ey, u * 0.13, u * 0.03, col)
    }
    softDisk(hd, tx, ty + u * 0.1, u * 0.28, hdDarken(hut, 0.6))
  }
  // Grass tufts: three-blade fans on the bank.
  for (const tuft of MEKONG_GRASS) {
    const gx = hd.X(tuft + 0.5)
    for (let b = -1; b <= 1; b++) {
      artLine(
        hd,
        gx + b * u * 0.12,
        waterY,
        gx + b * u * 0.5 + Math.sin(phase + tuft) * u * 0.1,
        waterY - u * 1.4,
        u * 0.1,
        u * 0.04,
        hdHex(c.grass),
      )
    }
  }

  // River: gradient, sky reflection near the far bank, ripple bands.
  for (let y = Math.max(0, Math.floor(waterY)); y < hd.h; y++) {
    const v = (y - waterY) / (hd.h - waterY || 1)
    const base = hdMix(hdMix(waterTop, horizon, (1 - v) * 0.45), waterDeep, v * 0.85)
    for (let x = 0; x < hd.w; x++) {
      const px = x / hd.cw
      const wave = Math.sin(px * (1.1 + v * 0.8) + y * 0.45 + phase) + Math.sin(px * 0.37 - phase + v * 6) * 0.6
      let col = hdDarken(base, 1 + wave * 0.035)
      if (wave > 1.25) col = hdMix(col, shimmerColor, 0.14)
      hd.set(x, y, col)
    }
  }
  // Mirror the temple, hut, and palms faintly in the near water.
  for (let y = Math.floor(waterY); y < Math.min(hd.h, waterY + hd.ch * 3.2); y++) {
    const v = (y - waterY) / (hd.ch * 3.2)
    const src = Math.floor(waterY - (y - waterY) * 0.9 - 1)
    if (src < 0) continue
    for (let x = 0; x < hd.w; x++) {
      const dx = Math.round(Math.sin(y * 0.8 + phase + x * 0.05) * 2)
      const i = (src * hd.w + Math.max(0, Math.min(hd.w - 1, x + dx))) * 3
      const color: RGB = [hd.pixels[i]!, hd.pixels[i + 1]!, hd.pixels[i + 2]!]
      blendPixel(hd, x, y, color, 0.28 * (1 - v))
    }
  }
  // Sun glitter path on the river.
  const path = hd.X(MEKONG_SUN.x)
  const glitter = hdMix(shimmerColor, sun, 0.4)
  for (let y = Math.floor(waterY); y < hd.h; y++) {
    const v = (y - waterY) / (hd.h - waterY || 1)
    const half = hd.X(1.4 + v * 3.2)
    const wob = Math.sin(y * 0.4 + phase) * hd.cw * 0.5
    for (let x = Math.max(0, Math.floor(path - half)); x < Math.min(hd.w, Math.ceil(path + half)); x++) {
      const r = artHash(x + shimmer * 17, Math.floor(y / 2))
      const edge = 1 - Math.abs(x - path - wob) / half
      if (edge > 0 && r < edge * (0.55 - v * 0.2)) blendPixel(hd, x, y, glitter, 0.45 + edge * 0.5)
    }
  }
  glow(hd, path, waterY + hd.ch * 1.5, hd.cw * 6, sunGlow, 0.22)

  // Lotus pads with a blossom.
  for (const [padX, padY] of MEKONG_LILIES) {
    const px = hd.X(padX! + 0.5)
    const py = hd.Y(padY! + 0.5)
    softDisk(hd, px, py + u * 0.1, u * 0.7, hdDarken(lily, 0.7), 0.5)
    softDisk(hd, px, py, u * 0.62, lily)
    softDisk(hd, px - u * 0.15, py - u * 0.1, u * 0.3, hdMix(lily, [200, 255, 170], 0.25), 0.6)
    if (padX! % 2 === 0) softDisk(hd, px + u * 0.2, py - u * 0.25, u * 0.2, [255, 170, 200])
  }

  const ring = (cx: number, cy: number, rx: number, strength: number) => {
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2
      blendPixel(
        hd,
        Math.round(cx + Math.cos(ang) * rx),
        Math.round(cy + Math.sin(ang) * rx * 0.22),
        shimmerColor,
        strength,
      )
    }
  }
  const hull = (x: number, y: number, len: number, deep: number, color: RGB) => {
    const pts: [number, number][] = [
      [x - len, y - deep * 0.9],
      [x - len * 0.6, y + deep * 0.1],
      [x + len * 0.6, y + deep * 0.1],
      [x + len, y - deep * 0.9],
      [x + len * 0.55, y + deep * 0.5],
      [x - len * 0.55, y + deep * 0.5],
    ]
    // Soft reflection under the hull.
    for (let k = 0; k < 5; k++)
      artLine(
        hd,
        x - len * (0.8 - k * 0.12),
        y + deep * (0.9 + k * 0.45),
        x + len * (0.8 - k * 0.12),
        y + deep * (0.9 + k * 0.45),
        0.8,
        0.8,
        hdDarken(waterDeep, 0.55),
        0.3 - k * 0.05,
      )
    polyFill(hd, pts, (px, py) =>
      hdMix(hdDarken(color, 0.7), color, Math.max(0, Math.min(1, 1 - (py - (y - deep)) / (deep * 1.6)))),
    )
    artLine(hd, x - len, y - deep * 0.9, x + len, y - deep * 0.9, 1, 1, hdMix(color, hat, 0.3))
  }
  const person = (x: number, y: number, torso: RGB) => {
    artLine(hd, x, y, x + u * 0.1, y - u * 1.3, u * 0.28, u * 0.22, torso)
    softDisk(hd, x + u * 0.1, y - u * 1.6, u * 0.28, hdDarken(hut, 0.9))
    // Conical hat.
    polyFill(
      hd,
      [
        [x + u * 0.1, y - u * 2.5],
        [x + u * 0.9, y - u * 1.65],
        [x - u * 0.7, y - u * 1.65],
      ],
      (px) => hdMix(hat, [255, 240, 170], px > x ? 0.05 : 0.25),
    )
  }

  // Distant skiff holding still upstream.
  {
    const dx = hd.X(MEKONG_DISTANT_X + 2.5)
    hull(dx, waterY + hd.ch * 0.25, hd.cw * 2.4, hd.ch * 0.45, hdMix(boat, horizon, 0.35))
    artLine(hd, dx, waterY - hd.ch * 1.1, dx, waterY, 1, 1, boat)
  }

  // Sampan with a rowing figure; the oar dips on the bob.
  {
    const bx = hd.X(MEKONG_BOAT_X + 0.5)
    const by = hd.Y(MEKONG_WATER_TOP + 2.3 + bob * 0.25)
    ring(bx, by + hd.ch * 0.35, hd.cw * (4.6 + Math.sin(phase) * 0.4), 0.3)
    ring(bx, by + hd.ch * 0.35, hd.cw * (6.2 + Math.sin(phase) * 0.5), 0.15)
    hull(bx, by, hd.cw * 4.3, hd.ch * 0.8, boat)
    person(bx + hd.cw * 0.5, by - hd.ch * 0.2, hdDarken(hdMix(hat, boat, 0.4), 0.9))
    const oarSwing = Math.sin(phase) * u * 0.7
    artLine(
      hd,
      bx + hd.cw * 0.9,
      by - hd.ch * 0.5,
      bx + hd.cw * 2.8 + oarSwing,
      by + hd.ch * 0.9,
      u * 0.1,
      u * 0.08,
      hdDarken(boat, 1.1),
    )
  }

  // Floating market boat drifts down from the right with a hat vendor and goods.
  {
    const mx = hd.X(mekongMarket(elapsed) + 3)
    const my = hd.Y(15.6 + bob * 0.1)
    ring(mx, my + hd.ch * 0.35, hd.cw * 4.6, 0.25)
    hull(mx, my, hd.cw * 3.6, hd.ch * 0.7, boat)
    // Mound of fruit and a woven canopy.
    for (let k = 0; k < 14; k++) {
      const gx = mx - hd.cw * 1.9 + (k % 7) * hd.cw * 0.42
      const gy = my - hd.ch * 0.65 - Math.floor(k / 7) * hd.ch * 0.2 - Math.sin(((k % 7) / 7) * Math.PI) * hd.ch * 0.22
      softDisk(hd, gx, gy, u * 0.3, k % 3 === 0 ? [236, 190, 70] : goods)
    }
    person(mx + hd.cw * 2, my - hd.ch * 0.3, hdHex(c.egret))
  }

  // Egrets cross the sky with a steady wing beat.
  for (const [i, bird] of mekongEgrets(elapsed).entries()) {
    const bx = hd.X(bird.x + 0.5)
    const by = hd.Y(bird.y + 0.5)
    const flap = Math.sin(elapsed / 140 + i * 2) * u * 0.7
    const egret = hdHex(c.egret)
    softDisk(hd, bx, by, u * 0.32, egret)
    artLine(hd, bx - u * 0.1, by, bx - u * 1.2, by - u * 0.4 - flap, u * 0.14, u * 0.06, egret)
    artLine(hd, bx + u * 0.1, by, bx + u * 1.2, by - u * 0.4 + flap, u * 0.14, u * 0.06, egret)
    artLine(hd, bx, by, bx + (i === 0 ? u * 0.7 : -u * 0.7), by + u * 0.1, u * 0.08, u * 0.05, egret)
  }
  vignette(hd, dawn ? 0.15 : 0.3)
  return hd.pixels
}
