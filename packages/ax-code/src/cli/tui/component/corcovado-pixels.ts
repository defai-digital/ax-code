import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  CORCOVADO_CABLE_ROW,
  CORCOVADO_CABLE_X0,
  CORCOVADO_CABLE_X1,
  CORCOVADO_COLORS,
  CORCOVADO_COLUMNS,
  CORCOVADO_GROUND_TOP,
  CORCOVADO_PEAK,
  CORCOVADO_ROWS,
  CORCOVADO_STATUE,
  CORCOVADO_SUGARLOAF,
  CORCOVADO_UMBRELLAS,
  corcovadoCable,
  corcovadoClouds,
  corcovadoGliders,
  corcovadoGulls,
  corcovadoHalf,
  corcovadoSail,
  corcovadoSkyRgb,
  corcovadoSurf,
  type CorcovadoStyle,
} from "./corcovado-view-model"

/** Granite peak, summit statue, and Guanabara Bay. */
export function renderCorcovadoPixels(width: number, height: number, style: CorcovadoStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, CORCOVADO_COLUMNS, CORCOVADO_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const gold = style === "corcovado-gold"
  const c = CORCOVADO_COLORS[style]
  const phase = (2 * Math.PI * (Math.max(0, elapsedMs) % 2400)) / 2400
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return corcovadoSkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return corcovadoSkyRgb(style, py / (hd.h - 1))
  }
  const rock = hdHex(c.rock)
  const rockDark = hdHex(c.rockDark)
  const statue = hdHex(c.statue)
  const statueShade = hdHex(c.statueShade)
  const forest = hdHex(c.forest)
  const forestDeep = hdHex(c.forestDeep)
  const lights = hdHex(c.lights)
  const foam = hdHex(c.foam)
  const sugar = hdHex(c.sugarloaf)
  const sail = hdHex(c.sail)
  const cloud = hdHex(c.cloud)
  const sea = hdHex(c.sea)
  const ground = hdHex(c.ground)
  const glider = hdHex(c.glider)
  const sun = gold ? { x: 66, y: 3.5 } : { x: 62, y: 1.7 }
  const edge = hdMix(rock, statue, 0.35)

  hd.sky((t) => corcovadoSkyRgb(style, t))
  hd.halo(hd.X(sun.x), hd.Y(sun.y), coreR, lights, cloud, skyAt(sun.y))

  const loaf = CORCOVADO_SUGARLOAF
  hd.mass(
    (loaf.x0 + loaf.x1) / 2,
    loaf.top,
    loaf.base + 0.3,
    1.2,
    3.4,
    sugar,
    hdDarken(sugar, 0.72),
    hdMix(sugar, rock, 0.4),
  )
  hd.stroke(
    CORCOVADO_CABLE_X0,
    CORCOVADO_CABLE_ROW,
    CORCOVADO_CABLE_X1,
    CORCOVADO_CABLE_ROW,
    Math.max(1.1, hd.ch * 0.06),
    rockDark,
  )
  const car = corcovadoCable(elapsedMs)
  hd.rect(hd.X(car), hd.Y(CORCOVADO_CABLE_ROW - 0.32), hd.X(car + 2), hd.Y(CORCOVADO_CABLE_ROW + 0.28), statue)

  hd.water(15.4, CORCOVADO_GROUND_TOP + 0.15, sea, hdDarken(sea, 0.62), phase)
  hd.reflection(sun.x, 15.6, CORCOVADO_GROUND_TOP, lights, phase, 3.4)
  const surf = corcovadoSurf(elapsedMs)
  for (let x = 0; x < CORCOVADO_COLUMNS; x++) {
    if ((x + surf * 2) % 8 === 0) hd.disk(hd.X(x + 0.5), hd.Y(CORCOVADO_GROUND_TOP), Math.max(1.3, hd.cw * 0.2), foam)
  }
  const sailX = corcovadoSail(elapsedMs)
  hd.stroke(sailX, 17.1, sailX + 1.2, 16.2, Math.max(1.2, hd.cw * 0.1), sail)
  hd.stroke(sailX + 1.2, 16.2, sailX + 2.2, 17.1, Math.max(1.2, hd.cw * 0.1), sail)
  hd.stroke(sailX + 0.2, 18.7, sailX + 2, 18.7, Math.max(1.3, hd.ch * 0.06), sail)

  const peak = CORCOVADO_PEAK
  const topY = hd.Y(peak.top)
  const baseY = hd.Y(peak.base)
  const rowTop = Math.max(0, Math.floor(topY))
  const rowBottom = Math.min(hd.h, Math.ceil(baseY))
  for (let y = rowTop; y < rowBottom; y++) {
    const sceneY = (y + 0.5) / hd.ch
    const half = corcovadoHalf(sceneY)
    const peakX = hd.X(peak.x)
    const halfW = half * hd.cw
    const xa = Math.max(0, Math.floor(peakX - halfW))
    const xb = Math.min(hd.w, Math.ceil(peakX + halfW))
    const faceX = peakX - halfW * 0.12
    for (let x = xa; x < xb; x++) hd.set(x, y, x > faceX ? rock : rockDark)
    hd.set(xa, y, edge)
    if (xb - 1 > xa) hd.set(xb - 1, y, edge)
    if (sceneY >= 9 && sceneY <= 16) {
      for (let x = xa + 2; x < xb - 2; x++) {
        const hash = (x * 7 + y * 3) % 5
        if (hash < 2) hd.set(x, y, hash === 0 ? forest : forestDeep)
      }
    }
  }

  const figure = CORCOVADO_STATUE
  hd.disk(hd.X(figure.x), hd.Y(figure.head + 0.15), Math.max(2, hd.cw * 0.42), statue)
  hd.stroke(figure.x - 5, figure.arms, figure.x + 5, figure.arms, Math.max(1.5, hd.ch * 0.09), statueShade)
  hd.stroke(figure.x, figure.arms, figure.x, figure.base, Math.max(1.7, hd.cw * 0.16), statue)
  hd.disk(hd.X(figure.x - 4.6), hd.Y(figure.arms), dot * 0.45, statue)
  hd.disk(hd.X(figure.x + 4.6), hd.Y(figure.arms), dot * 0.45, statueShade)

  for (const puff of corcovadoClouds(elapsedMs)) hd.puff(puff.x, puff.y, 6, cloud)
  for (const flyer of corcovadoGliders(elapsedMs)) {
    hd.stroke(flyer.x - 1.4, flyer.y, flyer.x + 1.4, flyer.y + 0.15, Math.max(1.3, hd.cw * 0.1), glider)
    hd.disk(hd.X(flyer.x), hd.Y(flyer.y + 0.35), dot * 0.35, glider)
  }
  for (const gull of corcovadoGulls(elapsedMs)) {
    const bx = hd.X(gull.x + 0.5)
    const by = hd.Y(gull.y + 0.5)
    hd.disk(bx, by, dot * 0.4, foam)
    hd.disk(bx - dot * 0.65, by - dot * 0.08, dot * 0.26, foam)
    hd.disk(bx + dot * 0.65, by - dot * 0.08, dot * 0.26, foam)
  }

  for (let x = 2; x < CORCOVADO_COLUMNS; x += 5) {
    hd.disk(hd.X(x + 0.3), hd.Y(CORCOVADO_GROUND_TOP - 0.35), dot * 0.35, gold ? lights : foam)
  }
  hd.rect(0, hd.Y(CORCOVADO_GROUND_TOP + 0.35), hd.w, hd.h, ground)
  for (let x = 0; x < CORCOVADO_COLUMNS; x++) {
    if (x % 8 < 4) {
      hd.rect(
        hd.X(x),
        hd.Y(CORCOVADO_GROUND_TOP + 1.05),
        hd.X(x + 1),
        hd.Y(CORCOVADO_GROUND_TOP + 1.35),
        hdMix(sea, ground, 0.45),
      )
    }
  }
  for (const shade of CORCOVADO_UMBRELLAS) {
    hd.blob(
      hd.X(shade + 1),
      hd.Y(CORCOVADO_GROUND_TOP + 1.15),
      hd.cw * 1.45,
      hd.ch * 0.4,
      lights,
      hdDarken(lights, 0.8),
    )
    hd.rect(
      hd.X(shade + 0.32),
      hd.Y(CORCOVADO_GROUND_TOP + 1.55),
      hd.X(shade + 0.72),
      hd.Y(CORCOVADO_GROUND_TOP + 3.05),
      lights,
    )
  }
  return hd.pixels
}
