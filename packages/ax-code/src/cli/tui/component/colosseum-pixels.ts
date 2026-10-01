import {
  COLOSSEUM_BANNERS,
  COLOSSEUM_COLUMNS,
  COLOSSEUM_CYPRESS,
  COLOSSEUM_FLASH,
  COLOSSEUM_GLADIATORS,
  COLOSSEUM_GROUND_TOP,
  COLOSSEUM_MOON,
  COLOSSEUM_PINES,
  COLOSSEUM_ROWS,
  COLOSSEUM_STARS,
  COLOSSEUM_STATUES,
  COLOSSEUM_WALL,
  COLOSSEUM_COLORS,
  colosseumBirds,
  colosseumFlash,
  colosseumSkyRgb,
  colosseumTorch,
  type ColosseumStyle,
} from "./colosseum-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"

/**
 * Freeform HD renderer. An elliptical travertine bowl, arched openings,
 * crown statues, speckled cypress and umbrella pines, and flashing cameras
 * come from the shared scene model. Pure and deterministic: everything
 * derives from `elapsedMs`.
 */
export function renderColosseumPixels(width: number, height: number, style: ColosseumStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, COLOSSEUM_COLUMNS, COLOSSEUM_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "colosseum-night"
  const c = COLOSSEUM_COLORS[style]
  const wall = COLOSSEUM_WALL
  const travertine = hdHex(c.travertine)
  const dark = hdHex(c.travertineDark)
  const arch = hdHex(c.arch)
  const torch = hdHex(c.torch)
  const cypress = hdHex(c.cypress)
  const pine = hdHex(c.pine)
  const crowd = hdHex(c.crowd)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const torchOn = colosseumTorch(elapsedMs)

  hd.sky((t) => colosseumSkyRgb(style, t))
  if (night) {
    hd.stars(COLOSSEUM_STARS, hdMix(torch, [255, 255, 255], 0.35), (index) => {
      return (Math.floor(Math.max(0, elapsedMs) / 400) + index) % 3 === 0
    })
    const around = colosseumSkyRgb(style, COLOSSEUM_MOON.y / COLOSSEUM_ROWS)
    hd.halo(hd.X(COLOSSEUM_MOON.x), hd.Y(COLOSSEUM_MOON.y + 0.4), coreR, torch, hdMix(torch, around, 0.45), around)
  } else {
    const cloud = hdHex(c.cloud)
    hd.puff(8, 2, 4, cloud)
    hd.puff(40, 1, 6, cloud)
    hd.puff(58, 4, 6, cloud)
  }
  for (const dove of colosseumBirds(elapsedMs)) {
    hd.disk(hd.X(dove.x + 0.5), hd.Y(dove.y + 0.5), Math.max(1.4, Math.min(hd.cw, hd.ch) * 0.14), hdHex(c.bird))
  }

  const midX = (wall.x0 + wall.x1) / 2
  const midY = (wall.top + wall.base) / 2
  hd.blob(hd.X(midX), hd.Y(midY), hd.cw * 25.5, hd.ch * 4.5, travertine, hdDarken(travertine, 0.9))
  hd.blob(hd.X(midX), hd.Y(14.2), hd.cw * 12, hd.ch * 1.6, hdDarken(travertine, 0.86))
  hd.rect(hd.X(wall.x0), hd.Y(wall.top - 1), hd.X(wall.x0 + 20), hd.Y(wall.top), dark)
  hd.rect(hd.X(wall.x0 + 22), hd.Y(wall.top - 1), hd.X(wall.x0 + 36), hd.Y(wall.top), dark)
  hd.rect(hd.X(wall.x0 + 40), hd.Y(wall.top - 1), hd.X(wall.x0 + 50), hd.Y(wall.top), dark)
  for (const archY of [10, 14]) {
    for (let x = wall.x0 + 3; x <= wall.x1 - 4; x += 7) {
      hd.blob(hd.X(x + 1), hd.Y(archY + 0.85), hd.cw * 0.95, hd.ch * 0.72, night ? torch : arch)
      hd.stroke(x + 0.15, archY + 0.2, x + 1.85, archY + 0.2, Math.max(1.2, hd.cw * 0.1), arch)
    }
  }
  for (const drape of COLOSSEUM_BANNERS) {
    hd.stroke(drape + 0.5, wall.top, drape + 0.5, wall.top + 1.8, Math.max(1.6, hd.cw * 0.16), hdHex(c.banner))
  }
  const gateGlow = night ? torch : travertine
  hd.blob(hd.X(38), hd.Y(16.7), hd.cw * 2.1, hd.ch * 1.05, gateGlow)
  hd.stroke(36.2, 16.15, 39.8, 16.15, Math.max(1.4, hd.cw * 0.12), arch)
  hd.stroke(36.15, 16.4, 36.15, 17.8, Math.max(1.3, hd.cw * 0.1), arch)
  hd.stroke(39.85, 16.4, 39.85, 17.8, Math.max(1.3, hd.cw * 0.1), arch)
  hd.rect(hd.X(34), hd.Y(COLOSSEUM_GROUND_TOP - 1), hd.X(42), hd.Y(COLOSSEUM_GROUND_TOP), dark)

  for (const tree of COLOSSEUM_CYPRESS) {
    hd.blob(hd.X(tree + 1), hd.Y(15.5), hd.cw * 1.3, hd.ch * 2.2, cypress, hdDarken(cypress, 0.7))
    hd.stroke(tree + 1, 16.6, tree + 1, 17.8, Math.max(1.4, hd.cw * 0.12), hdDarken(cypress, 0.62))
  }
  for (const tree of COLOSSEUM_PINES) {
    hd.blob(hd.X(tree + 0.5), hd.Y(11.5), hd.cw * 1.8, hd.ch * 0.8, pine, hdDarken(pine, 0.72))
    hd.stroke(tree + 0.5, 12.15, tree + 0.5, 17.6, Math.max(1.4, hd.cw * 0.12), hdDarken(pine, 0.62))
  }
  for (const figure of COLOSSEUM_STATUES) {
    hd.disk(hd.X(figure + 0.5), hd.Y(wall.top - 1), Math.max(4, hd.cw * 0.42), arch)
    hd.stroke(figure + 0.5, wall.top - 1.7, figure + 0.5, wall.top - 1.15, Math.max(1.2, hd.cw * 0.1), arch)
  }
  for (const brazier of [10, 65]) {
    const radius = torchOn ? Math.max(2.2, hd.cw * 0.28) : Math.max(1.2, hd.cw * 0.12)
    hd.disk(hd.X(brazier + 0.5), hd.Y(COLOSSEUM_GROUND_TOP - 0.55), radius, torch)
  }
  for (const x of [22, 40, 52]) {
    hd.disk(hd.X(x + 0.5), hd.Y(15.4), Math.max(1.5, hd.cw * 0.16), crowd)
  }
  for (const gladiator of COLOSSEUM_GLADIATORS) {
    hd.disk(hd.X(gladiator + 0.5), hd.Y(17.5), Math.max(3.2, hd.cw * 0.36), crowd)
  }

  hd.rect(0, hd.Y(COLOSSEUM_GROUND_TOP), hd.w, hd.h, hdHex(c.ground))
  const flash = colosseumFlash(elapsedMs)
  COLOSSEUM_FLASH.forEach((camera, index) => {
    const radius = index === flash ? Math.max(2.4, hd.cw * 0.28) : Math.max(2, hd.cw * 0.2)
    hd.disk(hd.X(camera + 0.5), hd.Y(COLOSSEUM_GROUND_TOP - 0.5), radius, index === flash ? torch : crowd)
  })
  return hd.pixels
}
