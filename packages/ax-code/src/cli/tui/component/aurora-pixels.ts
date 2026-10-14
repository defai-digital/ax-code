import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  AURORA_COLUMNS,
  AURORA_COLORS,
  AURORA_CURTAIN_BOTTOM,
  AURORA_CURTAINS,
  AURORA_CURTAIN_WIDTH,
  AURORA_CYCLE_MS,
  AURORA_HORIZON,
  AURORA_LAKE_TOP,
  AURORA_MIST_ROW,
  AURORA_MOON,
  AURORA_PINES,
  AURORA_ROWS,
  AURORA_STARS,
  AURORA_TREELINE,
  auroraRipple,
  auroraShimmer,
  auroraSkyRgb,
  type AuroraStyle,
} from "./aurora-view-model"
import { clamp01 } from "./atmos-paint"

const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}

/**
 * Freeform HD aurora. Per-pixel curtains with vertical rays and a bright lower
 * edge hang over snowy ranges, a layered pine forest, and a frozen lake that
 * mirrors the sky. Pure and deterministic: everything derives from
 * `elapsedMs` and loops at 2400ms.
 */
export function renderAuroraPixels(width: number, height: number, style: AuroraStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, AURORA_COLUMNS, AURORA_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const dawn = style === "aurora-dawn"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % AURORA_CYCLE_MS) / AURORA_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = AURORA_COLORS[style]
  const curtain = hdHex(c.curtain)
  const edge = hdHex(c.curtainEdge)
  const snow = hdHex(c.snow)
  const pine = hdHex(c.pine)
  const trunk = hdHex(c.trunk)
  const horizonColor = hdHex(c.skyBottom)
  const bottom = dawn ? AURORA_CURTAIN_BOTTOM - 3 : AURORA_CURTAIN_BOTTOM + 1.5
  const strength = dawn ? 0.5 : 1
  const topTint: RGB = dawn ? [236, 168, 206] : [140, 96, 240]
  const midTint = hdMix(curtain, topTint, 0.25)
  const { cw, ch, w, h } = hd
  const laneTop = hd.Y(AURORA_LAKE_TOP)
  const horizonY = hd.Y(AURORA_HORIZON)

  const add = (i: number, color: RGB, k: number) => {
    hd.pixels[i] = Math.min(255, Math.round(hd.pixels[i]! + color[0] * k))
    hd.pixels[i + 1] = Math.min(255, Math.round(hd.pixels[i + 1]! + color[1] * k))
    hd.pixels[i + 2] = Math.min(255, Math.round(hd.pixels[i + 2]! + color[2] * k))
  }

  // Ridge silhouettes are needed up front: every row each ridge covers is
  // repainted solid later, so the sky above can stop at the far cap.
  const farRidge = (sx: number) =>
    AURORA_HORIZON - 0.2 - 2.4 * Math.pow(Math.abs(Math.sin(sx * 0.085 + 0.9)), 1.3) - 0.7 * Math.sin(sx * 0.31 + 1.7)
  const nearRidge = (sx: number) =>
    AURORA_HORIZON + 1.4 - 1.5 * Math.pow(Math.abs(Math.sin(sx * 0.13 + 2.4)), 1.2) - 0.45 * Math.sin(sx * 0.41)
  const skyTop = Math.ceil(laneTop)
  const colSx = new Float64Array(w)
  const colA13 = new Float64Array(w)
  const colA31 = new Float64Array(w)
  const veilTab = new Float64Array(w)
  const farCap = new Int32Array(w)
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    colSx[x] = sx
    colA13[x] = sx * 1.3
    colA31[x] = sx * 3.1
    veilTab[x] = 0.14 * (0.6 + 0.4 * Math.sin(sx * 0.21 + theta))
    farCap[x] = Math.max(0, Math.floor(hd.Y(farRidge(sx))))
  }
  // Curtain terms that depend only on the row, evaluated once per row.
  const baseRow = new Float64Array(skyTop * 3)
  const curtainRow = new Uint8Array(skyTop)
  const vrRow = new Float64Array(skyTop)
  const rim09Row = new Float64Array(skyTop)
  const tHiRow = new Float64Array(skyTop)
  const mixRow = new Float64Array(skyTop * 3)
  const cenT = new Float64Array(skyTop * 3)
  const swayT = new Float64Array(skyTop * 3)
  const sigT = new Float64Array(skyTop * 3)
  const sy25T = new Float64Array(skyTop * 3)
  const c3T = new Float64Array(skyTop * 3)
  const sy04T = new Float64Array(skyTop * 3)
  for (let y = 0; y < skyTop; y++) {
    const sy = (y + 0.5) / ch
    const base = auroraSkyRgb(style, clamp01(sy / AURORA_ROWS))
    baseRow[y * 3] = base[0]
    baseRow[y * 3 + 1] = base[1]
    baseRow[y * 3 + 2] = base[2]
    if (sy < 0 || sy > bottom + 1.2) continue
    curtainRow[y] = 1
    const v = sy / bottom
    const vertical = smooth(0, 0.3, v) * (1 - smooth(0.9, 1.1, v))
    const rim = Math.exp(-(((v - 0.88) / 0.1) ** 2)) * 0.55
    vrRow[y] = vertical * 0.8 + rim
    rim09Row[y] = rim * 0.9
    tHiRow[y] = rim * 0.9 + 0.15
    const body = hdMix(topTint, midTint, smooth(0, 0.5, v))
    const mixed = hdMix(body, curtain, smooth(0.4, 0.85, v))
    mixRow[y * 3] = mixed[0]
    mixRow[y * 3 + 1] = mixed[1]
    mixRow[y * 3 + 2] = mixed[2]
    for (let ci = 0; ci < 3; ci++) {
      const center = AURORA_CURTAINS[ci]!
      const j = y * 3 + ci
      cenT[j] = center
      swayT[j] = auroraRipple(elapsed, center + sy * 0.2) + Math.sin(sy * 0.5 + theta + center) * 0.8
      sigT[j] = AURORA_CURTAIN_WIDTH * (0.85 + 0.25 * Math.sin(sy * 0.3 + center))
      sy25T[j] = sy * 0.25
      c3T[j] = center * 3
      sy04T[j] = sy * 0.4
    }
  }
  // Sky and curtains, column-major, stopping at the far ridge cap.
  {
    const pixels = hd.pixels
    const stride = w * 3
    for (let x = 0; x < w; x++) {
      const sxv = colSx[x]!
      const sx13 = colA13[x]!
      const sx31 = colA31[x]!
      const veil = veilTab[x]!
      const capY = Math.min(skyTop, farCap[x]!)
      let i = x * 3
      for (let y = 0; y < capY; y++, i += stride) {
        const y3 = y * 3
        if (curtainRow[y] === 0) {
          pixels[i] = baseRow[y3]!
          pixels[i + 1] = baseRow[y3 + 1]!
          pixels[i + 2] = baseRow[y3 + 2]!
          continue
        }
        let env = 0
        for (let ci = 0; ci < 3; ci++) {
          const j = y3 + ci
          const d = (sxv - cenT[j]! - swayT[j]!) / sigT[j]!
          const rays =
            0.6 + 0.25 * Math.sin(sx13 + sy25T[j]! + c3T[j]! + theta) + 0.15 * Math.sin(sx31 - sy04T[j]! + cenT[j]!)
          env += Math.exp(-d * d) * rays
        }
        env += veil
        const a = clamp01(env * vrRow[y]! * strength)
        if (a <= 0.004) {
          pixels[i] = baseRow[y3]!
          pixels[i + 1] = baseRow[y3 + 1]!
          pixels[i + 2] = baseRow[y3 + 2]!
          continue
        }
        const t = a > 0.75 ? tHiRow[y]! : rim09Row[y]!
        const u1 = clamp01(t)
        const mr = mixRow[y3]!
        const mg = mixRow[y3 + 1]!
        const mb = mixRow[y3 + 2]!
        const cr = Math.round(mr + (edge[0] - mr) * u1)
        const cg = Math.round(mg + (edge[1] - mg) * u1)
        const cb = Math.round(mb + (edge[2] - mb) * u1)
        const u2 = clamp01(a * 0.9)
        const br = baseRow[y3]!
        const bg = baseRow[y3 + 1]!
        const bb = baseRow[y3 + 2]!
        pixels[i] = Math.round(br + (cr - br) * u2)
        pixels[i + 1] = Math.round(bg + (cg - bg) * u2)
        pixels[i + 2] = Math.round(bb + (cb - bb) * u2)
      }
    }
  }
  // Horizon glow: rose at dawn, teal-tinted starlight at night. Rows at or
  // below the far ridge cap are repainted later, so the glow stops there too.
  const glowColor = dawn ? hdMix(horizonColor, [255, 214, 170], 0.5) : hdMix(curtain, [30, 70, 110], 0.55)
  {
    const glowTop = Math.floor(hd.Y(AURORA_HORIZON - 6))
    const kRow = new Float64Array(Math.max(0, skyTop - glowTop))
    for (let y = glowTop; y < skyTop; y++) {
      kRow[y - glowTop] = smooth(AURORA_HORIZON - 6, AURORA_LAKE_TOP, (y + 0.5) / ch) * (dawn ? 0.55 : 0.28)
    }
    const pixels = hd.pixels
    for (let x = 0; x < w; x++) {
      const capY = Math.min(skyTop, farCap[x]!)
      for (let y = Math.max(0, glowTop); y < capY; y++) {
        const k = kRow[y - glowTop]!
        if (k <= 0) continue
        const a = Math.min(1, k)
        const i = (y * w + x) * 3
        pixels[i] = Math.round(pixels[i]! + (glowColor[0] - pixels[i]!) * a)
        pixels[i + 1] = Math.round(pixels[i + 1]! + (glowColor[1] - pixels[i + 1]!) * a)
        pixels[i + 2] = Math.round(pixels[i + 2]! + (glowColor[2] - pixels[i + 2]!) * a)
      }
    }
  }

  if (!dawn) {
    const moon = hdHex(c.moon)
    const mx = hd.X(AURORA_MOON.x)
    const my = hd.Y(AURORA_MOON.y)
    const r = Math.max(3, Math.min(cw, ch) * 0.9)
    const reach = r * 7
    // The disk interior (d < 1) paints with k = 0 and rows |dy| >= reach are
    // already outside the d <= 7 cutoff, so both are skipped without change.
    const moonFull = hdMix([0, 0, 0], moon, 1)
    const mfR = moonFull[0]!
    const mfG = moonFull[1]!
    const mfB = moonFull[2]!
    const pixels = hd.pixels
    for (let y = Math.max(0, Math.floor(my - reach)); y < Math.min(h, Math.ceil(my + reach)); y++) {
      const dy = y + 0.5 - my
      if (dy >= reach || dy <= -reach) continue
      let i = (y * w + Math.max(0, Math.floor(mx - reach))) * 3
      for (let x = Math.max(0, Math.floor(mx - reach)); x < Math.min(w, Math.ceil(mx + reach)); x++, i += 3) {
        const d = Math.hypot(x + 0.5 - mx, dy) / r
        if (d > 7 || d < 1) continue
        const k = 0.34 * Math.exp(-d * 0.8)
        pixels[i] = Math.min(255, Math.round(pixels[i]! + mfR * k))
        pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1]! + mfG * k))
        pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2]! + mfB * k))
      }
    }
    hd.disk(mx, my, r, moon)
    hd.disk(mx + r * 0.3, my - r * 0.15, r * 0.3, hdMix(moon, [150, 160, 190], 0.35))
    hd.disk(mx - r * 0.35, my + r * 0.25, r * 0.22, hdMix(moon, [150, 160, 190], 0.25))
    hd.stars(AURORA_STARS, hdHex(c.star), (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    // Extra deterministic dust stars above the curtains.
    for (let i = 0; i < 70; i++) {
      const sx = (i * 37.7 + 5) % AURORA_COLUMNS
      const sy = (((i * 53.3 + 2) % 100) / 100) * (AURORA_HORIZON - 1)
      const twinkle = (Math.floor(elapsed / 300) + i) % 4 === 0
      const px = Math.floor(hd.X(sx))
      const py = Math.floor(hd.Y(sy))
      const idx = (py * w + px) * 3
      if (px < 0 || px >= w || py < 0 || py >= h) continue
      add(idx, hdHex(c.star), twinkle ? 0.9 : 0.4)
    }
  }

  // Far snowy range lit by the sky glow.
  const farBase = dawn ? hdMix(hdHex("#7e6a94"), horizonColor, 0.25) : hdMix(hdHex("#1a3256"), curtain, 0.06)
  const farSnow = dawn ? hdMix(snow, hdHex("#f6c0b0"), 0.45) : hdMix(snow, hdHex("#6c8ec0"), 0.55)
  const nearBase = dawn ? hdHex("#4d4668") : hdHex("#0f2440")
  {
    // Per-column ridge geometry and colors, with the hdMix/hdSet calls inlined.
    const pixels = hd.pixels
    const Y3 = hd.Y(3)
    const fsFb = hdMix(farSnow, farBase, 0.45)
    const farPx = new Float64Array(w)
    const nearPx = new Float64Array(w)
    const nearCap = new Int32Array(w)
    const colA85 = new Float64Array(w)
    const colSx9 = new Float64Array(w)
    for (let x = 0; x < w; x++) {
      const sx = colSx[x]!
      farPx[x] = hd.Y(farRidge(sx))
      nearPx[x] = hd.Y(nearRidge(sx))
      nearCap[x] = Math.max(0, Math.floor(nearPx[x]!))
      colA85[x] = sx * 0.085 + 0.9
      colSx9[x] = sx * 0.9
    }
    const fbr = farBase[0]!
    const fbg = farBase[1]!
    const fbb = farBase[2]!
    const fsr = farSnow[0]!
    const fsg = farSnow[1]!
    const fsb = farSnow[2]!
    const ffr = fsFb[0]!
    const ffg = fsFb[1]!
    const ffb = fsFb[2]!
    const nbr = nearBase[0]!
    const nbg = nearBase[1]!
    const nbb = nearBase[2]!
    const gcr = glowColor[0]!
    const gcg = glowColor[1]!
    const gcb = glowColor[2]!
    const stride = w * 3
    for (let x = 0; x < w; x++) {
      const far = farPx[x]!
      const facetLit = Math.cos(colA85[x]!) * Math.sin(colA85[x]!) < 0
      const sx9 = colSx9[x]!
      let i = farCap[x]! * stride + x * 3
      for (let y = farCap[x]!; y < skyTop; y++, i += stride) {
        const depth = clamp01((y - far) / Y3)
        const t1 = clamp01(0.15 + depth * 0.35)
        let r = Math.round(fbr + (gcr - fbr) * t1)
        let g = Math.round(fbg + (gcg - fbg) * t1)
        let b = Math.round(fbb + (gcb - fbb) * t1)
        // Snow above the snow line with a faceted lit side.
        if (depth < 0.4) {
          const pick = facetLit === Math.sin(sx9 + depth * 3) > -0.6
          const t2 = clamp01(0.8 - depth * 1.6)
          const pr = pick ? fsr : ffr
          const pg = pick ? fsg : ffg
          const pb = pick ? fsb : ffb
          r = Math.round(r + (pr - r) * t2)
          g = Math.round(g + (pg - g) * t2)
          b = Math.round(b + (pb - b) * t2)
        }
        pixels[i] = r
        pixels[i + 1] = g
        pixels[i + 2] = b
      }
      const near = nearPx[x]!
      let j = nearCap[x]! * stride + x * 3
      for (let y = nearCap[x]!; y < skyTop; y++, j += stride) {
        const depth = clamp01((y - near) / Y3)
        const t1 = clamp01(0.18 * (1 - depth))
        let r = Math.round(nbr + (gcr - nbr) * t1)
        let g = Math.round(nbg + (gcg - nbg) * t1)
        let b = Math.round(nbb + (gcb - nbb) * t1)
        if (depth < 0.16) {
          const t2 = clamp01(0.4 * (1 - depth / 0.16))
          r = Math.round(r + (fsr - r) * t2)
          g = Math.round(g + (fsg - g) * t2)
          b = Math.round(b + (fsb - b) * t2)
        }
        pixels[j] = r
        pixels[j + 1] = g
        pixels[j + 2] = b
      }
    }
  }

  // Low mist along the shore, drifting with the loop. The per-column sine
  // argument and per-row band are hoisted; the blend is inlined.
  {
    const mistArg = new Float64Array(w)
    for (let x = 0; x < w; x++) mistArg[x] = colSx[x]! * 0.4
    const mistK = dawn ? 0.3 : 0.22
    const snowR = snow[0]!
    const snowG = snow[1]!
    const snowB = snow[2]!
    const pixels = hd.pixels
    for (let y = Math.floor(hd.Y(AURORA_MIST_ROW - 1.2)); y < Math.ceil(laneTop); y++) {
      const sy = (y + 0.5) / ch
      const band = Math.exp(-(((sy - AURORA_MIST_ROW) / 0.9) ** 2))
      const sinSy2 = Math.sin(sy * 2)
      let i = y * w * 3
      for (let x = 0; x < w; x++, i += 3) {
        const wisp = 0.55 + 0.45 * Math.sin(mistArg[x]! - theta + sinSy2)
        const alpha = band * wisp * mistK
        if (alpha <= 0) continue
        const a = Math.min(1, alpha)
        pixels[i] = Math.round(pixels[i]! + (snowR - pixels[i]!) * a)
        pixels[i + 1] = Math.round(pixels[i + 1]! + (snowG - pixels[i + 1]!) * a)
        pixels[i + 2] = Math.round(pixels[i + 2]! + (snowB - pixels[i + 2]!) * a)
      }
    }
  }

  // Layered pine forest: a dense back row and the eight lead trees.
  const shore = AURORA_LAKE_TOP - 0.45
  const drawPine = (sx: number, baseRow: number, tall: number, wide: number, dark: RGB, lit: RGB, snowy: boolean) => {
    const cx = hd.X(sx)
    const apex = hd.Y(baseRow - tall)
    const base = hd.Y(baseRow)
    const half = hd.X(wide)
    const tiers = 4
    const pixels = hd.pixels
    const trunkShade = hdMix(dark, [0, 0, 0], 0.15)
    const tR = trunkShade[0]!
    const tG = trunkShade[1]!
    const tB = trunkShade[2]!
    const snowR = snow[0]!
    const snowG = snow[1]!
    const snowB = snow[2]!
    for (let y = Math.max(0, Math.floor(apex)); y < Math.min(h, Math.ceil(base)); y++) {
      const t = (y - apex) / (base - apex || 1)
      const tierT = (t * tiers) % 1
      const widest = half * (0.25 + 0.75 * t)
      const rowHalf = widest * (0.45 + 0.55 * tierT)
      const litMix = hdMix(dark, lit, 0.55 * (1 - tierT))
      const lr = litMix[0]!
      const lg = litMix[1]!
      const lb = litMix[2]!
      const snowBand = snowy && tierT < 0.38
      const snowT = snowBand ? clamp01(0.8 - tierT) : 0
      const sideLimit = 0.9 - tierT
      const xa = Math.max(0, Math.floor(cx - rowHalf))
      const xb = Math.min(w, Math.ceil(cx + rowHalf))
      let i = (y * w + xa) * 3
      for (let x = xa; x < xb; x++, i += 3) {
        const side = (x + 0.5 - cx) / (rowHalf || 1)
        let r: number
        let g: number
        let b: number
        if (side < -0.1) {
          r = lr
          g = lg
          b = lb
        } else {
          r = tR
          g = tG
          b = tB
        }
        if (snowBand && Math.abs(side) < sideLimit) {
          r = Math.round(r + (snowR - r) * snowT)
          g = Math.round(g + (snowG - g) * snowT)
          b = Math.round(b + (snowB - b) * snowT)
        }
        pixels[i] = r
        pixels[i + 1] = g
        pixels[i + 2] = b
      }
    }
  }
  const forestDark = dawn ? hdDarken(pine, 0.62) : hdDarken(pine, 0.5)
  const forestLit = dawn ? hdMix(pine, snow, 0.25) : hdMix(pine, curtain, 0.28)
  for (let i = 0; i < 58; i++) {
    const sx = i * 1.35 + ((i * 7) % 5) * 0.12
    drawPine(sx, shore - 0.2, 2.2 + ((i * 5) % 4) * 0.45, 0.85, hdDarken(forestDark, 0.8), forestLit, false)
  }
  // Shore snowbank: rise is per-column, the snow tint is per-row.
  {
    const riseTab = new Float64Array(w)
    for (let x = 0; x < w; x++) {
      const sx = colSx[x]!
      riseTab[x] = Math.sin(sx * 0.7) * 0.16 + Math.sin(sx * 0.23) * 0.2
    }
    const bankTint = dawn ? hdHex("#d9b4c0") : hdHex("#6c88b4")
    const pixels = hd.pixels
    const bankTop = hd.Y(shore - 0.1)
    for (let y = Math.floor(bankTop); y < Math.ceil(laneTop); y++) {
      const u = (y - bankTop) / (laneTop - bankTop || 1)
      const col = hdMix(snow, bankTint, 0.35 + 0.4 * u)
      const cr = col[0]!
      const cg = col[1]!
      const cb = col[2]!
      let i = y * w * 3
      for (let x = 0; x < w; x++, i += 3) {
        if (u + riseTab[x]! < 0.05) continue
        pixels[i] = cr
        pixels[i + 1] = cg
        pixels[i + 2] = cb
      }
    }
  }
  for (const tree of AURORA_PINES) {
    const sx = tree + 0.5
    drawPine(sx, shore + 0.4, AURORA_LAKE_TOP - AURORA_TREELINE + 1.2, 1.9, forestDark, forestLit, true)
    hd.rect(hd.X(sx - 0.2), hd.Y(shore + 0.1), hd.X(sx + 0.2), hd.Y(shore + 0.5), trunk)
  }

  // Frozen lake: deep gradient with a mirrored, ripple-shifted sky. Curtain
  // terms that depend only on the mirrored row are hoisted out of the x loop.
  const top = hdHex(c.water)
  const deep = hdHex(c.waterDeep)
  const mirror = auroraShimmer(elapsed) ? 1 : 0.88
  {
    const colA03 = new Float64Array(w)
    for (let x = 0; x < w; x++) colA03[x] = colSx[x]! * 0.3
    const pixels = hd.pixels
    for (let y = Math.floor(laneTop); y < h; y++) {
      const u = (y - laneTop) / (h - laneTop || 1)
      const sy = (y + 0.5) / ch
      const mirrorY = AURORA_HORIZON - (sy - AURORA_LAKE_TOP) * 1.2
      const base = hdMix(top, deep, Math.pow(u, 0.8))
      const baseMir = auroraSkyRgb(style, clamp01(mirrorY / AURORA_ROWS))
      const mixT = clamp01(0.5 * (1 - u * 0.6) * mirror)
      const rowStart = y * w * 3
      if (mirrorY < 0 || mirrorY > bottom + 1.2) {
        // Curtain intensity is zero along the whole mirrored row.
        const fr = Math.round(base[0] + (baseMir[0] - base[0]) * mixT)
        const fg = Math.round(base[1] + (baseMir[1] - base[1]) * mixT)
        const fb = Math.round(base[2] + (baseMir[2] - base[2]) * mixT)
        for (let i = rowStart; i < rowStart + w * 3; i += 3) {
          pixels[i] = fr
          pixels[i + 1] = fg
          pixels[i + 2] = fb
        }
        continue
      }
      const v = mirrorY / bottom
      const vertical = smooth(0, 0.3, v) * (1 - smooth(0.9, 1.1, v))
      const rim = Math.exp(-(((v - 0.88) / 0.1) ** 2)) * 0.55
      const vr = vertical * 0.8 + rim
      const rim09 = rim * 0.9
      const tHi = rim * 0.9 + 0.15
      const body = hdMix(topTint, midTint, smooth(0, 0.5, v))
      const mixed = hdMix(body, curtain, smooth(0.4, 0.85, v))
      const dxA = sy * 2.2 + theta
      const sinB = Math.sin(sy * 5 - theta * 2)
      const m25 = mirrorY * 0.25
      const m04 = mirrorY * 0.4
      // Per-curtain terms along this mirrored row.
      const ctr0 = AURORA_CURTAINS[0]!
      const ctr1 = AURORA_CURTAINS[1]!
      const ctr2 = AURORA_CURTAINS[2]!
      const sway0 = auroraRipple(elapsed, ctr0 + mirrorY * 0.2) + Math.sin(mirrorY * 0.5 + theta + ctr0) * 0.8
      const sig0 = AURORA_CURTAIN_WIDTH * (0.85 + 0.25 * Math.sin(mirrorY * 0.3 + ctr0))
      const sway1 = auroraRipple(elapsed, ctr1 + mirrorY * 0.2) + Math.sin(mirrorY * 0.5 + theta + ctr1) * 0.8
      const sig1 = AURORA_CURTAIN_WIDTH * (0.85 + 0.25 * Math.sin(mirrorY * 0.3 + ctr1))
      const sway2 = auroraRipple(elapsed, ctr2 + mirrorY * 0.2) + Math.sin(mirrorY * 0.5 + theta + ctr2) * 0.8
      const sig2 = AURORA_CURTAIN_WIDTH * (0.85 + 0.25 * Math.sin(mirrorY * 0.3 + ctr2))
      const c30 = ctr0 * 3
      const c31 = ctr1 * 3
      const c32 = ctr2 * 3
      let i = rowStart
      for (let x = 0; x < w; x++, i += 3) {
        const dx = Math.sin(dxA + colA03[x]!) * 0.6 + sinB * 0.25
        const sxm = (x + dx * cw + 0.5) / cw
        const d0 = (sxm - ctr0 - sway0) / sig0
        const rays0 = 0.6 + 0.25 * Math.sin(sxm * 1.3 + m25 + c30 + theta) + 0.15 * Math.sin(sxm * 3.1 - m04 + ctr0)
        const env0 = Math.exp(-d0 * d0) * rays0
        const d1 = (sxm - ctr1 - sway1) / sig1
        const rays1 = 0.6 + 0.25 * Math.sin(sxm * 1.3 + m25 + c31 + theta) + 0.15 * Math.sin(sxm * 3.1 - m04 + ctr1)
        const env1 = Math.exp(-d1 * d1) * rays1
        const d2 = (sxm - ctr2 - sway2) / sig2
        const rays2 = 0.6 + 0.25 * Math.sin(sxm * 1.3 + m25 + c32 + theta) + 0.15 * Math.sin(sxm * 3.1 - m04 + ctr2)
        const env2 = Math.exp(-d2 * d2) * rays2
        let env = env0 + env1 + env2
        env += 0.14 * (0.6 + 0.4 * Math.sin(sxm * 0.21 + theta))
        const a = clamp01(env * vr * strength)
        let rr: number
        let rg: number
        let rb: number
        if (a <= 0.004) {
          rr = baseMir[0]
          rg = baseMir[1]
          rb = baseMir[2]
        } else {
          const t = a > 0.75 ? tHi : rim09
          const u1 = clamp01(t)
          const cr = Math.round(mixed[0] + (edge[0] - mixed[0]) * u1)
          const cg = Math.round(mixed[1] + (edge[1] - mixed[1]) * u1)
          const cb = Math.round(mixed[2] + (edge[2] - mixed[2]) * u1)
          const u2 = clamp01(a * 0.9)
          rr = Math.round(baseMir[0] + (cr - baseMir[0]) * u2)
          rg = Math.round(baseMir[1] + (cg - baseMir[1]) * u2)
          rb = Math.round(baseMir[2] + (cb - baseMir[2]) * u2)
        }
        pixels[i] = Math.round(base[0] + (rr - base[0]) * mixT)
        pixels[i + 1] = Math.round(base[1] + (rg - base[1]) * mixT)
        pixels[i + 2] = Math.round(base[2] + (rb - base[2]) * mixT)
      }
    }
  }
  // Dark forest reflection hugging the shore, broken by ripples.
  {
    const pixels = hd.pixels
    const fdR = forestDark[0]!
    const fdG = forestDark[1]!
    const fdB = forestDark[2]!
    for (let y = Math.floor(laneTop); y < Math.min(h, Math.ceil(hd.Y(AURORA_LAKE_TOP + 1.6))); y++) {
      const u = (y - laneTop) / (hd.Y(1.6) || 1)
      const y05 = y * 0.5
      const oneMinusU = 1 - u
      let i = y * w * 3
      for (let x = 0; x < w; x++, i += 3) {
        const broken = 0.5 + 0.5 * Math.sin(colA31[x]! + y05 + theta)
        const alpha = oneMinusU * (0.55 - broken * 0.2)
        if (alpha <= 0) continue
        const a = Math.min(1, alpha)
        pixels[i] = Math.round(pixels[i]! + (fdR - pixels[i]!) * a)
        pixels[i + 1] = Math.round(pixels[i + 1]! + (fdG - pixels[i + 1]!) * a)
        pixels[i + 2] = Math.round(pixels[i + 2]! + (fdB - pixels[i + 2]!) * a)
      }
    }
  }
  const bright = auroraShimmer(elapsed)
  const base0 = (y: number) => hdMix(top, deep, (y - laneTop) / (h - laneTop || 1))
  const shimmer = hdHex(c.shimmer)
  for (const center of AURORA_CURTAINS) {
    const cx = hd.X(center + auroraRipple(elapsed, center))
    for (let y = Math.floor(laneTop); y < h; y += 3) {
      const u = (y - laneTop) / (h - laneTop || 1)
      const len = cw * (1.2 + 1.8 * Math.sin(y * 0.31 + theta + center) ** 2) * (1 - u * 0.5)
      const off = Math.sin(y * 0.2 + theta) * cw * 0.8
      hd.rect(
        cx + off - len,
        y,
        cx + off + len,
        y + 1,
        hdMix(hdMix(base0(y), shimmer, 0.35), shimmer, bright ? 0.2 : 0),
      )
    }
  }
  for (let x = 4; x < AURORA_COLUMNS; x += 17) {
    hd.stroke(
      x,
      AURORA_LAKE_TOP + 4.7,
      x + 1.5,
      AURORA_LAKE_TOP + 5.25,
      Math.max(1, cw * 0.12),
      bright ? snow : hdMix(snow, deep, 0.4),
    )
  }

  // Falling snow drifting in the foreground.
  for (let i = 0; i < 16; i++) {
    const x = (i * 17 + 3 + phase * AURORA_COLUMNS) % AURORA_COLUMNS
    const y = 1.2 + (i % 6) * 1.6 + Math.sin(theta + i * 0.7) * 0.25
    hd.disk(hd.X(x), hd.Y(y), i % 4 === 0 ? Math.max(1.4, cw * 0.26) : 1.15, snow)
  }
  void horizonY
  return hd.pixels
}
