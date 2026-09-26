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
    rain: createDigitalCode({ width: Math.floor(w / 7), height: Math.ceil(h / 6), direction, random }),
  }
}
export type DigitalCodePixels = ReturnType<typeof createDigitalCodePixels>

function paletteColor(hue: DigitalCodeHue, level: number): readonly [number, number, number] {
  const ramp = DIGITAL_CODE_LEVEL_RGB[hue]
  return ramp[Math.min(DIGITAL_CODE_LEVELS, Math.max(0, level))] ?? ramp[DIGITAL_CODE_LEVELS]!
}

export function renderDigitalCodePixels(frame: DigitalCodePixels): Buffer {
  const { width, height, rain } = frame
  const pixels = Buffer.alloc(width * height * 3)
  const paint = (x: number, y: number, strength: number, color: readonly [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = (y * width + x) * 3
    for (let c = 0; c < 3; c++) pixels[index + c] = Math.min(255, pixels[index + c]! + color[c]! * strength)
  }
  for (const column of rain.columns) {
    for (let offset = column.length - 1; offset >= 0; offset--) {
      const x = column.x * 7
      const y = Math.floor(column.head * 6) + (rain.direction === "up" ? offset * 6 : -offset * 6)
      if (y < -7 || y >= height) continue
      const level = digitalCodeCellLevel(rain.direction, offset, column.length)
      const hue = column.hues[offset] ?? column.hue
      const color = paletteColor(hue, level)
      const cell = column.chars[offset]
      // A missing or empty cell must not reach charCodeAt: "" yields NaN, and
      // NaN % length would index GLYPHS out of range and crash the frame.
      const glyph = GLYPHS[(cell ? cell.charCodeAt(0) : 0) % GLYPHS.length]!
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (!(glyph[gy]! & (1 << (4 - gx)))) continue
          paint(x + gx, y + gy, 1, color)
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            paint(x + gx + dx!, y + gy + dy!, 0.12, color)
          }
        }
      }
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
      } else frame.rain = advanceDigitalCode(frame.rain)
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
