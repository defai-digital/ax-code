import { renderTextScenePixels } from "./text-scene-pixels"
import { isTextSceneStyle } from "./text-scene-view-model"
import { createFoliagePixelPainter, isFoliageVariant, type OverlayStyle } from "./foliage-view-model"
import { deflateSync } from "node:zlib"
import { randomInt } from "node:crypto"
import {
  createDigitalCode,
  advanceDigitalCode,
  digitalCodeCellLevel,
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

/**
 * Classic Matrix palettes for the HD raster. The opening falls in green, the
 * ending rises in gold. Index 0 is blank, the last entry is the white-hot lead.
 * Hue keys follow the shared view-model hues: "purple" is the dominant tone,
 * "blue" a paler accent and "highlight" a near-white sparkle.
 */
export const DIGITAL_CODE_MATRIX_RGB: Record<
  DigitalCodeDirection,
  Record<DigitalCodeHue, readonly (readonly [number, number, number])[]>
> = {
  down: {
    purple: [
      [0, 0, 0],
      [0, 22, 6],
      [0, 52, 16],
      [6, 104, 36],
      [22, 168, 66],
      [70, 228, 116],
      [205, 255, 220],
    ],
    blue: [
      [0, 0, 0],
      [4, 30, 18],
      [8, 64, 40],
      [20, 120, 76],
      [50, 190, 120],
      [120, 245, 170],
      [225, 255, 240],
    ],
    highlight: [
      [0, 0, 0],
      [20, 34, 24],
      [50, 80, 58],
      [100, 150, 110],
      [160, 215, 170],
      [215, 255, 225],
      [255, 255, 255],
    ],
  },
  up: {
    purple: [
      [0, 0, 0],
      [26, 18, 0],
      [60, 44, 0],
      [120, 88, 4],
      [190, 144, 12],
      [245, 200, 40],
      [255, 244, 200],
    ],
    blue: [
      [0, 0, 0],
      [34, 24, 4],
      [78, 56, 10],
      [150, 112, 24],
      [220, 170, 50],
      [255, 222, 100],
      [255, 250, 225],
    ],
    highlight: [
      [0, 0, 0],
      [34, 30, 20],
      [80, 72, 48],
      [150, 135, 90],
      [215, 195, 140],
      [255, 240, 190],
      [255, 255, 255],
    ],
  },
}

/** Continuous ramp lookup: `level` may be fractional, 0..DIGITAL_CODE_LEVELS. */
function matrixColor(
  direction: DigitalCodeDirection,
  hue: DigitalCodeHue,
  level: number,
): readonly [number, number, number] {
  const ramp = DIGITAL_CODE_MATRIX_RGB[direction][hue]
  const f = Math.min(DIGITAL_CODE_LEVELS, Math.max(0, level))
  const lo = Math.floor(f)
  const hi = Math.min(DIGITAL_CODE_LEVELS, lo + 1)
  const k = f - lo
  const a = ramp[lo]!
  const b = ramp[hi]!
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

function hash(n: number): number {
  let h = Math.imul(n | 0, 0x45d9f3b) ^ 0x1b873593
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

// Depth layers: far glyphs are small, dim and soft; near glyphs are larger,
// sharper and brighter. Columns are perfectly vertical on the lane grid.
const LAYER_STYLE = {
  far: { scale: 0.72, gain: 0.5, soft: true, bloom: 0.35 },
  mid: { scale: 1, gain: 0.85, soft: false, bloom: 0.7 },
  near: { scale: 1.43, gain: 1.1, soft: false, bloom: 1.1 },
} as const

const BLOOM_DIV = 4

export function renderDigitalCodePixels(frame: Omit<DigitalCodePixels, "tick"> & { tick?: number }): Buffer {
  const { width, height, rain } = frame
  const tick = Math.max(0, Math.floor(frame.tick ?? 0))
  const up = rain.direction === "up"
  const theme = rain.direction
  const pixels = Buffer.alloc(width * height * 3)
  const gw = Math.ceil(width / BLOOM_DIV)
  const gh = Math.ceil(height / BLOOM_DIV)
  const glow = new Float32Array(gw * gh * 3)
  // The field fades up over the first second.
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
  const add = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 3
    pixels[i] = Math.min(255, pixels[i]! + r)
    pixels[i + 1] = Math.min(255, pixels[i + 1]! + g)
    pixels[i + 2] = Math.min(255, pixels[i + 2]! + b)
  }

  for (let ci = 0; ci < rain.columns.length; ci++) {
    const column = rain.columns[ci]!
    const style = LAYER_STYLE[column.layer ?? "mid"]
    const gh7 = Math.max(1, Math.ceil(7 * style.scale))
    const gw5 = Math.max(1, Math.ceil(5 * style.scale))
    const advance = DIGITAL_CODE_PIXEL_CELL_HEIGHT * style.scale
    const x = column.x * DIGITAL_CODE_PIXEL_CELL_WIDTH
    const headY = Math.floor(column.head * DIGITAL_CODE_PIXEL_CELL_HEIGHT)
    // Each drop has its own overall brightness, so neighbouring columns differ.
    const columnGain = 0.7 + 0.45 * hash(ci * 7919 + 13)
    const span = Math.max(1, column.length - 1)
    for (let offset = column.length - 1; offset >= 0; offset--) {
      const y = Math.floor(headY + (up ? offset * advance : -offset * advance))
      if (y < -gh7 || y >= height) continue
      const level = digitalCodeCellLevel(rain.direction, offset, column.length)
      const lead = level >= DIGITAL_CODE_LEVELS
      // Continuous brightness along the trail, matching the integer level.
      const fine = up
        ? 1 + (offset * (DIGITAL_CODE_LEVELS - 1)) / span
        : DIGITAL_CODE_LEVELS - (offset * (DIGITAL_CODE_LEVELS - 1)) / span
      const hue = column.hues[offset] ?? column.hue
      const cellKey = ci * 977 + offset * 31
      // Per-glyph shimmer and its own mutation clock: every glyph changes
      // shape on its own phase, independently of the model's mutations.
      const phase = Math.floor(hash(cellKey + 3) * 9)
      const epoch = Math.floor((tick + phase) / (3 + (phase % 4)))
      const mutated = hash(cellKey + epoch * 7919) < (lead ? 0.9 : 0.3)
      const cell = column.chars[offset]
      // A missing or empty cell must not reach charCodeAt: "" yields NaN, and
      // NaN % length would index GLYPHS out of range and crash the frame.
      const code = (cell ? cell.charCodeAt(0) : 0) + (mutated ? 1 + Math.floor(hash(cellKey + epoch * 31 + 5) * 15) : 0)
      const glyph = GLYPHS[code % GLYPHS.length]!
      const vary = 0.55 + 0.45 * hash(cellKey + (tick >> 1) * 131)
      const color = matrixColor(theme, hue, lead ? DIGITAL_CODE_LEVELS : fine)
      const gain =
        (lead ? 1.15 : style.gain * columnGain * vary * (0.35 + 0.65 * (fine / DIGITAL_CODE_LEVELS))) * ignite
      let inked = 0
      for (let py = 0; py < gh7; py++) {
        const row = glyph[Math.min(6, Math.floor(py / style.scale))]!
        for (let px = 0; px < gw5; px++) {
          if (!(row & (1 << (4 - Math.min(4, Math.floor(px / style.scale)))))) continue
          inked++
          if (style.soft) {
            // Far layer: out-of-focus, spread over a plus-shaped footprint.
            add(x + px, y + py, color[0] * gain * 0.6, color[1] * gain * 0.6, color[2] * gain * 0.6)
            for (const [dx, dy] of [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ] as const)
              add(x + px + dx, y + py + dy, color[0] * gain * 0.14, color[1] * gain * 0.14, color[2] * gain * 0.14)
          } else {
            add(x + px, y + py, color[0] * gain, color[1] * gain, color[2] * gain)
          }
        }
      }
      if (inked > 0) {
        // Sparkle: a rare bright white pixel on a glyph, strongest in gold.
        if (hash(cellKey + tick * 17) < (up ? 0.12 : 0.04))
          add(
            x + Math.floor(hash(cellKey + 9) * gw5),
            y + Math.floor(hash(cellKey + 11) * gh7),
            170 * ignite,
            170 * ignite,
            150 * ignite,
          )
        splat(
          x + gw5 / 2,
          y + gh7 / 2,
          matrixColor(theme, hue, lead ? DIGITAL_CODE_LEVELS - 1 : fine),
          gain * style.bloom * (lead ? 2.4 : 0.22) * Math.sqrt(inked / 12),
        )
      }
    }
  }

  // Bloom: two box-blur passes (horizontal, vertical) over the quarter-resolution glow buffer.
  const tmp = new Float32Array(glow.length)
  const R = 2
  for (let pass = 0; pass < 4; pass++) {
    const src = pass % 2 === 0 ? glow : tmp
    const dst = pass % 2 === 0 ? tmp : glow
    dst.fill(0)
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const di = (gy * gw + gx) * 3
        for (let k = -R; k <= R; k++) {
          const sx = pass % 2 === 0 ? gx + k : gx
          const sy = pass % 2 === 0 ? gy : gy + k
          if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue
          const si = (sy * gw + sx) * 3
          dst[di] += src[si]!
          dst[di + 1] += src[si + 1]!
          dst[di + 2] += src[si + 2]!
        }
        const norm = 1 / (2 * R + 1)
        dst[di] *= norm
        dst[di + 1] *= norm
        dst[di + 2] *= norm
      }
  }
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, y >> 2)
    for (let x = 0; x < width; x++) {
      const gi = (gy * gw + Math.min(gw - 1, x >> 2)) * 3
      const i = (y * width + x) * 3
      pixels[i] = Math.min(255, pixels[i]! + glow[gi]! * 0.8)
      pixels[i + 1] = Math.min(255, pixels[i + 1]! + glow[gi + 1]! * 0.8)
      pixels[i + 2] = Math.min(255, pixels[i + 2]! + glow[gi + 2]! * 0.8)
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
  let foliagePainter: ReturnType<typeof createFoliagePixelPainter> | undefined
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
        foliagePainter = isFoliageVariant(input.style)
          ? createFoliagePixelPainter(frame.width, frame.height, input.style)
          : undefined
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
            : foliagePainter
              ? foliagePainter(input.elapsedMs ?? now - started)
              : undefined,
        ),
      )
    },
    dispose() {
      if (closed) return
      closed = true
      const active = frame
      frame = undefined
      foliagePainter = undefined
      if (active) clear()
    },
  }
}
