import { renderTextScenePixels } from "./text-scene-pixels"
import { isTextSceneStyle } from "./text-scene-view-model"
import { isFoliageVariant, renderFoliagePixels, type OverlayStyle } from "./foliage-view-model"
import { deflateSync } from "node:zlib"
import { randomInt } from "node:crypto"
import {
  createDigitalCode,
  advanceDigitalCode,
  digitalCodeCellLevel,
  DIGITAL_CODE_LEVEL_RGB,
  DIGITAL_CODE_LEVELS,
  DIGITAL_CODE_PIXEL_CELL_HEIGHT,
  DIGITAL_CODE_PIXEL_CELL_WIDTH,
  type DigitalCodeDirection,
  type DigitalCodeHue,
  type DigitalCodeRandom,
} from "./digital-code-view-model"

// Original 5x7 bitmap alphabet. Six-pixel vertical advance overlaps adjacent
// glyphs slightly, independently of the terminal's font and line spacing.
const GLYPHS = [
  [14, 17, 19, 21, 25, 17, 14],
  [4, 12, 4, 4, 4, 4, 14],
  [14, 17, 1, 2, 4, 8, 31],
  [30, 1, 1, 14, 1, 1, 30],
  [2, 6, 10, 18, 31, 2, 2],
  [31, 16, 16, 30, 1, 1, 30],
  [14, 16, 16, 30, 17, 17, 14],
  [31, 1, 2, 4, 8, 8, 8],
  [14, 17, 17, 14, 17, 17, 14],
  [14, 17, 17, 15, 1, 1, 14],
  [14, 17, 17, 31, 17, 17, 17],
  [30, 17, 17, 30, 17, 17, 30],
  [15, 16, 16, 16, 16, 16, 15],
  [30, 17, 17, 17, 17, 17, 30],
  [31, 16, 16, 30, 16, 16, 31],
  [31, 16, 16, 30, 16, 16, 16],
]

// Bounded even on a 4K terminal. 1280x720 stays sharp when the Kitty image is
// stretched to the window, without blowing the 20 fps zlib budget.
export const DIGITAL_CODE_PIXEL_MAX_WIDTH = 1280
export const DIGITAL_CODE_PIXEL_MAX_HEIGHT = 720

export function supportsDigitalCodePixels(input: {
  tty: boolean
  screenMode: string
  capabilities?: { kitty_graphics: boolean; remote: boolean; multiplexer: string } | null
}): boolean {
  const caps = input.capabilities
  return (
    input.tty &&
    input.screenMode === "alternate-screen" &&
    caps?.kitty_graphics === true &&
    caps.remote === false &&
    caps.multiplexer === "none"
  )
}

export function createDigitalCodePixels(
  width: number,
  height: number,
  direction: DigitalCodeDirection,
  random?: DigitalCodeRandom,
  style?: OverlayStyle,
) {
  const maxWidth = isTextSceneStyle(style) ? 1920 : DIGITAL_CODE_PIXEL_MAX_WIDTH
  const maxHeight = isTextSceneStyle(style) ? 1080 : DIGITAL_CODE_PIXEL_MAX_HEIGHT
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const w = Math.max(7, Math.floor(width * scale))
  const h = Math.max(7, Math.floor(height * scale))
  return {
    width: w,
    height: h,
    tick: 0,
    rain: createDigitalCode({
      width: Math.floor(w / DIGITAL_CODE_PIXEL_CELL_WIDTH),
      height: Math.ceil(h / DIGITAL_CODE_PIXEL_CELL_HEIGHT),
      direction,
      random,
    }),
  }
}
export type DigitalCodePixels = ReturnType<typeof createDigitalCodePixels>

function paletteColor(hue: DigitalCodeHue, level: number): readonly [number, number, number] {
  const ramp = DIGITAL_CODE_LEVEL_RGB[hue]
  return ramp[Math.min(DIGITAL_CODE_LEVELS, Math.max(0, level))] ?? ramp[DIGITAL_CODE_LEVELS]!
}

// Per-size static layers (background, vignette, scanlines), built once and reused.
interface StaticLayers {
  base: Buffer
  mask: Uint8Array
  groundY: number
}
const staticCache = new Map<string, StaticLayers>()

/** Ground (horizon) row: drops land here; everything below is wet pavement. */
function groundRow(height: number): number {
  return Math.max(1, Math.floor(height * 0.86))
}

function staticLayers(width: number, height: number): StaticLayers {
  const key = `${width}x${height}`
  const hit = staticCache.get(key)
  if (hit) return hit
  const base = Buffer.alloc(width * height * 3)
  const mask = new Uint8Array(width * height)
  const cx = width / 2
  const cy = height / 2
  const groundY = groundRow(height)
  for (let y = 0; y < height; y++) {
    const scan = y % 3 === 2 ? 0.86 : 1
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / cx
      const ny = (y - cy) / cy
      const r2 = nx * nx * 0.8 + ny * ny * 0.9
      // Overcast storm sky: a cool slate core fading to near-black navy.
      const core = Math.max(0, 1 - r2) ** 2
      const sky = Math.max(0, 1 - y / groundY)
      const i = (y * width + x) * 3
      const wet = y >= groundY ? 6 : 0
      base[i] = 3 + core * 10 + sky * 4
      base[i + 1] = 6 + core * 20 + sky * 8 + wet
      base[i + 2] = 12 + core * 36 + sky * 14 + wet * 2
      mask[y * width + x] = Math.round(255 * scan * Math.max(0.2, 1 - r2 * 0.4))
    }
  }
  if (staticCache.size > 4) staticCache.clear()
  const layers = { base, mask, groundY }
  staticCache.set(key, layers)
  return layers
}

function hash(n: number): number {
  let h = Math.imul(n | 0, 0x45d9f3b) ^ 0x1b873593
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

// Per depth layer: far drops are fine, dim mist-like streaks; near drops are
// big, bright, thick and carry most of the bloom. slope is the wind slant in
// horizontal pixels per vertical pixel.
const LAYER_STYLE = {
  far: { scale: 0.72, gain: 0.45, glyph: 0.55, line: 0.8, width: 1, slope: 0.07, bloom: 0.4 },
  mid: { scale: 1, gain: 0.8, glyph: 0.7, line: 0.8, width: 1, slope: 0.11, bloom: 0.8 },
  near: { scale: 2, gain: 1.1, glyph: 0.75, line: 1, width: 2, slope: 0.17, bloom: 1.4 },
} as const

const BLOOM_DIV = 4
// Cool blue-white that streak bodies and splashes are drawn in.
const RAIN_TINT = [150, 195, 235] as const

export function renderDigitalCodePixels(frame: Omit<DigitalCodePixels, "tick"> & { tick?: number }): Buffer {
  const { width, height, rain } = frame
  const tick = Math.max(0, Math.floor(frame.tick ?? 0))
  const up = rain.direction === "up"
  const layers = staticLayers(width, height)
  const groundY = layers.groundY
  const pixels = Buffer.from(layers.base)
  const gw = Math.ceil(width / BLOOM_DIV)
  const gh = Math.ceil(height / BLOOM_DIV)
  const glow = new Float32Array(gw * gh * 3)
  // Opening ignition: the downpour fades in over the first second.
  const ignite = Math.min(1, 0.35 + tick / 18)

  // Lightning: roughly every three seconds a double flicker briefly lights the
  // whole sheet of rain. Deterministic from the tick.
  const stormPeriod = 70
  const storm = Math.floor(tick / stormPeriod)
  const stormTick = tick % stormPeriod
  const stormOn = tick >= 24 && hash(storm + 5) < 0.75
  const flash = stormOn ? ([1, 0.35, 0.8, 0.45, 0.2, 0.08][stormTick] ?? 0) : 0
  const lit = 1 + flash * 1.3

  const splat = (cx: number, cy: number, color: readonly [number, number, number], weight: number) => {
    const gx = Math.floor(cx / BLOOM_DIV)
    const gy = Math.floor(cy / BLOOM_DIV)
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return
    const i = (gy * gw + gx) * 3
    glow[i] += color[0] * weight
    glow[i + 1] += color[1] * weight
    glow[i + 2] += color[2] * weight
  }
  const add = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= groundY) return
    const i = (y * width + x) * 3
    pixels[i] = Math.min(255, pixels[i]! + r)
    pixels[i + 1] = Math.min(255, pixels[i + 1]! + g)
    pixels[i + 2] = Math.min(255, pixels[i + 2]! + b)
  }

  const ripples: { x: number; age: number; hue: number; weight: number }[] = []

  for (let ci = 0; ci < rain.columns.length; ci++) {
    const column = rain.columns[ci]!
    const style = LAYER_STYLE[column.layer ?? "mid"]
    const gh7 = Math.max(1, Math.ceil(7 * style.scale))
    const gw5 = Math.max(1, Math.ceil(5 * style.scale))
    const advance = DIGITAL_CODE_PIXEL_CELL_HEIGHT * style.scale
    const x = column.x * DIGITAL_CODE_PIXEL_CELL_WIDTH
    const headY = Math.floor(column.head * DIGITAL_CODE_PIXEL_CELL_HEIGHT)
    // Falling drops trail up-left of the head; rising ones trail down-right.
    const dir = up ? 1 : -1
    const span = column.length * advance
    const centre = x + gw5 / 2

    // Streak body: a thin slanted line, bright at the head and tapering to nothing.
    const bodyHue = paletteColor(column.hue, DIGITAL_CODE_LEVELS - 2)
    for (let d = 0; d < span; d++) {
      const yy = Math.floor(headY + (up ? d : -d))
      if (yy < 0 || yy >= groundY) continue
      const u = d / span
      const a = (1 - u) ** 1.7 * style.line * 0.9 * ignite * lit * (0.8 + 0.2 * hash(ci * 131 + yy))
      const px = Math.round(centre + dir * style.slope * d)
      for (let w = 0; w < style.width; w++) {
        const cr = (RAIN_TINT[0] * 0.55 + bodyHue[0] * 0.45) * a
        const cg = (RAIN_TINT[1] * 0.55 + bodyHue[1] * 0.45) * a
        const cb = (RAIN_TINT[2] * 0.55 + bodyHue[2] * 0.45) * a
        add(px + w - (style.width >> 1), yy, cr, cg, cb)
      }
    }

    let leadSplat = false
    for (let offset = column.length - 1; offset >= 0; offset--) {
      const gy0 = Math.floor(headY + (up ? offset * advance : -offset * advance))
      const gx0 = Math.round(x + dir * style.slope * offset * advance)
      if (gy0 < -gh7 || gy0 >= groundY) continue
      const level = digitalCodeCellLevel(rain.direction, offset, column.length)
      const head = level >= DIGITAL_CODE_LEVELS
      const hue = column.hues[offset] ?? column.hue
      const ramp = paletteColor(hue, level)
      const flick = 0.82 + 0.18 * hash(ci * 977 + offset * 31 + (tick >> 1))
      const t = level / DIGITAL_CODE_LEVELS
      let gain = style.gain * style.glyph * flick * ignite * lit * (0.3 + 0.9 * t * t)
      const color: readonly [number, number, number] = head
        ? [Math.min(255, ramp[0] * 0.4 + 165), Math.min(255, ramp[1] * 0.4 + 175), Math.min(255, ramp[2] * 0.4 + 190)]
        : ramp
      if (head) gain *= 1.7
      const cell = column.chars[offset]
      // A missing or empty cell must not reach charCodeAt: "" yields NaN, and
      // NaN % length would index GLYPHS out of range and crash the frame.
      const glyph = GLYPHS[(cell ? cell.charCodeAt(0) : 0) % GLYPHS.length]!
      let inked = 0
      for (let py = 0; py < gh7; py++) {
        const yy = gy0 + py
        if (yy < 0 || yy >= groundY) continue
        const row = glyph[Math.min(6, Math.floor(py / style.scale))]!
        for (let px = 0; px < gw5; px++) {
          const xx = gx0 + px
          if (xx < 0 || xx >= width) continue
          if (!(row & (1 << (4 - Math.min(4, Math.floor(px / style.scale)))))) continue
          inked++
          const i = (yy * width + xx) * 3
          pixels[i] = Math.min(255, pixels[i]! + color[0] * gain)
          pixels[i + 1] = Math.min(255, pixels[i + 1]! + color[1] * gain)
          pixels[i + 2] = Math.min(255, pixels[i + 2]! + color[2] * gain)
        }
      }
      if (inked > 0) {
        const w = gain * style.bloom * (head ? 0.7 : 0.25) * Math.sqrt(inked / 12)
        splat(gx0 + gw5 / 2, gy0 + gh7 / 2, paletteColor(hue, DIGITAL_CODE_LEVELS - 1), w)
        if (head) leadSplat = true
      }
    }
    void leadSplat

    // Landing glints: a falling drop splashes where its head crosses the
    // ground; a rising one leaves a ripple where it lifts off.
    const age = up ? groundY - headY : headY - groundY
    const emerging = up ? headY + span >= groundY : true
    if (age >= 0 && age < 44 && emerging)
      ripples.push({
        x: Math.round(up ? x + gw5 / 2 + style.slope * (groundY - headY) : x + gw5 / 2),
        age,
        hue: column.hue === "blue" ? 1 : 0,
        weight: style.gain,
      })
  }

  // Wet ground: a faint, shimmering, stretched reflection of the rain above.
  const groundSpan = height - groundY
  if (groundSpan > 1) {
    for (let y = groundY; y < height; y++) {
      const depth = (y - groundY) / groundSpan
      const sy = groundY - 1 - Math.floor((y - groundY) * 1.4)
      if (sy < 0) break
      const fade = 0.4 * (1 - depth) ** 1.4 * ignite
      const wobble = Math.sin(y * 0.7 + tick * 0.5)
      for (let x = 0; x < width; x++) {
        const sx = Math.min(width - 1, Math.max(0, x + Math.round(wobble * 2 + Math.sin(x * 0.09 + tick * 0.2))))
        const si = (sy * width + sx) * 3
        const di = (y * width + x) * 3
        pixels[di] = Math.min(255, pixels[di]! + Math.max(0, pixels[si]! - 6) * fade)
        pixels[di + 1] = Math.min(255, pixels[di + 1]! + Math.max(0, pixels[si + 1]! - 9) * fade)
        pixels[di + 2] = Math.min(255, pixels[di + 2]! + Math.max(0, pixels[si + 2]! - 12) * fade * 1.1)
      }
    }
    // Horizon sheen.
    for (let x = 0; x < width; x++) {
      const i = (groundY * width + x) * 3
      pixels[i] = Math.min(255, pixels[i]! + 10)
      pixels[i + 1] = Math.min(255, pixels[i + 1]! + 22 + flash * 30)
      pixels[i + 2] = Math.min(255, pixels[i + 2]! + 34 + flash * 40)
    }
    // Splash rings (flattened ellipses) plus a few spray sparks.
    for (const ripple of ripples) {
      const k = 1 - ripple.age / 44
      const rx = 3 + ripple.age * 0.75
      const ry = Math.max(1, rx * 0.22)
      const a = k * k * ripple.weight * 1.2 * lit
      for (let s = 0; s < 28; s++) {
        const ang = (s / 28) * Math.PI * 2
        const px = Math.round(ripple.x + Math.cos(ang) * rx)
        const py = groundY + 1 + Math.round(Math.sin(ang) * ry + ry)
        if (px < 0 || px >= width || py < groundY || py >= height) continue
        const i = (py * width + px) * 3
        pixels[i] = Math.min(255, pixels[i]! + 120 * a)
        pixels[i + 1] = Math.min(255, pixels[i + 1]! + 190 * a)
        pixels[i + 2] = Math.min(255, pixels[i + 2]! + 240 * a)
      }
      if (ripple.age < 14) {
        const spark = 1 - ripple.age / 14
        for (let s = 0; s < 3; s++) {
          const sx = ripple.x + Math.round((hash(ripple.x * 7 + s) - 0.5) * (6 + ripple.age))
          const sy = groundY - 1 - Math.round(ripple.age * 0.5 * (0.4 + hash(ripple.x * 13 + s)))
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
            const i = (sy * width + sx) * 3
            pixels[i] = Math.min(255, pixels[i]! + 200 * spark * ripple.weight)
            pixels[i + 1] = Math.min(255, pixels[i + 1]! + 235 * spark * ripple.weight)
            pixels[i + 2] = Math.min(255, pixels[i + 2]! + 255 * spark * ripple.weight)
          }
        }
        splat(ripple.x, groundY, RAIN_TINT, spark * ripple.weight * 0.8)
      }
    }
  }

  // Bloom: two box-blur passes (horizontal, vertical) over the quarter-resolution glow buffer.
  const tmp = new Float32Array(glow.length)
  const R = 2
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? glow : tmp
    const dst = pass === 0 ? tmp : glow
    dst.fill(0)
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const di = (gy * gw + gx) * 3
        for (let k = -R; k <= R; k++) {
          const sx = pass === 0 ? gx + k : gx
          const sy = pass === 0 ? gy : gy + k
          if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue
          const si = (sy * gw + sx) * 3
          dst[di] += src[si]!
          dst[di + 1] += src[si + 1]!
          dst[di + 2] += src[si + 2]!
        }
        const norm = 1.1 / (2 * R + 1)
        dst[di] *= norm
        dst[di + 1] *= norm
        dst[di + 2] *= norm
      }
  }

  // Low mist: a drifting cool haze hugging the ground. The ending pulls it
  // higher and thicker, as if the rain were evaporating upward.
  const fogHeight = height * (up ? 0.42 : 0.3)
  const fogGain = up ? 1 : 0.65
  const drift = new Float32Array(width)
  for (let x = 0; x < width; x++)
    drift[x] = 0.7 + 0.3 * Math.sin(x * 0.011 + tick * (up ? -0.05 : 0.04)) * Math.sin(x * 0.027 - tick * 0.03)

  const mask = layers.mask
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, y >> 2)
    const dist = Math.abs(y - groundY)
    const fogRow = Math.exp(-dist / fogHeight) * fogGain * (up && y < groundY ? 1.2 : 1)
    const skyFlash = flash * (y < groundY ? 70 * (1 - (y / groundY) * 0.5) : 10)
    for (let x = 0; x < width; x++) {
      const gi = (gy * gw + Math.min(gw - 1, x >> 2)) * 3
      const i = (y * width + x) * 3
      const m = mask[y * width + x]! / 255
      const fog = fogRow * drift[x]!
      pixels[i] = Math.min(255, (pixels[i]! + glow[gi]! * 0.9 + fog * 20 + skyFlash * 0.6) * m)
      pixels[i + 1] = Math.min(255, (pixels[i + 1]! + glow[gi + 1]! * 0.9 + fog * 36 + skyFlash * 0.85) * m)
      pixels[i + 2] = Math.min(255, (pixels[i + 2]! + glow[gi + 2]! * 0.9 + fog * 52 + skyFlash) * m)
    }
  }
  return pixels
}

export function kittyDigitalCodeDeleteSequence(id: number): string {
  // d=I deletes this image and every placement of it. Quiet (q=2) so the
  // terminal does not write a response into stdin during overlay teardown.
  return `\x1b_Ga=d,d=I,i=${id},q=2;\x1b\\`
}

export function kittyDigitalCodeFrame(
  id: number,
  frame: DigitalCodePixels,
  columns: number,
  rows: number,
  rgb?: Buffer,
): string {
  const payload = deflateSync(rgb ?? renderDigitalCodePixels(frame), { level: 1 }).toString("base64")
  const chunks: string[] = ["\x1b7\x1b[H"]
  for (let offset = 0; offset < payload.length; offset += 4096) {
    const more = offset + 4096 < payload.length ? 1 : 0
    const header =
      offset === 0
        ? `a=T,f=24,o=z,s=${frame.width},v=${frame.height},i=${id},p=1,c=${columns},r=${rows},C=1,z=1,q=2,`
        : ""
    chunks.push(`\x1b_G${header}m=${more};${payload.slice(offset, offset + 4096)}\x1b\\`)
  }
  chunks.push("\x1b8")
  return chunks.join("")
}

// The caller supplies the renderer's native output queue, never intercepted
// console/stdout output. Delete only this playback's image and its placements.
export function digitalCodePixelPlayer(write: (data: string) => void) {
  const id = randomInt(1, 0x7fffffff)
  let frame: DigitalCodePixels | undefined
  let tick = 0
  const started = performance.now()
  let size = ""
  let closed = false
  const clear = () => write(kittyDigitalCodeDeleteSequence(id))
  return {
    draw(input: {
      width: number
      height: number
      columns: number
      rows: number
      direction: DigitalCodeDirection
      style?: OverlayStyle
      elapsedMs?: number
    }) {
      if (closed) return
      const next = `${input.width}:${input.height}:${input.columns}:${input.rows}:${input.direction}:${input.style ?? "digital-code"}`
      if (!frame || next !== size) {
        if (frame) clear()
        frame = createDigitalCodePixels(input.width, input.height, input.direction, undefined, input.style)
        size = next
        tick = 0
      } else if (!isTextSceneStyle(input.style) && !isFoliageVariant(input.style)) {
        // Scene and foliage styles never render the rain; don't pay per-frame
        // column copies for state nobody reads. Style switches rebuild anyway.
        frame.rain = advanceDigitalCode(frame.rain)
        tick++
        frame.tick = tick
      }
      const now = performance.now()
      write(
        kittyDigitalCodeFrame(
          id,
          frame,
          input.columns,
          input.rows,
          isTextSceneStyle(input.style)
            ? renderTextScenePixels(frame.width, frame.height, input.style, input.elapsedMs ?? now - started)
            : isFoliageVariant(input.style)
              ? renderFoliagePixels(frame.width, frame.height, input.style, input.elapsedMs ?? now - started)
              : undefined,
        ),
      )
    },
    dispose() {
      if (closed) return
      closed = true
      if (frame) clear()
      frame = undefined
    },
  }
}
