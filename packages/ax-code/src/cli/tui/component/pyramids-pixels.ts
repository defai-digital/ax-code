import { artHash, artLine, blendPixel, glow, polyFill, softDisk, vignette } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  PYRAMIDS_APEX,
  PYRAMIDS_APEX_SMALL,
  PYRAMIDS_BASE_ROW,
  PYRAMIDS_CAMEL_COUNT,
  PYRAMIDS_CAMEL_GAP,
  PYRAMIDS_CARAVAN_ROW,
  PYRAMIDS_COLORS,
  PYRAMIDS_COLUMNS,
  PYRAMIDS_CYCLE_MS,
  PYRAMIDS_DUNE_TOP,
  PYRAMIDS_FIRE,
  PYRAMIDS_MOON,
  PYRAMIDS_ROWS,
  PYRAMIDS_STARS,
  PYRAMIDS_SUN,
  pyramidsCaravanX,
  pyramidsFlicker,
  pyramidsSkyRgb,
  type PyramidsStyle,
} from "./pyramids-view-model"

/**
 * Freeform HD pyramids. A graded sky with sun or moon bloom, stone pyramids
 * built from lit and shaded faces with masonry courses and cast shadows, a
 * sphinx, hazy distant masses, layered wind-rippled dunes, swaying palms, a
 * walking camel caravan, and (at night) a campfire that lights the sand.
 * Pure and deterministic: everything derives from `elapsedMs`, and motion
 * loops on the 2400ms cycle.
 */
export function renderPyramidsPixels(width: number, height: number, style: PyramidsStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, PYRAMIDS_COLUMNS, PYRAMIDS_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "pyramids-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % PYRAMIDS_CYCLE_MS) / PYRAMIDS_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = PYRAMIDS_COLORS[style]
  const u = Math.min(hd.cw, hd.ch / 2)
  // Light comes from the sun on the right by day and the moon on the left by night.
  const lightDir = night ? -1 : 1
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const sand = hdHex(c.sand)
  const sandDark = hdHex(c.sandDark)
  const dune = hdHex(c.dune)
  const sun = hdHex(c.sun)
  const horizon = pyramidsSkyRgb(style, 1)
  const horizonY = hd.Y(PYRAMIDS_BASE_ROW)
  const flameOn = pyramidsFlicker(elapsed)
  const fireX = hd.X(PYRAMIDS_FIRE.x + 1.2)
  const fireY = hd.Y(PYRAMIDS_FIRE.y + 0.9)
  const flick = 0.85 + 0.15 * Math.sin(theta * 27) + (flameOn ? 0.1 : -0.1)

  // Sky runs from the zenith to the pale horizon line.
  hd.sky((t) => pyramidsSkyRgb(style, Math.min(1, (t * hd.h) / (horizonY || 1))))

  // Stars, moon and sun.
  if (night) {
    for (let i = 0; i < 70; i++) {
      const sx = artHash(i, 3) * hd.w
      const sy = Math.pow(artHash(i, 7), 1.5) * horizonY * 0.8
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(theta + i * 1.7))
      blendPixel(hd, Math.floor(sx), Math.floor(sy), [235, 238, 255], 0.35 + 0.5 * tw)
    }
    hd.stars(PYRAMIDS_STARS, sun, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    const mx = hd.X(PYRAMIDS_MOON.x)
    const my = hd.Y(PYRAMIDS_MOON.y)
    const mr = Math.max(4, u * 1.6)
    glow(hd, mx, my, mr * 7, [120, 140, 200], 0.45)
    softDisk(hd, mx, my, mr, hdMix(sun, [255, 255, 255], 0.2))
    for (const [dx, dy, r] of [
      [-0.35, -0.25, 0.28],
      [0.3, 0.1, 0.22],
      [-0.1, 0.4, 0.17],
    ] as const) {
      softDisk(hd, mx + dx * mr, my + dy * mr, r * mr, hdDarken(sun, 0.82), 0.7)
    }
  } else {
    const sx = hd.X(PYRAMIDS_SUN.x)
    const sy = hd.Y(PYRAMIDS_SUN.y)
    const sr = Math.max(4, u * 1.6)
    glow(hd, sx, sy, sr * 12, [255, 236, 180], 0.55)
    glow(hd, sx, sy, sr * 4.5, [255, 246, 214], 0.7)
    softDisk(hd, sx, sy, sr, [255, 250, 226])
    // Thin high cirrus drifting on the cycle, wrapped off-screen.
    for (let i = 0; i < 4; i++) {
      const cx = hd.X(((i * 23 + phase * (PYRAMIDS_COLUMNS + 30)) % (PYRAMIDS_COLUMNS + 30)) - 15)
      const cy = hd.Y(1.4 + (i % 3) * 1.6)
      for (let k = 0; k < 14; k++) {
        softDisk(hd, cx + k * hd.cw * 0.5, cy + Math.sin(k * 0.8 + i) * hd.ch * 0.08, hd.ch * 0.2, [255, 255, 255], 0.2)
      }
    }
  }

  // Hazy distant dune line behind the pyramids.
  const farTop = hd.Y(PYRAMIDS_BASE_ROW - 0.7)
  {
    // The mix color is constant and alpha is 1, so this is a plain overwrite.
    const farCol = hdMix(sand, horizon, night ? 0.35 : 0.55)
    const f0 = farCol[0]!
    const f1 = farCol[1]!
    const f2 = farCol[2]!
    const pixels = hd.pixels
    for (let x = 0; x < hd.w; x++) {
      const sx = x / hd.cw
      const edge = farTop + Math.sin(sx * 0.17 + 0.6) * hd.ch * 0.22 + Math.sin(sx * 0.41) * hd.ch * 0.08
      for (let y = Math.max(0, Math.floor(edge)); y < horizonY; y++) {
        const i = (y * hd.w + x) * 3
        pixels[i] = f0
        pixels[i + 1] = f1
        pixels[i + 2] = f2
      }
    }
  }

  // Pyramids: shared face painter with courses and aerial haze toward the base.
  const pyramid = (apexX: number, apexY: number, baseY: number, half: number, haze: number) => {
    const ax = hd.X(apexX)
    const ay = hd.Y(apexY)
    const by = hd.Y(baseY)
    const hw = hd.X(half)
    const courseH = Math.max(3, (by - ay) / 20)
    polyFill(
      hd,
      [
        [ax, ay],
        [ax + hw, by],
        [ax - hw, by],
      ],
      (x, y) => {
        const t = (y - ay) / (by - ay || 1)
        const side = x >= ax ? 1 : -1
        const lit = side === lightDir
        let color = lit ? stone : stoneDark
        // Light falls off toward the shaded edge of each face.
        const across = Math.abs(x - ax) / (hw * Math.max(0.02, t) || 1)
        color = hdMix(
          color,
          lit ? hdMix(stone, [255, 240, 200], night ? 0.05 : 0.2) : hdDarken(stoneDark, 0.8),
          across * 0.45,
        )
        const row = Math.floor((y - ay) / courseH)
        const joint = (y - ay) / courseH - row
        const block = Math.floor((x - ax) / (courseH * 2.2 + row * 0.8) + (row % 2) * 0.5)
        const grain = artHash(row * 31 + block, row) - 0.5
        color = hdDarken(color, 1 + grain * 0.12)
        if (joint < 0.12) color = hdDarken(color, 0.86)
        else if (joint > 0.88 && lit) color = hdMix(color, [255, 235, 190], night ? 0.02 : 0.1)
        if (Math.abs(x - ax) < 1.2 + t) color = hdMix(color, lit ? [255, 232, 180] : stoneDark, lit ? 0.35 : 0.2)
        return hdMix(color, horizon, haze + t * t * 0.18)
      },
    )
    // Weathered pyramidion cap.
    polyFill(
      hd,
      [
        [ax, ay],
        [ax + hw * 0.07, ay + (by - ay) * 0.07],
        [ax - hw * 0.07, ay + (by - ay) * 0.07],
      ],
      () => hdMix(stone, [255, 240, 200], night ? 0.1 : 0.4),
    )
  }
  pyramid(63, 12.2, PYRAMIDS_BASE_ROW, 3.2, 0.5)
  pyramid(
    PYRAMIDS_APEX_SMALL.x,
    PYRAMIDS_APEX_SMALL.y,
    PYRAMIDS_BASE_ROW,
    PYRAMIDS_BASE_ROW - PYRAMIDS_APEX_SMALL.y,
    0.16,
  )
  pyramid(PYRAMIDS_APEX.x, PYRAMIDS_APEX.y, PYRAMIDS_BASE_ROW, PYRAMIDS_BASE_ROW - PYRAMIDS_APEX.y, 0.05)

  // Hardpan ground from the pyramid bases down, graded toward the viewer.
  for (let y = Math.max(0, Math.floor(horizonY)); y < hd.h; y++) {
    const v = (y - horizonY) / (hd.h - horizonY || 1)
    const row = hdMix(hdMix(sand, horizon, 0.3 * (1 - v)), dune, Math.min(1, v * 1.4))
    const r0 = row[0]!
    const r1 = row[1]!
    const r2 = row[2]!
    let i = y * hd.w * 3
    for (let x = 0; x < hd.w; x++, i += 3) {
      hd.pixels[i] = r0
      hd.pixels[i + 1] = r1
      hd.pixels[i + 2] = r2
    }
  }
  // Pyramid cast shadows fall away from the light across the sand.
  const shadowColor: RGB = night ? [14, 14, 36] : [90, 60, 40]
  const castShadow = (apexX: number, half: number, length: number) => {
    const bx = hd.X(apexX)
    const by = horizonY
    const s = -lightDir
    const pts: [number, number][] = [
      [bx, by],
      [bx + s * hd.X(half), by],
      [bx + s * hd.X(half + length), by + hd.ch * 1.4],
      [bx + s * hd.X(length * 0.5), by + hd.ch * 1.4],
    ]
    polyFill(hd, pts, (x, y) => {
      blendPixel(hd, x, y, shadowColor, night ? 0.3 : 0.28)
      return null
    })
  }
  castShadow(PYRAMIDS_APEX.x, 9, 12)
  castShadow(PYRAMIDS_APEX_SMALL.x, 6, 8)

  // Sphinx in profile, facing east, lit from the same side as the pyramids.
  {
    const sx0 = hd.X(5.5)
    const sw = hd.X(8.5)
    const sy0 = hd.Y(12.2)
    const sh = hd.Y(PYRAMIDS_BASE_ROW + 0.25) - sy0
    const P = (px: number, py: number): [number, number] => [sx0 + px * sw, sy0 + py * sh]
    const outline: [number, number][] = [
      P(0, 1),
      P(0.02, 0.66),
      P(0.1, 0.52),
      P(0.24, 0.48),
      P(0.46, 0.5),
      P(0.54, 0.46),
      P(0.56, 0.3),
      P(0.6, 0.1),
      P(0.68, 0.0),
      P(0.79, 0.03),
      P(0.85, 0.16),
      P(0.85, 0.36),
      P(0.83, 0.5),
      P(0.84, 0.62),
      P(1, 0.7),
      P(1, 1),
    ]
    const shadeBody = (x: number, y: number): RGB => {
      const tx = (x - sx0) / sw
      const ty = (y - sy0) / sh
      const lit = lightDir > 0 ? tx : 1 - tx
      let col = hdMix(hdDarken(stoneDark, 0.8), stone, 0.15 + lit * 0.6 - ty * 0.25)
      if (ty < 0.35 && tx > 0.57 && tx < 0.83 && (Math.floor(ty * 20) + Math.floor(tx * 30)) % 3 === 0) {
        col = hdDarken(col, 0.9)
      }
      return hdDarken(col, 0.92 + ty * 0.04)
    }
    polyFill(hd, outline, (x, y) => shadeBody(x, y))
    const [ex, ey] = P(0.77, 0.2)
    softDisk(hd, ex, ey, Math.max(0.9, u * 0.11), hdDarken(stoneDark, 0.5))
  }

  // Layered dunes: ripples and slope shading follow the light direction.
  const crestA = (sx: number) => PYRAMIDS_DUNE_TOP + 0.4 + Math.sin(sx * 0.33) * 0.55 + Math.cos(sx * 0.11) * 0.28
  const crestB = (sx: number) => PYRAMIDS_DUNE_TOP + 3.1 + Math.sin(sx * 0.21 + 1.7) * 0.8 + Math.cos(sx * 0.07) * 0.4
  const litSand = hdMix(sand, night ? [120, 120, 170] : [255, 232, 176], night ? 0.2 : 0.35)
  const dimSand = hdDarken(sandDark, night ? 0.9 : 1)
  {
    // Every crest, slope, facing, and ripple-constant term depends only on the
    // column; hoist them into tables so the pixel loop keeps just one sin.
    const pixels = hd.pixels
    const cols = hd.w
    const crestACol = new Float64Array(cols)
    const crestBCol = new Float64Array(cols)
    const facingACol = new Float64Array(cols)
    const facingBCol = new Float64Array(cols)
    const absFacingACol = new Float64Array(cols)
    const absFacingBCol = new Float64Array(cols)
    const targetA0 = new Float64Array(cols)
    const targetA1 = new Float64Array(cols)
    const targetA2 = new Float64Array(cols)
    const targetB0 = new Float64Array(cols)
    const targetB1 = new Float64Array(cols)
    const targetB2 = new Float64Array(cols)
    const ripple26 = new Float64Array(cols)
    const rippleInner = new Float64Array(cols)
    const lit0 = litSand[0]!
    const lit1 = litSand[1]!
    const lit2 = litSand[2]!
    const dim0 = dimSand[0]!
    const dim1 = dimSand[1]!
    const dim2 = dimSand[2]!
    const dune0 = dune[0]!
    const dune1 = dune[1]!
    const dune2 = dune[2]!
    for (let x = 0; x < cols; x++) {
      const sx = (x + 0.5) / hd.cw
      const a = crestA(sx)
      const b = crestB(sx)
      crestACol[x] = a
      crestBCol[x] = b
      const slopeA = (crestA(sx + 0.2) - crestA(sx - 0.2)) / 0.4
      const slopeB = (crestB(sx + 0.2) - crestB(sx - 0.2)) / 0.4
      const facingA = Math.max(-1, Math.min(1, slopeA * lightDir * 3))
      const facingB = Math.max(-1, Math.min(1, slopeB * lightDir * 3))
      facingACol[x] = facingA
      facingBCol[x] = facingB
      absFacingACol[x] = Math.abs(facingA)
      absFacingBCol[x] = Math.abs(facingB)
      if (facingA > 0) {
        targetA0[x] = lit0
        targetA1[x] = lit1
        targetA2[x] = lit2
      } else {
        targetA0[x] = dim0
        targetA1[x] = dim1
        targetA2[x] = dim2
      }
      if (facingB > 0) {
        targetB0[x] = lit0
        targetB1[x] = lit1
        targetB2[x] = lit2
      } else {
        targetB0[x] = dim0
        targetB1[x] = dim1
        targetB2[x] = dim2
      }
      ripple26[x] = sx * 2.6
      rippleInner[x] = Math.sin(sx * 0.5) * 2
    }
    for (let y = Math.max(0, Math.floor(hd.Y(PYRAMIDS_DUNE_TOP - 0.8))); y < hd.h; y++) {
      const sy = (y + 0.5) / hd.ch
      const sy5 = sy * 5
      let i = y * cols * 3
      for (let x = 0; x < cols; x++, i += 3) {
        const a = crestACol[x]!
        const b = crestBCol[x]!
        let layer = 0
        let crest = 0
        if (sy >= b) {
          layer = 2
          crest = b
        } else if (sy >= a) {
          layer = 1
          crest = a
        }
        if (!layer) continue
        const depth = Math.min(1, (sy - crest) / 3)
        // hdMix clamps are identities here: the factor stays inside [0, 0.55].
        const k1 = (layer === 2 ? absFacingBCol[x]! : absFacingACol[x]!) * (0.55 - depth * 0.15)
        let c0 = Math.round(dune0 + ((layer === 2 ? targetB0[x]! : targetA0[x]!) - dune0) * k1)
        let c1 = Math.round(dune1 + ((layer === 2 ? targetB1[x]! : targetA1[x]!) - dune1) * k1)
        let c2 = Math.round(dune2 + ((layer === 2 ? targetB2[x]! : targetA2[x]!) - dune2) * k1)
        if (layer === 2) {
          // hdDarken(col, 0.94) with the same channel clamp/round.
          let v0 = c0 * 0.94
          c0 = v0 < 0 ? 0 : v0 > 255 ? 255 : Math.round(v0)
          let v1 = c1 * 0.94
          c1 = v1 < 0 ? 0 : v1 > 255 ? 255 : Math.round(v1)
          let v2 = c2 * 0.94
          c2 = v2 < 0 ? 0 : v2 > 255 ? 255 : Math.round(v2)
        }
        const ripple = Math.sin(ripple26[x]! + sy5 + rippleInner[x]!)
        if (ripple > 0.85) {
          c0 = Math.round(c0 + (lit0 - c0) * 0.25)
          c1 = Math.round(c1 + (lit1 - c1) * 0.25)
          c2 = Math.round(c2 + (lit2 - c2) * 0.25)
        } else if (ripple < -0.88) {
          c0 = Math.round(c0 + (dim0 - c0) * 0.25)
          c1 = Math.round(c1 + (dim1 - c1) * 0.25)
          c2 = Math.round(c2 + (dim2 - c2) * 0.25)
        }
        // artHash(x, y) inlined.
        let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
        n = Math.imul(n ^ (n >>> 13), 1274126177)
        const grain = (((n ^ (n >>> 16)) >>> 0) / 4294967296 - 0.5) * 0.05
        let g0 = c0 * (1 + grain)
        c0 = g0 < 0 ? 0 : g0 > 255 ? 255 : Math.round(g0)
        let g1 = c1 * (1 + grain)
        c1 = g1 < 0 ? 0 : g1 > 255 ? 255 : Math.round(g1)
        let g2 = c2 * (1 + grain)
        c2 = g2 < 0 ? 0 : g2 > 255 ? 255 : Math.round(g2)
        // Rim light along the crest.
        if (sy - crest < 0.08 && (layer === 2 ? facingBCol[x]! : facingACol[x]!) > -0.2) {
          c0 = Math.round(c0 + (lit0 - c0) * 0.55)
          c1 = Math.round(c1 + (lit1 - c1) * 0.55)
          c2 = Math.round(c2 + (lit2 - c2) * 0.55)
        }
        pixels[i] = c0
        pixels[i + 1] = c1
        pixels[i + 2] = c2
      }
    }
  }

  // Palms: curved trunks with drooping, swaying fronds.
  const palm = hdHex(c.palm)
  const trunkColor = hdHex(c.trunk)
  const palmBases = [
    { x: 66, h: 4.1, lean: 0.8 },
    { x: 70.5, h: 3.4, lean: -0.6 },
  ]
  for (const p of palmBases) {
    const bx = hd.X(p.x + 0.5)
    const by = hd.Y(PYRAMIDS_BASE_ROW + 1.1)
    const tx = bx + hd.X(p.lean)
    const ty = by - hd.Y(p.h)
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      const px = bx + (tx - bx) * t + Math.sin(t * Math.PI) * hd.X(p.lean * 0.3)
      softDisk(
        hd,
        px,
        by + (ty - by) * t,
        u * (0.17 - t * 0.06),
        hdMix(trunkColor, [255, 220, 170], night ? 0.02 : 0.1 * t),
      )
    }
    for (let f = 0; f < 8; f++) {
      const ang = -Math.PI + (f / 7) * Math.PI
      const len = hd.X(2.4 + (f % 2) * 0.5)
      const sway = Math.sin(theta + p.x + f) * u * 0.16
      const ex = tx + Math.cos(ang) * len + sway
      const ey = ty - Math.sin(ang) * len * 0.35 + len * 0.28
      const mx = tx + Math.cos(ang) * len * 0.55
      const my = ty - Math.sin(ang) * len * 0.62
      const col = hdMix(hdDarken(palm, 0.72), palm, f / 7)
      artLine(hd, tx, ty, mx, my, u * 0.14, u * 0.12, col)
      artLine(hd, mx, my, ex, ey, u * 0.12, u * 0.03, hdMix(col, [200, 255, 160], night ? 0 : 0.18))
    }
    softDisk(hd, tx, ty, u * 0.24, hdDarken(trunkColor, 0.8))
    // Shadow pooling at the base of the tree.
    blendPixel(hd, Math.round(bx), Math.round(by), shadowColor, 0.4)
  }

  // Camel caravan walking left to right across the hardpan.
  const hide = hdHex(c.caravan)
  const lead = pyramidsCaravanX(elapsed)
  for (let i = 0; i < PYRAMIDS_CAMEL_COUNT; i++) {
    const cxs = lead - i * PYRAMIDS_CAMEL_GAP
    const bobUp = Math.abs(Math.sin(theta * 2 + i * 1.3)) * u * 0.18
    const gx = hd.X(cxs + 1.3)
    const gy = hd.Y(PYRAMIDS_CARAVAN_ROW + 1.05)
    const body = night ? hdDarken(hide, 0.55) : hdMix(hide, [255, 220, 170], 0.12)
    const s = u * 0.95
    // Ground shadow.
    for (let k = -7; k <= 7; k++)
      blendPixel(hd, Math.round(gx - lightDir * s * 0.8 + k * s * 0.28), Math.round(gy), shadowColor, 0.45)
    const swing = (leg: number) => Math.sin(theta * 3 + leg * 1.8 + i) * s * 0.5
    const legs: [number, number][] = [
      [-1.5, 0],
      [-0.9, 2],
      [1.0, 1],
      [1.7, 3],
    ]
    for (const [lx, lk] of legs) {
      const hipX = gx + lx * s
      const hipY = gy - s * 2.4 - bobUp
      const footX = hipX + swing(lk)
      const footLift = Math.max(0, Math.cos(theta * 3 + lk * 1.8 + i)) * s * 0.4
      artLine(hd, hipX, hipY, footX, gy - footLift, s * 0.22, s * 0.14, hdDarken(body, 0.82))
    }
    // Body, hump, saddle blanket, neck, head, tail.
    softDisk(hd, gx, gy - s * 3 - bobUp, s * 1.9, body)
    softDisk(hd, gx - s * 0.3, gy - s * 3 - bobUp, s * 1.55, hdMix(body, [255, 255, 255], night ? 0.04 : 0.08))
    softDisk(hd, gx - s * 0.2, gy - s * 4.7 - bobUp, s * 0.95, body)
    if (i === 0) softDisk(hd, gx - s * 0.2, gy - s * 4.1 - bobUp, s * 0.8, [190, 70, 60], night ? 0.55 : 0.85)
    else if (i === 1) softDisk(hd, gx - s * 0.2, gy - s * 4.1 - bobUp, s * 0.8, [70, 110, 170], night ? 0.55 : 0.8)
    artLine(hd, gx + s * 1.5, gy - s * 3.5 - bobUp, gx + s * 2.7, gy - s * 5.9 - bobUp, s * 0.5, s * 0.34, body)
    softDisk(hd, gx + s * 3.1, gy - s * 6.1 - bobUp, s * 0.55, body)
    artLine(hd, gx + s * 3.2, gy - s * 6, gx + s * 4, gy - s * 5.8 - bobUp, s * 0.32, s * 0.25, body)
    artLine(
      hd,
      gx - s * 1.8,
      gy - s * 3.5 - bobUp,
      gx - s * 2.2,
      gy - s * 2.2 - bobUp,
      s * 0.14,
      s * 0.1,
      hdDarken(body, 0.8),
    )
  }

  // Night campfire: logs, layered flame, rising sparks, and warm light on the sand.
  if (night) {
    glow(hd, fireX, fireY - hd.ch * 0.3, hd.cw * 9 * flick, [255, 150, 60], 0.55)
    glow(hd, fireX, fireY - hd.ch * 0.2, hd.cw * 3.5, [255, 210, 120], 0.5)
    artLine(hd, fireX - u * 1.4, fireY + u * 0.15, fireX + u * 1.3, fireY - u * 0.2, u * 0.22, u * 0.22, hdHex(c.trunk))
    artLine(
      hd,
      fireX - u * 1.3,
      fireY - u * 0.2,
      fireX + u * 1.4,
      fireY + u * 0.15,
      u * 0.22,
      u * 0.22,
      hdDarken(hdHex(c.trunk), 0.8),
    )
    const fh = u * (flameOn ? 3.4 : 2.7) * flick
    for (const [k, col] of [
      [1, [255, 110, 30]],
      [0.72, [255, 170, 50]],
      [0.42, [255, 235, 140]],
    ] as const) {
      const lean = Math.sin(theta * 18) * u * 0.18
      const pts: [number, number][] = []
      for (let a = 0; a <= 16; a++) {
        const t = a / 16
        const wv = Math.sin(t * Math.PI) * u * 1.0 * k
        pts.push([fireX - wv + lean * t * t, fireY - fh * k * t])
      }
      for (let a = 16; a >= 0; a--) {
        const t = a / 16
        const wv = Math.sin(t * Math.PI) * u * 1.0 * k
        pts.push([fireX + wv + lean * t * t, fireY - fh * k * t])
      }
      polyFill(hd, pts, () => col as RGB)
    }
    for (let i = 0; i < 6; i++) {
      const t = (phase * 2 + i / 6) % 1
      blendPixel(
        hd,
        Math.round(fireX + Math.sin(i * 2.3 + t * 5) * u * (0.5 + t)),
        Math.round(fireY - fh - t * u * 5),
        [255, 190, 90],
        1 - t,
      )
    }
  }

  // Drifting sand grains close to the ground.
  for (let i = 0; i < 18; i++) {
    const x = (i * 13 + 2 + phase * PYRAMIDS_COLUMNS) % PYRAMIDS_COLUMNS
    const y = PYRAMIDS_DUNE_TOP + 1.15 + (i % 5) * 0.85 + Math.sin(theta + i) * 0.12
    blendPixel(hd, Math.floor(hd.X(x)), Math.floor(hd.Y(y)), i % 2 === 0 ? litSand : dimSand, 0.7)
  }
  vignette(hd, night ? 0.35 : 0.18)
  return hd.pixels
}
