import {
  MEKONG_BOAT_X,
  MEKONG_COLUMNS,
  MEKONG_DISTANT_X,
  MEKONG_GRASS,
  MEKONG_HUT_X,
  MEKONG_LILIES,
  MEKONG_PALMS,
  MEKONG_ROWS,
  MEKONG_SUN,
  MEKONG_TEMPLE_X,
  MEKONG_WATER_TOP,
  MEKONG_COLORS,
  mekongBob,
  mekongEgrets,
  mekongMarket,
  mekongShimmer,
  mekongSkyRgb,
  type MekongStyle,
} from "./mekong-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"

/**
 * Freeform HD renderer. A haloed sun, speckled palms, a temple roof, rippled
 * river, bobbing sampan, and the drifting market boat come from the shared
 * scene model. Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderMekongPixels(width: number, height: number, style: MekongStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, MEKONG_COLUMNS, MEKONG_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const c = MEKONG_COLORS[style]
  const dawn = style === "mekong-dawn"
  const bob = mekongBob(elapsedMs)
  const shimmer = mekongShimmer(elapsedMs)
  const palm = hdHex(c.palm)
  const hut = hdHex(c.hut)
  const boat = hdHex(c.boat)
  const hat = hdHex(c.hat)
  const goods = hdHex(c.goods)
  const lily = hdHex(c.lily)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  // Phase 0 keeps the two open-water samples on one tone. These stops are the
  // ripple's inverse there, so both land on the palette water color.
  const waterTop: RGB = dawn ? [81, 142, 156] : [97, 78, 124]
  const waterDeep: RGB = dawn ? [76, 138, 155] : [92, 74, 123]

  hd.sky((t) => mekongSkyRgb(style, t))
  const around = mekongSkyRgb(style, MEKONG_SUN.y / MEKONG_ROWS)
  const sun = hdHex(c.sun)
  hd.halo(hd.X(MEKONG_SUN.x), hd.Y(MEKONG_SUN.y + 0.5), coreR, sun, hdHex(c.sunGlow), around)

  for (const trunk of MEKONG_PALMS) {
    hd.blob(hd.X(trunk + 0.2), hd.Y(9.35), hd.cw * 1.8, hd.ch * 0.55, palm, hdDarken(palm, 0.75))
    hd.blob(hd.X(trunk + 1.8), hd.Y(9.5), hd.cw * 1.5, hd.ch * 0.48, palm, hdDarken(palm, 0.82))
    hd.stroke(trunk + 1.5, 10, trunk + 1.5, 13, Math.max(1.8, hd.cw * 0.16), hdDarken(palm, 0.7))
  }
  for (const tuft of MEKONG_GRASS) {
    hd.disk(hd.X(tuft + 0.5), hd.Y(MEKONG_WATER_TOP - 0.55), Math.max(1.4, hd.cw * 0.14), hdHex(c.grass))
  }

  hd.mass(MEKONG_TEMPLE_X + 2.5, 9.7, 11.15, 0.35, 2.5, hut, hdDarken(hut, 0.82), hdDarken(hut, 0.68))
  hd.rect(hd.X(MEKONG_TEMPLE_X), hd.Y(11), hd.X(MEKONG_TEMPLE_X + 5), hd.Y(13), hut)
  hd.stroke(MEKONG_TEMPLE_X + 0.4, 11.2, MEKONG_TEMPLE_X + 0.4, 12.8, Math.max(1.2, hd.cw * 0.1), hdDarken(hut, 0.72))
  hd.stroke(MEKONG_TEMPLE_X + 4.6, 11.2, MEKONG_TEMPLE_X + 4.6, 12.8, Math.max(1.2, hd.cw * 0.1), hdDarken(hut, 0.72))
  hd.blob(hd.X(MEKONG_HUT_X + 2), hd.Y(10.35), hd.cw * 2.1, hd.ch * 0.42, hut, hdDarken(hut, 0.8))
  hd.rect(hd.X(MEKONG_HUT_X), hd.Y(10.7), hd.X(MEKONG_HUT_X + 4), hd.Y(13), hut)

  hd.water(MEKONG_WATER_TOP, MEKONG_ROWS, waterTop, waterDeep, 0)
  const phase = ((Math.max(0, elapsedMs) % 2400) / 2400) * Math.PI * 2
  hd.reflection(MEKONG_SUN.x, MEKONG_WATER_TOP, MEKONG_ROWS, hdMix(hdHex(c.shimmer), sun, 0.35), phase, 2.6)
  const crest = hdHex(c.shimmer)
  for (let i = 0; i < 10; i++) {
    const x = (i * 7 + shimmer * 3) % MEKONG_COLUMNS
    const y = 17.2 + (i % 4) * 1.3
    hd.disk(hd.X(x + 0.5), hd.Y(y), Math.max(1.1, hd.cw * 0.1), crest)
  }
  for (const [padX, padY] of MEKONG_LILIES) {
    hd.disk(hd.X(padX! + 0.5), hd.Y(padY! + 0.5), Math.max(2.2, hd.cw * 0.28), lily)
  }
  hd.disk(hd.X(48.5), hd.Y(19.5), Math.max(1.6, hd.cw * 0.16), hat)

  const boatY = MEKONG_WATER_TOP + 2 + bob
  hd.blob(hd.X(MEKONG_BOAT_X + 0.6), hd.Y(boatY - 2.55), hd.cw * 1.15, hd.ch * 0.7, hat)
  hd.stroke(MEKONG_BOAT_X + 1, boatY - 1.3, MEKONG_BOAT_X + 1, boatY, Math.max(1.2, hd.cw * 0.1), boat)
  hd.blob(hd.X(MEKONG_BOAT_X + 0.5), hd.Y(boatY + 0.45), hd.cw * 4.4, hd.ch * 0.42, boat, hdDarken(boat, 0.8))

  const marketX = mekongMarket(elapsedMs)
  hd.blob(hd.X(marketX + 3), hd.Y(15.45), hd.cw * 3.1, hd.ch * 0.42, boat, hdDarken(boat, 0.82))
  hd.rect(hd.X(marketX + 1), hd.Y(14), hd.X(marketX + 4), hd.Y(15), goods)

  hd.stroke(
    MEKONG_DISTANT_X + 2.5,
    MEKONG_WATER_TOP - 2,
    MEKONG_DISTANT_X + 2.5,
    MEKONG_WATER_TOP - 1.15,
    Math.max(1.2, hd.cw * 0.1),
    boat,
  )
  hd.rect(hd.X(MEKONG_DISTANT_X), hd.Y(MEKONG_WATER_TOP - 1), hd.X(MEKONG_DISTANT_X + 5), hd.Y(MEKONG_WATER_TOP), boat)

  for (const bird of mekongEgrets(elapsedMs)) {
    hd.disk(hd.X(bird.x + 0.5), hd.Y(bird.y + 0.5), Math.max(1.5, Math.min(hd.cw, hd.ch) * 0.16), hdHex(c.egret))
  }
  return hd.pixels
}
