import { glow } from "./atmos-paint"
import { artHash, blendPixel, polyFill } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type HdCanvas, type RGB } from "./scene-hd"
import { blitGlyphText } from "./text-scene-glyphs"
import {
  RACING_CENTER_X,
  RACING_COLUMNS,
  RACING_CYCLE_MS,
  RACING_ROWS,
  RACING_STARS,
  racingExhaust,
  racingSpeed,
  racingSway,
  type RacingStyle,
} from "./racing-view-model"

/**
 * HD chase view of a mountain highway, opening by day and ending at night.
 * The text fallback keeps its own layout in racing-view-model.ts.
 * Motion comes only from `elapsedMs` and loops at 2400ms.
 */

const VANISH_X = 34
const VANISH_Y = 8.55
const BOTTOM_Y = 24
const BOTTOM_LEFT = -1
const BOTTOM_RIGHT = 50
const POWER = 0.76

function noise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return artHash(i, seed) * (1 - u) + artHash(i + 1, seed) * u
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function spanAt(sy: number) {
  const t = Math.max(0, Math.min(1, (sy - VANISH_Y) / (BOTTOM_Y - VANISH_Y)))
  const u = Math.pow(t, POWER)
  return {
    t,
    left: VANISH_X + (BOTTOM_LEFT - VANISH_X) * u,
    right: VANISH_X + (BOTTOM_RIGHT - VANISH_X) * u,
  }
}

function rightAt(t: number): number {
  return VANISH_X + (BOTTOM_RIGHT - VANISH_X) * Math.pow(t, POWER)
}

function leftHill(sx: number): number {
  const u = Math.max(0, Math.min(1, sx / VANISH_X))
  return 3.15 + u * (VANISH_Y - 3.15) + Math.sin(sx * 0.46) * 0.22 + (noise1(sx * 0.33, 2) - 0.5) * 0.28
}

function rightCliff(sx: number): number {
  const u = Math.max(0, Math.min(1, (sx - VANISH_X) / 26))
  return VANISH_Y - Math.pow(u, 0.42) * 8.15 + Math.sin(sx * 0.31) * 0.16 + (noise1(sx * 0.4, 5) - 0.5) * 0.22
}

function hillTop(sx: number): number {
  if (sx < VANISH_X - 1) return leftHill(sx)
  if (sx > VANISH_X + 4) return rightCliff(sx)
  const u = (sx - (VANISH_X - 1)) / 5
  return leftHill(sx) * (1 - u) + rightCliff(sx) * u
}

function paintRearCar(
  hd: HdCanvas,
  cx: number,
  base: number,
  scale: number,
  night: boolean,
  exhaust: boolean,
  shadow: boolean,
) {
  const { cw, ch } = hd
  const S = (x: number, y: number) => [hd.X(cx + x * scale), hd.Y(base + y * scale)] as const
  const body = hdHex(night ? "#16181c" : "#121418")
  const skyTint = hdHex("#5aa6dc")
  const rimTint = hdHex("#5c78a0")
  const spillTint = hdHex("#ff5030")
  const gloss = hdHex("#e8eef6")
  const valance = hdHex("#0b0c0f")
  const valanceFace = hdMix(hdHex("#0b0c0f"), hdHex("#2a2d33"), 0.18)
  const finGap = hdHex("#3a3e46")
  const plateInk = hdHex("#17191d")
  const plateFace = hdHex(night ? "#7c8087" : "#c8ccd2")
  const plateBar = hdHex(night ? "#4a4e54" : "#777b81")
  const lampHousing = hdHex("#3a0f0e")
  const lampBand = hdHex("#d01616")
  const lampCore = hdHex("#ff9d8e")
  const mirrorInk = hdHex("#101216")
  const gauss = (d: number, w: number) => Math.exp(-d * d * w)
  // GT coupe silhouette: narrow cabin, hips flaring to 8.4 at y = -3.4,
  // tucking back into the 7.4-wide bumper valance.
  const widthKeys: readonly (readonly [number, number])[] = [
    [-7.4, 3.2],
    [-7.05, 3.35],
    [-6.5, 4.5],
    [-5.9, 5.7],
    [-5.6, 6.4],
    [-5.0, 6.9],
    [-4.5, 7.5],
    [-3.9, 8.1],
    [-3.4, 8.4],
    [-2.6, 8.3],
    [-2.0, 8.25],
    [-1.4, 8.22],
    [-0.9, 8.2],
    [-0.78, 8.1],
  ]
  const halfWidth = (y: number): number => {
    if (y <= widthKeys[0]![0]) return widthKeys[0]![1]
    for (let i = 0; i + 1 < widthKeys.length; i++) {
      const a = widthKeys[i]!
      const b = widthKeys[i + 1]!
      if (y <= b[0]) {
        const s = 0.5 - 0.5 * Math.cos((Math.PI * (y - a[0])) / (b[0] - a[0]))
        return a[1] + (b[1] - a[1]) * s
      }
    }
    return widthKeys[widthKeys.length - 1]![1]
  }
  const hipL = hd.X(cx - 8.4 * scale)
  const hipR = hd.X(cx + 8.4 * scale)
  const topPx = hd.Y(base - 7.4 * scale)
  const botPx = hd.Y(base - 0.72 * scale)
  const yCar = (y: number) => -7.4 + ((y + 0.5 - topPx) / (botPx - topPx || 1)) * 6.68
  // Sheet-metal shading: cylinder falloff, shoulder-crease specular, deck
  // reflections, panel seams, and occlusion in the arches and under the bumper.
  const shade = (x: number, y: number): RGB => {
    const u = Math.max(0, Math.min(1, (x + 0.5 - hipL) / (hipR - hipL || 1)))
    const yc = yCar(y)
    const ax = Math.abs((u - 0.5) * 16.8)
    let color = hdDarken(body, 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(Math.PI * u)))
    if (night) {
      // Cool rim light on the edges, warm tail-light spill on the flanks.
      const rim = Math.max(0, 1 - Math.min(u, 1 - u) / 0.09)
      color = hdMix(color, rimTint, rim * 0.32)
      const lat = Math.max(0, (0.3 - u) / 0.3, (u - 0.7) / 0.3)
      color = hdMix(color, spillTint, gauss(yc + 4, 260) * Math.min(1, lat * 2) * 0.16)
      if (yc > -7.4 && yc < -7.28) color = hdMix(color, rimTint, 0.3)
    } else {
      // Sun from the upper-left: a crisp shoulder-crease specular plus gloss.
      const roll = 0.35 + 0.65 * Math.sin(Math.PI * u)
      color = hdMix(color, gloss, gauss(yc + 5.05, 900) * (1 - 0.72 * u) * roll * 0.42)
      color = hdMix(color, gloss, gauss(yc + 5.5, 220) * (1 - 0.72 * u) * roll * 0.2)
      if (yc > -7.4 && yc < -7.31 && u < 0.58) color = hdMix(color, gloss, 0.45 * roll)
    }
    // Trunk deck: a sloped surface catching sky by day, lamp wash at night.
    if (yc > -5.62 && yc < -4.82) {
      const t = (yc + 5.62) / 0.8
      color = hdDarken(color, 1.28 + 0.22 * (1 - t))
      color = hdMix(color, night ? spillTint : skyTint, night ? 0.04 + 0.12 * (1 - t) : 0.1 + 0.3 * (1 - t))
    }
    // Upper rear fascia: a soft sky reflection that fades out by the shoulder
    // crease, so the flanks keep their dark mass under the deck highlights.
    color = hdMix(color, night ? spillTint : skyTint, gauss(yc + 4.5, 3.2) * (night ? 0.05 : 0.1))
    // Panel seams: deck shutline, bumper split, and trunk-corner joints.
    if (Math.abs(yc + 4.82) < 0.05) color = hdDarken(color, 0.68)
    if (Math.abs(yc + 2.42) < 0.045) color = hdDarken(color, 0.72)
    if (yc > -4.7 && yc < -2.4 && Math.abs(ax - 5.6) < 0.07) color = hdDarken(color, 0.78)
    // Haunch swell: a soft brightening just below the shoulder crease, so the
    // rear fender reads as a rolled sheet-metal surface. The crisp 1px crease
    // stroke is laid over the lamps later, on the visible sheet metal only.
    if (ax > 4.6 && ax < 8.0) {
      const inner = Math.min(1, (ax - 4.6) / 1.1)
      color = hdMix(color, night ? rimTint : gloss, gauss(yc + 3.35, 34) * inner * (night ? 0.08 : 0.1))
    }
    // Occlusion: wheel-arch gaps and the recess under the bumper.
    if (yc > -3.9) {
      const arch = 1 - Math.pow((ax - 6.8) / 2.0, 2) - Math.pow(yc + 2.3, 2)
      if (arch > 0) color = hdDarken(color, 1 - 0.34 * arch)
    }
    if (yc > -1.15) color = hdDarken(color, 1 - 0.2 * Math.min(1, (yc + 1.15) / 0.55))
    return color
  }
  // Grounding: one soft contact shadow, wider than the tyres, with a very
  // dark core pressed under them, plus a red lamp pool on the asphalt at night.
  if (shadow) {
    const scx = hd.X(cx + 0.25 * scale)
    const scy = hd.Y(base - 0.35 * scale)
    const srx = cw * 10.5 * scale
    const sry = ch * 0.95 * scale
    const xa = Math.max(0, Math.floor(scx - srx))
    const xb = Math.min(hd.w - 1, Math.ceil(scx + srx))
    const ya = Math.max(0, Math.floor(scy - sry))
    const yb = Math.min(hd.h - 1, Math.ceil(scy + sry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = (x + 0.5 - scx) / srx
        const dy = (y + 0.5 - scy) / sry
        const d = Math.hypot(dx, dy)
        if (d >= 1) continue
        blendPixel(hd, x, y, [0, 0, 0], Math.pow(1 - d, 1.6) * (night ? 0.52 : 0.66))
      }
    }
    if (night) glow(hd, hd.X(cx + 0.2 * scale), hd.Y(base + 0.55 * scale), cw * 8.2 * scale, spillTint, 0.14, 0.14)
  }
  // Rear tyres: upright rounded rectangles tucked under the flares, with a
  // faint tread band and a lighter outer sidewall. No rims show from behind.
  for (const side of [-1, 1]) {
    const x0 = hd.X(cx + side * 6.2 * scale)
    const x1 = hd.X(cx + side * 8.5 * scale)
    const y0 = hd.Y(base - 2.5 * scale)
    const y1 = hd.Y(base)
    const xa = Math.max(0, Math.floor(Math.min(x0, x1)))
    const xb = Math.min(hd.w - 1, Math.ceil(Math.max(x0, x1)))
    const ya = Math.max(0, Math.floor(y0))
    const yb = Math.min(hd.h - 1, Math.ceil(y1))
    const wpx = Math.abs(x1 - x0)
    const hpx = y1 - y0
    const rr = Math.max(1, Math.min(wpx, hpx) * 0.18)
    const mx = (x0 + x1) / 2
    const my = (y0 + y1) / 2
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const qx = Math.abs(px - mx) - wpx / 2 + rr
        const qy = Math.abs(py - my) - hpx / 2 + rr
        if (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) > rr) continue
        const uo = side === 1 ? (px - Math.min(x0, x1)) / (wpx || 1) : 1 - (px - Math.min(x0, x1)) / (wpx || 1)
        let color: RGB = [10, 11, 13]
        if (Math.abs(uo - 0.5) < 0.06) color = [36, 38, 43]
        // Faint tread notches keep the casing from reading as flat rubber.
        const tq = py - my
        if (Math.abs(tq) > 0.18 && Math.floor(tq / Math.max(1, hpx * 0.14)) % 2 === 0) {
          color = hdMix(color, [26, 28, 32], 0.6)
        }
        if (uo > 0.84) color = hdMix(color, [46, 50, 56], ((uo - 0.84) / 0.16) * 0.7)
        hd.set(x, y, color) // @scan-suppress lifecycle_scan - Bounded writes into the current pixel frame, not a Map.
      }
    }
  }
  const outline: (readonly [number, number])[] = [S(-3.2, -7.4), S(3.2, -7.4)]
  const railY: number[] = []
  for (let i = 1; i <= 14; i++) railY.push(-7.05 + (6.33 * i) / 14)
  for (const y of railY) outline.push(S(halfWidth(y), y))
  outline.push(S(7.55, -0.74), S(0, -0.8), S(-7.55, -0.74))
  for (let i = railY.length - 1; i >= 0; i--) outline.push(S(-halfWidth(railY[i]!), railY[i]!))
  polyFill(hd, outline, shade)
  // Matte bumper valance with a six-fin diffuser and twin round chrome tips.
  polyFill(hd, [S(-7.35, -2.4), S(7.35, -2.4), S(7.3, -0.74), S(-7.3, -0.74)], (_x, y) => {
    const yc = yCar(y)
    // Matte grey-black face, a split line above the diffuser, and a contact
    // gap where the valance meets the road.
    if (yc > -1.62 && yc < -1.42) return hdHex("#050506")
    if (yc > -1.0) return hdDarken(valance, 0.62)
    return hdDarken(valanceFace, yc > -1.2 ? 0.86 : 1)
  })
  for (let k = -2.5; k <= 2.5; k++) {
    polyFill(hd, [S(k - 0.1, -1.46), S(k + 0.1, -1.46), S(k + 0.08, -0.72), S(k - 0.08, -0.72)], () => finGap)
    polyFill(hd, [S(k - 0.05, -1.46), S(k + 0.05, -1.46), S(k + 0.04, -0.72), S(k - 0.04, -0.72)], () =>
      hdDarken(valanceFace, 0.86),
    )
  }
  for (const side of [-1, 1]) {
    const ex = hd.X(cx + side * 2.6 * scale)
    const ey = hd.Y(base - 1.3 * scale)
    // Chrome ring: the tip's outer lip catches the light, the bore stays black.
    hd.disk(ex, ey, Math.max(1, cw * 0.46 * scale), [184, 188, 196])
    hd.disk(ex, ey, Math.max(1, cw * 0.36 * scale), [26, 28, 30])
    hd.disk(ex, ey, Math.max(0.6, cw * 0.28 * scale), [12, 12, 14])
    // Only a small ember sits inside the bore; the ring itself never fills solid.
    if (exhaust) {
      hd.disk(ex, ey, Math.max(0.6, cw * 0.2 * scale), hdHex("#ff9a3c"))
      glow(hd, ex, ey, Math.max(2, cw * 1.1 * scale), hdHex("#ff8a30"), 0.3, 0.6)
    }
  }
  // Ducktail lip on the deck's rear edge, then the small chrome badge above
  // the lamp band. Both stay clear of the dark centre sample zone.
  polyFill(hd, [S(-7.42, -4.88), S(7.42, -4.88), S(7.34, -4.68), S(-7.34, -4.68)], (_x, y) => {
    const t = (y + 0.5 - hd.Y(base - 4.88 * scale)) / (hd.Y(base - 4.68 * scale) - hd.Y(base - 4.88 * scale) || 1)
    return hdMix(hdDarken(body, night ? 1.05 : 1.32), night ? spillTint : skyTint, (1 - t) * (night ? 0.1 : 0.3))
  })
  polyFill(hd, [S(-7.34, -4.68), S(7.34, -4.68), S(7.34, -4.6), S(-7.34, -4.6)], () => hdDarken(body, 0.55))
  polyFill(hd, [S(-7.34, -4.6), S(7.34, -4.6), S(7.34, -4.56), S(-7.34, -4.56)], () =>
    hdMix(hdDarken(body, 1.1), night ? rimTint : gloss, night ? 0.16 : 0.24),
  )
  hd.disk(hd.X(cx), hd.Y(base - 4.72 * scale), Math.max(0.8, cw * 0.2 * scale), [150, 156, 164])
  // Licence plate recess: a dark frame, a light face, and two text bars. The
  // whole plate stays below y = -2.9 so the dark centre sample band is intact.
  polyFill(hd, [S(-2.2, -2.9), S(2.2, -2.9), S(2.2, -2.15), S(-2.2, -2.15)], () => plateInk)
  polyFill(hd, [S(-2.1, -2.84), S(2.1, -2.84), S(2.1, -2.21), S(-2.1, -2.21)], () => plateFace)
  polyFill(hd, [S(-1.42, -2.72), S(1.42, -2.72), S(1.42, -2.6), S(-1.42, -2.6)], () => plateBar)
  polyFill(hd, [S(-1.42, -2.44), S(1.42, -2.44), S(1.42, -2.32), S(-1.42, -2.32)], () => plateBar)
  // Shoulder crease: a crisp 1px specular running along the top of each rear
  // haunch, from the window edge out to the fender crown. Drawn before the
  // lamps so they overpaint its outer ends, and clipped to the shell so it
  // never floats past the fender crown or the lamp housing.
  const hipSpan = hipR - hipL || 1
  for (const side of [-1, 1]) {
    polyFill(hd, [S(side * 4.6, -4.3), S(side * 8.0, -4.3), S(side * 8.0, -4.2), S(side * 4.6, -4.2)], (x) => {
      const u = (x + 0.5 - hipL) / hipSpan
      const ax = Math.abs((u - 0.5) * 16.8)
      if (ax < 4.6 || ax > 8.0 || ax > halfWidth(-4.25)) return null
      const fade = 1 - Math.max(0, (ax - 7.4) / 0.6)
      return hdMix(body, night ? rimTint : gloss, (night ? 0.4 : 0.58) * fade)
    })
  }
  // Wrap-around GT lamps following the hip curve: dark red housing, bright
  // band, hot white-pink core. Thin at the centre, taller at the outer ends.
  const lampBody = (
    side: number,
    innerX: number,
    yTIn: number,
    yTOut: number,
    yBIn: number,
    yBOut: number,
    inset: number,
    color: RGB,
  ) => {
    const yM = (yTOut + yBOut) / 2
    polyFill(
      hd,
      [
        S(side * innerX, yTIn),
        S(side * (halfWidth(yTOut) - inset), yTOut),
        S(side * (halfWidth(yM) - inset), yM),
        S(side * (halfWidth(yBOut) - inset), yBOut),
        S(side * innerX, yBIn),
      ],
      () => color,
    )
  }
  for (const side of [-1, 1]) {
    lampBody(side, 1.7, -4.0, -4.46, -3.6, -3.52, 0.42, lampHousing)
    lampBody(side, 1.84, -3.92, -4.36, -3.68, -3.6, 0.58, lampBand)
    lampBody(side, 1.95, -3.85, -4.24, -3.73, -4.1, 0.68, lampCore)
  }
  polyFill(hd, [S(-1.72, -4.24), S(1.72, -4.24), S(1.72, -4.12), S(-1.72, -4.12)], () =>
    hdMix(lampBand, lampCore, 0.25),
  )
  // Rear window: tinted trapezoid glass, vertical gradient, a diagonal
  // reflection streak, and a thin lighter top edge.
  const glassTop = night ? hdHex("#0a0f16") : hdHex("#131b24")
  const glassBot = night ? hdHex("#141d28") : hdHex("#2e4252")
  const gTopPx = hd.Y(base - 7.02 * scale)
  const gBotPx = hd.Y(base - 5.62 * scale)
  const streakGap = Math.max(10, cw * scale * 3.2)
  polyFill(hd, [S(-3.0, -7.02), S(3.0, -7.02), S(3.9, -5.62), S(-3.9, -5.62)], (x, y) => {
    const t = Math.max(0, Math.min(1, (y + 0.5 - gTopPx) / (gBotPx - gTopPx || 1)))
    if (t < 0.06) return hdMix(hdMix(glassTop, glassBot, t), [130, 150, 170], night ? 0.18 : 0.35)
    const color = hdMix(glassTop, glassBot, t)
    const s = (((x - y * 1.35) % streakGap) + streakGap) % streakGap
    if (s < streakGap * 0.15) return hdMix(color, [208, 224, 236], night ? 0.06 : 0.13)
    if (s > streakGap * 0.55 && s < streakGap * 0.65) return hdMix(color, [208, 224, 236], night ? 0.04 : 0.08)
    return color
  })
  // C-pillars frame the tinted glass and connect the cabin to the rear deck.
  for (const side of [-1, 1]) {
    // C-pillar quarter: clearly lighter than the glass so the cabin silhouette
    // reads against the window, brightest on the sun side by day.
    polyFill(hd, [S(side * 3.0, -6.82), S(side * 3.86, -6.34), S(side * 3.92, -5.72), S(side * 3.0, -5.64)], () =>
      hdMix(hdDarken(body, night ? 1.5 : 3.0), night ? rimTint : gloss, night ? 0.12 : side < 0 ? 0.22 : 0.12),
    )
  }
  polyFill(hd, [S(-6.4, -5.88), S(6.4, -5.88), S(6.4, -5.62), S(-6.4, -5.62)], () => hdDarken(body, 0.85))
  polyFill(hd, [S(-6.35, -5.88), S(6.35, -5.88), S(6.35, -5.79), S(-6.35, -5.79)], () =>
    hdHex(night ? "#3c424a" : "#67717d"),
  )
  for (const side of [-1, 1]) {
    polyFill(hd, [S(side * 6.4, -6.32), S(side * 6.58, -6.2), S(side * 6.58, -5.55), S(side * 6.4, -5.55)], () =>
      hdDarken(body, 0.75),
    )
  }
  // Door mirrors on the C-pillar edges with a faint rim light.
  for (const side of [-1, 1]) {
    polyFill(
      hd,
      [S(side * 5.15, -6.08), S(side * 5.92, -6.2), S(side * 5.98, -5.76), S(side * 5.35, -5.7)],
      () => mirrorInk,
    )
    polyFill(hd, [S(side * 5.2, -6.14), S(side * 5.86, -6.22), S(side * 5.88, -6.11), S(side * 5.26, -6.04)], () =>
      hdMix(mirrorInk, rimTint, night ? 0.4 : 0.3),
    )
  }
  const glowR = cw * (night ? 2.3 : 1.0) * scale
  glow(hd, hd.X(cx - 4.6 * scale), hd.Y(base - 4.0 * scale), glowR, lampBand, night ? 0.5 : 0.16, 0.5)
  glow(hd, hd.X(cx + 4.6 * scale), hd.Y(base - 4.0 * scale), glowR, lampBand, night ? 0.5 : 0.16, 0.5)
}

/** Concrete barrier along the right edge. One filled strip, so the face stays smooth. */
function paintBarrier(hd: HdCanvas, night: boolean, haze: RGB) {
  const top: (readonly [number, number])[] = []
  const bottom: (readonly [number, number])[] = []
  const capPath: (readonly [number, number])[] = []
  const steps = 22
  for (let i = 0; i <= steps; i++) {
    const t = 0.08 + (i / steps) * 0.92
    const gy = VANISH_Y + t * (BOTTOM_Y - VANISH_Y)
    const inner = rightAt(t) + 0.2
    const outer = inner + 0.3 + t * t * 14
    const lift = 0.12 + t * 2.6
    bottom.push([hd.X(inner), hd.Y(gy)])
    top.push([hd.X(outer), hd.Y(gy - lift)])
    capPath.push([outer, gy - lift])
  }
  const cap = hdHex(night ? "#6a727a" : "#e7e2d6")
  const concrete = hdHex(night ? "#6f757b" : "#e2ddd0")
  const teal = hdHex(night ? "#0f2f38" : "#2b6674")
  const stripeInk = hdHex(night ? "#3f6a78" : "#8fb7c2")
  const seamInk = hdHex(night ? "#14181c" : "#262b30")
  const corner: readonly [number, number] = [hd.X(RACING_COLUMNS + 4), hd.Y(BOTTOM_Y)]
  // Per-column cap and base rows: the cap follows the painted top edge, and
  // the base rides the perspective curve (extrapolated past the frame near
  // the camera), so the concrete/teal split stays a constant fraction of the
  // wall face. capEndX/capEndY are the t=1 cap endpoint.
  const capEndX = 64.5
  const capEndY = BOTTOM_Y - 2.72
  const capRows = new Float32Array(hd.w)
  const baseRows = new Float32Array(hd.w)
  for (let x = 0; x < hd.w; x++) {
    const sx = (x + 0.5) / hd.cw
    // Clamping the base to BOTTOM_Y past BOTTOM_RIGHT kinked the teal band
    // into a channel hugging the canvas bottom; extrapolation keeps the
    // strip on the same perspective as the cap all the way to the edge.
    const tb = Math.max(0.08, Math.pow(Math.max(0, (sx - VANISH_X - 0.2) / (BOTTOM_RIGHT - VANISH_X)), 1 / POWER))
    baseRows[x] = VANISH_Y + tb * (BOTTOM_Y - VANISH_Y)
    if (sx <= capEndX) {
      // Bisect the cap depth from outer(t) = 34.5 + 16*t^POWER + 14*t^2.
      let lo = 0.08
      let hi = 1
      const target = sx - 34.5
      for (let it = 0; it < 20; it++) {
        const mid = (lo + hi) / 2
        if (16 * Math.pow(mid, POWER) + 14 * mid * mid < target) lo = mid
        else hi = mid
      }
      const t = (lo + hi) / 2
      capRows[x] = VANISH_Y + t * (BOTTOM_Y - VANISH_Y) - (0.12 + t * 2.6)
    } else {
      capRows[x] = capEndY + ((sx - capEndX) * (BOTTOM_Y - capEndY)) / (RACING_COLUMNS + 4 - capEndX)
    }
  }
  polyFill(hd, [...top, corner, ...bottom.reverse()], (x, y) => {
    const sx = (x + 0.5) / hd.cw
    const sy = (y + 0.5) / hd.ch
    const u = Math.max(0, Math.min(1, (sx - VANISH_X) / (RACING_COLUMNS + 4 - VANISH_X)))
    const t = Math.pow(u, 1 / POWER)
    // Upper 55% of the face is pale concrete and the base is dark teal with
    // a faint reflective stripe, split by a crisp one-pixel seam; lighter
    // vertical joints recur every ninth of the strip depth.
    const faceH = Math.max(0.1, baseRows[x]! - capRows[x]!)
    const v = Math.max(0, Math.min(1, (baseRows[x]! - sy) / faceH))
    let face: RGB = v > 0.45 ? concrete : teal
    if (v <= 0.45 && v > 0.26 && v < 0.38) face = hdMix(teal, stripeInk, 0.5)
    if (Math.abs(v - 0.45) < 0.55 / Math.max(1, faceH * hd.ch)) face = seamInk
    // Haze fades the far end only; up close the face colours read pure.
    return hdMix(haze, fract(t * 9) < 0.05 ? hdDarken(face, 1.14) : face, 0.55 + Math.pow(t, 0.6) * 0.45)
  })
  for (let i = 1; i < capPath.length; i++) {
    const a = capPath[i - 1]!
    const b = capPath[i]!
    const t = i / capPath.length
    hd.stroke(a[0], a[1], b[0], b[1], Math.max(0.8, hd.cw * (0.04 + t * 0.08)), cap)
  }
}

function label(hd: HdCanvas, x: number, y: number, cellW: number, cellH: number, text: string, color: RGB) {
  blitGlyphText(hd.pixels, hd.w, hd.h, x + 1, y + 1, cellW, cellH, text, [0, 0, 0])
  blitGlyphText(hd.pixels, hd.w, hd.h, x, y, cellW, cellH, text, color)
}

/**
 * Freeform HD mountain highway. Day is a cloudy chase view behind a black
 * sports car; night keeps that camera and lights the lamps. ASCII is separate.
 */
export function renderRacingPixels(width: number, height: number, style: RacingStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, RACING_COLUMNS, RACING_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "racing-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % RACING_CYCLE_MS) / RACING_CYCLE_MS
  const { w, h, cw, ch } = hd
  const px = hd.pixels
  const put = (x: number, y: number, color: RGB) => {
    const i = (y * w + x) * 3
    px[i] = color[0]
    px[i + 1] = color[1]
    px[i + 2] = color[2]
  }
  const skyTop = hdHex(night ? "#070d1c" : "#5aa6dc")
  const skyMid = hdHex(night ? "#1a1830" : "#b7d6ee")
  const skyLow = hdHex(night ? "#4a342c" : "#e4eef4")
  const grassLit = hdHex(night ? "#24341c" : "#7d9a48")
  const grassDark = hdHex(night ? "#152012" : "#3f5c28")
  const grassSun = hdHex("#9fb858")
  const hillShrub = hdHex(night ? "#131f0e" : "#2e4a22")
  const rockLit = hdHex(night ? "#6b675e" : "#b9b2a4")
  const rockMid = hdHex(night ? "#4a463f" : "#8a8378")
  const rockDark = hdHex(night ? "#2b2925" : "#4e4a44")
  const haze = hdHex(night ? "#2a3344" : "#d5e0e8")

  hd.sky((t) => {
    if (t < 0.42) return hdMix(skyTop, skyMid, t / 0.42)
    return hdMix(skyMid, skyLow, (t - 0.42) / 0.58)
  })
  if (night) {
    hd.stars(RACING_STARS, hdHex("#e8eef8"), (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    const moonX = hd.X(16)
    const moonY = hd.Y(1.7)
    const moonR = Math.max(3, Math.min(cw, ch) * 0.85)
    glow(hd, moonX, moonY, moonR * 5, hdHex("#c5d4f0"), 0.28, 1)
    hd.disk(moonX, moonY, moonR, hdHex("#f4f7ff"))
    hd.disk(moonX - moonR * 0.28, moonY - moonR * 0.16, moonR * 0.28, hdHex("#d5def0"))
  } else {
    glow(hd, hd.X(14), hd.Y(2.4), cw * 16, hdHex("#fff6df"), 0.42, 0.75)
    // Eight soft clouds, each three overlapping ellipses. High clouds are
    // bigger, brighter, and drift further; low ones near the horizon are
    // smaller, hazier, and barely move, which reads as depth.
    const cloudWhite: RGB = [248, 250, 252]
    const drift = Math.sin(phase * Math.PI * 2)
    const clouds = [
      { x: 7, y: 1.5, rx: 5.8, ry: 0.95, a: 0.9, k: 2.6 },
      { x: 20, y: 1.1, rx: 4.8, ry: 0.8, a: 0.85, k: 2.4 },
      { x: 31.5, y: 1.6, rx: 4.2, ry: 0.7, a: 0.82, k: 2.5 },
      { x: 42.5, y: 1.9, rx: 3.2, ry: 0.55, a: 0.72, k: 2 },
      { x: 13, y: 2.9, rx: 3.8, ry: 0.6, a: 0.68, k: 1.9 },
      { x: 26, y: 3.5, rx: 3, ry: 0.5, a: 0.55, k: 1.6 },
      { x: 36, y: 4, rx: 2.5, ry: 0.42, a: 0.48, k: 1.4 },
      { x: 4.5, y: 3.9, rx: 2.3, ry: 0.4, a: 0.5, k: 1.2 },
    ]
    for (let ci = 0; ci < clouds.length; ci++) {
      const cloud = clouds[ci]!
      const tint = hdMix(cloudWhite, haze, Math.max(0, 0.78 - cloud.a))
      const flip = ci % 2 === 0 ? 1 : -1
      for (const lobe of [
        { dx: 0, dy: 0, fx: 1, fy: 1 },
        { dx: -0.55 * flip, dy: 0.3, fx: 0.62, fy: 0.75 },
        { dx: 0.58 * flip, dy: 0.18, fx: 0.52, fy: 0.66 },
      ]) {
        const cx = hd.X(cloud.x + lobe.dx * cloud.rx) + drift * cw * cloud.k
        const cy = hd.Y(cloud.y + lobe.dy * cloud.ry)
        const rx = cw * cloud.rx * lobe.fx
        const ry = ch * cloud.ry * lobe.fy
        const xa = Math.max(0, Math.floor(cx - rx))
        const xb = Math.min(w - 1, Math.ceil(cx + rx))
        const ya = Math.max(0, Math.floor(cy - ry))
        const yb = Math.min(h - 1, Math.ceil(cy + ry))
        for (let y = ya; y <= yb; y++) {
          for (let x = xa; x <= xb; x++) {
            const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
            if (d >= 1) continue
            blendPixel(hd, x, y, tint, (1 - d) * cloud.a)
          }
        }
      }
    }
  }

  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) / ch
    const span = sy >= VANISH_Y ? spanAt(sy) : undefined
    const mark = span ? fract(1 / Math.max(0.2, span.t) - phase * 4.2) : 0
    const dashOn = mark < 0.4 && (span?.t ?? 0) > 0.08
    // Scrolling sunlit/shadow bands across the asphalt, keyed to road depth.
    const band = span ? 1 + 0.06 * Math.sin(2 * Math.PI * ((1 / Math.max(0.2, span.t)) * 1.3 - phase * 4)) : 1
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      if (span && sx >= span.left && sx <= span.right) {
        const width = span.right - span.left || 1
        const u = (sx - span.left) / width
        const t = span.t
        // Asphalt darkens toward the camera under the scrolling sun/shadow
        // bands; the haze mix keeps the far road washed out.
        let color = hdMix(
          haze,
          hdMix(hdHex(night ? "#6a7280" : "#b7c0c8"), hdHex(night ? "#23272e" : "#3a3d42"), Math.pow(t, 0.5)),
          Math.pow(t, 0.45),
        )
        color = hdDarken(color, band)
        color = hdDarken(color, 0.9 + (1 - Math.abs(u - 0.55) * 1.3) * 0.12)
        // Faint tyre tracks at u 0.3 and 0.7, fading with distance.
        const track = Math.max(0, 1 - Math.abs(Math.abs(u - 0.5) - 0.2) / 0.03) * t
        color = hdDarken(color, 1 - 0.15 * track)
        color = hdDarken(color, 0.94 + artHash(x >> 1, y >> 2) * 0.08)
        // Sparse patch and crack blotches on the worn lane.
        const patch = artHash(x >> 2, y >> 2)
        if (patch > 0.995) color = hdDarken(color, patch > 0.9975 ? 1.13 : 0.87)
        const edge = 0.012 + t * 0.006
        const dashW = 0.02 + t * 0.022
        if (u < edge) color = hdHex(night ? "#c8c2a8" : "#f3f1e8")
        else if (u > 1 - edge) color = hdHex(night ? "#b8963a" : "#e2c14a")
        else if (dashOn && Math.abs(u - 0.5) < dashW) color = hdHex("#f4f2ea")
        put(x, y, color)
        continue
      }
      const top = hillTop(sx)
      if (sy < top) continue
      const down = Math.max(0, Math.min(1, (sy - top) / 7))
      const grain = noise1(sx * 1.3 + sy * 0.85, sx < VANISH_X ? 3 : 8)
      let color: RGB
      if (sx < VANISH_X + 1) {
        color = hdMix(grassLit, grassDark, down * 0.7 + grain * 0.3)
        // Grass reads as a surface: mow-like stripes track the slope, sun
        // patches catch the light, and a shrub fringe with a noisy lower
        // edge hugs the crest line.
        color = hdDarken(color, 0.93 + noise1(sx * 1.9 - sy * 1.1, 61) * 0.14)
        if (!night) {
          const lit = noise1(sx * 0.62 + sy * 0.34, 62)
          if (lit > 0.6) color = hdMix(color, grassSun, 0.25 * Math.min(1, (lit - 0.6) * 5))
        }
        const fringe = top + 0.5 + (noise1(sx * 3.1, 63) - 0.5) * 0.4
        if (sy < fringe) color = hdMix(color, hillShrub, 0.85)
      } else {
        // Warm grey-brown cliff: sloped strata, two-octave noise facets, gated
        // vertical crevices, ridge scree, and shrubs hugging the barrier cap.
        const facet = grain * 0.6 + noise1(sx * 2.3 + sy * 0.95, 22) * 0.4
        color = facet > 0.5 ? hdMix(rockMid, rockLit, (facet - 0.5) * 2) : hdMix(rockDark, rockMid, facet * 2)
        color = hdMix(color, rockDark, down * 0.5)
        const strata = Math.floor((sy + sx * 0.35) * 1.25) % 3
        color = hdDarken(color, strata === 0 ? 1.05 : strata === 1 ? 1 : 0.95)
        if (noise1(sx * 3.4, 31) > 0.85 && noise1(sx * 0.5 + sy * 0.35, 32) > 0.52) {
          color = hdDarken(color, 0.72)
        }
        const ridge = Math.max(0, 1 - (sy - top) / 1.35)
        color = hdMix(color, rockLit, ridge * (night ? 0.18 : 0.5))
        if (ridge > 0.25 && noise1(sx * 4.3, 41) > 0.87) {
          color = hdMix(color, hdHex(night ? "#8c887e" : "#eee9de"), ridge * 0.8)
        }
        // Shrub band: edgeAt is a quadratic fit of the barrier cap line
        // (paintBarrier's outer curve, within ~0.1 row) so the bushes sit in
        // the lowest rock rows just above the concrete wall.
        if (sy > 8.5 && sy < 23.4) {
          const u = sx - 37.3
          const edgeAt = sx > 64.5 ? 21.28 + (sx - 64.5) * 0.175 : Math.max(9.46, 9.71 + u * (0.5583 - 0.004886 * u))
          if (sy > edgeAt - 0.85 && sy < edgeAt - 0.05 && noise1(sx * 2.2, 51) > 0.45 && noise1(sx * 5.4, 52) > 0.5) {
            color = hdMix(color, hdHex(night ? "#1f331a" : "#2f4a26"), 0.85)
          }
        }
      }
      if (night) color = hdDarken(color, 0.72)
      const fade = Math.max(0, 1 - Math.max(0, sy - (VANISH_Y - 1.5)) / 3.2)
      if (fade > 0) color = hdMix(color, haze, fade * (night ? 0.35 : 0.4))
      if (span && sx < span.left && sx > span.left - (0.45 + span.t * 1.8)) color = hdHex(night ? "#3a342c" : "#b7a07a")
      put(x, y, hdDarken(color, 0.97 + artHash(x >> 1, y >> 1) * 0.05))
    }
  }

  // Overhead gantry: a steel truss beam just past the horizon, two uprights
  // down to the ground, and the highway signs hanging beneath it. Painted
  // before the barrier and the cars so it stays behind them.
  const steel = hdHex(night ? "#8a929c" : "#d5dbe2")
  const pole = hdHex(night ? "#2a3038" : "#8d939a")
  const gantry = spanAt(VANISH_Y + 0.75)
  const beamLeft = gantry.left - 1
  const beamRight = gantry.right + 1
  const beamTop = VANISH_Y + 0.6
  const beamBot = VANISH_Y + 0.9
  const beamW = Math.max(0.6, cw * 0.055)
  hd.stroke(beamLeft, beamTop, beamRight, beamTop, beamW, steel)
  hd.stroke(beamLeft, beamBot, beamRight, beamBot, beamW * 0.8, steel)
  for (let i = 0; i < 7; i++) {
    const x0 = beamLeft + ((beamRight - beamLeft) * i) / 7
    const x1 = beamLeft + ((beamRight - beamLeft) * (i + 1)) / 7
    hd.stroke(x0, i % 2 === 0 ? beamTop : beamBot, x1, i % 2 === 0 ? beamBot : beamTop, Math.max(0.4, cw * 0.03), steel)
  }
  for (let i = 0; i < 6; i++) {
    const ta = gantry.t + ((0.5 - gantry.t) * i) / 6
    const tb = gantry.t + ((0.5 - gantry.t) * (i + 1)) / 6
    const syA = VANISH_Y + ta * (BOTTOM_Y - VANISH_Y)
    const syB = VANISH_Y + tb * (BOTTOM_Y - VANISH_Y)
    const a = spanAt(syA)
    const b = spanAt(syB)
    hd.stroke(a.left - 1, syA, b.left - 1, syB, Math.max(0.5, cw * 0.045), pole)
    hd.stroke(a.right + 1, syA, b.right + 1, syB, Math.max(0.5, cw * 0.045), pole)
  }
  const sign = hdHex(night ? "#1c6a34" : "#1f8a3a")
  const signInk = hdHex("#e8f6e4")
  const roadCx = (gantry.left + gantry.right) / 2
  const signY0 = VANISH_Y + 0.95
  for (const cx of [roadCx - 2.7, roadCx + 2.7]) {
    hd.rect(hd.X(cx - 2.5), hd.Y(signY0), hd.X(cx + 2.5), hd.Y(signY0 + 1.1), sign)
    hd.rect(hd.X(cx - 2.15), hd.Y(signY0 + 0.25), hd.X(cx + 2.15), hd.Y(signY0 + 0.47), signInk)
    hd.rect(hd.X(cx - 2.15), hd.Y(signY0 + 0.62), hd.X(cx + 1.6), hd.Y(signY0 + 0.82), signInk)
  }

  // Conifer silhouettes standing on the left crest: two stacked triangles
  // per tree, heights shrinking toward the vanishing point.
  const conifer = hdHex(night ? "#0e1a0c" : "#24401e")
  for (const tree of [
    { x: 4.6, h: 1.75 },
    { x: 7.4, h: 1.55 },
    { x: 10.2, h: 1.45 },
    { x: 13.5, h: 1.3 },
    { x: 16.8, h: 1.2 },
    { x: 20.4, h: 1.1 },
    { x: 24.6, h: 1 },
    { x: 28.2, h: 0.9 },
  ]) {
    const baseY = leftHill(tree.x)
    const bx = hd.X(tree.x)
    polyFill(
      hd,
      [
        [bx - cw * tree.h * 0.4, hd.Y(baseY)],
        [bx + cw * tree.h * 0.4, hd.Y(baseY)],
        [bx, hd.Y(baseY - tree.h * 0.62)],
      ],
      () => conifer,
    )
    polyFill(
      hd,
      [
        [bx - cw * tree.h * 0.28, hd.Y(baseY - tree.h * 0.3)],
        [bx + cw * tree.h * 0.28, hd.Y(baseY - tree.h * 0.3)],
        [bx, hd.Y(baseY - tree.h)],
      ],
      () => conifer,
    )
  }

  paintBarrier(hd, night, haze)

  let railX = 0
  let railY = 0
  let railOn = false
  for (let i = 0; i <= 16; i++) {
    const t = 0.14 + (i / 16) * 0.86
    const sy = VANISH_Y + t * (BOTTOM_Y - VANISH_Y)
    const span = spanAt(sy)
    const x = span.left - 0.15
    const y = sy - (0.12 + t * 0.55)
    if (railOn) hd.stroke(railX, railY, x, y, Math.max(0.7, cw * 0.055 * (0.35 + t)), steel)
    railX = x
    railY = y
    railOn = true
  }
  for (let k = 0; k < 8; k++) {
    const t = fract(k / 8 + phase)
    if (t < 0.12) continue
    const sy = VANISH_Y + Math.pow(t, 1.05) * (BOTTOM_Y - VANISH_Y - 0.4)
    const span = spanAt(sy)
    const postH = 0.15 + t * 0.7
    hd.stroke(span.left - 0.15, sy, span.left - 0.15, sy - postH, Math.max(0.6, cw * 0.04), steel)
  }
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < 7; k++) {
      const t = fract((k + side * 0.37) / 7 + phase)
      if (t < 0.1) continue
      const sy = VANISH_Y + 0.35 + Math.pow(t, 1.2) * (20.6 - VANISH_Y)
      const span = spanAt(sy)
      const lx = side === 0 ? span.left - (0.8 + t * 1.4) : span.right + (1.3 + t * 2.4)
      const poleH = 1.1 + t * 4.6
      const rad = Math.max(0.7, cw * (0.045 + t * 0.04))
      hd.stroke(lx, sy, lx, sy - poleH, rad, pole)
      // Curved three-segment arm reaching from the pole top over the road.
      const armDir = side === 0 ? 1 : -1
      const armLen = 1.1 + t
      const bends = [0, -0.22, -0.3, -0.18]
      let armX = lx
      let armY = sy - poleH
      for (let s = 1; s <= 3; s++) {
        const nextX = lx + armDir * ((armLen * s) / 3)
        const nextY = sy - poleH + bends[s]!
        hd.stroke(armX, armY, nextX, nextY, rad * 0.75, pole)
        armX = nextX
        armY = nextY
      }
      const headX = hd.X(armX)
      const headY = hd.Y(armY)
      if (night) {
        glow(hd, headX, headY, cw * (1.6 + t * 3.2), hdHex("#ffd18a"), 0.5, 0.7)
        hd.disk(headX, headY, Math.max(1, cw * 0.16), hdHex("#fff2c8"))
        glow(
          hd,
          hd.X(side === 0 ? span.left + 1.2 : span.right - 1.4),
          hd.Y(sy),
          cw * (1.2 + t * 3.5),
          hdHex("#ffd9a0"),
          0.16,
          0.35,
        )
      } else {
        hd.disk(headX, headY, Math.max(1, cw * 0.14), hdHex("#c5ccd2"))
      }
    }
  }

  const bridge = hdHex(night ? "#3a4450" : "#6c7682")
  hd.stroke(5, 6.15, 13.5, 6.55, Math.max(0.7, cw * 0.05), bridge)
  hd.stroke(5, 6.7, 13.5, 7.05, Math.max(0.6, cw * 0.04), bridge)
  for (let i = 0; i <= 4; i++) {
    const x = 5 + (8.5 * i) / 4
    hd.stroke(x, 6.2 + i * 0.08, x, 6.85 + i * 0.05, Math.max(0.6, cw * 0.035), bridge)
  }

  const rivalX = RACING_CENTER_X - 4 + Math.sin(phase * Math.PI * 2) * 3
  paintRearCar(hd, rivalX, 13.55, 0.22, night, false, false)
  const sway = racingSway(elapsed) * 0.85 + Math.sin(phase * Math.PI * 2) * 0.35
  paintRearCar(hd, 35.5 + sway, 23.25, 1.06, night, racingExhaust(elapsed), true)

  const cellW = Math.max(4, Math.min(26, Math.round(w / 54)))
  const cellH = Math.max(7, Math.round(cellW * 1.65))
  const bigW = Math.min(36, Math.round(cellW * 1.4))
  const bigH = Math.round(cellH * 1.35)
  const marginX = Math.round(cw * 1.1)
  const marginY = Math.round(ch * 0.28)
  const white = hdHex("#f4f7fb")
  const amber = hdHex("#f0a020")
  const green = hdHex("#3dce4a")
  const red = hdHex("#e10600")
  const speed = String(racingSpeed(elapsed))
  const seconds = 40 + Math.floor((elapsed % RACING_CYCLE_MS) / 1000)
  const clock = `00:${String(seconds).padStart(2, "0")}`
  label(hd, marginX, marginY, cellW, cellH, "KMH", white)
  label(hd, marginX + cellW * 4, marginY - Math.round((bigH - cellH) / 2), bigW, bigH, speed, amber)
  const damageY = marginY + bigH + Math.round(cellH * 0.35)
  label(hd, marginX, damageY, cellW, cellH, "DAMAGE", white)
  label(hd, marginX + cellW * 7, damageY - Math.round((bigH - cellH) / 2), bigW, bigH, "6", red)
  label(hd, Math.round((w - clock.length * bigW) / 2), marginY, bigW, bigH, clock, green)
  const laps = "LAPS"
  label(hd, w - marginX - laps.length * cellW - bigW - cellW, marginY, cellW, cellH, laps, white)
  label(hd, w - marginX - bigW, marginY - Math.round((bigH - cellH) / 2), bigW, bigH, "1", amber)
  return px
}
