import { isMahjongStyle } from "./mahjong-view-model"
import { isFujiStyle } from "./fuji-view-model"
import { renderFujiPixels } from "./fuji-pixels"
import { renderMahjongPixels } from "./mahjong-pixels"
import { glyphMask } from "./text-scene-glyphs"
import { textSceneBackground, textSceneRows, type TextSceneStyle } from "./text-scene-view-model"

const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))

export function renderTextScenePixels(width: number, height: number, style: TextSceneStyle, elapsedMs: number): Buffer {
  // Fuji and Mahjong paint freeform HD frames from their shared scene models;
  // the glyph rasterizer below serves the remaining text scenes.
  if (isFujiStyle(style)) return renderFujiPixels(width, height, style, elapsedMs)
  if (isMahjongStyle(style)) return renderMahjongPixels(width, height, style, elapsedMs)
  const pixels = Buffer.alloc(width * height * 3)
  const sceneBackground = rgb(textSceneBackground(style))
  pixels.fill(Buffer.from(sceneBackground))
  // Fit the complete reference composition, retaining its 1:2 cell aspect.
  // Pixel output is independent of terminal columns, font, and line spacing.
  const columns = 70
  const sceneHeight = 23
  const cellWidth = Math.max(1, Math.floor(Math.min(width / (columns + 4), height / ((sceneHeight + 2) * 2))))
  const cellHeight = cellWidth * 2
  const left = Math.floor((width - columns * cellWidth) / 2)
  const top = Math.floor((height - sceneHeight * cellHeight) / 2)
  const rows = textSceneRows(columns, sceneHeight, style, elapsedMs)
  for (let row = 0; row < rows.length; row++) {
    let column = 0
    for (const run of rows[row]!) {
      const foreground = rgb(run.color)
      const runBackground = run.background ? rgb(run.background) : undefined
      for (const char of run.text) {
        const x0 = left + column++ * cellWidth,
          y0 = top + row * cellHeight
        if (char === " " && !run.background) continue
        const mask = glyphMask(char, cellWidth, cellHeight)
        for (let y = 0; y < cellHeight; y++) {
          if (y0 + y < 0 || y0 + y >= height) continue
          const background = runBackground ?? sceneBackground
          for (let x = 0; x < cellWidth; x++) {
            if (x0 + x < 0 || x0 + x >= width) continue
            const alpha = mask[y * cellWidth + x]!
            const index = ((y0 + y) * width + x0 + x) * 3
            for (let c = 0; c < 3; c++)
              pixels[index + c] = Math.round(background[c]! + alpha * (foreground[c]! - background[c]!))
          }
        }
      }
    }
  }
  return pixels
}
