import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  LIGHTHOUSE_CLIFF_TOP,
  LIGHTHOUSE_COLORS,
  LIGHTHOUSE_COLUMNS,
  LIGHTHOUSE_CYCLE_MS,
  LIGHTHOUSE_LAMP,
  LIGHTHOUSE_MOON,
  LIGHTHOUSE_ROWS,
  LIGHTHOUSE_SEA_TOP,
  LIGHTHOUSE_STARS,
  LIGHTHOUSE_TOWER,
  lighthouseGulls,
  lighthouseSkyRgb,
  lighthouseSurf,
  type LighthouseStyle,
} from "./lighthouse-view-model"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Freeform HD lighthouse. A round striped tower with cylinder shading, a
 * railed gallery, glazed lantern room and copper cap; a keeper's cottage on a
 * strata-cut headland with grass and surf at its foot; a perspective sea with
 * swell lines; sun and clouds by day, or moon, stars, a smoothly rotating
 * volumetric beam and a lit lantern by night. The layout comes from the shared
 * scene model. Pure and deterministic: everything derives from `elapsedMs`
 * and loops at 2400ms.
 */
export function renderLighthousePixels(
  width: number,
  height: number,
  style: LighthouseStyle,
  elapsedMs: number,
): Buffer {
  const hd = createHdCanvas(width, height, LIGHTHOUSE_COLUMNS, LIGHTHOUSE_ROWS)
  const { w, h, cw, ch, X, Y } = hd
  if (w === 0 || h === 0) return hd.pixels
  const night = style === "lighthouse-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % LIGHTHOUSE_CYCLE_MS) / LIGHTHOUSE_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = LIGHTHOUSE_COLORS[style]
  const unit = Math.max(1, Math.min(cw, ch / 2))
  const chalk = hdHex(c.tower)
  const stripe = hdHex(c.stripe)
  const lampDark = hdHex(c.lamp)
  const glass = hdHex(c.glass)
  const cliffLit = hdHex(c.cliff)
  const cliffShade = hdHex(c.cliffDark)
  const foam = hdHex(c.foam)
  const center = LIGHTHOUSE_TOWER.x + 0.5
  const skyAt = (y: number): RGB => lighthouseSkyRgb(style, h <= 1 ? 0 : y / (h - 1))
  const seaTop = Y(LIGHTHOUSE_SEA_TOP)

  const tint = (x: number, y: number, color: RGB, a: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return
    const i = (y * w + x) * 3
    for (let k = 0; k < 3; k++) hd.pixels[i + k] = Math.round(hd.pixels[i + k]! + (color[k]! - hd.pixels[i + k]!) * a)
  }
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
  /** Volumetric cone: bright at the origin, widening and fading along `angle`. */
  const cone = (
    ox: number,
    oy: number,
    angle: number,
    length: number,
    spread: number,
    color: RGB,
    strength: number,
  ) => {
    const dx = Math.cos(angle),
      dy = Math.sin(angle)
    const reach = length + spread * length
    const xa = Math.max(0, Math.floor(Math.min(ox, ox + dx * length) - reach * 0.4)),
      xb = Math.min(w - 1, Math.ceil(Math.max(ox, ox + dx * length) + reach * 0.4))
    const ya = Math.max(0, Math.floor(Math.min(oy, oy + dy * length) - reach * 0.4)),
      yb = Math.min(h - 1, Math.ceil(Math.max(oy, oy + dy * length) + reach * 0.4))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5 - ox,
          py = y + 0.5 - oy
        const along = px * dx + py * dy
        if (along < 0 || along > length) continue
        const across = Math.abs(-px * dy + py * dx)
        const half = unit * 0.8 + along * spread
        if (across > half) continue
        const u = along / length
        const edge = 1 - (across / half) * (across / half)
        tint(x, y, color, strength * edge * Math.pow(1 - u, 1.3))
      }
    }
  }

  // --- Sky ---------------------------------------------------------------
  hd.sky((t) => skyAt(t * (h - 1)))
  const surf = lighthouseSurf(elapsed)
  const lampX = X(center),
    lampY = Y(LIGHTHOUSE_LAMP.y - 0.65)
  // Horizon haze.
  const hazeColor = night ? hdHex("#34487a") : hdHex("#fff3d6")
  for (let y = Math.floor(seaTop - ch * 5); y < seaTop; y++) {
    const a = smooth(seaTop - ch * 5, seaTop, y) * (night ? 0.4 : 0.5)
    for (let x = 0; x < w; x++) tint(x, y, hazeColor, a)
  }
  const moonX = X(LIGHTHOUSE_MOON.x),
    moonY = Y(LIGHTHOUSE_MOON.y)
  if (night) {
    const moon = foam
    for (let i = 0; i < 80; i++) {
      const sx = Math.floor(hash(i + 3) * w),
        sy = Math.floor(Math.pow(hash(i + 60), 1.3) * seaTop * 0.9)
      if (Math.hypot(sx - moonX, sy - moonY) < unit * 6) continue
      const tw = 0.5 + 0.5 * Math.sin(theta * (1 + (i % 3)) + hash(i + 9) * 6)
      hd.set(sx, sy, hdMix(skyAt(sy), moon, 0.35 + 0.5 * tw))
    }
    hd.stars(LIGHTHOUSE_STARS, moon, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    const mr = Math.max(3, unit * 1.9)
    glow(moonX, moonY, mr * 8, hdHex("#5a72b0"), 0.5)
    glow(moonX, moonY, mr * 3, moon, 0.35)
    hd.disk(moonX, moonY, mr, hdMix(moon, [255, 255, 255], 0.4))
    const mare = hdMix(moon, hdHex("#8fa2cc"), 0.5)
    hd.disk(moonX - mr * 0.3, moonY - mr * 0.15, mr * 0.28, mare)
    hd.disk(moonX + mr * 0.25, moonY + mr * 0.3, mr * 0.2, mare)
    // Moonlit clouds.
    for (let i = 0; i < 3; i++) {
      const cx = X(((14 + i * 27 + phase * 3) % (LIGHTHOUSE_COLUMNS + 10)) - 4),
        cy = Y(4 + (i % 2) * 3.5)
      for (let k = 0; k < 6; k++)
        hd.blob(
          cx + k * unit * 3.6,
          cy + Math.sin(k + i) * unit * 0.6,
          unit * 7,
          unit * 0.9,
          hdMix(skyAt(cy), hdHex("#7c8fc0"), 0.16),
        )
    }
  } else {
    const sunX = X(62),
      sunY = Y(4.2)
    glow(sunX, sunY, w * 0.45, hdHex("#fff0b8"), 0.35)
    glow(sunX, sunY, unit * 14, hdHex("#fff6d0"), 0.55)
    hd.disk(sunX, sunY, Math.max(3, unit * 2.1), hdHex("#fffbea"))
    // Layered, shaded cumulus drifting with the loop.
    const cloudLit = hdHex(c.cloud)
    const cloudShade = hdMix(cloudLit, hdHex("#9cc0da"), 0.7)
    for (let n = 0; n < 4; n++) {
      const baseX = 4 + n * 25
      const cx = X(((baseX + surf * 2) % (LIGHTHOUSE_COLUMNS + 12)) - 6)
      const cy = Y(3 + ((baseX % 3) + n * 0.4) * 1.15)
      const size = unit * (2.6 + (n % 3) * 0.7)
      for (let k = 0; k < 5; k++) {
        const bx = cx + (k - 2) * size * 0.9
        const by = cy - Math.sin((k / 4) * Math.PI) * size * 0.45
        const r = size * (0.7 + Math.sin((k / 4) * Math.PI) * 0.35)
        hd.blob(bx, by + r * 0.2, r, r * 0.55, cloudShade)
      }
      for (let k = 0; k < 5; k++) {
        const bx = cx + (k - 2) * size * 0.9
        const by = cy - Math.sin((k / 4) * Math.PI) * size * 0.45
        const r = size * (0.7 + Math.sin((k / 4) * Math.PI) * 0.35)
        hd.blob(bx - r * 0.1, by - r * 0.05, r * 0.9, r * 0.5, cloudLit)
      }
    }
  }

  // --- Sea -------------------------------------------------------------
  hd.water(LIGHTHOUSE_SEA_TOP, LIGHTHOUSE_ROWS, hdHex(c.sea), hdHex(c.seaDeep), theta)
  // Horizon glow on the water and swell lines in perspective.
  const span = h - seaTop
  for (let y = Math.floor(seaTop); y < Math.min(h, Math.ceil(seaTop + ch * 1.5)); y++) {
    const a = (1 - (y - seaTop) / (ch * 1.5)) * (night ? 0.3 : 0.4)
    for (let x = 0; x < w; x++) tint(x, y, hazeColor, a)
  }
  const swell = night ? hdMix(hdHex(c.sea), foam, 0.3) : hdMix(hdHex(c.sea), foam, 0.45)
  for (let k = 0; k < 14; k++) {
    const v = Math.pow((k + 0.5) / 14, 1.8)
    const y = Math.round(seaTop + v * span)
    const len = unit * (3 + v * 14)
    const gap = unit * (7 + v * 26)
    const drift = (phase * gap * (k % 2 ? 1 : -1) + hash(k + 20) * gap) % gap
    for (let x0 = -gap + drift; x0 < w; x0 += gap) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, x0 + len); x++) {
        const edge = Math.min(x - x0, x0 + len - x) / (len * 0.5)
        tint(x, y, swell, 0.55 * clamp01(edge * 2) * (0.5 + v * 0.5))
        if (v > 0.5) tint(x, y + 1, swell, 0.25 * clamp01(edge * 2))
      }
    }
  }
  if (night) {
    hd.reflection(LIGHTHOUSE_MOON.x, LIGHTHOUSE_SEA_TOP, LIGHTHOUSE_ROWS, hdMix(foam, hdHex(c.sea), 0.2), theta, 3)
  } else {
    hd.reflection(62, LIGHTHOUSE_SEA_TOP, LIGHTHOUSE_ROWS, hdMix(hdHex("#fff6d0"), hdHex(c.sea), 0.3), theta, 3)
  }
  for (let i = 0; i < 18; i++) {
    const gx = ((i * 5 + surf * 1.4) % LIGHTHOUSE_COLUMNS) * cw
    const v = hash(i + 33)
    const gy = seaTop + (0.15 + v * 0.8) * span
    const on = Math.sin(theta * 2 + i * 1.9) > -0.1
    if (on)
      hd.rect(
        gx,
        gy,
        gx + unit * (1 + v * 2),
        gy + Math.max(1, unit * 0.22),
        night ? hdMix(foam, hdHex(c.sea), 0.3) : foam,
      )
  }
  // A distant sailboat (day) or ship lights (night).
  const boatX = X(54 + Math.sin(theta) * 0.5),
    boatY = seaTop + ch * 0.7
  if (!night) {
    hd.rect(boatX - unit * 1.2, boatY, boatX + unit * 1.2, boatY + unit * 0.4, hdHex("#2c3a5e"))
    for (let y = 0; y < unit * 3; y++) {
      const u = y / (unit * 3)
      hd.rect(boatX - unit * 0.2 - u * unit * 0.1, boatY - y, boatX + unit * 0.1 + u * unit * 0.1, boatY - y + 1, chalk)
      hd.rect(
        boatX + unit * 0.3,
        boatY - y,
        boatX + unit * (0.3 + 1.1 * (1 - u)),
        boatY - y + 1,
        hdMix(chalk, hdHex("#c8d8e4"), 0.4),
      )
    }
  } else {
    glow(boatX, boatY - unit, unit * 3, hdHex("#ffd27a"), 0.6)
    hd.rect(boatX - unit, boatY, boatX + unit, boatY + unit * 0.35, hdHex("#101830"))
    hd.disk(boatX, boatY - unit * 0.6, Math.max(1, unit * 0.22), hdHex("#fff0b0"))
  }

  // --- Headland --------------------------------------------------------------------
  const cliffTopY = Y(LIGHTHOUSE_CLIFF_TOP - 0.2)
  const grass = night ? hdHex("#223a2c") : hdHex("#5c8a46")
  const grassLit = night ? hdHex("#2e4a38") : hdHex("#7aa65a")
  const edgeX = (y: number) => {
    const sy = y / ch
    return (
      (20.6 +
        Math.max(0, sy - LIGHTHOUSE_CLIFF_TOP) * 1.35 +
        Math.sin(sy * 2.1) * 0.9 +
        Math.cos(sy * 5.3) * 0.35 -
        Math.max(0, LIGHTHOUSE_CLIFF_TOP + 0.4 - sy) * 3) *
      cw
    )
  }
  const bottomY = Y(LIGHTHOUSE_SEA_TOP + 1.7)
  for (let y = Math.max(0, Math.floor(cliffTopY - ch * 0.5)); y < Math.min(h, Math.ceil(bottomY)); y++) {
    const topRamp = clamp01((y - (cliffTopY - ch * 0.5)) / (ch * 0.6))
    const reach = edgeX(y) * (0.55 + 0.45 * topRamp)
    const sy = y / ch
    for (let x = 0; x < Math.min(w, reach); x++) {
      const sx = x / cw
      const strata = Math.sin(sy * 5.2 + sx * 0.18 + Math.sin(sx * 0.6) * 0.6)
      const nearEdge = clamp01((x - (reach - cw * 5)) / (cw * 5))
      let col = hdMix(cliffLit, cliffShade, clamp01(0.2 + nearEdge * 0.7 + sx * 0.012))
      col = hdDarken(col, 0.92 + strata * 0.07)
      if (strata > 0.93) col = hdMix(col, chalk, night ? 0.05 : 0.14)
      // Cracks.
      if (Math.sin(sx * 2.1 + sy * 3.3) > 0.9) col = hdDarken(col, 0.78)
      // Grass cap with a ragged lip.
      const lip = cliffTopY + Math.sin(sx * 1.7) * ch * 0.12 + (sx > 15 ? (sx - 15) * ch * 0.4 : 0)
      if (y < lip + ch * 0.55) {
        col = y < lip + ch * 0.2 ? grassLit : grass
        if (hash(x * 0.3 + y) > 0.9) col = hdDarken(col, 0.8)
      }
      hd.set(x, y, col)
    }
  }
  // Boulders at the water line.
  for (const [bx, by, br] of [
    [20.5, LIGHTHOUSE_SEA_TOP + 0.55, 2.2],
    [24.5, LIGHTHOUSE_SEA_TOP + 0.85, 1.6],
    [27.2, LIGHTHOUSE_SEA_TOP + 1.0, 1.1],
  ] as const) {
    hd.blob(X(bx), Y(by), cw * br, ch * 0.55, cliffShade)
    hd.blob(X(bx) - cw * 0.3, Y(by) - ch * 0.12, cw * br * 0.75, ch * 0.34, hdMix(cliffLit, cliffShade, 0.3))
  }
  // Surf: foam band and spray breaking against the rock.
  for (let i = 0; i < 26; i++) {
    const bx = X(15 + (i % 14) * 0.95) + Math.sin(theta + i) * unit * 0.8
    const by = Y(LIGHTHOUSE_SEA_TOP + 0.3 + hash(i + 77) * 1.6) + Math.sin(theta * 2 + i * 1.3) * unit * 0.3
    if (bx < edgeX(by) - cw) continue
    hd.blob(bx, by, unit * (0.9 + hash(i) * 1.3), unit * 0.35, hdMix(foam, hdHex(c.sea), 0.12))
  }
  const sprayLift = Math.max(0, Math.sin(theta * 2)) * ch * 1.2
  for (let i = 0; i < 8; i++) {
    hd.disk(
      X(21 + hash(i + 5) * 5),
      Y(LIGHTHOUSE_SEA_TOP) - sprayLift * (0.4 + hash(i)),
      Math.max(1, unit * 0.18),
      foam,
    )
  }

  // --- Keeper's cottage --------------------------------------------------------------------
  const cottageL = X(3.4),
    cottageR = X(8.2)
  const cottageBase = cliffTopY + ch * 0.1
  const cottageTop = cottageBase - ch * 1.4
  const wallC = hdMix(chalk, hdHex("#d8cfc0"), 0.4)
  hd.rect(cottageL, cottageTop, cottageR, cottageBase, hdDarken(wallC, night ? 0.75 : 1))
  hd.rect(
    cottageL,
    cottageTop,
    cottageL + (cottageR - cottageL) * 0.35,
    cottageBase,
    hdDarken(wallC, night ? 0.6 : 0.9),
  )
  for (let y = 0; y < ch * 0.9; y++) {
    const u = y / (ch * 0.9)
    const mid = (cottageL + cottageR) / 2
    const half = ((cottageR - cottageL) / 2 + unit * 0.7) * (0.1 + 0.9 * u)
    hd.rect(
      mid - half,
      cottageTop - ch * 0.9 + y,
      mid + half,
      cottageTop - ch * 0.9 + y + 1,
      hdDarken(stripe, night ? 0.6 : 0.9 - 0.15 * (1 - u)),
    )
  }
  hd.rect(
    cottageR - unit * 1.5,
    cottageTop - ch * 1.2,
    cottageR - unit * 0.7,
    cottageTop - ch * 0.3,
    hdDarken(cliffShade, 1.2),
  )
  const winLit = night ? hdHex("#ffd27a") : hdHex("#6f93ab")
  hd.rect(cottageL + unit * 1.4, cottageTop + ch * 0.35, cottageL + unit * 2.4, cottageTop + ch * 0.85, winLit)
  hd.rect(cottageR - unit * 2.4, cottageTop + ch * 0.35, cottageR - unit * 1.4, cottageTop + ch * 0.85, winLit)
  if (night) glow((cottageL + cottageR) / 2, cottageTop + ch * 0.6, unit * 6, hdHex("#ffd27a"), 0.25)
  // Stone path up to the tower.
  hd.blob(X(10.2), cliffTopY + ch * 0.35, unit * 5.5, ch * 0.18, hdMix(cliffLit, chalk, 0.2))

  // --- Beam (behind the tower, in front of the sky) --------------------------------------------------------------
  const sunk = night
  if (sunk) {
    // Rotating once per cycle: the beam swings past the viewer.
    const facing = Math.cos(theta)
    const len = (0.25 + Math.abs(facing) * 0.75) * w * 0.8
    const dir = facing >= 0 ? 0 : Math.PI
    const slope = Math.sin(theta) * 0.09
    const strength = 0.2 + 0.4 * Math.abs(facing) + 0.2 * (1 - Math.abs(facing))
    cone(
      lampX,
      lampY,
      dir + (facing >= 0 ? slope : -slope),
      len,
      0.1 + 0.06 * (1 - Math.abs(facing)),
      hdHex("#fff2b8"),
      strength,
    )
    // The back beam is fainter.
    cone(lampX, lampY, dir + Math.PI + slope, len * 0.45, 0.12, hdHex("#ffe9a0"), strength * 0.25)
    glow(lampX, lampY, unit * 14 + Math.abs(Math.sin(theta)) * unit * 8, hdHex("#ffe9a0"), 0.6)
  }

  // --- Tower -------------------------------------------------------------------------------------
  const topRow = LIGHTHOUSE_TOWER.top,
    baseRow = LIGHTHOUSE_TOWER.base + 0.25
  const halfAt = (row: number) => (1.85 + ((row - topRow) / (baseRow - topRow)) * 1.05) * cw
  const lightSide = 0.72 // highlight sits right of center, where sun/moon are
  const ambient = night ? 0.6 : 1
  const towerY0 = Y(topRow),
    towerY1 = Y(baseRow)
  for (let y = Math.floor(towerY0); y < Math.ceil(towerY1); y++) {
    const row = y / ch
    const half = halfAt(row)
    const band = Math.floor((row - topRow) / 2) % 2 === 1
    const base = band ? stripe : chalk
    for (let x = Math.floor(lampX - half); x < Math.ceil(lampX + half); x++) {
      const u = (x + 0.5 - (lampX - half)) / (2 * half)
      const cyl = 0.55 + 0.45 * Math.cos((u - lightSide) * Math.PI * 0.95)
      let col = hdDarken(base, (0.55 + 0.5 * clamp01(cyl)) * ambient)
      if (night) col = hdMix(col, hdHex("#8fa6d8"), 0.1 * cyl)
      // Seam between bands.
      if (Math.abs(((row - topRow) % 2) - 0) < 0.05) col = hdDarken(col, 0.85)
      hd.set(x, y, col)
    }
  }
  // Windows and door.
  for (const wr of [6.3, 9.3, 12.4]) {
    const half = halfAt(wr)
    void half
    const wx = lampX + cw * 0.2
    hd.rect(wx - unit * 0.55, Y(wr), wx + unit * 0.55, Y(wr) + ch * 0.9, hdDarken(lampDark, 0.8))
    hd.blob(wx, Y(wr), unit * 0.55, unit * 0.55, hdDarken(lampDark, 0.8))
    if (night) hd.rect(wx - unit * 0.35, Y(wr) + ch * 0.1, wx + unit * 0.35, Y(wr) + ch * 0.75, hdHex("#ffd27a"))
  }
  hd.rect(lampX - unit * 0.8, Y(baseRow) - ch * 1.0, lampX + unit * 0.8, Y(baseRow), hdDarken(lampDark, 0.7))
  hd.blob(lampX, Y(baseRow) - ch * 1.0, unit * 0.8, unit * 0.8, hdDarken(lampDark, 0.7))
  // Plinth.
  hd.rect(
    lampX - cw * 3.25,
    Y(baseRow) - ch * 0.15,
    lampX + cw * 3.25,
    Y(baseRow) + ch * 0.25,
    hdDarken(cliffShade, 1.3),
  )
  // Gallery: platform, rail, and posts.
  const galY = Y(LIGHTHOUSE_LAMP.y + 0.55)
  const galHalf = cw * 2.9
  hd.rect(lampX - galHalf, galY, lampX + galHalf, galY + ch * 0.3, hdDarken(lampDark, night ? 0.9 : 1.1))
  hd.rect(lampX - galHalf, galY + ch * 0.3, lampX + galHalf, galY + ch * 0.4, hdDarken(lampDark, 0.6))
  const railTop = galY - ch * 0.5
  hd.rect(lampX - galHalf, railTop, lampX + galHalf, railTop + Math.max(1, unit * 0.2), hdDarken(lampDark, 1.1))
  for (let k = 0; k <= 12; k++) {
    const px = lampX - galHalf + (k / 12) * galHalf * 2
    hd.rect(px, railTop, px + 1, galY, hdDarken(lampDark, 1.0))
  }
  // Lantern room: glass, mullions, and the lamp itself.
  const roomTop = Y(LIGHTHOUSE_LAMP.y - 1.35)
  const roomHalf = cw * 1.45
  const glassCol = night ? glass : hdMix(glass, chalk, 0.2)
  for (let y = Math.floor(roomTop); y < galY; y++) {
    const v = (y - roomTop) / (galY - roomTop)
    for (let x = Math.floor(lampX - roomHalf); x < Math.ceil(lampX + roomHalf); x++) {
      const u = (x - (lampX - roomHalf)) / (roomHalf * 2)
      hd.set(
        x,
        y,
        night
          ? hdMix(hdHex("#fff2b8"), glassCol, v * 0.5 + Math.abs(u - 0.5))
          : hdMix(glassCol, hdHex("#5d8aa2"), 0.2 + v * 0.3 + Math.abs(u - 0.5) * 0.4),
      )
    }
  }
  for (const m of [0, 0.5, 1])
    hd.rect(lampX - roomHalf + m * roomHalf * 2 - 0.5, roomTop, lampX - roomHalf + m * roomHalf * 2 + 1, galY, lampDark)
  hd.rect(lampX - roomHalf, roomTop, lampX + roomHalf, roomTop + Math.max(1, unit * 0.25), lampDark)
  if (night) hd.disk(lampX, lampY, Math.max(2, unit * 0.7), [255, 255, 235])
  // Copper dome, ball, and rod.
  const domeTop = Y(LIGHTHOUSE_LAMP.y - 2.3)
  for (let y = Math.floor(domeTop); y < roomTop; y++) {
    const u = (y - domeTop) / (roomTop - domeTop)
    const half = (roomHalf + unit * 0.5) * Math.sqrt(u)
    const copper = hdMix(hdHex(night ? "#2e3a3a" : "#4f7a6a"), lampDark, 0.3)
    for (let x = Math.floor(lampX - half); x < Math.ceil(lampX + half); x++) {
      const k = (x - lampX) / (half || 1)
      hd.set(x, y, hdDarken(copper, 0.75 + 0.35 * (1 - Math.abs(k - 0.35))))
    }
  }
  hd.disk(lampX, domeTop - unit * 0.1, Math.max(1.5, unit * 0.45), lampDark)
  hd.rect(lampX - 0.5, domeTop - ch * 0.8, lampX + 1, domeTop, lampDark)
  if (night) glow(lampX, lampY, unit * 5, hdHex("#fff6c8"), 0.6)

  // --- Gulls -----------------------------------------------------------------------------------
  const gull = hdHex(c.gull)
  for (const bird of lighthouseGulls(elapsed)) {
    const flap = Math.sin(theta * 2 + bird.x) * 0.45
    const bx = X(bird.x + 0.5),
      by = Y(bird.y + 0.5)
    const r = Math.max(1, unit * 0.12)
    for (const side of [-1, 1]) {
      for (let i = 0; i <= 16; i++) {
        const u = i / 16
        hd.disk(
          bx + side * u * unit * 2.4,
          by - Math.sin(u * Math.PI * 0.8) * unit * (0.5 + flap) * (1 - u * 0.3) + u * unit * 0.4 * flap,
          r,
          gull,
        )
      }
    }
    hd.disk(bx, by, r * 1.4, gull)
  }
  return hd.pixels
}
