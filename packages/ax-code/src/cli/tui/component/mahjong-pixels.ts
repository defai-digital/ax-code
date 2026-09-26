import {
  MAHJONG_COLUMNS,
  MAHJONG_ENDING_LAYOUT,
  MAHJONG_MATCH_LAYOUT,
  MAHJONG_ROWS,
  MAHJONG_SCORES,
  MAHJONG_TABLE,
  MAHJONG_COLORS,
  mahjongCenterX,
  mahjongEndingBlink,
  mahjongFeltRgb,
  mahjongMatch,
  mahjongScoreLine,
  mahjongSuitColor,
  mahjongTileFace,
  type MahjongStyle,
} from "./mahjong-view-model"
import { blitGlyphText } from "./text-scene-glyphs"

type RGB = readonly [number, number, number]
const hex = (value: string): RGB =>
  [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]

/**
 * Freeform HD renderer. Unlike the glyph rasterizer used by the remaining text
 * scenes, Mahjong paints the felt, frame, labels, and tile faces directly.
 * Layout, palette, match phase, and blink phase come from the shared view
 * model, so the HD frame and the text fallback show the same scene for the
 * same millisecond. Pure and deterministic: no random state, everything
 * derives from `elapsedMs`.
 */
export function renderMahjongPixels(width: number, height: number, style: MahjongStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3)
  if (w === 0 || h === 0) return pixels
  const c = MAHJONG_COLORS
  const cw = w / MAHJONG_COLUMNS,
    ch = h / MAHJONG_ROWS
  const X = (sceneX: number) => sceneX * cw
  const Y = (sceneY: number) => sceneY * ch

  const set = (x: number, y: number, color: RGB) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    pixels[i] = color[0]!
    pixels[i + 1] = color[1]!
    pixels[i + 2] = color[2]!
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, color: RGB) => {
    const xa = Math.max(0, Math.floor(x0)),
      xb = Math.min(w, Math.ceil(x1))
    const ya = Math.max(0, Math.floor(y0)),
      yb = Math.min(h, Math.ceil(y1))
    for (let y = ya; y < yb; y++) {
      let i = (y * w + xa) * 3
      for (let x = xa; x < xb; x++) {
        pixels[i++] = color[0]!
        pixels[i++] = color[1]!
        pixels[i++] = color[2]!
      }
    }
  }
  const disk = (cx: number, cy: number, r: number, color: RGB) => {
    if (r <= 0) return
    const xa = Math.max(0, Math.floor(cx - r)),
      xb = Math.min(w - 1, Math.ceil(cx + r))
    const ya = Math.max(0, Math.floor(cy - r)),
      yb = Math.min(h - 1, Math.ceil(cy + r))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= r * r) set(x, y, color)
      }
    }
  }
  // Labels blend onto the felt without punching holes in the gradient.
  const blit = (sceneX: number, sceneY: number, text: string, color: RGB) => {
    const cellW = Math.max(1, Math.round(cw)),
      cellH = Math.max(1, Math.round(ch))
    let column = sceneX
    for (const char of text) {
      blitGlyphText(pixels, w, h, Math.round(column * cw), Math.round(sceneY * ch), cellW, cellH, char, color)
      column += 1
    }
  }

  // Felt gradient, one color per row.
  for (let y = 0; y < h; y++) {
    const [r, g, b] = mahjongFeltRgb(h <= 1 ? 0 : y / (h - 1))
    let i = y * w * 3
    for (let x = 0; x < w; x++) {
      pixels[i++] = r
      pixels[i++] = g
      pixels[i++] = b
    }
  }

  // Table frame from the shared scene-space bounds.
  const frame = hex(c.frame)
  const table = MAHJONG_TABLE
  const frameT = Math.max(1, Math.round(Math.min(cw, ch) * 0.15))
  rect(X(table.left), Y(table.top), X(table.right + 1), Y(table.top) + frameT, frame)
  rect(X(table.left), Y(table.bottom + 1) - frameT, X(table.right + 1), Y(table.bottom + 1), frame)
  rect(X(table.left), Y(table.top), X(table.left) + frameT, Y(table.bottom + 1), frame)
  rect(X(table.right + 1) - frameT, Y(table.top), X(table.right + 1), Y(table.bottom + 1), frame)

  const ink = hex(c.ink),
    accent = hex(c.accent),
    info = hex(c.info),
    good = hex(c.good)
  const face = hex(c.tileFace),
    edge = hex(c.tileEdge),
    back = hex(c.tileBack),
    backInk = hex(c.tileBackInk)

  // Tiles are two scene cells wide with a one-cell gap, matching the text runs.
  const tile = (sceneX: number, sceneY: number, tileIndex: number, hidden: boolean) => {
    const x0 = X(sceneX),
      y0 = Y(sceneY)
    const tileW = 2 * cw,
      tileH = ch
    if (hidden) {
      rect(x0, y0, x0 + tileW, y0 + tileH, back)
      const ix = tileW * 0.2,
        iy = tileH * 0.2
      const bt = Math.max(1, Math.round(Math.min(tileW, tileH) * 0.08))
      rect(x0 + ix, y0 + iy, x0 + tileW - ix, y0 + iy + bt, backInk)
      rect(x0 + ix, y0 + tileH - iy - bt, x0 + tileW - ix, y0 + tileH - iy, backInk)
      rect(x0 + ix, y0 + iy, x0 + ix + bt, y0 + tileH - iy, backInk)
      rect(x0 + tileW - ix - bt, y0 + iy, x0 + tileW - ix, y0 + tileH - iy, backInk)
      return
    }
    rect(x0, y0, x0 + tileW, y0 + tileH, face)
    const et = Math.max(1, Math.round(Math.min(tileW, tileH) * 0.06))
    rect(x0, y0, x0 + tileW, y0 + et, edge)
    rect(x0, y0 + tileH - et, x0 + tileW, y0 + tileH, edge)
    rect(x0, y0, x0 + et, y0 + tileH, edge)
    rect(x0 + tileW - et, y0, x0 + tileW, y0 + tileH, edge)
    const suit = hex(mahjongSuitColor(tileIndex))
    const glyph = mahjongTileFace(tileIndex)
    const cx = x0 + tileW / 2,
      cy = y0 + tileH / 2
    if (glyph.family === "honor") {
      const ix = tileW * 0.18,
        iy = tileH * 0.18
      rect(x0 + ix, y0 + iy, x0 + tileW - ix, y0 + tileH - iy, suit)
      disk(cx, cy, Math.max(1, Math.round(Math.min(tileW, tileH) * 0.12)), face)
    } else if (glyph.family === "bamboo") {
      const bt = Math.max(1, Math.round(tileW * 0.1))
      for (let i = 0; i < glyph.count; i++) {
        const bx = x0 + (tileW * (i + 1)) / (glyph.count + 1)
        rect(bx - bt / 2, y0 + tileH * 0.18, bx + bt / 2, y0 + tileH * 0.82, suit)
      }
    } else {
      const pipR = Math.max(1, Math.round(Math.min(tileW, tileH) * 0.11))
      if (glyph.count === 1) {
        disk(cx, cy, pipR, suit)
      } else {
        const rows = Math.ceil(glyph.count / 2)
        for (let i = 0; i < glyph.count; i++) {
          const px = cx + ((i % 2) - 0.5) * tileW * 0.44
          const py = rows === 1 ? cy : cy + (Math.floor(i / 2) / (rows - 1) - 0.5) * tileH * 0.55
          disk(px, py, pipR, suit)
        }
      }
    }
  }
  const tiles = (sceneX: number, sceneY: number, hand: number[], hidden = false) =>
    hand.forEach((tileIndex, i) => tile(sceneX + i * 3, sceneY, tileIndex, hidden))

  if (style === "mahjong-ending") {
    const ending = MAHJONG_ENDING_LAYOUT
    const title = "HAND COMPLETED"
    blit(mahjongCenterX(title), ending.titleRow, title, accent)
    const ledger = "FINAL POINT LEDGER"
    blit(mahjongCenterX(ledger), ending.ledgerTitleRow, ledger, info)
    for (let i = 0; i < MAHJONG_SCORES.length; i++) {
      const line = mahjongScoreLine(i)
      blit(mahjongCenterX(line), ending.firstScoreRow + i * ending.scoreRowGap, line, i === 0 ? accent : ink)
    }
    const thanks = "THANK YOU FOR PLAYING"
    blit(mahjongCenterX(thanks), ending.thanksRow, thanks, good)
    const twinkle = mahjongEndingBlink(elapsedMs) ? "*   *   *" : "  *   *  "
    blit(mahjongCenterX(twinkle), ending.blinkRow, twinkle, accent)
    // Blink marker beside the twinkle line, flipping with the shared phase.
    if (mahjongEndingBlink(elapsedMs)) disk(X(38.5), Y(21.5), Math.max(1, Math.round(Math.min(cw, ch) * 0.3)), accent)
  } else {
    const layout = MAHJONG_MATCH_LAYOUT
    const match = mahjongMatch(elapsedMs)
    const title = "MAHJONG MATCH"
    blit(mahjongCenterX(title), layout.titleRow, title, accent)
    const north = "NORTH"
    blit(mahjongCenterX(north), layout.northLabelRow, north, ink)
    tiles(layout.northHandX, layout.northHandRow, match.hands[2]!, true)
    tiles(layout.discardsX, layout.northDiscardsRow, match.discards[2]!)
    blit(layout.westX, layout.sideLabelRow, "WEST", ink)
    blit(layout.eastX, layout.sideLabelRow, "EAST", ink)
    tiles(layout.westX, layout.sideHandRow, match.hands[3]!.slice(0, 4), true)
    tiles(layout.eastX, layout.sideHandRow, match.hands[1]!.slice(0, 4), true)
    tiles(layout.westX, layout.sideDiscardsRow, match.discards[3]!)
    tiles(layout.eastX, layout.sideDiscardsRow, match.discards[1]!)
    const view = "MATCH VIEW"
    blit(mahjongCenterX(view), layout.viewRow, view, info)
    tiles(layout.discardsX, layout.southDiscardsRow, match.discards[0]!)
    const south = "YOU (SOUTH)"
    blit(mahjongCenterX(south), layout.southLabelRow, south, ink)
    tiles(layout.southHandX, layout.southHandRow, match.hands[0]!)
    blit(mahjongCenterX(match.action), layout.actionRow, match.action, info)
    blit(layout.westX, layout.statusRow, `WALL: ${match.wall}`, good)
    blit(layout.turnX, layout.statusRow, `TURN: ${match.turn}`, accent)
  }

  return pixels
}
