import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  BIGBEN_ABBEY,
  BIGBEN_BRIDGE,
  BIGBEN_COLORS,
  BIGBEN_COLUMNS,
  BIGBEN_FACE,
  BIGBEN_GROUND_TOP,
  BIGBEN_LAMPS,
  BIGBEN_MOON,
  BIGBEN_ROWS,
  BIGBEN_STARS,
  BIGBEN_TOWER,
  BIGBEN_WATER_TOP,
  bigbenBirds,
  bigbenBus,
  bigbenClouds,
  bigbenFlag,
  bigbenHands,
  bigbenShimmer,
  bigbenSkyRgb,
  type BigbenStyle,
} from "./bigben-view-model"

/** Shaded Westminster: clock, abbey, quay, and a rippling Thames. */
export function renderBigbenPixels(width: number, height: number, style: BigbenStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, BIGBEN_COLUMNS, BIGBEN_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "bigben-night"
  const c = BIGBEN_COLORS[style]
  const phase = (2 * Math.PI * (Math.max(0, elapsedMs) % 2400)) / 2400
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return bigbenSkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return bigbenSkyRgb(style, py / (hd.h - 1))
  }
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const stoneLight = hdHex(c.stoneLight)
  const face = hdHex(c.face)
  const hand = hdHex(c.hand)
  const arch = hdHex(c.arch)
  const windowLit = hdHex(c.window)
  const ground = hdHex(c.ground)
  const water = hdHex(c.water)
  const deep = hdHex(c.waterDeep)
  const lamp = hdHex(c.lampGlow)
  const abbey = hdHex(c.abbey)
  const abbeyShade = hdDarken(abbey, 0.72)
  const cloud = hdHex(c.cloud)
  const bus = hdHex(c.bus)
  const beam = hdHex(c.beam)
  const rail = hdHex(c.rail)
  const edge = hdMix(stoneLight, stoneDark, 0.4)
  const orb = night ? BIGBEN_MOON : { x: 14, y: 1.7 }

  hd.sky((t) => bigbenSkyRgb(style, t))
  if (night) {
    hd.stars(BIGBEN_STARS, hdHex(c.sky), (i) => (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0)
  }
  hd.halo(hd.X(orb.x), hd.Y(orb.y), coreR, night ? face : lamp, night ? hdHex(c.sky) : face, skyAt(orb.y))
  for (const puff of bigbenClouds(elapsedMs)) hd.puff(puff.x, puff.y, 5, cloud)

  const abbeyMid = (BIGBEN_ABBEY.x0 + BIGBEN_ABBEY.x1) / 2
  hd.mass(abbeyMid, BIGBEN_ABBEY.top, BIGBEN_ABBEY.base, 6.2, 9.2, abbey, abbeyShade, hdDarken(abbey, 0.55))
  for (const spire of [56, 64])
    hd.mass(spire, 12.6, BIGBEN_ABBEY.top, 0.35, 1.15, abbey, abbeyShade, hdDarken(abbey, 0.5))
  for (let x = BIGBEN_ABBEY.x0 + 2; x <= BIGBEN_ABBEY.x1 - 2; x += 4) {
    hd.disk(hd.X(x + 0.8), hd.Y(17.35), Math.max(1.5, hd.cw * 0.32), night ? face : stoneDark)
  }

  const tower = BIGBEN_TOWER
  const mid = (tower.x0 + tower.x1) / 2
  hd.mass(mid, 1.1, tower.top, 0.4, 3.15, stoneDark, hdDarken(stoneDark, 0.78), edge)
  hd.mass(34, 3.1, 5.1, 0.3, 0.85, stoneDark, hdDarken(stoneDark, 0.8), edge)
  hd.mass(43, 3.1, 5.1, 0.3, 0.85, stoneLight, stone, edge)
  // Lit face is palette stone, so the sampled course between the string bands stays put.
  hd.mass(mid, tower.top, tower.base, 3.15, 3.55, stone, stoneDark, edge)
  for (const course of [11, 15]) {
    hd.rect(hd.X(tower.x0 + 0.15), hd.Y(course + 0.38), hd.X(tower.x1 + 0.85), hd.Y(course + 0.58), arch)
  }

  const flag = bigbenFlag(elapsedMs)
  hd.rect(hd.X(37.85), hd.Y(0.05), hd.X(38.2), hd.Y(1.15), stoneDark)
  hd.blob(
    hd.X(39.6 + (flag - 1) * 0.25),
    hd.Y(0.42),
    hd.cw * (1.15 + flag * 0.12),
    hd.ch * 0.32,
    face,
    hdDarken(face, 0.82),
  )

  const faceR = Math.max(4, Math.min(hd.cw, hd.ch) * BIGBEN_FACE.r * 0.82)
  hd.disk(hd.X(BIGBEN_FACE.cx), hd.Y(BIGBEN_FACE.cy), faceR, arch)
  hd.disk(hd.X(BIGBEN_FACE.cx), hd.Y(BIGBEN_FACE.cy), faceR * 0.84, face)
  const hands = bigbenHands(elapsedMs)
  const handW = Math.max(1.15, hd.cw * 0.11)
  for (const cell of hands.hour) {
    hd.stroke(BIGBEN_FACE.cx, BIGBEN_FACE.cy, cell.x + 0.5, cell.y + 0.5, handW * 1.35, hand)
  }
  for (const cell of hands.minute) {
    hd.stroke(BIGBEN_FACE.cx, BIGBEN_FACE.cy, cell.x + 0.5, cell.y + 0.5, handW, hand)
  }
  hd.disk(hd.X(BIGBEN_FACE.cx), hd.Y(BIGBEN_FACE.cy), Math.max(1.5, hd.cw * 0.16), hand)

  for (const y of [12, 14, 16, 18]) {
    hd.disk(hd.X(38), hd.Y(y - 0.45), Math.max(1.6, hd.cw * 0.28), arch)
    hd.disk(hd.X(38), hd.Y(y + 0.4), Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.32), windowLit)
  }

  if (night) hd.stroke(30.2, 19.2, 33.6, 16.2, Math.max(2.2, hd.cw * 0.28), beam)

  for (const lampX of BIGBEN_LAMPS) {
    hd.rect(hd.X(lampX + 0.2), hd.Y(18), hd.X(lampX + 0.48), hd.Y(20), stoneDark)
    hd.disk(hd.X(lampX + 0.34), hd.Y(17.4), night ? dot * 0.95 : dot * 0.55, lamp)
  }
  for (const foot of BIGBEN_BRIDGE) {
    hd.stroke(foot + 0.15, 19.2, foot + 1.85, 19.2, Math.max(1.3, hd.ch * 0.07), hdMix(stone, stoneDark, 0.35))
    hd.rect(hd.X(foot), hd.Y(19.05), hd.X(foot + 2), hd.Y(20), stoneDark)
  }

  const busX = bigbenBus(elapsedMs)
  hd.rect(hd.X(busX), hd.Y(17), hd.X(busX + 10), hd.Y(19), bus)
  hd.rect(hd.X(busX), hd.Y(18.02), hd.X(busX + 10), hd.Y(18.16), hdDarken(bus, 0.78))
  const glass = hdMix(face, bus, 0.28)
  hd.rect(hd.X(busX + 1.15), hd.Y(17.22), hd.X(busX + 2.35), hd.Y(17.68), glass)
  hd.rect(hd.X(busX + 7.45), hd.Y(17.22), hd.X(busX + 8.65), hd.Y(17.68), glass)
  hd.rect(hd.X(busX + 1.15), hd.Y(18.22), hd.X(busX + 2.35), hd.Y(18.62), hdMix(face, bus, 0.4))
  hd.rect(hd.X(busX + 7.45), hd.Y(18.22), hd.X(busX + 8.65), hd.Y(18.62), hdMix(face, bus, 0.4))
  hd.disk(hd.X(busX + 1.6), hd.Y(19.05), Math.max(1.6, hd.cw * 0.26), stoneDark)
  hd.disk(hd.X(busX + 8.2), hd.Y(19.05), Math.max(1.6, hd.cw * 0.26), stoneDark)

  for (const bird of bigbenBirds(elapsedMs)) {
    const bx = hd.X(bird.x + 0.5)
    const by = hd.Y(bird.y + 0.5)
    hd.disk(bx, by, dot * 0.5, stoneDark)
    hd.disk(bx - dot * 0.7, by - dot * 0.12, dot * 0.32, stoneDark)
    hd.disk(bx + dot * 0.7, by - dot * 0.12, dot * 0.32, stoneDark)
  }

  hd.rect(0, hd.Y(BIGBEN_GROUND_TOP), hd.w, hd.Y(BIGBEN_WATER_TOP), ground)
  hd.rect(0, hd.Y(BIGBEN_GROUND_TOP + 0.72), hd.w, hd.Y(BIGBEN_WATER_TOP), hdDarken(ground, 0.84))
  for (let x = 0; x < BIGBEN_COLUMNS; x += 5) {
    hd.rect(hd.X(x + 0.32), hd.Y(BIGBEN_GROUND_TOP + 0.12), hd.X(x + 0.58), hd.Y(BIGBEN_GROUND_TOP + 0.78), rail)
  }

  const shimmer = bigbenShimmer(elapsedMs)
  hd.water(BIGBEN_WATER_TOP, BIGBEN_ROWS, water, deep, phase)
  hd.reflection(orb.x + shimmer * 0.35, BIGBEN_WATER_TOP, BIGBEN_ROWS, night ? face : lamp, phase, 3.2)
  if (night) hd.disk(hd.X(32.5), hd.Y(17.5), Math.max(2.6, Math.min(hd.cw, hd.ch) * 0.42), beam)
  return hd.pixels
}
