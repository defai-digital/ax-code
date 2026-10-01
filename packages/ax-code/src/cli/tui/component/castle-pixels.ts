import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  CASTLE_BANNER,
  CASTLE_BEACON,
  CASTLE_BIRD_ROW,
  CASTLE_BIRDS,
  CASTLE_CLOUDS,
  CASTLE_COLORS,
  CASTLE_COLUMNS,
  CASTLE_GATE,
  CASTLE_HILL_TOP,
  CASTLE_KEEP,
  CASTLE_MOON,
  CASTLE_POLE_TOP,
  CASTLE_POLE_X,
  CASTLE_ROWS,
  CASTLE_SLOPE_ROW,
  CASTLE_STARS,
  CASTLE_SUN,
  CASTLE_TOWERS,
  CASTLE_TOWER_BASE,
  CASTLE_TOWER_TOP,
  CASTLE_TREES,
  CASTLE_WINDOWS,
  castleBeaconBright,
  castleBirdShift,
  castleCloudShift,
  castleSkyRgb,
  castleTwinkle,
  castleWave,
  type CastleStyle,
} from "./castle-view-model"

/**
 * Freeform HD renderer. Halo, drifting cloud puffs, shaded keep, speckled
 * trees, and the hill slope come from the shared scene model. Pure: every
 * pixel derives from `elapsedMs`.
 */
export function renderCastlePixels(width: number, height: number, style: CastleStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const hd = createHdCanvas(w, h, CASTLE_COLUMNS, CASTLE_ROWS)
  if (w === 0 || h === 0) return hd.pixels
  const day = style === "castle-day"
  const c = CASTLE_COLORS[style]
  const wall = hdHex(c.wall)
  const wallDark = hdHex(c.wallDark)
  const roof = hdHex(c.roof)
  const tree = hdHex(c.tree)
  const hill = hdHex(c.hill)
  const hillDark = hdHex(c.hillDark)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const around = castleSkyRgb(style, 0.12)

  hd.sky((t) => castleSkyRgb(style, t))
  if (day) {
    hd.halo(hd.X(CASTLE_SUN.x), hd.Y(CASTLE_SUN.y), coreR, hdHex(c.sun), hdMix(hdHex(c.sun), around, 0.35), around)
    const bird = hdHex(c.bird)
    const shift = castleBirdShift(elapsedMs)
    const wing = Math.max(1.3, hd.cw * 0.14)
    for (const base of CASTLE_BIRDS) {
      const bx = (base + shift) % CASTLE_COLUMNS
      hd.disk(hd.X(bx + 0.5), hd.Y(CASTLE_BIRD_ROW + 0.55), wing, bird)
      hd.disk(hd.X(bx + 0.15), hd.Y(CASTLE_BIRD_ROW + 0.3), wing * 0.75, bird)
      hd.disk(hd.X(bx + 0.85), hd.Y(CASTLE_BIRD_ROW + 0.3), wing * 0.75, bird)
    }
  } else {
    hd.stars(CASTLE_STARS, hdHex(c.star), (index) => castleTwinkle(elapsedMs, index))
    hd.halo(hd.X(CASTLE_MOON.x), hd.Y(CASTLE_MOON.y), coreR, hdHex(c.moon), hdMix(hdHex(c.moon), around, 0.4), around)
  }

  const cloud = hdHex(c.cloud)
  const drift = castleCloudShift(elapsedMs)
  for (const puff of CASTLE_CLOUDS) {
    const nx = (((puff.x - drift) % CASTLE_COLUMNS) + CASTLE_COLUMNS) % CASTLE_COLUMNS
    hd.puff(nx, puff.y, 4, cloud)
  }

  const crest = hd.Y(CASTLE_SLOPE_ROW - 0.1)
  for (let y = Math.max(0, Math.floor(crest)); y < hd.h; y++) {
    const u = (y - crest) / (hd.h - crest || 1)
    const tone = u < 0.2 ? hillDark : hdMix(hillDark, hill, Math.min(1, (u - 0.2) / 0.45))
    for (let x = 0; x < hd.w; x++) {
      const nx = Math.abs((x + 0.5) / hd.w - 0.5)
      if (y + 0.5 < crest + nx * nx * hd.ch * 2.4) continue
      hd.set(x, y, tone)
    }
  }

  for (const trunk of CASTLE_TREES) {
    hd.blob(hd.X(trunk + 1), hd.Y(CASTLE_TOWER_BASE - 0.15), hd.cw * 2.5, hd.ch * 1.05, tree, hdDarken(tree, 0.68))
    hd.rect(
      hd.X(trunk + 0.62),
      hd.Y(CASTLE_TOWER_BASE + 0.35),
      hd.X(trunk + 1.38),
      hd.Y(CASTLE_HILL_TOP + 0.45),
      hdDarken(tree, 0.62),
    )
  }

  for (const tower of CASTLE_TOWERS) {
    const mid = tower + 2
    hd.mass(
      mid,
      CASTLE_TOWER_TOP - 1.2,
      CASTLE_TOWER_TOP + 0.2,
      0.12,
      2.05,
      roof,
      hdDarken(roof, 0.7),
      hdDarken(roof, 0.55),
    )
    hd.mass(mid, CASTLE_TOWER_TOP, CASTLE_TOWER_BASE + 0.15, 1.45, 2.05, wall, wallDark, hdDarken(wallDark, 0.8))
  }
  const keep = CASTLE_KEEP
  const apex = (keep.x0 + keep.x1) / 2
  hd.mass(apex, keep.top, keep.base + 0.15, 6.5, 7.05, wall, wallDark, hdDarken(wallDark, 0.78))
  for (let x = keep.x0; x < keep.x1; x += 2) {
    hd.rect(hd.X(x), hd.Y(keep.top - 0.9), hd.X(x + 1.05), hd.Y(keep.top + 0.08), wall)
    hd.rect(hd.X(x + 1.05), hd.Y(keep.top - 0.4), hd.X(x + 2), hd.Y(keep.top + 0.08), wallDark)
  }
  const pane = hdHex(day ? c.window : c.lit)
  for (const win of CASTLE_WINDOWS) {
    hd.rect(hd.X(win.x + 0.2), hd.Y(win.y + 0.25), hd.X(win.x + 2.45), hd.Y(win.y + 0.85), pane)
  }
  const gate = hdHex(c.gate)
  hd.disk(hd.X(CASTLE_GATE.x + 2), hd.Y(CASTLE_GATE.y + 0.55), hd.cw * 1.65, gate)
  hd.rect(
    hd.X(CASTLE_GATE.x + 0.35),
    hd.Y(CASTLE_GATE.y + 0.7),
    hd.X(CASTLE_GATE.x + 3.65),
    hd.Y(CASTLE_GATE.y + 3),
    gate,
  )
  hd.disk(hd.X(CASTLE_GATE.x + 2), hd.Y(CASTLE_GATE.y + 0.7), hd.cw * 1.15, hdDarken(gate, 0.72))
  hd.stroke(
    CASTLE_POLE_X + 0.5,
    CASTLE_POLE_TOP,
    CASTLE_POLE_X + 0.5,
    keep.top - 0.15,
    Math.max(1, hd.cw * 0.09),
    hdHex(c.wood),
  )
  const flying = castleWave(elapsedMs)
  const bx = flying ? CASTLE_BANNER.x : CASTLE_BANNER.x - 2.2
  const banner = hdHex(c.banner)
  hd.mass(
    bx + 1.3,
    CASTLE_BANNER.y,
    CASTLE_BANNER.y + 1.2,
    1.55,
    0.55,
    banner,
    hdDarken(banner, 0.7),
    hdDarken(banner, 0.55),
  )
  hd.rect(
    hd.X(CASTLE_TOWERS[0]!),
    hd.Y(CASTLE_TOWER_BASE + 0.85),
    hd.X(CASTLE_TOWERS[1]! + 4),
    hd.Y(CASTLE_TOWER_BASE + 1.7),
    wallDark,
  )

  const path = hdHex(c.path)
  hd.rect(
    hd.X(CASTLE_GATE.x),
    hd.Y(CASTLE_HILL_TOP + 1.15),
    hd.X(CASTLE_GATE.x + 3),
    hd.Y(CASTLE_HILL_TOP + 1.85),
    path,
  )
  hd.rect(
    hd.X(CASTLE_GATE.x - 1),
    hd.Y(CASTLE_HILL_TOP + 2.05),
    hd.X(CASTLE_GATE.x + 4),
    hd.Y(CASTLE_HILL_TOP + 2.85),
    path,
  )

  if (!day) {
    const bx = Math.floor(hd.X(CASTLE_BEACON.x + 0.5))
    const by = Math.floor(hd.Y(CASTLE_BEACON.y + 0.5))
    if (castleBeaconBright(elapsedMs))
      hd.halo(bx, by, coreR * 0.46, hdHex(c.beacon), hdMix(hdHex(c.beacon), around, 0.35), around)
    else hd.set(bx, by, wallDark)
  }
  return hd.pixels
}
