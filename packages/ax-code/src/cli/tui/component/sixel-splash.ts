// Static single-frame Sixel splash for the TUI opening/ending overlay.
//
// Windows Terminal supports Sixel but not Kitty graphics, so the animated
// Kitty pixel path never engages there. This module offers those sessions one
// static pixel frame instead of raw ASCII: the same RGB scene buffers,
// quantized to the 256-entry Sixel palette and emitted as a single 7-bit DCS
// sequence. Anything unexpected (encode failure, oversize payload, write
// failure) falls back to the ASCII overlay — the caller owns that fallback.
//
// Two Sixel facts shape this design:
// - Sixel has no image id, so teardown cannot delete. Disposal repaints the
//   same geometry with the overlay background color, which reads as removal.
//   A future renderer region-invalidate API could repaint text instead.
// - Sixel cells share the text grid: any renderer repaint of covered cells
//   erases the splash there. The caller freezes ASCII updates while the splash
//   is up and draws only after the first ASCII frame has painted.

import { isTextSceneStyle } from "./text-scene-view-model"
import { renderTextScenePixels } from "./text-scene-pixels"
import { isFoliageVariant, renderFoliagePixels, type OverlayStyle } from "./foliage-view-model"
import { advanceDigitalCode, type DigitalCodeDirection } from "./digital-code-view-model"
import { createDigitalCodePixels, renderDigitalCodePixels } from "./digital-code-pixels"

// Budget: one small opaque frame. Animated Sixel is a different project.
export const SIXEL_SPLASH_MAX_WIDTH = 640
export const SIXEL_SPLASH_MAX_HEIGHT = 360
export const SIXEL_SPLASH_MAX_BYTES = 256 * 1024
// Viewports smaller than this stay on the ASCII overlay.
export const SIXEL_SPLASH_MIN_COLUMNS = 40
export const SIXEL_SPLASH_MIN_ROWS = 10
// Overlay ticks (50ms) before the first splash draw, so at least one ASCII
// frame has painted underneath. Drawing earlier risks the renderer painting
// text over the fresh splash and eating it cell by cell.
export const SIXEL_SPLASH_MIN_TICKS = 2
// Registers 1..255 carry splash colors; register 0 is background-select and
// never holds a real color. Every pixel is painted, so background-select
// behavior never shows through.
const SIXEL_REGISTERS = 255
const SIXEL_RLE_MIN_RUN = 3
const SIXEL_RLE_MAX_RUN = 255
// Representative development for the static frame: the rain field and the
// scenes animate over time, so frame zero would look empty or unsettled.
const SIXEL_SPLASH_RAIN_TICKS = 20
const SIXEL_SPLASH_SCENE_ELAPSED_MS = 1000

export type SixelSplashSize = {
  width: number
  height: number
}

/** Fit a pixel resolution into the splash budget, preserving aspect. */
export function sixelSplashSize(resolutionWidth: number, resolutionHeight: number): SixelSplashSize {
  const sourceWidth = Math.max(1, Math.floor(resolutionWidth))
  const sourceHeight = Math.max(1, Math.floor(resolutionHeight))
  const scale = Math.min(1, SIXEL_SPLASH_MAX_WIDTH / sourceWidth, SIXEL_SPLASH_MAX_HEIGHT / sourceHeight)
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  }
}

export type SixelSplashRaster = {
  data: Buffer
  width: number
  height: number
}

function parseSplashHex(value: string): readonly [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim())
  if (!match) return [0, 0, 0]
  const hex = match[1]!
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number]
}

/** Pad raster height up to a multiple of 6 (one Sixel band) with `background`. */
export function padSplashToBand(
  data: Buffer,
  width: number,
  height: number,
  background: string,
): SixelSplashRaster | null {
  if (width <= 0 || height <= 0 || data.length !== width * height * 3) return null
  const paddedHeight = Math.ceil(height / 6) * 6
  if (paddedHeight === height) return { data, width, height }
  const [r, g, b] = parseSplashHex(background)
  const padded = Buffer.alloc(width * paddedHeight * 3)
  data.copy(padded)
  for (let i = data.length; i < padded.length; i += 3) {
    padded[i] = r
    padded[i + 1] = g
    padded[i + 2] = b
  }
  return { data: padded, width, height: paddedHeight }
}

type SplashColorEntry = {
  key: number
  r: number
  g: number
  b: number
  count: number
}

const toSixelChannel = (channel: number) => Math.round((channel * 100) / 255)

function collectSplashEntries(data: Buffer): { entries: SplashColorEntry[]; keyOf: number[] } {
  const index = new Map<number, number>()
  const entries: SplashColorEntry[] = []
  const keyOf = new Array<number>(Math.floor(data.length / 3))
  for (let offset = 0, pixel = 0; offset < data.length; offset += 3, pixel++) {
    const r = toSixelChannel(data[offset]!)
    const g = toSixelChannel(data[offset + 1]!)
    const b = toSixelChannel(data[offset + 2]!)
    const key = (r * 101 + g) * 101 + b
    keyOf[pixel] = key
    const at = index.get(key)
    if (at === undefined) {
      index.set(key, entries.length)
      entries.push({ key, r, g, b, count: 1 })
    } else {
      entries[at]!.count++
    }
  }
  return { entries, keyOf }
}

/**
 * Deterministic median-cut over the 0-100 channel space. Boxes split along
 * the widest channel at the count median; ties break by pixel count, then box
 * order, then channel order (r > g > b), so the same raster always yields the
 * same palette. No dithering: it breaks RLE runs and explodes the payload.
 */
function medianCutSplashPalette(entries: SplashColorEntry[]): {
  palette: [number, number, number][]
  boxOf: Map<number, number>
} {
  let boxes: number[][] = entries.length > 0 ? [entries.map((_, position) => position)] : []
  const boxCount = (box: number[]) => box.reduce((total, entry) => total + entries[entry]!.count, 0)
  const boxRanges = (box: number[]) => {
    let rMin = 100
    let rMax = 0
    let gMin = 100
    let gMax = 0
    let bMin = 100
    let bMax = 0
    for (const entry of box) {
      const color = entries[entry]!
      if (color.r < rMin) rMin = color.r
      if (color.r > rMax) rMax = color.r
      if (color.g < gMin) gMin = color.g
      if (color.g > gMax) gMax = color.g
      if (color.b < bMin) bMin = color.b
      if (color.b > bMax) bMax = color.b
    }
    return [rMax - rMin, gMax - gMin, bMax - bMin] as const
  }
  while (boxes.length < SIXEL_REGISTERS) {
    let pick = -1
    let pickRange = 0
    let pickCount = 0
    for (let position = 0; position < boxes.length; position++) {
      const box = boxes[position]!
      if (box.length < 2) continue
      const ranges = boxRanges(box)
      const range = Math.max(ranges[0], ranges[1], ranges[2])
      const count = boxCount(box)
      if (range === 0) continue
      if (range > pickRange || (range === pickRange && count > pickCount)) {
        pick = position
        pickRange = range
        pickCount = count
      }
    }
    if (pick === -1) break
    const box = boxes[pick]!
    const ranges = boxRanges(box)
    const channel = ranges[0] >= ranges[1] && ranges[0] >= ranges[2] ? 0 : ranges[1] >= ranges[2] ? 1 : 2
    const fields = ["r", "g", "b"] as const
    const field = fields[channel]!
    const sorted = [...box].sort((left, right) => entries[left]![field] - entries[right]![field])
    const total = boxCount(box)
    let run = 0
    let cut = 0
    while (cut < sorted.length - 1) {
      run += entries[sorted[cut]!]!.count
      cut++
      if (run * 2 >= total) break
    }
    boxes = [...boxes.slice(0, pick), sorted.slice(0, cut), sorted.slice(cut), ...boxes.slice(pick + 1)]
  }
  const palette: [number, number, number][] = []
  const boxOf = new Map<number, number>()
  boxes.forEach((box, register) => {
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    for (const entry of box) {
      const color = entries[entry]!
      r += color.r * color.count
      g += color.g * color.count
      b += color.b * color.count
      count += color.count
      boxOf.set(color.key, register)
    }
    palette.push([
      Math.max(0, Math.min(100, Math.round(r / Math.max(1, count)))),
      Math.max(0, Math.min(100, Math.round(g / Math.max(1, count)))),
      Math.max(0, Math.min(100, Math.round(b / Math.max(1, count)))),
    ])
  })
  return { palette, boxOf }
}

/**
 * Encode one RGB raster as a single 7-bit Sixel DCS sequence, or null when
 * the input is invalid or the payload exceeds the byte budget (the caller
 * falls back to ASCII). Height must already be a multiple of 6.
 */
export function encodeSixelSplash(data: Buffer, width: number, height: number): string | null {
  if (width <= 0 || height <= 0 || height % 6 !== 0 || data.length !== width * height * 3) return null
  const { entries, keyOf } = collectSplashEntries(data)
  let palette: [number, number, number][]
  const registerOf = new Map<number, number>()
  if (entries.length <= SIXEL_REGISTERS) {
    palette = entries.map((entry) => [entry.r, entry.g, entry.b])
    entries.forEach((entry, register) => registerOf.set(entry.key, register + 1))
  } else {
    const cut = medianCutSplashPalette(entries)
    palette = cut.palette
    for (const [key, box] of cut.boxOf) registerOf.set(key, box + 1)
  }
  // Per-pixel registers, resolved once: the band loop below is hot.
  const pixelRegister = new Uint16Array(keyOf.length)
  for (let pixel = 0; pixel < keyOf.length; pixel++) pixelRegister[pixel] = registerOf.get(keyOf[pixel]!) ?? 1

  const parts: string[] = [`\x1bP0;1;0q"1;1;${width};${height}`]
  palette.forEach(([r, g, b], register) => parts.push(`#${register + 1};2;${r};${g};${b}`))
  const bands = height / 6
  for (let band = 0; band < bands; band++) {
    const base = band * 6 * width
    const present = new Set<number>()
    for (let pixel = 0; pixel < width * 6; pixel++) present.add(pixelRegister[base + pixel]!)
    const ordered = [...present].sort((left, right) => left - right)
    // One byte column per color, built in a single x pass so busy bands stay
    // linear in pixels instead of quadratic in palette size. The column byte
    // is 0x3F plus the sixel mask (bit 0 is the top row), applied at emit.
    const columns = new Map<number, Uint8Array>()
    for (const register of ordered) columns.set(register, new Uint8Array(width))
    for (let x = 0; x < width; x++) {
      for (let row = 0; row < 6; row++) {
        const register = pixelRegister[base + row * width + x]!
        columns.get(register)![x]! |= 1 << row
      }
    }
    for (const register of ordered) {
      parts.push(`#${register}`)
      const bytes = columns.get(register)!
      let runByte = -1
      let runLength = 0
      const flush = () => {
        if (runLength <= 0) return
        const char = String.fromCharCode(runByte)
        if (runLength >= SIXEL_RLE_MIN_RUN) parts.push(`!${runLength}${char}`)
        else for (let rest = 0; rest < runLength; rest++) parts.push(char)
      }
      for (let x = 0; x < width; x++) {
        const byte = 0x3f + bytes[x]!
        if (byte === runByte && runLength < SIXEL_RLE_MAX_RUN) runLength++
        else {
          flush()
          runByte = byte
          runLength = 1
        }
      }
      flush()
      parts.push("$")
    }
    if (band < bands - 1) parts.push("-")
  }
  parts.push("\x1b\\")
  const output = parts.join("")
  return output.length > SIXEL_SPLASH_MAX_BYTES ? null : output
}

function renderSplashRgb(width: number, height: number, direction: DigitalCodeDirection, style?: OverlayStyle): Buffer {
  if (isTextSceneStyle(style)) return renderTextScenePixels(width, height, style, SIXEL_SPLASH_SCENE_ELAPSED_MS)
  if (isFoliageVariant(style)) return renderFoliagePixels(width, height, style, SIXEL_SPLASH_SCENE_ELAPSED_MS)
  const frame = createDigitalCodePixels(width, height, direction)
  for (let tick = 0; tick < SIXEL_SPLASH_RAIN_TICKS; tick++) frame.rain = advanceDigitalCode(frame.rain)
  frame.tick = SIXEL_SPLASH_RAIN_TICKS
  return renderDigitalCodePixels(frame)
}

export function supportsSixelSplash(input: {
  tty: boolean
  screenMode: string
  columns: number
  rows: number
  capabilities?: {
    kitty_graphics: boolean
    sixel: boolean
    remote: boolean
    multiplexer: string
  } | null
  /** Direct Windows Terminal host (WT_SESSION without a nested TERM_PROGRAM). */
  windowsTerminal: boolean
  /** AX_CODE_SIXEL_SPLASH_ENV: true bypasses the host gate (test path), false forces off. */
  env?: boolean
}): boolean {
  if (input.env === false) return false
  // The renderer sixel flag is the positive signal, but until it is verified
  // on real Windows Terminal hardware through ConPTY, the splash additionally
  // requires the tested host gate. SSH byte forwarding would work, yet v1
  // mirrors the Kitty path and excludes remote sessions for a smaller blast
  // radius; WSL tabs launched by Windows Terminal pass the host gate.
  if (input.env !== true && !input.windowsTerminal) return false
  if (input.columns < SIXEL_SPLASH_MIN_COLUMNS || input.rows < SIXEL_SPLASH_MIN_ROWS) return false
  const caps = input.capabilities
  return (
    input.tty &&
    input.screenMode === "alternate-screen" &&
    caps?.sixel === true &&
    caps.kitty_graphics !== true &&
    caps.remote === false &&
    caps.multiplexer === "none"
  )
}

export type SixelSplashDrawInput = {
  /** Viewport pixels; fitted into the splash budget preserving aspect. */
  width: number
  height: number
  direction: DigitalCodeDirection
  style?: OverlayStyle
  /** Overlay background hex, used for band padding and teardown repaint. */
  background: string
}

// The caller supplies the renderer's native output queue, never intercepted
// console/stdout output. Throws on encode failure so the caller falls back.
export function sixelSplashPlayer(write: (data: string) => void) {
  let drawn: SixelSplashRaster | undefined
  let background = "#000000"
  let closed = false
  return {
    draw(input: SixelSplashDrawInput) {
      if (closed || drawn) return
      background = input.background
      const size = sixelSplashSize(input.width, input.height)
      const rgb = renderSplashRgb(size.width, size.height, input.direction, input.style)
      const raster = padSplashToBand(rgb, size.width, size.height, background)
      const dcs = raster ? encodeSixelSplash(raster.data, raster.width, raster.height) : null
      if (!dcs || !raster) throw new Error("Sixel splash exceeded the size budget")
      write(`\x1b7\x1b[H${dcs}\x1b8`)
      drawn = raster
    },
    dispose() {
      if (closed) return
      closed = true
      const raster = drawn
      drawn = undefined
      if (!raster) return
      // No image id to delete: repaint the same geometry with the overlay
      // background, which reads as removal.
      const [r, g, b] = parseSplashHex(background)
      const solid = Buffer.alloc(raster.data.length)
      for (let offset = 0; offset < solid.length; offset += 3) {
        solid[offset] = r
        solid[offset + 1] = g
        solid[offset + 2] = b
      }
      const dcs = encodeSixelSplash(solid, raster.width, raster.height)
      if (!dcs) return
      write(`\x1b7\x1b[H${dcs}\x1b8`)
    },
  }
}
