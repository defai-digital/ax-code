import { artHash, blendPixel, glow, softDisk } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  MAHJONG_COLORS,
  MAHJONG_COLUMNS,
  MAHJONG_ENDING_LAYOUT,
  MAHJONG_INNER,
  MAHJONG_MATCH_LAYOUT,
  MAHJONG_ROWS,
  MAHJONG_SCORES,
  MAHJONG_TABLE,
  MAHJONG_WALL_BAR_LEN,
  MAHJONG_WALL_BAR_X,
  mahjongCenterX,
  mahjongEndingBlink,
  mahjongFeltRgb,
  mahjongLatestMarker,
  mahjongMatch,
  mahjongRank,
  mahjongRankColor,
  mahjongRankedLine,
  mahjongSeatLabel,
  mahjongSuitColor,
  mahjongTileFace,
  mahjongWallFill,
  type MahjongStyle,
} from "./mahjong-view-model"
import { blitGlyphText } from "./text-scene-glyphs"

/** Ending confetti loop and match loop share one 4800ms cycle. */
const MAHJONG_CYCLE_MS = 4800

/**
 * Freeform HD renderer. Woven felt under a warm lamp, a polished jade table
 * rim with gold inlay, solid ivory tiles with jade backs, drop shadows, and
 * carved circle, bamboo, and dragon faces, a glossy wall meter, and a gold
 * medal ledger with falling confetti for the ending. Layout, palette, match
 * phase, and blink phase come from the shared view model, so the HD frame and
 * the text fallback show the same scene for the same millisecond. Pure and
 * deterministic: everything derives from `elapsedMs`.
 */
export function renderMahjongPixels(width: number, height: number, style: MahjongStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, MAHJONG_COLUMNS, MAHJONG_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const { w, h, cw, ch, X, Y } = hd
  const c = MAHJONG_COLORS
  const elapsed = Math.max(0, elapsedMs)
  const u = Math.min(cw, ch / 2)
  const cycle = (elapsed % MAHJONG_CYCLE_MS) / MAHJONG_CYCLE_MS
  const ink = hdHex(c.ink)
  const accent = hdHex(c.accent)
  const info = hdHex(c.info)
  const good = hdHex(c.good)
  const frame = hdHex(c.frame)
  const frameDim = hdHex(c.frameDim)
  const ivory = hdHex(c.tileFace)
  const jade = hdHex(c.tileBack)
  const jadeInk = hdHex(c.tileBackInk)
  const jadeEdge = hdHex(c.tileEdge)

  // Labels blend onto the felt without punching holes in the gradient.
  const blit = (sceneX: number, sceneY: number, text: string, color: RGB) => {
    const cellW = Math.max(1, Math.round(cw))
    const cellH = Math.max(1, Math.round(ch))
    const px = Math.round(sceneX * cw)
    const py = Math.round(sceneY * ch)
    blitGlyphText(hd.pixels, w, h, px, py, cellW, cellH, text, color)
  }

  // Felt: vertical gradient, warm lamp pool in the middle, woven grain.
  hd.sky((t) => mahjongFeltRgb(t))
  const lampX = w / 2
  const lampY = Y(9)
  glow(hd, lampX, lampY, Math.max(w, h * 2) * 0.62, [120, 230, 170], 0.16)
  glow(hd, lampX, lampY, Math.max(w, h * 2) * 0.3, [255, 240, 190], 0.07)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 1.03 : 0.97
      const k = weave + (artHash(x, y) - 0.5) * 0.05
      const i = (y * w + x) * 3
      hd.pixels[i] = Math.min(255, Math.round(hd.pixels[i]! * k))
      hd.pixels[i + 1] = Math.min(255, Math.round(hd.pixels[i + 1]! * k))
      hd.pixels[i + 2] = Math.min(255, Math.round(hd.pixels[i + 2]! * k))
    }
  }

  // Rounded rectangle with a per-pixel shader and an anti-aliased edge.
  const roundRect = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
    shade: (px: number, py: number, u: number, v: number) => RGB,
    alpha = 1,
  ) => {
    const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
    const xa = Math.max(0, Math.floor(x0))
    const xb = Math.min(w - 1, Math.ceil(x1))
    const ya = Math.max(0, Math.floor(y0))
    const yb = Math.min(h - 1, Math.ceil(y1))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const qx = Math.max(x0 + r - px, 0, px - (x1 - r))
        const qy = Math.max(y0 + r - py, 0, py - (y1 - r))
        const d = Math.hypot(qx, qy) - r
        const cover = Math.max(0, Math.min(1, 0.5 - d))
        if (px < x0 - 0.5 || px > x1 + 0.5 || py < y0 - 0.5 || py > y1 + 0.5 || cover <= 0) continue
        blendPixel(hd, x, y, shade(px, py, (px - x0) / (x1 - x0 || 1), (py - y0) / (y1 - y0 || 1)), cover * alpha)
      }
    }
  }
  const shadowRect = (x0: number, y0: number, x1: number, y1: number, spread: number, strength: number) => {
    for (let k = spread; k >= 1; k--) {
      roundRect(x0 - k + 1, y0 - k + 2, x1 + k + 1, y1 + k + 3, k + 2, () => [0, 8, 5], (strength / spread) * 0.9)
    }
  }

  // Table rim: jade bevel with a gold inlay line, then an inner border.
  const table = MAHJONG_TABLE
  const rimT = Math.max(3, u * 0.9)
  const tx0 = X(table.left)
  const ty0 = Y(table.top)
  const tx1 = X(table.right + 1)
  const ty1 = Y(table.bottom + 1)
  const rim = (px: number, py: number) => {
    const edge = Math.min(px - tx0, tx1 - px, py - ty0, ty1 - py)
    const t = Math.max(0, Math.min(1, edge / rimT))
    const bevelLight = px - tx0 < rimT || py - ty0 < rimT ? 1 : 0
    let col = hdMix(hdDarken(frameDim, 0.55), frame, Math.sin(t * Math.PI * 0.5))
    if (bevelLight && edge < rimT * 0.4) col = hdMix(col, [150, 255, 210], 0.3)
    if (edge > rimT * 0.55 && edge < rimT * 0.75) col = hdMix(col, accent, 0.65)
    return col
  }
  for (let y = Math.max(0, Math.floor(ty0)); y < Math.min(h, Math.ceil(ty1)); y++) {
    for (let x = Math.max(0, Math.floor(tx0)); x < Math.min(w, Math.ceil(tx1)); x++) {
      if (Math.min(x - tx0, tx1 - x, y - ty0, ty1 - y) < rimT) hd.set(x, y, rim(x + 0.5, y + 0.5))
    }
  }
  const inner = MAHJONG_INNER
  const ix0 = X(inner.left)
  const iy0 = Y(inner.top)
  const ix1 = X(inner.right + 1)
  const iy1 = Y(inner.bottom + 1)
  const line = Math.max(1, Math.round(u * 0.14))
  hd.rect(ix0, iy0, ix1, iy0 + line, frameDim)
  hd.rect(ix0, iy1 - line, ix1, iy1, frameDim)
  hd.rect(ix0, iy0, ix0 + line, iy1, frameDim)
  hd.rect(ix1 - line, iy0, ix1, iy1, frameDim)
  for (const [cx, cy] of [
    [ix0, iy0],
    [ix1, iy0],
    [ix0, iy1],
    [ix1, iy1],
  ] as const) {
    softDisk(hd, cx, cy, u * 0.5, accent)
    softDisk(hd, cx, cy, u * 0.25, hdMix(accent, [255, 255, 255], 0.5))
  }

  // Center wind rosette, painted before tiles so everything reads on top.
  {
    const rcx = w / 2
    const rcy = Y(12.5)
    const rr = Math.min(ch * 3.2, cw * 9)
    for (const [r, a] of [
      [rr, 0.1],
      [rr * 0.78, 0.07],
      [rr * 0.46, 0.08],
    ] as const) {
      for (let k = 0; k < 160; k++) {
        const ang = (k / 160) * Math.PI * 2
        blendPixel(
          hd,
          Math.round(rcx + Math.cos(ang) * r * 1.5),
          Math.round(rcy + Math.sin(ang) * r * 0.62),
          good,
          a * 3,
        )
      }
    }
  }

  // One tile with thickness: jade back, ivory face, bevel, and a carved glyph.
  const tile = (sceneX: number, sceneY: number, tileIndex: number, hidden: boolean) => {
    const x0 = X(sceneX)
    const y0 = Y(sceneY)
    const tw = 2 * cw
    const th = ch
    const depth = Math.max(1, th * 0.2)
    const rad = Math.max(1.5, th * 0.16)
    shadowRect(x0, y0, x0 + tw, y0 + th, Math.max(2, Math.round(u * 0.35)), 0.5)
    // Jade body, visible along the bottom as the tile's thickness.
    roundRect(x0, y0, x0 + tw, y0 + th, rad, (_px, _py, _u, v) => hdMix(jade, jadeEdge, 0.2 + v * 0.5))
    if (hidden) {
      roundRect(x0 + tw * 0.06, y0 + th * 0.06, x0 + tw * 0.94, y0 + th - depth * 0.6, rad * 0.8, (_px, _py, _u, v) =>
        hdMix(hdMix(jade, jadeInk, 0.22), jade, v * 0.8),
      )
      const ix = tw * 0.22
      const iy = th * 0.2
      const bt = Math.max(1, Math.round(Math.min(tw, th) * 0.07))
      hd.rect(x0 + ix, y0 + iy, x0 + tw - ix, y0 + iy + bt, jadeInk)
      hd.rect(x0 + ix, y0 + th - depth - iy, x0 + tw - ix, y0 + th - depth - iy + bt, jadeInk)
      hd.rect(x0 + ix, y0 + iy, x0 + ix + bt, y0 + th - depth - iy + bt, jadeInk)
      hd.rect(x0 + tw - ix - bt, y0 + iy, x0 + tw - ix, y0 + th - depth - iy + bt, jadeInk)
      softDisk(hd, x0 + tw / 2, y0 + (th - depth) / 2, Math.max(1, th * 0.1), jadeInk)
      return
    }
    const fx0 = x0 + tw * 0.04
    const fx1 = x0 + tw - tw * 0.04
    const fy0 = y0 + th * 0.03
    const fy1 = y0 + th - depth
    roundRect(fx0, fy0, fx1, fy1, rad * 0.85, (_px, _py, uu, v) => {
      let col = hdMix(ivory, [214, 232, 222], v * 0.45)
      col = hdMix(col, [255, 255, 255], Math.max(0, 0.35 - v * 0.8) * (1 - uu * 0.4))
      return col
    })
    const suit = hdHex(mahjongSuitColor(tileIndex))
    const glyph = mahjongTileFace(tileIndex)
    const cx = (fx0 + fx1) / 2
    const cy = (fy0 + fy1) / 2
    const fw = fx1 - fx0
    const fh = fy1 - fy0
    const pip = (px: number, py: number, r: number, outer: RGB, innerCol: RGB) => {
      softDisk(hd, px, py, r, hdDarken(outer, 0.8))
      softDisk(hd, px, py, r * 0.82, outer)
      softDisk(hd, px, py, r * 0.52, innerCol)
      softDisk(hd, px, py, r * 0.2, hdDarken(outer, 0.7))
    }
    if (glyph.family === "honor") {
      const kind = tileIndex - 10
      const rx0 = cx - fw * 0.28
      const rx1 = cx + fw * 0.28
      const ry0 = cy - fh * 0.34
      const ry1 = cy + fh * 0.34
      const bt = Math.max(1, Math.round(fw * 0.06))
      const col: RGB = kind === 0 ? [200, 40, 40] : kind === 1 ? [26, 130, 80] : [40, 80, 180]
      if (kind === 0) {
        hd.rect(rx0, ry0, rx1, ry0 + bt, col)
        hd.rect(rx0, ry1 - bt, rx1, ry1, col)
        hd.rect(rx0, ry0, rx0 + bt, ry1, col)
        hd.rect(rx1 - bt, ry0, rx1, ry1, col)
        hd.rect(cx - bt / 2, ry0 - fh * 0.1, cx + bt / 2, ry1 + fh * 0.1, col)
      } else if (kind === 1) {
        for (const s of [-1, 0, 1]) {
          hd.rect(cx + s * fw * 0.2 - bt / 2, ry0, cx + s * fw * 0.2 + bt / 2, ry1, col)
        }
        hd.rect(rx0, cy - bt / 2, rx1, cy + bt / 2, col)
        softDisk(hd, cx, ry0, bt * 1.1, col)
      } else {
        hd.rect(rx0, ry0, rx1, ry0 + bt, col)
        hd.rect(rx0, ry1 - bt, rx1, ry1, col)
        hd.rect(rx0, ry0, rx0 + bt, ry1, col)
        hd.rect(rx1 - bt, ry0, rx1, ry1, col)
        hd.rect(rx0 + bt * 2, ry0 + bt * 2, rx1 - bt * 2, ry0 + bt * 3, col)
      }
    } else if (glyph.family === "bamboo") {
      const n = glyph.count
      const sw = Math.max(1.6, fw * 0.13)
      for (let i = 0; i < n; i++) {
        const bx = fx0 + (fw * (i + 1)) / (n + 1)
        const green = i === 1 && n >= 3 ? ([196, 44, 44] as RGB) : ([30, 140, 84] as RGB)
        const top = fy0 + fh * 0.18
        const bot = fy1 - fh * 0.18
        hd.rect(bx - sw / 2, top, bx + sw / 2, bot, green)
        hd.rect(bx - sw / 2, top, bx - sw / 2 + Math.max(1, sw * 0.3), bot, hdMix(green, [255, 255, 255], 0.3))
        const nodes = Math.max(1, Math.round((bot - top) / (fh * 0.28)))
        for (let k = 1; k < nodes; k++) {
          const ny = top + ((bot - top) * k) / nodes
          hd.rect(bx - sw * 0.75, ny - 0.7, bx + sw * 0.75, ny + 0.7, hdDarken(green, 0.55))
        }
      }
    } else {
      const n = glyph.count
      const base = Math.max(1.3, Math.min(fw, fh) * (n === 1 ? 0.3 : n <= 3 ? 0.17 : 0.15))
      const dx = fw * 0.22
      const dy = fh * 0.26
      const positions: [number, number][] =
        n === 1
          ? [[0, 0]]
          : n === 2
            ? [
                [0, -dy],
                [0, dy],
              ]
            : n === 3
              ? [
                  [-dx, -dy],
                  [0, 0],
                  [dx, dy],
                ]
              : n === 4
                ? [
                    [-dx, -dy],
                    [dx, -dy],
                    [-dx, dy],
                    [dx, dy],
                  ]
                : n === 5
                  ? [
                      [-dx, -dy],
                      [dx, -dy],
                      [0, 0],
                      [-dx, dy],
                      [dx, dy],
                    ]
                  : [
                      [-dx, -dy],
                      [dx, -dy],
                      [-dx, 0],
                      [dx, 0],
                      [-dx, dy],
                      [dx, dy],
                    ]
      positions.forEach(([ox, oy], i) => {
        const outer: RGB = n === 1 ? [196, 44, 44] : i % 2 === 0 ? suit : hdMix(suit, [196, 44, 44], 0.5)
        pip(cx + ox, cy + oy, base, outer, ivory)
      })
    }
  }
  const tiles = (sceneX: number, sceneY: number, hand: number[], hidden = false) =>
    hand.forEach((tileIndex, i) => tile(sceneX + i * 3, sceneY, tileIndex, hidden))

  if (style === "mahjong-ending") {
    const ending = MAHJONG_ENDING_LAYOUT
    const title = "HAND COMPLETED"
    // Celebration: warm bloom behind the title and a loop of falling confetti.
    glow(hd, w / 2, Y(ending.titleRow + 0.5), cw * 22, accent, 0.28)
    const confetti: RGB[] = [accent, info, good, [236, 90, 90], ink]
    for (let i = 0; i < 46; i++) {
      const speed = 1 + (i % 3)
      const fall = (artHash(i, 4) + cycle * speed) % 1
      const px = artHash(i, 8) * w + Math.sin(cycle * Math.PI * 2 * speed + i) * cw * 1.4
      const py = fall * (h + 20) - 10
      const spin = Math.abs(Math.cos(cycle * Math.PI * 2 * (speed + 1) + i))
      const sw = Math.max(1, u * 0.28)
      const sh = Math.max(1, u * 0.18 * (0.3 + spin))
      const col = confetti[i % confetti.length]!
      roundRect(px - sw, py - sh, px + sw, py + sh, 1, () => col, 0.85)
    }
    // Decorative winning tiles flank the title.
    ;[18, 21, 24].forEach((x, i) => tile(x, ending.titleRow, 6 + i, false))
    ;[47, 50, 53].forEach((x, i) => tile(x, ending.titleRow, 10 + i, false))
    blit(mahjongCenterX(title), ending.titleRow, title, accent)
    const ledger = "FINAL POINT LEDGER"
    blit(mahjongCenterX(ledger), ending.ledgerTitleRow, ledger, info)
    const rule = "- - - - - -"
    blit(mahjongCenterX(rule), ending.ledgerTitleRow - 1, rule, frame)
    blit(mahjongCenterX(rule), ending.thanksRow - 2, rule, frame)
    for (let i = 0; i < MAHJONG_SCORES.length; i++) {
      const rank = mahjongRank(i)
      const text = mahjongRankedLine(i)
      const color = hdHex(mahjongRankColor(rank))
      const row = ending.firstScoreRow + i * ending.scoreRowGap
      const x0 = X(mahjongCenterX(text) - 5)
      const x1 = X(mahjongCenterX(text) + text.length + 3)
      const y0 = Y(row) - ch * 0.15
      const y1 = Y(row + 1) + ch * 0.15
      // Translucent band, brightest for the winner, plus a score bar.
      roundRect(
        x0,
        y0,
        x1,
        y1,
        ch * 0.35,
        (_px, _py, _u, v) => hdMix(hdDarken(color, 0.3), [2, 20, 14], v * 0.5),
        rank === 1 ? 0.5 : 0.32,
      )
      const fill = (MAHJONG_SCORES[i]! / Math.max(...MAHJONG_SCORES)) * (x1 - x0 - 8)
      roundRect(x0 + 4, y1 - ch * 0.12, x0 + 4 + fill, y1 - ch * 0.02, 1, () => color, 0.8)
      if (rank === 1) glow(hd, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.7, accent, 0.12)
      blit(mahjongCenterX(text), row, text, color)
      // Coin medal.
      const mx = X(mahjongCenterX(text) - 2.5)
      const my = Y(row + 0.5)
      const mr = Math.max(2, Math.min(cw, ch) * 0.45)
      softDisk(hd, mx + 1, my + 2, mr, [0, 8, 5], 0.5)
      softDisk(hd, mx, my, mr, hdDarken(color, 0.7))
      softDisk(hd, mx, my, mr * 0.82, color)
      softDisk(hd, mx - mr * 0.25, my - mr * 0.28, mr * 0.35, hdMix(color, [255, 255, 255], 0.65), 0.8)
    }
    const thanks = "THANK YOU FOR PLAYING"
    blit(mahjongCenterX(thanks), ending.thanksRow, thanks, good)
    const blink = mahjongEndingBlink(elapsed)
    const twinkle = blink ? "*   *   *" : "  *   *  "
    blit(mahjongCenterX(twinkle), ending.blinkRow, twinkle, accent)
    if (blink) {
      glow(hd, X(38.5), Y(21.5), cw * 3, accent, 0.4)
      softDisk(hd, X(38.5), Y(21.5), Math.max(1.5, Math.min(cw, ch) * 0.3), accent)
    }
  } else {
    const layout = MAHJONG_MATCH_LAYOUT
    const match = mahjongMatch(elapsed)
    const seat = (name: string) => {
      const label = mahjongSeatLabel(name)
      if (match.turn === name) {
        const x0 = X(label.x - 1)
        const x1 = X(label.x + label.text.length + 1)
        const y0 = Y(label.y) + ch * 0.05
        const y1 = Y(label.y + 1) - ch * 0.05
        const pulse = 0.75 + 0.25 * Math.sin(cycle * Math.PI * 24)
        glow(hd, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.9, accent, 0.25 * pulse)
        roundRect(x0, y0, x1, y1, (y1 - y0) / 2, (_px, _py, _u, v) =>
          hdMix(hdMix(jade, jadeInk, 0.2), jadeEdge, v * 0.6),
        )
        blit(label.x, label.y, label.text, accent)
      } else {
        blit(label.x, label.y, label.text, ink)
      }
    }
    const title = "MAHJONG MATCH"
    blit(mahjongCenterX(title), layout.titleRow, title, accent)
    seat("NORTH")
    tiles(layout.northHandX, layout.northHandRow, match.hands[2]!, true)
    tiles(layout.discardsX, layout.northDiscardsRow, match.discards[2]!)
    seat("WEST")
    seat("EAST")
    tiles(layout.westX, layout.sideHandRow, match.hands[3]!.slice(0, 4), true)
    tiles(layout.eastX, layout.sideHandRow, match.hands[1]!.slice(0, 4), true)
    tiles(layout.westX, layout.sideDiscardsRow, match.discards[3]!)
    tiles(layout.eastX, layout.sideDiscardsRow, match.discards[1]!)
    const view = "-- MATCH VIEW --"
    blit(mahjongCenterX(view), layout.viewRow, view, info)
    tiles(layout.discardsX, layout.southDiscardsRow, match.discards[0]!)
    seat("SOUTH")
    tiles(layout.southHandX, layout.southHandRow, match.hands[0]!)
    const marker = mahjongLatestMarker(elapsed)
    if (marker) {
      const mx0 = X(marker.x)
      const my0 = Y(marker.y + 0.7)
      glow(hd, X(marker.x + 1), my0 + ch * 0.1, cw * 3.2, accent, 0.4)
      roundRect(mx0, my0, X(marker.x + 2), Y(marker.y + 1) - ch * 0.04, ch * 0.12, () => accent)
    }
    blit(mahjongCenterX(match.action), layout.actionRow, match.action, info)
    blit(layout.westX, layout.statusRow, `WALL: ${match.wall}`, good)
    // Wall meter: recessed track, glossy fill, and end caps.
    const fill = mahjongWallFill(match.wall)
    const barTop = Y(layout.statusRow) + ch * 0.18
    const barBottom = Y(layout.statusRow + 1) - ch * 0.18
    const bx0 = X(MAHJONG_WALL_BAR_X + 1)
    const bx1 = X(MAHJONG_WALL_BAR_X + 1 + MAHJONG_WALL_BAR_LEN)
    const bf = X(MAHJONG_WALL_BAR_X + 1 + fill)
    roundRect(bx0, barTop, bx1, barBottom, (barBottom - barTop) / 2, () => [2, 22, 15])
    if (fill > 0) {
      roundRect(bx0, barTop, bf, barBottom, (barBottom - barTop) / 2, (_px, _py, uu, v) => {
        const base = hdMix(good, hdDarken(good, 0.65), v)
        return hdMix(base, [255, 255, 255], Math.max(0, 0.35 - v * 0.9) * (1 - uu * 0.3))
      })
    }
    hd.rect(X(MAHJONG_WALL_BAR_X), barTop - 2, X(MAHJONG_WALL_BAR_X) + 2, barBottom + 2, ink)
    hd.rect(bx1, barTop - 2, bx1 + 2, barBottom + 2, ink)
    blit(layout.turnX, layout.statusRow, `TURN: ${match.turn}`, accent)
  }

  return hd.pixels
}
