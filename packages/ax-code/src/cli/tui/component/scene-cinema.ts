/**
 * Cinematic finishing pass for the HD opening and ending scenes.
 *
 * Every playback gets a fade in from black and out to black, a soft bloom
 * around bright lights, a gentle contrast and saturation grade, and a
 * vignette, plus a static ordered dither so smooth gradients stay smooth
 * instead of banding once they quantize to bytes. Every theme carries an
 * authored move: an opening pushes in gently as the arrival settles, an ending
 * starts close and pulls back to the full frame as it departs, and neutral or
 * framed themes hold still. The camera is deterministic and never draws per
 * playback. The camera resample is bilinear, which also smooths the painters'
 * hard stair-stepped edges.
 *
 * Pure and deterministic: the output depends only on the inputs.
 */

export const CINEMA_FADE_IN_MS = 180
export const CINEMA_FADE_OUT_MS = 360
/** Window of the one-shot foreground action inside the default 3s playback. */
export const ACTION_START_MS = 700
export const ACTION_END_MS = 1900
/** Playback length the action window is authored against. */
const ACTION_WINDOW_MS = 3000
/** Zoom range of a camera move. The top end still never crops a landmark. */
export const CINEMA_ZOOM_MIN = 1.04
export const CINEMA_ZOOM_MAX = 1.1
const BLOOM_DIV = 4
const BLOOM_STRENGTH = 0.38
const VIGNETTE = 0.2
const SATURATION = 1.06

export type CinemaMoveKind = "still" | "push-in" | "pull-back" | "drift-left" | "drift-right"
export type CinemaEase = "in-out" | "out" | "in" | "linear"

export type CinemaMove = Readonly<{
  kind: CinemaMoveKind
  /**
   * Peak zoom, at most CINEMA_ZOOM_MAX (1 for still). Authored moves sit at
   * 1.03, just under CINEMA_ZOOM_MIN, so they read as a breath and never crop.
   */
  zoom: number
  ease: CinemaEase
  /** Focal point as a fraction of the zoom slack, -1..1 on each axis. */
  focusX: number
  focusY: number
}>

export const CINEMA_STILL: CinemaMove = Object.freeze({ kind: "still", zoom: 1, ease: "linear", focusX: 0, focusY: 0 })

/**
 * Themes are authored, not drawn: an opening settles by pushing in on the
 * composition, an ending departs by pulling back to the full frame. The two
 * neutral themes appear in both halves of every pair and hold still, as do
 * styles outside the pair list.
 */
const NEUTRAL_STYLES: ReadonlySet<string> = new Set(["digital-code", "taegeuk"])

const OPENING_STYLES: ReadonlySet<string> = new Set([
  "digital-code",
  "classic-foliage",
  "midnight-dream",
  "fuji-day",
  "mahjong-match",
  "city-night",
  "festival-fireworks",
  "snowfall",
  "volcano-eruption",
  "bigben-day",
  "taipei101-day",
  "greatwall-dawn",
  "torii-day",
  "taegeuk",
  "sagrada-day",
  "corcovado-day",
  "eiffel-day",
  "brandenburg-night",
  "domes-snow",
  "borobudur-mist",
  "balloons-night",
  "mekong-dawn",
  "colosseum-day",
  "space-launch",
  "dungeon-descent",
  "castle-day",
  "islands-day",
  "jungle-day",
  "reef-day",
  "pyramids-day",
  "aurora-night",
  "lighthouse-day",
  "falls-day",
  "steppe-day",
  "canyon-day",
  "singapore-day",
  "sanguozhi-muster",
  "racing-day",
  "dinosaur-day",
])

const ENDING_STYLES: ReadonlySet<string> = new Set([
  "digital-code",
  "golden-foliage",
  "sunset-serenade",
  "fuji-night",
  "mahjong-ending",
  "city-dawn",
  "festival-lanterns",
  "winter-night",
  "volcano-calm",
  "bigben-night",
  "taipei101-neon",
  "greatwall-dusk",
  "torii-night",
  "taegeuk",
  "sagrada-night",
  "corcovado-gold",
  "eiffel-night",
  "brandenburg-dawn",
  "domes-clear",
  "borobudur-noon",
  "balloons-dawn",
  "mekong-dusk",
  "colosseum-night",
  "space-drift",
  "dungeon-treasure",
  "castle-night",
  "islands-dusk",
  "jungle-night",
  "reef-night",
  "pyramids-night",
  "aurora-dawn",
  "lighthouse-night",
  "falls-moon",
  "steppe-night",
  "canyon-night",
  "singapore-night",
  "sanguozhi-dusk",
  "racing-night",
  "dinosaur-night",
])

/** A gentle 3% push: the arrival closes in and settles on the composition. */
const OPENING_MOVE: CinemaMove = Object.freeze({ kind: "push-in", zoom: 1.03, ease: "out", focusX: 0, focusY: 0 })
/** The same breath in reverse: start close, reveal the full frame, settle. */
const ENDING_MOVE: CinemaMove = Object.freeze({ kind: "pull-back", zoom: 1.03, ease: "out", focusX: 0, focusY: 0 })

/**
 * The authored camera move for a theme. Neutral themes resolve to a still
 * before the pair lists, because they open and close with the same artwork.
 */
export function chooseCinemaMove(style?: string): CinemaMove {
  if (!style || NEUTRAL_STYLES.has(style)) return CINEMA_STILL
  if (OPENING_STYLES.has(style)) return OPENING_MOVE
  if (ENDING_STYLES.has(style)) return ENDING_MOVE
  return CINEMA_STILL
}

/** Respect authored framing: overlay-heavy scenes must never lose their edges. */
export function sceneCinemaMove(style: string | undefined, move: CinemaMove): CinemaMove {
  if (
    style === "racing-day" ||
    style === "racing-night" ||
    style === "mahjong-match" ||
    style === "mahjong-ending" ||
    style === "sanguozhi-muster" ||
    style === "sanguozhi-dusk"
  )
    return CINEMA_STILL
  if (
    style === "singapore-day" ||
    style === "singapore-night" ||
    style === "dinosaur-day" ||
    style === "dinosaur-night"
  )
    return { ...move, zoom: Math.min(move.zoom, 1.035), focusX: 0, focusY: 0.3 }
  return move
}

export type CinemaShot = Readonly<{
  /** Visible fraction of the source is 1 / zoom. Always >= 1. */
  zoom: number
  /** Window center in source pixels. */
  centerX: number
  centerY: number
  /** 0 = black, 1 = full exposure. */
  exposure: number
}>

const EASE: Record<CinemaEase, (t: number) => number> = {
  "in-out": (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  linear: (t) => t,
}
const smoothstep = (t: number) => {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return u * u * (3 - 2 * u)
}
const clampUnit = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v)

/**
 * One-shot progress for a foreground action (a walker crossing, a boat leaving
 * the bay): 0 until ACTION_START_MS, eased 0..1 across the action window, then
 * 1 so the subject arrives and holds instead of wrapping. A non-default
 * playback duration scales the window with it. Pure and monotonic.
 */
export function actionProgress(elapsedMs: number, durationMs?: number): number {
  const scale = durationMs && durationMs > 0 ? durationMs / ACTION_WINDOW_MS : 1
  const start = ACTION_START_MS * scale
  const end = ACTION_END_MS * scale
  const elapsed = Math.max(0, elapsedMs)
  if (elapsed <= start) return 0
  if (elapsed >= end) return 1
  return EASE["in-out"]((elapsed - start) / (end - start))
}

/**
 * The camera at `elapsedMs` for the given move. A push-in starts on the full
 * composition and closes in on its focal point; a pull-back starts there and
 * reveals the whole frame; a drift holds its zoom and travels across the frame.
 * Without a known duration the camera holds its starting framing and only the
 * fade-in applies.
 */
export function cinemaShot(input: {
  width: number
  height: number
  elapsedMs: number
  durationMs?: number
  move: CinemaMove
}): CinemaShot {
  const elapsed = Math.max(0, input.elapsedMs)
  const duration = input.durationMs && input.durationMs > 0 ? input.durationMs : undefined
  const { width, height, move } = input
  const progress = duration ? EASE[move.ease](Math.min(1, elapsed / duration)) : 0
  const fadeIn = smoothstep(elapsed / CINEMA_FADE_IN_MS)
  const fadeOut = duration ? smoothstep((duration - elapsed) / CINEMA_FADE_OUT_MS) : 1
  const exposure = Math.min(fadeIn, fadeOut)
  const peak = Math.max(1, Math.min(CINEMA_ZOOM_MAX, move.zoom))
  if (move.kind === "still" || peak === 1) return { zoom: 1, centerX: width / 2, centerY: height / 2, exposure }

  if (move.kind === "drift-left" || move.kind === "drift-right") {
    const slackX = (width - width / peak) / 2
    const slackY = (height - height / peak) / 2
    // Travel from one side of the slack to the other, never past the frame edge.
    const along = (progress * 2 - 1) * (move.kind === "drift-right" ? 1 : -1)
    return {
      zoom: peak,
      centerX: width / 2 + along * slackX * 0.9,
      centerY: height / 2 + clampUnit(move.focusY) * slackY,
      exposure,
    }
  }

  const push = move.kind === "push-in" ? progress : 1 - progress
  const zoom = 1 + (peak - 1) * push
  const slackX = (width - width / zoom) / 2
  const slackY = (height - height / zoom) / 2
  return {
    zoom,
    centerX: width / 2 + clampUnit(move.focusX) * slackX,
    centerY: height / 2 + clampUnit(move.focusY) * slackY,
    exposure,
  }
}

type Grid = { w: number; h: number; vignette: Float32Array }
let gridCache: Grid | undefined

function vignetteGrid(w: number, h: number): Grid {
  if (gridCache && gridCache.w === w && gridCache.h === h) return gridCache
  const vignette = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5) / h - 0.5
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5) / w - 0.5
      // Elliptical falloff that leaves the middle 60% untouched.
      const r = Math.max(0, Math.sqrt(dx * dx + dy * dy) * 1.414 - 0.42) / 0.58
      vignette[y * w + x] = 1 - VIGNETTE * r * r
    }
  }
  gridCache = { w, h, vignette }
  return gridCache
}

/**
 * 4x4 Bayer matrix, 0..15 row-major. Indexed by output position, never by
 * time: a framed playback dithers the same way on every draw.
 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const
/** The matrix as byte offsets in [-1, +0.875]: under one quantization step. */
const BAYER_OFFSET = Float32Array.from(BAYER, (value) => (value / 16 - 0.5) * 2)

/** Clamp a graded float to a byte and round to nearest, dither overshoot included. */
const toByte = (value: number) => (value <= 0 ? 0 : value >= 255 ? 255 : (value + 0.5) | 0)

/** Contrast S-curve as a byte lookup table, with a lifted floor and capped white. */
const CURVE = (() => {
  const lut = new Uint8Array(256 * 4)
  // Remap after the S-curve: pure black lands near 8/255 and pure white near
  // 242/255, so the grade softens clipping instead of crushing it.
  const FLOOR = 0.03
  const RANGE = 0.92
  for (let i = 0; i < lut.length; i++) {
    const v = Math.min(1, i / 255)
    const s = v * v * (3 - 2 * v)
    const curve = Math.min(1, v * 0.72 + s * 0.28)
    lut[i] = Math.round(255 * (FLOOR + curve * RANGE))
  }
  return lut
})()

/**
 * Bright-pass glow at 1/BLOOM_DIV resolution, blurred with two separable box
 * passes. Returned as RGB floats in source-grid coordinates.
 */
function bloomGrid(src: Buffer, w: number, h: number) {
  const gw = Math.max(1, Math.ceil(w / BLOOM_DIV))
  const gh = Math.max(1, Math.ceil(h / BLOOM_DIV))
  const glow = new Float32Array(gw * gh * 3)
  // Only lights brighter than the frame's own key glow: a bright daytime sky
  // must not bloom, while lit windows on a night scene should.
  let sum = 0
  let count = 0
  for (let i = 0; i < w * h * 3; i += 3 * 17) {
    sum += src[i]! * 0.299 + src[i + 1]! * 0.587 + src[i + 2]! * 0.114
    count++
  }
  const mean = count ? sum / count : 0
  const threshold = Math.max(185, Math.min(238, mean + 72))
  // The bright pass reads every other pixel in both axes; the blur hides the gaps.
  const norm = 4 / (BLOOM_DIV * BLOOM_DIV)
  for (let y = 0; y < h; y += 2) {
    const row = ((y / BLOOM_DIV) | 0) * gw
    let i = y * w * 3
    for (let x = 0; x < w; x += 2, i += 6) {
      const r = src[i]!
      const g = src[i + 1]!
      const b = src[i + 2]!
      const luma = r * 0.299 + g * 0.587 + b * 0.114
      if (luma <= threshold) continue
      const k = ((luma - threshold) / (255 - threshold)) * norm
      const gi = (row + ((x / BLOOM_DIV) | 0)) * 3
      glow[gi] += r * k
      glow[gi + 1] += g * k
      glow[gi + 2] += b * k
    }
  }
  // Two separable box passes with a running sum: O(1) per cell for any radius.
  // Samples past the edge count as black, which darkens the rim slightly.
  const tmp = new Float32Array(glow.length)
  const R = 3
  const scale = 1 / (2 * R + 1)
  const blur = (from: Float32Array, to: Float32Array, count: number, lines: number, step: number, stride: number) => {
    for (let line = 0; line < lines; line++) {
      const base = line * stride
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let k = 0; k < Math.min(R, count); k++) sum += from[base + k * step + c]!
        for (let i = 0; i < count; i++) {
          if (i + R < count) sum += from[base + (i + R) * step + c]!
          if (i - R - 1 >= 0) sum -= from[base + (i - R - 1) * step + c]!
          to[base + i * step + c] = sum * scale
        }
      }
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    blur(glow, tmp, gw, gh, 3, gw * 3)
    blur(tmp, glow, gh, gw, gw * 3, 3)
  }
  return { glow, gw, gh }
}

/**
 * Apply the shot to a painted RGB frame of `width` x `height`. Returns a new
 * buffer of the same size; `src` is not modified.
 */
export function applyCinema(src: Buffer, width: number, height: number, shot: CinemaShot): Buffer {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const out = Buffer.alloc(w * h * 3)
  if (w === 0 || h === 0 || src.length < w * h * 3) return out
  const exposure = Math.max(0, Math.min(1, shot.exposure))
  if (exposure === 0) return out

  const zoom = Math.max(1, shot.zoom)
  const direct = zoom === 1 && shot.centerX === w / 2 && shot.centerY === h / 2
  const span = 1 / zoom
  const left = shot.centerX - (w * span) / 2
  const top = shot.centerY - (h * span) / 2

  // Bilinear sample positions per column and per row, in 8-bit fixed point.
  const x0 = new Int32Array(w)
  const x1 = new Int32Array(w)
  const fx = new Int32Array(w)
  for (let x = 0; x < w; x++) {
    const sx = Math.max(0, Math.min(w - 1, left + (x + 0.5) * span - 0.5))
    const xi = Math.floor(sx)
    x0[x] = xi * 3
    x1[x] = Math.min(w - 1, xi + 1) * 3
    fx[x] = Math.round((sx - xi) * 256)
  }
  const { glow, gw, gh } = bloomGrid(src, w, h)
  const gx0 = new Int32Array(w)
  const gx1 = new Int32Array(w)
  const gfx = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const gxf = Math.max(0, Math.min(gw - 1, (left + (x + 0.5) * span) / BLOOM_DIV - 0.5))
    const gi = Math.floor(gxf)
    gx0[x] = gi * 3
    gx1[x] = Math.min(gw - 1, gi + 1) * 3
    gfx[x] = gxf - gi
  }
  const { vignette } = vignetteGrid(w, h)
  // Rows of the bloom grid with any light, so dark-free rows skip the taps.
  const litRow = new Uint8Array(gh)
  for (let gy = 0; gy < gh; gy++) {
    const end = (gy + 1) * gw * 3
    for (let i = gy * gw * 3; i < end; i++)
      if (glow[i]! > 0.25) {
        litRow[gy] = 1
        break
      }
  }

  for (let y = 0; y < h; y++) {
    const sy = Math.max(0, Math.min(h - 1, top + (y + 0.5) * span - 0.5))
    const yi = Math.floor(sy)
    const row0 = yi * w * 3
    const row1 = Math.min(h - 1, yi + 1) * w * 3
    const fy = Math.round((sy - yi) * 256)
    const gyf = Math.max(0, Math.min(gh - 1, (top + (y + 0.5) * span) / BLOOM_DIV - 0.5))
    const gyi = Math.floor(gyf)
    const grow0 = gyi * gw * 3
    const grow1 = Math.min(gh - 1, gyi + 1) * gw * 3
    const gfy = gyf - gyi
    const bloomRow = litRow[gyi]! | litRow[Math.min(gh - 1, gyi + 1)]!
    const ditherRow = (y & 3) << 2
    let o = y * w * 3
    let v = y * w
    for (let x = 0; x < w; x++, o += 3, v++) {
      const a = row0 + x0[x]!
      const b = row0 + x1[x]!
      const c = row1 + x0[x]!
      const d = row1 + x1[x]!
      const wx = fx[x]!
      const ix = 256 - wx
      const iy = 256 - fy
      let r = direct ? src[o]! : ((src[a]! * ix + src[b]! * wx) * iy + (src[c]! * ix + src[d]! * wx) * fy) >> 16
      let g = direct
        ? src[o + 1]!
        : ((src[a + 1]! * ix + src[b + 1]! * wx) * iy + (src[c + 1]! * ix + src[d + 1]! * wx) * fy) >> 16
      let bl = direct
        ? src[o + 2]!
        : ((src[a + 2]! * ix + src[b + 2]! * wx) * iy + (src[c + 2]! * ix + src[d + 2]! * wx) * fy) >> 16

      if (bloomRow) {
        const ga = grow0 + gx0[x]!
        const gb = grow0 + gx1[x]!
        const gc = grow1 + gx0[x]!
        const gd = grow1 + gx1[x]!
        const tx = gfx[x]!
        const top0 = 1 - tx
        const bottom = gfy
        const topW = 1 - bottom
        r +=
          ((glow[ga]! * top0 + glow[gb]! * tx) * topW + (glow[gc]! * top0 + glow[gd]! * tx) * bottom) * BLOOM_STRENGTH
        g +=
          ((glow[ga + 1]! * top0 + glow[gb + 1]! * tx) * topW + (glow[gc + 1]! * top0 + glow[gd + 1]! * tx) * bottom) *
          BLOOM_STRENGTH
        bl +=
          ((glow[ga + 2]! * top0 + glow[gb + 2]! * tx) * topW + (glow[gc + 2]! * top0 + glow[gd + 2]! * tx) * bottom) *
          BLOOM_STRENGTH
      }

      // Saturation around Rec. 601 luma, then the contrast curve.
      const luma = r * 0.299 + g * 0.587 + bl * 0.114
      r = luma + (r - luma) * SATURATION
      g = luma + (g - luma) * SATURATION
      bl = luma + (bl - luma) * SATURATION
      const k = vignette[v]! * exposure
      // Static dither folded into the write: the offset only ever moves a byte
      // by one step, so it breaks banding without adding visible texture.
      const dither = BAYER_OFFSET[ditherRow | (x & 3)]!
      out[o] = toByte(CURVE[r < 0 ? 0 : r > 1023 ? 1023 : r | 0]! * k + dither)
      out[o + 1] = toByte(CURVE[g < 0 ? 0 : g > 1023 ? 1023 : g | 0]! * k + dither)
      out[o + 2] = toByte(CURVE[bl < 0 ? 0 : bl > 1023 ? 1023 : bl | 0]! * k + dither)
    }
  }
  return out
}
