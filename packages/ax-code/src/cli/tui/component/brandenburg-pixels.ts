import {
  BRANDENBURG_COLORS,
  BRANDENBURG_COLUMNS,
  BRANDENBURG_GATE,
  BRANDENBURG_GROUND_TOP,
  BRANDENBURG_ROWS,
  BRANDENBURG_STARS,
  brandenburgBirds,
  brandenburgLights,
  brandenburgSkyRgb,
  brandenburgStarBright,
  brandenburgSun,
  brandenburgWalkers,
  type BrandenburgStyle,
} from "./brandenburg-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"

/**
 * Freeform HD renderer. The gate is drawn from the real proportions: a
 * floodlit sandstone body with six fluted columns, walled outer passages, a
 * frieze under a projecting cornice, a stepped attic, the quadriga with
 * Victory, colonnade wings, and the Tiergarten behind. The night opening
 * switches the floodlights on; the dawn ending lifts the sun behind the gate.
 * Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderBrandenburgPixels(
  width: number,
  height: number,
  style: BrandenburgStyle,
  elapsedMs: number,
): Buffer {
  const hd = createHdCanvas(width, height, BRANDENBURG_COLUMNS, BRANDENBURG_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "brandenburg-night"
  const c = BRANDENBURG_COLORS[style]
  const gate = BRANDENBURG_GATE
  const t = Math.max(0, elapsedMs)

  // Gate units are square pixels; the gate stays centered whatever the canvas shape.
  const unit = Math.min(hd.cw, hd.ch / 2)
  const cx = hd.w / 2
  const ground = hd.Y(BRANDENBURG_GROUND_TOP)
  const GX = (gx: number) => cx + gx * unit
  const GY = (gy: number) => ground - gy * unit
  const light = brandenburgLights(style, elapsedMs)
  /** Floodlight level applied to every stone surface. */
  const glow = 0.45 + 0.55 * light
  const stone = (color: string, boost = 1): RGB => hdDarken(hdHex(color), glow * boost)
  const sand = stone(c.sand)
  const sandHi = stone(c.sandHi)
  const sandLo = stone(c.sandLo)
  const sandDeep = stone(c.sandDeep)
  const wall = stone(c.wall)

  /** Thick segment in pixel space; `hd.stroke` takes scene cells, not pixels. */
  const line = (ax: number, ay: number, bx: number, by: number, radius: number, color: RGB) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)))
    for (let i = 0; i <= steps; i++) hd.disk(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps, radius, color)
  }
  const box = (gx0: number, gx1: number, gy0: number, gy1: number, color: RGB) =>
    hd.rect(GX(gx0), GY(gy1), GX(gx1), GY(gy0), color)
  const lerpBox = (gx0: number, gx1: number, gy0: number, gy1: number, top: RGB, bottom: RGB) => {
    const ya = Math.max(0, Math.floor(GY(gy1)))
    const yb = Math.min(hd.h, Math.ceil(GY(gy0)))
    for (let y = ya; y < yb; y++) {
      const v = (y + 0.5 - GY(gy1)) / (GY(gy0) - GY(gy1) || 1)
      hd.rect(GX(gx0), y, GX(gx1), y + 1, hdMix(top, bottom, v))
    }
  }

  // Sky: the gradient runs from the zenith to the horizon at the ground line.
  const skyAt = (y: number) => brandenburgSkyRgb(style, Math.min(1, y / (ground || 1)))
  hd.sky((v) => skyAt(v * (hd.h - 1)))
  // Floodlight bloom: the sky warms with distance from the lit stone.
  const bloomColor = hdHex(c.glow)
  const bloomStrength = (night ? 0.34 : 0.16) * light
  for (let y = 0; y < Math.min(hd.h, Math.ceil(ground)); y++) {
    const dy = Math.max(0, GY(gate.centerAtticTop) - y, y - ground) / unit
    for (let x = 0; x < hd.w; x++) {
      const dx = Math.max(0, Math.abs(x + 0.5 - cx) / unit - gate.corniceHalf)
      const alpha = bloomStrength * Math.exp(-Math.hypot(dx, y < GY(gate.atticTop) ? dy : 0) / 5.5)
      if (alpha < 0.01) continue
      const i = (y * hd.w + x) * 3
      hd.pixels[i] = Math.round(hd.pixels[i]! + (bloomColor[0] - hd.pixels[i]!) * alpha)
      hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! + (bloomColor[1] - hd.pixels[i + 1]!) * alpha)
      hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! + (bloomColor[2] - hd.pixels[i + 2]!) * alpha)
    }
  }
  if (night) {
    const star = hdHex(c.star)
    hd.stars(BRANDENBURG_STARS, star, (index) => brandenburgStarBright(elapsedMs, index))
  } else {
    // Dawn sun climbs behind the gate and shows through the central opening.
    const sunY = GY(brandenburgSun(elapsedMs))
    const core = hdHex("#fff6d4")
    hd.halo(cx, sunY, unit * 3.1, core, hdMix(core, skyAt(sunY), 0.45), skyAt(sunY))
  }
  for (const bird of brandenburgBirds(elapsedMs)) {
    const bx = hd.X(bird.x + 0.5)
    const by = hd.Y(bird.y + 0.5)
    const wing = unit * 0.9
    const lift = bird.up ? -unit * 0.5 : unit * 0.5
    const r = Math.max(1, unit * 0.12)
    line(bx - wing, by - lift, bx, by, r, hdHex(c.bird))
    line(bx, by, bx + wing, by - lift, r, hdHex(c.bird))
  }

  // Tiergarten tree line, low on the avenue so the horizon glows through the center.
  const tree = hdHex(c.tree)
  for (let i = -16; i <= 16; i++) {
    const gx = i * 3.1
    const hash = (i * 37 + 11) % 5
    const gap = Math.abs(gx) < 4.2
    const crown = gap ? 2.2 + hash * 0.15 : 5.4 + hash * 0.9
    hd.blob(GX(gx), GY(crown * 0.5), unit * 2.4, unit * crown * 0.5 + unit * 0.4, tree, hdDarken(tree, 0.8))
  }
  // Street lights and car lights down the avenue behind the gate.
  const lampRgb = hdHex(c.lamp)
  const avenue = [-3.4, -2.3, -1.2, 0, 1.2, 2.3, 3.4]
  avenue.forEach((gx, i) => {
    const color: RGB = i % 3 === 1 ? [255, 92, 78] : i % 3 === 2 ? [255, 244, 214] : lampRgb
    hd.disk(GX(gx), GY(2.4 + (i % 2) * 0.5), Math.max(1, unit * (night ? 0.2 : 0.12)), color)
  })

  // Colonnade wings flank the gate and run to the canvas edge.
  const wingEdge = hd.w / (2 * unit) + 3
  for (const side of [-1, 1]) {
    const x0 = Math.min(side * gate.wingInner, side * wingEdge)
    const x1 = Math.max(side * gate.wingInner, side * wingEdge)
    lerpBox(x0, x1, 0.5, gate.wingColumnTop, stone(c.interior, 1.5), stone(c.interior, 1.0))
    box(x0, x1, gate.wingColumnTop, gate.wingColumnTop + 0.9, sandLo)
    lerpBox(x0, x1, gate.wingColumnTop + 0.9, gate.wingColumnTop + 2.2, sandHi, sand)
    box(x0, x1, gate.wingColumnTop + 2.2, gate.wingRoofTop, stone(c.roof, 0.9 + 0.1 * light))
    for (let k = 0; ; k++) {
      const gx = side * (gate.wingInner + 1.3 + k * gate.wingColumnPitch)
      if (Math.abs(gx) > wingEdge) break
      for (let y = Math.floor(GY(gate.wingColumnTop)); y < Math.ceil(GY(0.5)); y++) {
        const v = (y - GY(gate.wingColumnTop)) / (GY(0.5) - GY(gate.wingColumnTop))
        for (let x = Math.floor(GX(gx - 0.9)); x < Math.ceil(GX(gx + 0.9)); x++) {
          const u = (x + 0.5 - GX(gx - 0.9)) / (1.8 * unit)
          hd.set(x, y, hdDarken(hdMix(sandHi, sandLo, Math.abs(u - 0.4) * 1.5), 0.85 + 0.2 * v))
        }
      }
      // Hanging lamp inside the colonnade.
      if (k % 2 === 1) hd.disk(GX(gx + gate.wingColumnPitch / 2), GY(9.2), unit * 0.35, lampRgb)
    }
  }

  // Quadriga: four horses abreast, the chariot, Victory with her staff, wreath, and the eagle.
  const bronze = stone(c.bronze, 1.05)
  const bronzeHi = stone(c.bronzeHi, 1.05)
  const bronzeLo = stone(c.bronzeLo, 1.05)
  const base = gate.centerAtticTop
  const stroke = (x0: number, y0: number, x1: number, y1: number, r: number, color: RGB) =>
    line(GX(x0), GY(y0), GX(x1), GY(y1), Math.max(0.8, r * unit), color)
  const blob = (gx: number, gy: number, rx: number, ry: number, color: RGB) =>
    hd.blob(GX(gx), GY(gy), Math.max(1, rx * unit), Math.max(1, ry * unit), color)
  box(-5.2, 5.2, base, base + 0.35, bronzeLo)
  box(-2.1, 2.1, base + 0.35, base + 2.4, bronzeLo)
  box(-2.1, 2.1, base + 2.1, base + 2.4, bronze)
  for (const hx of [-4.2, -1.7, 1.7, 4.2]) {
    const dir = Math.sign(hx)
    const turn = Math.abs(hx) > 3 ? dir * 1.0 : dir * 0.25
    // Forelegs, chest, arched neck, and head.
    stroke(hx - 0.35, base + 2.2, hx - 0.55, base + 0.5, 0.2, bronzeLo)
    stroke(hx + 0.35, base + 2.2, hx + 0.55 + dir * 0.2, base + 0.5, 0.2, bronzeLo)
    blob(hx, base + 2.9, 0.9, 1.0, bronze)
    stroke(hx, base + 3.3, hx + turn, base + 5.0, 0.5, bronze)
    stroke(hx - 0.2, base + 3.3, hx + turn - 0.2, base + 5.0, 0.1, bronzeHi)
    blob(hx + turn * 1.1, base + 5.4, 0.45, 0.62, bronze)
    stroke(hx + turn * 1.1, base + 5.9, hx + turn * 1.1 + dir * 0.1, base + 6.3, 0.14, bronzeLo)
  }
  stroke(0, base + 2.2, 0, base + 5.0, 0.75, bronze)
  stroke(-0.25, base + 2.4, -0.25, base + 4.9, 0.12, bronzeHi)
  hd.disk(GX(0), GY(base + 5.8), unit * 0.48, bronzeHi)
  stroke(0.55, base + 4.4, 0.1, base + 6.6, 0.14, bronze)
  stroke(0, base + 5.0, 0, base + 7.6, 0.14, bronzeLo)
  const wreathY = GY(base + 8.1)
  hd.disk(GX(0), wreathY, unit * 0.8, bronzeHi)
  hd.disk(GX(0), wreathY, unit * 0.6, skyAt(wreathY))
  stroke(0, base + 9.0, -1.0, base + 9.5, 0.16, bronzeHi)
  stroke(0, base + 9.0, 1.0, base + 9.5, 0.16, bronzeHi)
  hd.disk(GX(0), GY(base + 9.0), unit * 0.28, bronzeHi)

  // Attic: stepped side blocks and the relief block under the quadriga.
  lerpBox(-gate.atticHalf, gate.atticHalf, gate.atticBottom, gate.atticTop, sandHi, sand)
  box(-gate.atticHalf, gate.atticHalf, gate.atticTop - 0.35, gate.atticTop, sandHi)
  for (const side of [-1, 1]) {
    for (let step = 0; step < 6; step++) {
      const a = side * (16.2 - step * 1.7)
      const b = side * gate.centerAtticHalf
      const y0 = gate.atticBottom + step * 0.52
      box(Math.min(a, b), Math.max(a, b), y0, y0 + 0.52, sand)
      box(Math.min(a, b), Math.max(a, b), y0 + 0.4, y0 + 0.52, sandHi)
      box(Math.min(a, b), Math.max(a, b), y0, y0 + 0.08, sandLo)
    }
  }
  lerpBox(-gate.centerAtticHalf, gate.centerAtticHalf, gate.atticBottom, gate.centerAtticTop, sandHi, sand)
  box(-gate.centerAtticHalf, gate.centerAtticHalf, gate.centerAtticTop - 0.45, gate.centerAtticTop, sandHi)
  box(-gate.centerAtticHalf + 0.5, gate.centerAtticHalf - 0.5, 24.2, 26.8, sandLo)
  for (let k = 0; k < 15; k++) {
    const fx = -6.2 + k * 0.89
    hd.blob(GX(fx + 0.3), GY(25.4 + ((k * 7) % 3) * 0.3), unit * 0.3, unit * 0.55, sandHi)
    stroke(fx, 24.4, fx + 0.4, 25.4, 0.1, sandHi)
  }

  // Cornice with dentils, frieze, and architrave.
  lerpBox(-gate.corniceHalf, gate.corniceHalf, gate.corniceBottom, gate.atticBottom, sandHi, sand)
  box(-gate.corniceHalf, gate.corniceHalf, gate.atticBottom - 0.25, gate.atticBottom, sandHi)
  box(-gate.corniceHalf, gate.corniceHalf, gate.corniceBottom, gate.corniceBottom + 0.12, sandDeep)
  for (let gx = -gate.corniceHalf + 0.3; gx < gate.corniceHalf - 0.3; gx += 0.9) {
    box(gx, gx + 0.45, gate.corniceBottom + 0.12, gate.corniceBottom + 0.7, sandLo)
  }
  lerpBox(-gate.bodyHalf, gate.bodyHalf, gate.friezeBottom, gate.corniceBottom, sandLo, sand)
  const pitch = (2 * gate.bodyHalf - 0.4) / 28
  for (let k = 0; k < 28; k++) {
    const gx = -gate.bodyHalf + 0.2 + k * pitch
    box(gx, gx + pitch * 0.34, gate.friezeBottom + 0.1, gate.corniceBottom - 0.1, sandDeep)
    const fx = gx + pitch * 0.68
    hd.disk(GX(fx), GY(21.3), unit * 0.3, sandHi)
    stroke(fx - 0.25, 20.4, fx + 0.25, 21.0, 0.1, sandHi)
    stroke(fx + 0.25, 20.4, fx - 0.2, 21.0, 0.1, sandHi)
  }
  lerpBox(-gate.bodyHalf, gate.bodyHalf, gate.architraveBottom, gate.friezeBottom, sand, sandHi)
  box(-gate.bodyHalf, gate.bodyHalf, gate.architraveBottom, gate.architraveBottom + 0.12, sandDeep)

  // Soffit lit from below, then back-row column slabs glimpsed through the openings.
  const [sideA, sideB] = gate.openings
  const soffitTop = stone(c.sandLo, 1.05)
  const soffitBottom = stone(c.soffit, 1.12)
  for (const [x0, x1] of [
    [sideB[0], sideB[1]],
    [sideA[0], sideA[1]],
    [-gate.centerOpeningHalf, gate.centerOpeningHalf],
  ] as const) {
    lerpBox(x0, x1, gate.soffitBottom, gate.architraveBottom, soffitBottom, soffitTop)
  }
  for (const gx of gate.backSlabs) {
    for (let y = Math.floor(GY(gate.soffitBottom)); y < Math.ceil(GY(gate.plinthTop)); y++) {
      const v = (y - GY(gate.soffitBottom)) / (GY(gate.plinthTop) - GY(gate.soffitBottom))
      for (let x = Math.floor(GX(gx - 0.45)); x < Math.ceil(GX(gx + 0.45)); x++) {
        hd.set(x, y, hdDarken(hdMix(sand, sandLo, 0.45), 0.8 + 0.2 * v))
      }
    }
  }

  // Walled outer passages: lit wall, medallion, relief, and recessed panels.
  const [nearWall, farWall] = gate.wallHalfSpan
  for (const side of [-1, 1]) {
    const x0 = Math.min(side * nearWall, side * farWall)
    const x1 = Math.max(side * nearWall, side * farWall)
    lerpBox(x0, x1, gate.plinthTop, gate.architraveBottom, hdDarken(wall, 1.04), hdDarken(wall, 0.9))
    const mx = side * 17.4
    hd.disk(GX(mx), GY(14), unit * 1.05, sandLo)
    hd.disk(GX(mx), GY(14), unit * 0.82, hdMix(wall, sandHi, 0.4))
    hd.disk(GX(mx), GY(14), unit * 0.5, sand)
    box(mx - 1.1, mx + 1.1, 9, 11.6, sandLo)
    box(mx - 0.95, mx + 0.95, 9.15, 11.45, hdMix(wall, sandLo, 0.3))
    for (const [a, b] of [[1.2, 7.6]] as const) {
      box(x0 + 0.5, x1 - 0.5, a, b, hdMix(wall, sandLo, 0.28))
      box(x0 + 0.65, x1 - 0.65, a + 0.15, b - 0.15, hdDarken(wall, 0.97))
    }
  }

  // Six fluted columns with capitals and plinths. Light falls from the left.
  for (const gx of gate.columns) {
    const top = gate.capitalBottom
    const half = gate.shaftHalf
    const yTop = GY(top)
    const yBottom = GY(gate.plinthTop)
    for (let y = Math.max(0, Math.floor(yTop)); y < Math.min(hd.h, Math.ceil(yBottom)); y++) {
      const v = (y + 0.5 - yTop) / (yBottom - yTop || 1)
      const halfNow = half * (1 - 0.08 * (1 - v)) * unit
      const left = GX(gx) - halfNow
      for (let x = Math.floor(left); x < Math.ceil(GX(gx) + halfNow); x++) {
        const u = (x + 0.5 - left) / (2 * halfNow || 1)
        const lit = Math.max(0, 1 - Math.abs(u - 0.36) / 0.66)
        let color = lit > 0.5 ? hdMix(sand, sandHi, (lit - 0.5) * 1.6) : hdMix(sandLo, sand, lit * 2)
        if ((u * 6) % 1 < 0.1) color = hdDarken(color, 0.82)
        hd.set(x, y, hdDarken(color, 0.86 + 0.22 * v))
      }
    }
    // Capital: echinus and abacus.
    box(gx - gate.capitalHalf * 0.82, gx + gate.capitalHalf * 0.82, top, top + 0.45, hdMix(sand, sandLo, 0.3))
    lerpBox(gx - gate.capitalHalf, gx + gate.capitalHalf, top + 0.45, gate.architraveBottom, sandHi, sand)
    box(gx - gate.capitalHalf, gx + gate.capitalHalf, top + 0.45, top + 0.6, sandLo)
    // Plinth.
    lerpBox(gx - gate.capitalHalf, gx + gate.capitalHalf, 0, gate.plinthTop, sandHi, sand)
  }

  // Plaza: gradient stone with courses, a warm reflection under the gate, and floor lights.
  const groundTop = hdHex(c.ground)
  const groundBottom = hdHex(c.groundBottom)
  const warm = hdHex(c.glow)
  const ya = Math.max(0, Math.floor(ground))
  for (let y = ya; y < hd.h; y++) {
    const v = (y + 0.5 - ground) / (hd.h - ground || 1)
    const row = hdMix(groundTop, groundBottom, v)
    let i = y * hd.w * 3
    for (let x = 0; x < hd.w; x++) {
      const dx = Math.abs(x + 0.5 - cx) / (unit * 26)
      const reflect = Math.max(0, 1 - dx) * (1 - v) * 0.4 * light
      const px = hdMix(row, warm, reflect)
      hd.pixels[i++] = px[0]
      hd.pixels[i++] = px[1]
      hd.pixels[i++] = px[2]
    }
  }
  for (let k = 1; k < 7; k++) {
    const y = Math.round(ground + unit * (0.9 * k * k * 0.55 + k))
    if (y < hd.h) hd.rect(0, y, hd.w, y + 1, hdDarken(hdMix(groundTop, groundBottom, 0.5), 0.88))
  }
  // Column shadows pool on the lit plaza, and spotlights sit at each base.
  const spot = hdMix(hdHex(c.soffit), [255, 255, 255], 0.35)
  for (const gx of gate.columns) {
    hd.blob(GX(gx), ground + unit * 0.5, unit * 2.6, unit * 0.45, hdDarken(groundTop, 0.8))
    if (night) hd.disk(GX(gx), ground + unit * 0.25, Math.max(1.2, unit * 0.26), spot)
  }

  // Strollers: torso, head, and a swinging stride.
  const walkerColor = hdHex(c.walker)
  const stride = Math.sin(t / 220)
  for (const walker of brandenburgWalkers(elapsedMs)) {
    const wx = hd.X(walker.x + 0.5)
    const feet = ground + unit * (0.6 + walker.depth * 1.3)
    const h = walker.height * unit
    const leg = Math.max(1, unit * 0.15)
    line(wx, feet - h * 0.84, wx, feet - h * 0.42, Math.max(1.5, unit * 0.3), walkerColor)
    hd.disk(wx, feet - h * 0.97, Math.max(1.4, unit * 0.24), walkerColor)
    line(wx - unit * 0.1, feet - h * 0.42, wx - unit * 0.1 + stride * unit * 0.3, feet, leg, walkerColor)
    line(wx + unit * 0.1, feet - h * 0.42, wx + unit * 0.1 - stride * unit * 0.3, feet, leg, walkerColor)
  }
  return hd.pixels
}
