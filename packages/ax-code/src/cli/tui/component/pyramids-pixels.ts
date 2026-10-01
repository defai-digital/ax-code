import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  PYRAMIDS_APEX,
  PYRAMIDS_APEX_SMALL,
  PYRAMIDS_BASE_ROW,
  PYRAMIDS_CAMEL_COUNT,
  PYRAMIDS_CAMEL_GAP,
  PYRAMIDS_CARAVAN_ROW,
  PYRAMIDS_COLORS,
  PYRAMIDS_COLUMNS,
  PYRAMIDS_CYCLE_MS,
  PYRAMIDS_DUNE_TOP,
  PYRAMIDS_FIRE,
  PYRAMIDS_MOON,
  PYRAMIDS_ROWS,
  PYRAMIDS_STARS,
  PYRAMIDS_SUN,
  pyramidsCaravanX,
  pyramidsFlicker,
  pyramidsSkyRgb,
  type PyramidsStyle,
} from "./pyramids-view-model"

/**
 * Freeform HD pyramids. Gradient sky, a three-layer sun or moon, shaded
 * stone masses, speckled palms, a bobbing caravan, and wavy dunes come from
 * the shared scene model. Pure and deterministic: everything derives from
 * `elapsedMs`, and motion loops on the 2400ms cycle.
 */
export function renderPyramidsPixels(width: number, height: number, style: PyramidsStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, PYRAMIDS_COLUMNS, PYRAMIDS_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "pyramids-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % PYRAMIDS_CYCLE_MS) / PYRAMIDS_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = PYRAMIDS_COLORS[style]
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const sand = hdHex(c.sand)
  const sandDark = hdHex(c.sandDark)
  const dune = hdHex(c.dune)
  const edge = hdDarken(stoneDark, 0.8)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const orb = night ? PYRAMIDS_MOON : PYRAMIDS_SUN
  const sun = hdHex(c.sun)
  const around = pyramidsSkyRgb(style, orb.y / PYRAMIDS_ROWS)

  hd.sky((t) => pyramidsSkyRgb(style, t))
  if (night) hd.stars(PYRAMIDS_STARS, sun, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
  hd.halo(hd.X(orb.x), hd.Y(orb.y), coreR, sun, hdMix(sun, around, 0.4), around)

  // Lit face is the west side. The sample at scene (30.5, 10.5) sits just
  // right of the great-pyramid apex and must stay the flat stone color.
  hd.mass(
    PYRAMIDS_APEX.x,
    PYRAMIDS_APEX.y,
    PYRAMIDS_BASE_ROW,
    0.4,
    PYRAMIDS_BASE_ROW - PYRAMIDS_APEX.y,
    stone,
    stoneDark,
    edge,
  )
  hd.mass(
    PYRAMIDS_APEX_SMALL.x,
    PYRAMIDS_APEX_SMALL.y,
    PYRAMIDS_BASE_ROW,
    0.3,
    PYRAMIDS_BASE_ROW - PYRAMIDS_APEX_SMALL.y,
    stone,
    stoneDark,
    edge,
  )

  const duneTop = Math.floor(hd.Y(PYRAMIDS_DUNE_TOP - 0.8))
  for (let y = Math.max(0, duneTop); y < hd.h; y++) {
    const sceneY = (y + 0.5) / hd.ch
    for (let x = 0; x < hd.w; x++) {
      const sceneX = (x + 0.5) / hd.cw
      const crest = PYRAMIDS_DUNE_TOP + Math.sin(sceneX * 0.33) * 0.55 + Math.cos(sceneX * 0.11) * 0.25
      if (sceneY < crest) continue
      const ridge = Math.sin(sceneX * 0.45 + sceneY * 1.55)
      hd.set(x, y, ridge > 0.55 ? sand : ridge < -0.55 ? sandDark : dune)
    }
  }

  hd.mass(10.4, 12.4, 15.1, 1.1, 3.2, stone, stoneDark, edge)
  hd.blob(hd.X(10.2), hd.Y(12.7), hd.cw * 2.2, hd.ch * 0.72, stone, stoneDark)
  hd.disk(hd.X(9.3), hd.Y(12.65), Math.max(1.2, hd.cw * 0.18), hdDarken(stoneDark, 0.7))
  hd.disk(hd.X(11.1), hd.Y(12.65), Math.max(1.2, hd.cw * 0.18), hdDarken(stoneDark, 0.7))

  const palm = hdHex(c.palm)
  const frond = hdDarken(palm, 0.72)
  const trunk = hdHex(c.trunk)
  for (const tree of [66, 70]) {
    hd.rect(hd.X(tree + 0.28), hd.Y(12.7), hd.X(tree + 0.78), hd.Y(15.15), trunk)
    hd.blob(hd.X(tree + 0.5), hd.Y(12.15), hd.cw * 1.7, hd.ch * 0.52, palm, frond)
    hd.blob(hd.X(tree - 0.85), hd.Y(12.4), hd.cw * 1.15, hd.ch * 0.28, palm, frond)
    hd.blob(hd.X(tree + 1.85), hd.Y(12.4), hd.cw * 1.15, hd.ch * 0.28, palm, frond)
  }

  const hide = hdHex(c.caravan)
  const lead = pyramidsCaravanX(elapsed)
  for (let i = 0; i < PYRAMIDS_CAMEL_COUNT; i++) {
    const bob = Math.floor((elapsed + i * 300) / 600) % 2
    const x = lead - i * PYRAMIDS_CAMEL_GAP
    const y = PYRAMIDS_CARAVAN_ROW - bob * 0.65
    hd.blob(hd.X(x + 1.25), hd.Y(y + 0.32), hd.cw * 1.3, hd.ch * 0.36, hide)
    hd.blob(hd.X(x + 0.95), hd.Y(y - 0.02), hd.cw * 0.55, hd.ch * 0.28, hide)
    hd.disk(hd.X(x + 2.25), hd.Y(y + 0.02), Math.max(1.3, hd.cw * 0.3), hide)
    hd.rect(hd.X(x + 0.45), hd.Y(y + 0.42), hd.X(x + 0.75), hd.Y(y + 1.12), hide)
    hd.rect(hd.X(x + 1.65), hd.Y(y + 0.42), hd.X(x + 1.95), hd.Y(y + 1.12), hide)
  }

  if (night) {
    const logs = hdHex(c.trunk)
    hd.rect(
      hd.X(PYRAMIDS_FIRE.x - 0.8),
      hd.Y(PYRAMIDS_FIRE.y + 0.82),
      hd.X(PYRAMIDS_FIRE.x + 3.4),
      hd.Y(PYRAMIDS_FIRE.y + 1.18),
      logs,
    )
    if (pyramidsFlicker(elapsed)) {
      const flame = hdHex(c.sun)
      hd.halo(
        hd.X(PYRAMIDS_FIRE.x + 1.2),
        hd.Y(PYRAMIDS_FIRE.y + 0.15),
        Math.max(2, coreR * 0.55),
        flame,
        hdMix(flame, sand, 0.35),
        around,
      )
    } else {
      hd.disk(hd.X(PYRAMIDS_FIRE.x + 1.2), hd.Y(PYRAMIDS_FIRE.y + 0.35), Math.max(1.4, hd.cw * 0.32), sandDark)
    }
  }

  for (let i = 0; i < 18; i++) {
    const x = (i * 13 + 2 + phase * PYRAMIDS_COLUMNS) % PYRAMIDS_COLUMNS
    const y = PYRAMIDS_DUNE_TOP + 1.15 + (i % 5) * 0.85 + Math.sin(theta + i) * 0.12
    hd.disk(hd.X(x), hd.Y(y), Math.max(1, hd.cw * 0.2), i % 2 === 0 ? sand : sandDark)
  }
  return hd.pixels
}
