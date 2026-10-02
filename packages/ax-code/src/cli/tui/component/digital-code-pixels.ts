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
}
const staticCache = new Map<string, StaticLayers>()

function staticLayers(width: number, height: number): StaticLayers {
  const key = `${width}x${height}`
  const hit = staticCache.get(key)
  if (hit) return hit
  const base = Buffer.alloc(width * height * 3)
  const mask = new Uint8Array(width * height)
  const cx = width / 2
  const cy = height / 2
  for (let y = 0; y < height; y++) {
    const scan = y % 3 === 2 ? 0.78 : 1
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / cx
      const ny = (y - cy) / cy
      const r2 = nx * nx * 0.8 + ny * ny * 0.9
      // Central violet core fading to near-black navy at the edges.
      const core = Math.max(0, 1 - r2) ** 2
      const i = (y * width + x) * 3
      base[i] = 3 + core * 26
      base[i + 1] = 2 + core * 8
      base[i + 2] = 9 + core * 44
      mask[y * width + x] = Math.round(255 * scan * Math.max(0.18, 1 - r2 * 0.42))
    }
  }
  if (staticCache.size > 4) staticCache.clear()
  const layers = { base, mask }
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

// Glyph footprint and brightness per depth layer: far drops are small and dim,
// near drops are large, bright and carry most of the bloom.
const LAYER_STYLE = {
  far: { scale: 0.72, gain: 0.5, bloom: 0.5 },
  mid: { scale: 1, gain: 0.85, bloom: 1 },
  near: { scale: 2, gain: 1.15, bloom: 1.6 },
} as const

const BLOOM_DIV = 4

export function renderDigitalCodePixels(frame: Omit<DigitalCodePixels, "tick"> & { tick?: number }): Buffer {
  const { width, height, rain } = frame
  const tick = Math.max(0, Math.floor(frame.tick ?? 0))
  const up = rain.direction === "up"
  const layers = staticLayers(width, height)
  const pixels = Buffer.from(layers.base)
  const gw = Math.ceil(width / BLOOM_DIV)
  const gh = Math.ceil(height / BLOOM_DIV)
  const glow = new Float32Array(gw * gh * 3)
  // Opening ignition: the whole field fades up over the first second.
  const ignite = Math.min(1, 0.35 + tick / 18)

  const splat = (cx: number, cy: number, color: readonly [number, number, number], weight: number) => {
    const gx = Math.floor(cx / BLOOM_DIV)
    const gy = Math.floor(cy / BLOOM_DIV)
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return
    const i = (gy * gw + gx) * 3
    glow[i] += color[0] * weight
    glow[i + 1] += color[1] * weight
    glow[i + 2] += color[2] * weight
  }

  for (let ci = 0; ci < rain.columns.length; ci++) {
    const column = rain.columns[ci]!
    const style = LAYER_STYLE[column.layer ?? "mid"]
    const gh7 = Math.max(1, Math.ceil(7 * style.scale))
    const gw5 = Math.max(1, Math.ceil(5 * style.scale))
    const advance = DIGITAL_CODE_PIXEL_CELL_HEIGHT * style.scale
    const x = column.x * DIGITAL_CODE_PIXEL_CELL_WIDTH
    const headY = Math.floor(column.head * DIGITAL_CODE_PIXEL_CELL_HEIGHT)
    for (let offset = column.length - 1; offset >= 0; offset--) {
      const y = Math.floor(headY + (up ? offset * advance : -offset * advance))
      if (y < -gh7 || y >= height) continue
      const level = digitalCodeCellLevel(rain.direction, offset, column.length)
      const lead = level >= DIGITAL_CODE_LEVELS
      const hue = column.hues[offset] ?? column.hue
      const ramp = paletteColor(hue, level)
      // Shimmer: a deterministic per-cell flicker that changes every other tick.
      const flick = 0.82 + 0.18 * hash(ci * 977 + offset * 31 + (tick >> 1))
      const t = level / DIGITAL_CODE_LEVELS
      let gain = style.gain * flick * ignite * (0.55 + 0.9 * t * t)
      // Hot lead glyph: white-hot core, strongest bloom.
      const color: readonly [number, number, number] = lead
        ? [Math.min(255, ramp[0] * 0.5 + 150), Math.min(255, ramp[1] * 0.5 + 150), Math.min(255, ramp[2] * 0.5 + 150)]
        : ramp
      if (lead) gain *= 1.35
      const cell = column.chars[offset]
      // A missing or empty cell must not reach charCodeAt: "" yields NaN, and
      // NaN % length would index GLYPHS out of range and crash the frame.
      const glyph = GLYPHS[(cell ? cell.charCodeAt(0) : 0) % GLYPHS.length]!
      let lit = 0
      for (let py = 0; py < gh7; py++) {
        const yy = y + py
        if (yy < 0 || yy >= height) continue
        const row = glyph[Math.min(6, Math.floor(py / style.scale))]!
        for (let px = 0; px < gw5; px++) {
          const xx = x + px
          if (xx >= width) break
          if (!(row & (1 << (4 - Math.min(4, Math.floor(px / style.scale)))))) continue
          lit++
          const i = (yy * width + xx) * 3
          pixels[i] = Math.min(255, pixels[i]! + color[0] * gain)
          pixels[i + 1] = Math.min(255, pixels[i + 1]! + color[1] * gain)
          pixels[i + 2] = Math.min(255, pixels[i + 2]! + color[2] * gain)
        }
      }
      if (lit > 0)
        splat(
          x + gw5 / 2,
          y + gh7 / 2,
          paletteColor(hue, DIGITAL_CODE_LEVELS - 1),
          gain * style.bloom * (lead ? 1.1 : 0.4) * Math.sqrt(lit / 12),
        )
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
        const norm = 1.15 / (2 * R + 1)
        dst[di] *= norm
        dst[di + 1] *= norm
        dst[di + 2] *= norm
      }
  }

  // Slow shockwave: a bright sweep line crosses the field every ~3s, down for
  // the opening and up for the ending.
  const period = 60
  const phase = (tick % period) / period
  const sweepY = (up ? 1 - phase : phase) * (height + 80) - 40
  // Glitch burst: every ~2s, three ticks of a displaced, colour-split band.
  const burst = Math.floor(tick / 40)
  const bursting = tick % 40 < 3 && hash(burst + 11) < 0.7 && tick >= 20
  const bandH = 10 + Math.floor(hash(burst * 3 + 1) * 40)
  const bandY = Math.floor(hash(burst * 5 + 2) * Math.max(1, height - bandH))
  const shift = (hash(burst * 7 + 3) < 0.5 ? -1 : 1) * (6 + Math.floor(hash(burst * 11 + 4) * 28))

  const mask = layers.mask
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, y >> 2)
    const sweep = Math.max(0, 1 - Math.abs(y - sweepY) / 18)
    const sweepAdd = sweep * sweep * sweep * 22 * ignite
    if (bursting && y >= bandY && y < bandY + bandH) {
      const rowStart = y * width * 3
      const copy = Buffer.from(pixels.subarray(rowStart, rowStart + width * 3))
      for (let x = 0; x < width; x++) {
        const o = rowStart + x * 3
        const r = Math.min(width - 1, Math.max(0, x - shift))
        const b = Math.min(width - 1, Math.max(0, x + shift))
        pixels[o] = copy[r * 3]!
        pixels[o + 2] = copy[b * 3 + 2]!
      }
    }
    for (let x = 0; x < width; x++) {
      const gi = (gy * gw + Math.min(gw - 1, x >> 2)) * 3
      const i = (y * width + x) * 3
      const m = mask[y * width + x]! / 255
      pixels[i] = Math.min(255, (pixels[i]! + glow[gi]! * 0.9 + sweepAdd * 0.7) * m)
      pixels[i + 1] = Math.min(255, (pixels[i + 1]! + glow[gi + 1]! * 0.9 + sweepAdd * 0.4) * m)
      pixels[i + 2] = Math.min(255, (pixels[i + 2]! + glow[gi + 2]! * 0.9 + sweepAdd) * m)
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
