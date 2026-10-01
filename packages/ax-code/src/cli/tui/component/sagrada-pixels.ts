import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  SAGRADA_BODY_TOP,
  SAGRADA_COLORS,
  SAGRADA_COLUMNS,
  SAGRADA_CROWD,
  SAGRADA_CRANE_X,
  SAGRADA_GROUND_TOP,
  SAGRADA_MOON,
  SAGRADA_ROSE,
  SAGRADA_ROWS,
  SAGRADA_SPIRE_BASE,
  SAGRADA_SPIRE_TOP,
  SAGRADA_SPIRES,
  SAGRADA_STARS,
  SAGRADA_TREES,
  sagradaDoves,
  sagradaHook,
  sagradaLightX,
  sagradaSkyRgb,
  type SagradaStyle,
} from "./sagrada-view-model"

/** Clustered spires, stained glass, and doves over the plaza. */
export function renderSagradaPixels(width: number, height: number, style: SagradaStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, SAGRADA_COLUMNS, SAGRADA_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "sagrada-night"
  const c = SAGRADA_COLORS[style]
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return sagradaSkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return sagradaSkyRgb(style, py / (hd.h - 1))
  }
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const rib = hdHex(c.rib)
  const glass = hdHex(c.glass)
  const glassWarm = hdHex(c.glassWarm)
  const rose = hdHex(c.rose)
  const roseLight = hdHex(c.roseLight)
  const crane = hdHex(c.crane)
  const tree = hdHex(c.tree)
  const light = hdHex(c.light)
  const ground = hdHex(c.ground)
  const crowd = hdHex(c.crowd)
  const orb = night ? SAGRADA_MOON : { x: 10, y: 1.6 }
  const litFace = night ? stoneDark : stone
  const shadeFace = night ? stone : stoneDark

  hd.sky((t) => sagradaSkyRgb(style, t))
  if (night) {
    hd.stars(SAGRADA_STARS, hdHex(c.sky), (i) => (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0)
  }
  hd.halo(hd.X(orb.x), hd.Y(orb.y), coreR, light, night ? hdHex(c.sky) : glassWarm, skyAt(orb.y))

  hd.rect(hd.X(18), hd.Y(SAGRADA_BODY_TOP), hd.X(58), hd.Y(SAGRADA_GROUND_TOP), stone)
  hd.rect(
    hd.X(18),
    hd.Y(SAGRADA_BODY_TOP),
    hd.X(18.7),
    hd.Y(SAGRADA_GROUND_TOP),
    night ? stone : hdMix(light, stone, 0.35),
  )
  hd.rect(hd.X(57.3), hd.Y(SAGRADA_BODY_TOP), hd.X(58), hd.Y(SAGRADA_GROUND_TOP), stoneDark)
  for (const wx of [23, 30, 37, 44, 51]) {
    hd.disk(hd.X(wx + 0.6), hd.Y(15.3), Math.max(1.7, hd.cw * 0.34), night ? light : glass)
    hd.disk(hd.X(wx + 0.6), hd.Y(16.35), Math.max(1.8, hd.cw * 0.36), night ? light : glassWarm)
  }

  const roseAt = SAGRADA_ROSE
  for (const [dx, dy, color, scale] of [
    [0, -1.6, rose, 0.45],
    [-1, -0.7, rose, 0.4],
    [1, -0.7, rose, 0.4],
    [0, -0.5, roseLight, 0.7],
    [-1.6, 0.3, rose, 0.4],
    [1.6, 0.3, rose, 0.4],
    [0, 0.35, roseLight, 0.85],
    [0, 1.3, rose, 0.4],
  ] as const) {
    hd.disk(hd.X(roseAt.x + dx), hd.Y(roseAt.y + dy), dot * scale, color)
  }

  for (const peak of SAGRADA_SPIRES) {
    hd.mass(peak, SAGRADA_SPIRE_TOP, SAGRADA_SPIRE_BASE, 0.55, 3.35, litFace, shadeFace, rib)
    hd.stroke(peak, SAGRADA_SPIRE_TOP, peak, SAGRADA_SPIRE_BASE - 1, Math.max(1.15, hd.cw * 0.1), rib)
    hd.disk(hd.X(peak), hd.Y(SAGRADA_SPIRE_TOP - 0.45), dot * 0.55, night ? light : glass)
  }

  const hook = sagradaHook(elapsedMs)
  hd.stroke(SAGRADA_CRANE_X, 4, SAGRADA_CRANE_X, 12.2, Math.max(1.25, hd.cw * 0.12), crane)
  hd.stroke(57, 4, 70, 4, Math.max(1.3, hd.cw * 0.12), crane)
  hd.disk(hd.X(57.3), hd.Y(4), Math.max(1.6, hd.cw * 0.22), crane)
  const cableX = 68 + hook
  hd.stroke(cableX, 4.2, cableX, 9.1, Math.max(1.05, hd.cw * 0.08), crane)
  hd.rect(hd.X(cableX - 0.55), hd.Y(9.5), hd.X(cableX + 0.85), hd.Y(10.45), crane)

  const sweep = 18 + sagradaLightX(elapsedMs)
  for (let y = SAGRADA_BODY_TOP; y < SAGRADA_GROUND_TOP; y++) {
    hd.disk(hd.X(sweep - (y - SAGRADA_BODY_TOP) + 0.5), hd.Y(y + 0.5), Math.max(1.5, hd.cw * 0.2), light)
  }

  for (const treeX of SAGRADA_TREES) {
    hd.blob(hd.X(treeX + 0.6), hd.Y(15.6), hd.cw * 1.5, hd.ch * 1.3, tree, hdDarken(tree, 0.68))
    hd.rect(hd.X(treeX + 0.35), hd.Y(16.4), hd.X(treeX + 0.85), hd.Y(18.2), hdDarken(tree, 0.55))
  }
  for (const visitor of SAGRADA_CROWD) {
    hd.disk(hd.X(visitor + 0.35), hd.Y(17.15), dot * 0.38, crowd)
    hd.rect(hd.X(visitor + 0.15), hd.Y(17.45), hd.X(visitor + 0.55), hd.Y(18.6), crowd)
  }

  const flap = Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0
  for (const dove of sagradaDoves(elapsedMs)) {
    const bx = hd.X(dove.x + 0.5)
    const by = hd.Y(dove.y + 0.5)
    const wing = flap ? 0.85 : 0.4
    hd.disk(bx, by, dot * 0.42, crowd)
    hd.disk(bx - dot * wing, by - dot * 0.08, dot * 0.28, crowd)
    hd.disk(bx + dot * wing, by - dot * 0.08, dot * 0.28, crowd)
  }

  hd.rect(0, hd.Y(SAGRADA_GROUND_TOP), hd.w, hd.h, ground)
  hd.rect(hd.X(28), hd.Y(SAGRADA_GROUND_TOP + 1.1), hd.X(33), hd.Y(SAGRADA_GROUND_TOP + 1.4), glass)
  hd.rect(hd.X(42), hd.Y(SAGRADA_GROUND_TOP + 1.1), hd.X(47), hd.Y(SAGRADA_GROUND_TOP + 1.4), glassWarm)
  for (let x = 4; x < SAGRADA_COLUMNS; x += 8) {
    hd.blob(
      hd.X(x + 0.5),
      hd.Y(SAGRADA_GROUND_TOP + 3.5),
      Math.max(2.4, hd.cw * 0.72),
      Math.max(2.4, hd.ch * 0.42),
      roseLight,
      hdDarken(roseLight, 0.72),
    )
  }
  return hd.pixels
}
