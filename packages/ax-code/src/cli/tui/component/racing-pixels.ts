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
  const leftPx = hd.X(cx - 7.8 * scale)
  const rightPx = hd.X(cx + 7.8 * scale)
  const topPx = hd.Y(base - 7.4 * scale)
  const botPx = hd.Y(base - 0.5 * scale)
  // Cosine-blended half-width keys give the flanks a rounded sheet-metal curve
  // instead of polygon facets; the hips are widest at y = -3.3.
  const widthKeys: readonly (readonly [number, number])[] = [
    [-7.3, 2.5],
    [-6.6, 3.55],
    [-5.85, 5.1],
    [-4.95, 6.45],
    [-3.9, 7.3],
    [-3.3, 7.58],
    [-2.3, 7.42],
    [-1.35, 6.98],
    [-0.85, 6.62],
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
  const skyTint = hdHex("#5aa6dc")
  const rimTint = hdHex("#5c78a0")
  const spillTint = hdHex("#ff5030")
  const gloss = hdHex("#e8eef6")
  const gauss = (d: number, w: number) => Math.exp(-d * d * w)
  const shade = (x: number, y: number): RGB => {
    const u = Math.max(0, Math.min(1, (x - leftPx) / (rightPx - leftPx || 1)))
    const v = Math.max(0, Math.min(1, (y - topPx) / (botPx - topPx || 1)))
    // Horizontal cylinder: dark flanks rolling up to a lighter crown.
    let color = hdDarken(body, 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(Math.PI * u)))
    if (night) {
      // Weak cool rim light on both edges plus warm tail-light spill.
      const rim = Math.max(0, 1 - Math.min(u, 1 - u) / 0.1)
      color = hdMix(color, rimTint, rim * 0.3)
      const lat = Math.max(0, (0.33 - u) / 0.33, (u - 0.67) / 0.33)
      color = hdMix(color, spillTint, gauss(v - 0.53, 220) * Math.min(1, lat * 2.2) * 0.14)
    } else {
      // Sun from the upper-left: shoulder and roof speculars, sky on the deck.
      const roll = 0.35 + 0.65 * Math.sin(Math.PI * u)
      color = hdMix(color, gloss, gauss(v - 0.41, 300) * (1 - 0.72 * u) * roll * 0.34)
      color = hdMix(color, gloss, gauss(v - 0.05, 500) * (1 - 0.6 * u) * 0.3)
      color = hdMix(color, skyTint, Math.max(0, 1 - Math.abs(v - 0.33) / 0.14) * 0.14)
    }
    // Panel gaps: trunk shutline and the bumper split.
    return hdDarken(color, Math.abs(v - 0.35) < 0.008 || Math.abs(v - 0.7) < 0.007 ? 0.76 : 1)
  }
  if (shadow) {
    const scx = hd.X(cx + 4.2 * scale)
    const scy = hd.Y(base - 0.2 * scale)
    const srx = cw * 12 * scale
    const sry = ch * 1.35 * scale
    const xa = Math.max(0, Math.floor(scx - srx))
    const xb = Math.min(hd.w - 1, Math.ceil(scx + srx))
    const ya = Math.max(0, Math.floor(scy - sry))
    const yb = Math.min(hd.h - 1, Math.ceil(scy + sry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = (x + 0.5 - scx) / srx
        const dy = (y + 0.5 - scy) / sry
        const d = dx * dx + dy * dy
        if (d >= 1) continue
        blendPixel(hd, x, y, [0, 0, 0], (1 - d) * (night ? 0.55 : 0.72))
      }
    }
    // Contact-dark core pressed right under the tyres.
    const kx = hd.X(cx + 0.3 * scale)
    const ky = hd.Y(base - 0.9 * scale)
    const krx = cw * 8.4 * scale
    const kry = ch * 0.55 * scale
    const kxa = Math.max(0, Math.floor(kx - krx))
    const kxb = Math.min(hd.w - 1, Math.ceil(kx + krx))
    const kya = Math.max(0, Math.floor(ky - kry))
    const kyb = Math.min(hd.h - 1, Math.ceil(ky + kry))
    for (let y = kya; y <= kyb; y++) {
      for (let x = kxa; x <= kxb; x++) {
        const dx = (x + 0.5 - kx) / krx
        const dy = (y + 0.5 - ky) / kry
        const d = dx * dx + dy * dy
        if (d >= 1) continue
        blendPixel(hd, x, y, [0, 0, 0], (1 - d) * (night ? 0.4 : 0.5))
      }
    }
  }
  // Wide dark tyres under the bumper with a lighter sidewall rim arc.
  for (const side of [-1, 1]) {
    const wx = hd.X(cx + side * 6.5 * scale)
    const wy = hd.Y(base - 0.95 * scale)
    hd.blob(wx, wy, cw * 1.55 * scale, ch * 1.3 * scale, [7, 7, 9])
    hd.blob(wx, wy + ch * 0.13 * scale, cw * 1.02 * scale, ch * 0.62 * scale, [56, 60, 68])
  }
  const outline: (readonly [number, number])[] = []
  for (let i = 0; i <= 6; i++) {
    const t = i / 6
    outline.push(S(-2.5 + 5 * t, -7.3 - Math.sin(Math.PI * t) * 0.14))
  }
  for (let i = 1; i <= 13; i++) {
    const y = -7.3 + (6.45 * i) / 13
    outline.push(S(halfWidth(y), y))
  }
  outline.push(S(4.8, -1.02), S(0, -1.08), S(-4.8, -1.02))
  for (let i = 13; i >= 1; i--) {
    const y = -7.3 + (6.45 * i) / 13
    outline.push(S(-halfWidth(y), y))
  }
  polyFill(hd, outline, shade)
  // Rear window: gradient glass with a faint diagonal reflection streak.
  const gTopPx = hd.Y(base - 6.95 * scale)
  const gBotPx = hd.Y(base - 4.98 * scale)
  const glassTop = night ? hdHex("#0e1520") : hdHex("#1b2b3b")
  const glassBot = night ? hdHex("#1e3246") : hdHex("#3a6076")
  const streakGap = Math.max(10, cw * scale * 3.2)
  polyFill(hd, [S(-2.95, -6.95), S(2.95, -6.95), S(4, -4.98), S(-4, -4.98)], (x, y) => {
    const t = Math.max(0, Math.min(1, (y - gTopPx) / (gBotPx - gTopPx || 1)))
    let color = hdMix(glassTop, glassBot, t)
    if (!night) color = hdMix(color, skyTint, Math.max(0, 1 - t * 2.2) * 0.3)
    const s = (((x - y * 1.45) % streakGap) + streakGap) % streakGap
    if (s < streakGap * 0.16) return hdMix(color, [214, 228, 240], night ? 0.07 : 0.13)
    if (s > streakGap * 0.55 && s < streakGap * 0.64) return hdMix(color, [214, 228, 240], night ? 0.045 : 0.08)
    return color
  })
  // Rear wing: two uprights, slim blade with a lit top edge, angled end plates.
  for (const side of [-1, 1]) {
    polyFill(hd, [S(side * 2.1, -5.6), S(side * 2.42, -5.6), S(side * 2.26, -4.05), S(side * 1.96, -4.05)], () =>
      hdDarken(body, 0.75),
    )
  }
  polyFill(hd, [S(-11.4, -5.32), S(11.4, -5.32), S(10.85, -5.62), S(-10.85, -5.62)], () =>
    hdDarken(body, night ? 0.72 : 0.88),
  )
  polyFill(hd, [S(-11.35, -5.33), S(11.35, -5.33), S(11.3, -5.25), S(-11.3, -5.25)], () =>
    hdHex(night ? "#4a5058" : "#8a929c"),
  )
  polyFill(hd, [S(-1, -5.46), S(1, -5.46), S(1, -5.4), S(-1, -5.4)], () => hdHex("#e21818"))
  for (const side of [-1, 1]) {
    polyFill(hd, [S(side * 11.05, -5.9), S(side * 11.5, -5.72), S(side * 11.3, -4.92), S(side * 10.82, -5.1)], () =>
      hdDarken(body, 0.8),
    )
  }
  // Wrap-around LED lamps following the hip curve: dark red base, hot strip.
  const tail = hdHex("#c01414")
  const hot = hdHex("#ff6a54")
  for (const side of [-1, 1]) {
    const outer: (readonly [number, number])[] = []
    const inner: (readonly [number, number])[] = []
    for (let i = 0; i <= 6; i++) {
      const y = -3.95 + (1.15 * i) / 6
      outer.push(S(side * (halfWidth(y) - 0.3), y))
      inner.push(S(side * 2.1, y))
    }
    polyFill(hd, [...outer, ...inner.reverse()], () => tail)
    polyFill(
      hd,
      [
        S(side * (halfWidth(-3.8) - 0.52), -3.8),
        S(side * 2.28, -3.8),
        S(side * 2.28, -3.35),
        S(side * (halfWidth(-3.35) - 0.52), -3.35),
      ],
      () => hot,
    )
  }
  polyFill(hd, [S(0, -3.6), S(0.4, -3.35), S(0, -3.1), S(-0.4, -3.35)], () => [186, 190, 198])
  polyFill(hd, [S(-1.75, -2.98), S(1.75, -2.98), S(1.75, -2.2), S(-1.75, -2.2)], () => hdDarken(body, 0.6))
  polyFill(hd, [S(-1.55, -2.88), S(1.55, -2.88), S(1.55, -2.3), S(-1.55, -2.3)], () => hdHex("#23262c"))
  // Rear diffuser with fins and dual round exhaust tips.
  polyFill(hd, [S(-4.7, -1.42), S(4.7, -1.42), S(4.2, -0.6), S(-4.2, -0.6)], () => hdHex("#08090b"))
  for (let k = -1.5; k <= 1.5; k++) {
    polyFill(
      hd,
      [S(k * 1.55 - 0.11, -1.4), S(k * 1.55 + 0.11, -1.4), S(k * 1.55 + 0.09, -0.66), S(k * 1.55 - 0.09, -0.66)],
      () => hdHex("#1f2228"),
    )
  }
  for (const side of [-1, 1]) {
    const ex = hd.X(cx + side * 3.4 * scale)
    const ey = hd.Y(base - 0.85 * scale)
    hd.disk(ex, ey, Math.max(1, cw * 0.5 * scale), [186, 190, 196])
    hd.disk(ex, ey, Math.max(0.8, cw * 0.27 * scale), exhaust ? hdHex("#ff9a3c") : [12, 12, 14])
  }
  const glowR = cw * (night ? 1.7 : 0.8) * scale
  glow(hd, hd.X(cx - 4.2 * scale), hd.Y(base - 3.2 * scale), glowR, tail, night ? 0.42 : 0.16, 0.5)
  glow(hd, hd.X(cx + 4.2 * scale), hd.Y(base - 3.2 * scale), glowR, tail, night ? 0.42 : 0.16, 0.5)
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
