import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  DUNGEON_CHEST,
  DUNGEON_COIN_PILES,
  DUNGEON_COLUMNS,
  DUNGEON_COLORS,
  DUNGEON_DRIPS,
  DUNGEON_FLOOR_TOP,
  DUNGEON_GLINTS,
  DUNGEON_LANDING,
  DUNGEON_PILLARS,
  DUNGEON_PILLAR_BASE,
  DUNGEON_PILLAR_TOP,
  DUNGEON_ROWS,
  DUNGEON_STEP_COUNT,
  DUNGEON_STEP_DX,
  DUNGEON_STEP_DY,
  DUNGEON_STEP_X,
  DUNGEON_STEP_Y,
  DUNGEON_TORCHES,
  DUNGEON_TORCH_Y,
  dungeonDripY,
  dungeonFlicker,
  dungeonSkyRgb,
  dungeonTwinkle,
  type DungeonStyle,
} from "./dungeon-view-model"

/**
 * Freeform HD renderer. Brick walls, torch halos, drip disks, and the
 * treasure glow are painted from the shared scene model. Pure: every pixel
 * derives from `elapsedMs`.
 */
export function renderDungeonPixels(width: number, height: number, style: DungeonStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const hd = createHdCanvas(w, h, DUNGEON_COLUMNS, DUNGEON_ROWS)
  if (w === 0 || h === 0) return hd.pixels
  const descent = style === "dungeon-descent"
  const c = DUNGEON_COLORS[style]
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const flame = hdHex(c.flame)
  const wood = hdHex(c.wood)
  const drip = hdHex(c.drip)
  const step = hdHex(c.step)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const bright = dungeonFlicker(elapsedMs)

  hd.sky((t) => dungeonSkyRgb(style, t))

  const cap = hd.Y(1)
  const foot = hd.Y(DUNGEON_FLOOR_TOP)
  for (let y = Math.floor(cap); y < foot; y++) {
    const u = (y - cap) / (foot - cap || 1)
    const tone = hdMix(stone, stoneDark, Math.min(1, 0.15 + u * 0.8))
    const mortar = Math.floor(y / Math.max(3, hd.ch * 0.22)) % 4 === 3
    const color = mortar ? hdDarken(tone, 0.74) : tone
    const shade = hdDarken(color, 0.8)
    const xL = Math.ceil(hd.X(2.25))
    for (let x = 0; x < xL; x++) hd.set(x, y, x < xL * 0.32 ? shade : color)
    const xR = Math.floor(hd.X(DUNGEON_COLUMNS - 2.25))
    for (let x = xR; x < hd.w; x++) hd.set(x, y, x > xR + (hd.w - xR) * 0.68 ? shade : color)
  }
  // Solid cap. The top-left pixel is the flat dark stone, not the sky sample.
  hd.rect(0, 0, hd.w, cap, stoneDark)
  hd.rect(0, hd.Y(0.84), hd.w, cap, hdDarken(stoneDark, 0.76))

  const dripR = Math.max(1.7, hd.cw * 0.2)
  DUNGEON_DRIPS.forEach((dx, i) => {
    const dy = dungeonDripY(elapsedMs, i)
    hd.disk(hd.X(dx + 0.5), hd.Y(dy + 0.62), dripR, drip)
    hd.disk(hd.X(dx + 0.5), hd.Y(dy + 0.28), Math.max(1, hd.cw * 0.1), hdMix(drip, [230, 246, 255], 0.45))
  })

  if (descent) {
    const lip = hdMix(step, hdHex(c.glint), 0.22)
    for (let s = 0; s < DUNGEON_STEP_COUNT; s++) {
      const sx = DUNGEON_STEP_X + s * DUNGEON_STEP_DX
      const sy = DUNGEON_STEP_Y + s * DUNGEON_STEP_DY
      hd.rect(hd.X(sx), hd.Y(sy + 0.32), hd.X(sx + DUNGEON_STEP_DX), hd.Y(sy + 1), step)
      hd.rect(hd.X(sx), hd.Y(sy + 0.32), hd.X(sx + DUNGEON_STEP_DX), hd.Y(sy + 0.44), lip)
      hd.rect(hd.X(sx + DUNGEON_STEP_DX), hd.Y(sy + 1), hd.X(sx + DUNGEON_STEP_DX + 0.85), hd.Y(sy + 2), stoneDark)
    }
    const land = DUNGEON_LANDING
    hd.rect(hd.X(land.x), hd.Y(land.y + 0.32), hd.X(land.x + 15), hd.Y(land.y + 1), step)
    hd.rect(hd.X(land.x), hd.Y(land.y + 0.32), hd.X(land.x + 15), hd.Y(land.y + 0.44), lip)
  } else {
    const gold = hdHex(c.gold)
    const chest = DUNGEON_CHEST
    hd.halo(
      hd.X(chest.x + 4),
      hd.Y(chest.y + 1.4),
      Math.max(coreR, hd.cw * 1.5),
      hdHex(c.glint),
      gold,
      dungeonSkyRgb(style, 0.55),
    )
    for (const pillar of DUNGEON_PILLARS) {
      hd.rect(hd.X(pillar - 1), hd.Y(DUNGEON_PILLAR_TOP - 0.7), hd.X(pillar + 3), hd.Y(DUNGEON_PILLAR_TOP), stoneDark)
      hd.mass(
        pillar + 1,
        DUNGEON_PILLAR_TOP,
        DUNGEON_PILLAR_BASE,
        1.15,
        0.85,
        stone,
        stoneDark,
        hdDarken(stoneDark, 0.75),
      )
      hd.rect(hd.X(pillar - 1), hd.Y(DUNGEON_PILLAR_BASE), hd.X(pillar + 3), hd.Y(DUNGEON_PILLAR_BASE + 0.7), stoneDark)
    }
    // Lid stays a flat gold band so the center sample does not pick up the glow.
    hd.rect(hd.X(chest.x), hd.Y(chest.y), hd.X(chest.x + 8), hd.Y(chest.y + 1), gold)
    hd.rect(hd.X(chest.x), hd.Y(chest.y + 1), hd.X(chest.x + 8), hd.Y(chest.y + 2), hdHex(c.chest))
    hd.rect(hd.X(chest.x + 1.6), hd.Y(chest.y + 1.22), hd.X(chest.x + 6.4), hd.Y(chest.y + 1.82), hdHex(c.coin))
    hd.rect(hd.X(chest.x), hd.Y(chest.y + 2), hd.X(chest.x + 8), hd.Y(chest.y + 3), gold)
    hd.disk(hd.X(chest.x + 6.3), hd.Y(chest.y + 0.55), Math.max(1.5, hd.cw * 0.16), hdDarken(gold, 0.72))
    if (bright) {
      hd.disk(hd.X(chest.x - 1.4), hd.Y(chest.y + 0.4), Math.max(1.6, hd.cw * 0.18), hdHex(c.glint))
      hd.disk(hd.X(chest.x + 9.4), hd.Y(chest.y + 0.4), Math.max(1.6, hd.cw * 0.18), hdHex(c.glint))
    }
    const coin = hdHex(c.coin)
    for (const pile of DUNGEON_COIN_PILES) {
      hd.disk(hd.X(pile + 0.7), hd.Y(chest.y + 3.55), Math.max(2, hd.cw * 0.32), coin)
      hd.disk(hd.X(pile + 1.6), hd.Y(chest.y + 3.7), Math.max(1.7, hd.cw * 0.26), hdMix(coin, gold, 0.4))
      hd.disk(hd.X(pile + 1.1), hd.Y(chest.y + 3.25), Math.max(1.4, hd.cw * 0.2), hdHex(c.glint))
    }
    DUNGEON_GLINTS.forEach((point, i) => {
      const on = dungeonTwinkle(elapsedMs, i)
      if (on) hd.disk(hd.X(point.x + 0.5), hd.Y(point.y + 0.5), Math.max(2, hd.cw * 0.26), hdHex(c.glint))
      else hd.set(Math.floor(hd.X(point.x + 0.5)), Math.floor(hd.Y(point.y + 0.5)), hdHex(c.glint))
    })
  }

  for (const torch of DUNGEON_TORCHES) {
    const cx = hd.X(torch + 0.5)
    const cy = hd.Y(DUNGEON_TORCH_Y + 0.35)
    if (bright) hd.halo(cx, cy, coreR * 0.55, flame, hdMix(flame, wood, 0.2), dungeonSkyRgb(style, 0.35))
    else hd.halo(cx, cy + hd.ch * 0.08, coreR * 0.28, hdDarken(flame, 0.6), wood, dungeonSkyRgb(style, 0.35))
    hd.stroke(
      torch + 0.5,
      DUNGEON_TORCH_Y + 0.85,
      torch + 0.5,
      DUNGEON_TORCH_Y + 2.7,
      Math.max(1.2, hd.cw * 0.11),
      wood,
    )
  }

  const floor = hdHex(c.floor)
  hd.rect(0, foot, hd.w, hd.h, floor)
  for (let x = 5; x < DUNGEON_COLUMNS; x += 9) {
    hd.rect(hd.X(x), foot, hd.X(x) + 1, hd.h, hdDarken(floor, 0.78))
  }
  return hd.pixels
}
