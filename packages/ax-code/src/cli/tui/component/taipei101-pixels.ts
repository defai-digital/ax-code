import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  TAIPEI101_CAR_ROW,
  TAIPEI101_COLORS,
  TAIPEI101_COLUMNS,
  TAIPEI101_GROUND_TOP,
  TAIPEI101_MOON,
  TAIPEI101_PARK_LAMPS,
  TAIPEI101_PARK_TOP,
  TAIPEI101_PILLARS,
  TAIPEI101_PODIUM,
  TAIPEI101_ROWS,
  TAIPEI101_SPIRE,
  TAIPEI101_STARS,
  TAIPEI101_TIERS,
  TAIPEI101_TRACK_ROW,
  TAIPEI101_TREES,
  taipei101Beacon,
  taipei101Cars,
  taipei101Clouds,
  taipei101Lanterns,
  taipei101Lit,
  taipei101SkyRgb,
  taipei101Train,
  type Taipei101Style,
} from "./taipei101-view-model"

/** Stacked glass tiers, a window chase, and rising sky lanterns. */
export function renderTaipei101Pixels(width: number, height: number, style: Taipei101Style, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, TAIPEI101_COLUMNS, TAIPEI101_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const neon = style === "taipei101-neon"
  const c = TAIPEI101_COLORS[style]
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return taipei101SkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return taipei101SkyRgb(style, py / (hd.h - 1))
  }
  const glass = hdHex(c.glass)
  const frame = hdHex(c.frame)
  const lit = hdHex(c.lit)
  const unlit = hdHex(c.unlit)
  const podium = hdHex(c.podium)
  const mountain = hdHex(c.mountain)
  const tree = hdHex(c.tree)
  const beacon = hdHex(c.beacon)
  const cloud = hdHex(c.cloud)
  const street = hdHex(c.street)
  const ground = hdHex(c.ground)
  const headlight = hdHex(c.headlight)
  const node = hdHex(c.node)
  const orb = neon ? TAIPEI101_MOON : { x: 12, y: 1.6 }

  hd.sky((t) => taipei101SkyRgb(style, t))
  if (neon) hd.stars(TAIPEI101_STARS, hdHex(c.sky), (i) => taipei101Lit(elapsedMs, i))
  hd.halo(hd.X(orb.x), hd.Y(orb.y), coreR, lit, neon ? hdHex(c.sky) : headlight, skyAt(orb.y))
  for (const puff of taipei101Clouds(elapsedMs)) hd.puff(puff.x, puff.y, 4, cloud)

  hd.mass(9, 14.3, 16.8, 1.4, 9.5, mountain, hdDarken(mountain, 0.74), hdMix(mountain, frame, 0.35))
  hd.mass(67, 14.3, 16.8, 1.4, 9.5, hdDarken(mountain, 0.86), mountain, hdMix(mountain, frame, 0.35))

  const railTop = hd.Y(TAIPEI101_TRACK_ROW + 0.28)
  const railBot = hd.Y(TAIPEI101_TRACK_ROW + 0.58)
  hd.rect(0, railTop, hd.w, railBot, frame)
  for (const pillar of TAIPEI101_PILLARS) {
    hd.rect(hd.X(pillar + 0.25), hd.Y(14), hd.X(pillar + 0.7), hd.Y(17), frame)
  }
  const train = taipei101Train(elapsedMs)
  hd.rect(hd.X(train), hd.Y(TAIPEI101_TRACK_ROW - 0.82), hd.X(train + 6), hd.Y(TAIPEI101_TRACK_ROW - 0.18), lit)
  hd.rect(
    hd.X(train + 0.4),
    hd.Y(TAIPEI101_TRACK_ROW - 0.7),
    hd.X(train + 5.5),
    hd.Y(TAIPEI101_TRACK_ROW - 0.38),
    hdMix(frame, lit, 0.35),
  )

  const spire = TAIPEI101_SPIRE
  hd.mass((spire.x0 + spire.x1) / 2, spire.top, spire.base + 0.2, 0.35, 1.15, glass, hdDarken(glass, 0.7), frame)
  const beaconOn = taipei101Beacon(elapsedMs)
  hd.disk(hd.X(37.5), hd.Y(1.15), beaconOn ? dot * 0.85 : dot * 0.4, beaconOn ? beacon : frame)

  const leftEdge = neon ? hdDarken(glass, 0.66) : hdMix(lit, glass, 0.42)
  const rightEdge = neon ? hdMix(lit, glass, 0.38) : hdDarken(glass, 0.62)
  let windowIndex = 0
  for (const [x0, x1, y0, y1] of TAIPEI101_TIERS) {
    hd.rect(hd.X(x0), hd.Y(y0), hd.X(x1 + 1), hd.Y(y1 + 1), glass)
    hd.rect(hd.X(x0), hd.Y(y0), hd.X(x0 + 0.55), hd.Y(y1 + 1), leftEdge)
    hd.rect(hd.X(x1 + 0.45), hd.Y(y0), hd.X(x1 + 1), hd.Y(y1 + 1), rightEdge)
    hd.rect(hd.X(x0), hd.Y(y0), hd.X(x1 + 1), hd.Y(y0 + 0.16), frame)
    hd.disk(hd.X(x0 + 0.4), hd.Y(y0 + 0.35), Math.max(1.2, hd.cw * 0.16), node)
    hd.disk(hd.X(x1 + 0.6), hd.Y(y0 + 0.35), Math.max(1.2, hd.cw * 0.16), node)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0 + 2; x <= x1 - 2; x += 3) {
        const on = taipei101Lit(elapsedMs, windowIndex++)
        hd.disk(hd.X(x + 0.5), hd.Y(y + 0.5), Math.max(1.25, Math.min(hd.cw, hd.ch) * 0.2), on ? lit : unlit)
      }
    }
  }

  const base = TAIPEI101_PODIUM
  hd.rect(hd.X(base.x0), hd.Y(base.top), hd.X(base.x1 + 1), hd.Y(base.base + 1), podium)
  hd.rect(hd.X(base.x0), hd.Y(base.top), hd.X(base.x0 + 0.7), hd.Y(base.base + 1), hdMix(node, podium, 0.45))
  hd.rect(hd.X(base.x1 + 0.3), hd.Y(base.top), hd.X(base.x1 + 1), hd.Y(base.base + 1), hdDarken(podium, 0.75))
  hd.rect(hd.X(base.x0), hd.Y(base.top), hd.X(base.x1 + 1), hd.Y(base.top + 0.16), frame)
  hd.disk(hd.X(37.5), hd.Y(base.base + 0.35), Math.max(1.8, hd.cw * 0.55), lit)

  for (const lantern of taipei101Lanterns(elapsedMs)) {
    hd.disk(hd.X(lantern.x + 0.5), hd.Y(lantern.y + 0.45), dot * 0.85, lit)
    hd.disk(hd.X(lantern.x + 0.5), hd.Y(lantern.y + 1.15), dot * 0.4, beacon)
  }

  hd.rect(0, hd.Y(TAIPEI101_GROUND_TOP), hd.w, hd.Y(TAIPEI101_PARK_TOP), street)
  hd.rect(0, hd.Y(TAIPEI101_PARK_TOP), hd.w, hd.h, ground)
  for (let x = 0; x < TAIPEI101_COLUMNS; x += 4) {
    hd.rect(hd.X(x), hd.Y(TAIPEI101_GROUND_TOP + 0.35), hd.X(x + 1.4), hd.Y(TAIPEI101_GROUND_TOP + 0.5), frame)
  }
  for (const car of taipei101Cars(elapsedMs)) {
    const nose = car.x
    hd.rect(
      hd.X(nose - 1.4),
      hd.Y(TAIPEI101_CAR_ROW),
      hd.X(nose + 1.3),
      hd.Y(TAIPEI101_CAR_ROW + 0.62),
      hdMix(beacon, street, 0.25),
    )
    hd.disk(hd.X(nose + car.dir * 1.05), hd.Y(TAIPEI101_CAR_ROW + 0.28), Math.max(1.3, hd.cw * 0.18), headlight)
  }
  for (const treeX of TAIPEI101_TREES) {
    hd.blob(hd.X(treeX + 0.8), hd.Y(TAIPEI101_PARK_TOP + 0.35), hd.cw * 1.5, hd.ch * 0.55, tree, hdDarken(tree, 0.72))
    hd.rect(
      hd.X(treeX + 0.55),
      hd.Y(TAIPEI101_PARK_TOP + 0.7),
      hd.X(treeX + 1.05),
      hd.Y(TAIPEI101_PARK_TOP + 1.7),
      hdDarken(tree, 0.6),
    )
  }
  for (const lampX of TAIPEI101_PARK_LAMPS) {
    hd.rect(
      hd.X(lampX + 0.3),
      hd.Y(TAIPEI101_PARK_TOP + 0.45),
      hd.X(lampX + 0.55),
      hd.Y(TAIPEI101_PARK_TOP + 1.7),
      frame,
    )
    hd.disk(hd.X(lampX + 0.42), hd.Y(TAIPEI101_PARK_TOP + 0.3), dot * 0.6, headlight)
  }

  // Keep the elevated rail outside the tower a flat frame color. The tower covers the span it occupies.
  hd.rect(0, railTop, hd.X(24), railBot, frame)
  hd.rect(hd.X(52), railTop, hd.w, railBot, frame)
  return hd.pixels
}
