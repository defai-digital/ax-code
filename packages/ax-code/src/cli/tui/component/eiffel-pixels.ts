import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  EIFFEL_ARCH_HALF,
  EIFFEL_BASE,
  EIFFEL_CAROUSEL,
  EIFFEL_COLORS,
  EIFFEL_COLUMNS,
  EIFFEL_CX,
  EIFFEL_FOUNTAIN,
  EIFFEL_GROUND_TOP,
  EIFFEL_LAMPS,
  EIFFEL_MOON,
  EIFFEL_PLATFORMS,
  EIFFEL_ROOFS,
  EIFFEL_ROWS,
  EIFFEL_SPARKLES,
  EIFFEL_STARS,
  EIFFEL_TOP,
  eiffelBeacon,
  eiffelBeam,
  eiffelFlash,
  eiffelHalf,
  eiffelPigeons,
  eiffelSkyRgb,
  type EiffelStyle,
} from "./eiffel-view-model"

/** Open lattice: four tapering legs, a grand arch, and sparkles. */
export function renderEiffelPixels(width: number, height: number, style: EiffelStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, EIFFEL_COLUMNS, EIFFEL_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "eiffel-night"
  const c = EIFFEL_COLORS[style]
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return eiffelSkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return eiffelSkyRgb(style, py / (hd.h - 1))
  }
  const iron = hdHex(c.iron)
  const ironDark = hdHex(c.ironDark)
  const arch = hdHex(c.arch)
  const sparkle = hdHex(c.sparkle)
  const beacon = hdHex(c.beacon)
  const lawn = hdHex(c.lawn)
  const path = hdHex(c.path)
  const lamp = hdHex(c.lampGlow)
  const ground = hdHex(c.ground)
  const cloud = hdHex(c.cloud)
  const roof = hdHex(c.roof)
  const carousel = hdHex(c.carousel)
  const fountain = hdHex(c.fountain)
  const orb = night ? EIFFEL_MOON : { x: 64, y: 1.6 }
  const leftIron = night ? iron : ironDark
  const rightIron = night ? ironDark : iron
  const thick = Math.max(1.7, hd.cw * 0.24)
  const thin = Math.max(1.2, hd.cw * 0.12)
  const xAt = (y: number, side: number, inset: number) => EIFFEL_CX + side * Math.max(0.45, eiffelHalf(y) - inset)

  hd.sky((t) => eiffelSkyRgb(style, t))
  if (night) hd.stars(EIFFEL_STARS, hdHex(c.sky), (i) => eiffelFlash(elapsedMs, i))
  hd.halo(hd.X(orb.x), hd.Y(orb.y), coreR, night ? sparkle : lamp, night ? hdHex(c.sky) : cloud, skyAt(orb.y))

  for (const roofX of EIFFEL_ROOFS) {
    hd.blob(hd.X(roofX + 1), hd.Y(15.9), hd.cw * 1.2, hd.ch * 0.36, roof, hdDarken(roof, 0.78))
  }

  hd.stroke(xAt(EIFFEL_TOP, -1, 0), EIFFEL_TOP, xAt(EIFFEL_BASE, -1, 0), EIFFEL_BASE, thick, leftIron)
  hd.stroke(xAt(EIFFEL_TOP, 1, 0), EIFFEL_TOP, xAt(EIFFEL_BASE, 1, 0), EIFFEL_BASE, thick, rightIron)
  hd.stroke(xAt(8, -1, 2.3), 8, xAt(EIFFEL_BASE, -1, 3.4), EIFFEL_BASE, thin, iron)
  hd.stroke(xAt(8, 1, 2.3), 8, xAt(EIFFEL_BASE, 1, 3.4), EIFFEL_BASE, thin, ironDark)
  for (const y of [6, 10, 15]) {
    hd.stroke(xAt(y, -1, 0.2), y, xAt(y + 2, 1, 2.6), y + 2, thin, hdMix(iron, ironDark, 0.45))
    hd.stroke(xAt(y, 1, 0.2), y, xAt(y + 2, -1, 2.6), y + 2, thin, hdMix(iron, ironDark, 0.55))
  }
  for (const platform of EIFFEL_PLATFORMS) {
    const half = eiffelHalf(platform) + 1.15
    hd.stroke(EIFFEL_CX - half, platform, EIFFEL_CX + half, platform, Math.max(1.5, hd.ch * 0.09), ironDark)
  }
  let prevX = EIFFEL_CX - EIFFEL_ARCH_HALF
  let prevY = EIFFEL_BASE - 0.2
  for (let dx = -EIFFEL_ARCH_HALF; dx <= EIFFEL_ARCH_HALF; dx++) {
    const y = EIFFEL_BASE - Math.sqrt(Math.max(0, EIFFEL_ARCH_HALF * EIFFEL_ARCH_HALF - dx * dx)) / 3
    const x = EIFFEL_CX + dx
    hd.stroke(prevX, prevY, x, y, Math.max(1.45, hd.cw * 0.16), arch)
    prevX = x
    prevY = y
  }
  for (let y = EIFFEL_TOP + 2; y <= EIFFEL_BASE - 1; y += 2) {
    const half = eiffelHalf(y)
    hd.disk(hd.X(EIFFEL_CX - half * 0.42), hd.Y(y), Math.max(1.1, hd.cw * 0.11), iron)
    hd.disk(hd.X(EIFFEL_CX + half * 0.42), hd.Y(y), Math.max(1.1, hd.cw * 0.11), ironDark)
  }

  EIFFEL_SPARKLES.forEach((spark, i) => {
    if (!eiffelFlash(elapsedMs, i)) return
    hd.disk(hd.X(spark.x + 0.5), hd.Y(spark.y + 0.5), dot * 0.55, sparkle)
  })
  const beaconOn = eiffelBeacon(elapsedMs)
  hd.disk(hd.X(EIFFEL_CX), hd.Y(EIFFEL_TOP + 0.15), beaconOn ? dot * 0.7 : dot * 0.32, beacon)
  const beam = eiffelBeam(elapsedMs)
  for (let i = 1; i <= 3; i++) {
    hd.disk(hd.X(EIFFEL_CX + beam * i * 3), hd.Y(1 + i), i === 3 ? dot * 0.45 : dot * 0.28, sparkle)
  }

  const flap = Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0
  for (const pigeon of eiffelPigeons(elapsedMs)) {
    const bx = hd.X(pigeon.x + 0.5)
    const by = hd.Y(pigeon.y + 0.5)
    const wing = flap ? 0.8 : 0.38
    hd.disk(bx, by, dot * 0.4, ironDark)
    hd.disk(bx - dot * wing, by - dot * 0.08, dot * 0.26, ironDark)
    hd.disk(bx + dot * wing, by - dot * 0.08, dot * 0.26, ironDark)
  }

  hd.rect(0, hd.Y(EIFFEL_GROUND_TOP), hd.w, hd.h, lawn)
  hd.rect(0, hd.Y(23.15), hd.w, hd.h, hdMix(lawn, ground, 0.4))
  hd.rect(hd.X(36.2), hd.Y(EIFFEL_GROUND_TOP), hd.X(39.8), hd.h, path)
  hd.rect(hd.X(20), hd.Y(22.15), hd.X(57), hd.Y(22.45), path)
  for (let x = 2; x < EIFFEL_COLUMNS; x++) {
    if ((x * 5 + 42) % 11 === 0) hd.disk(hd.X(x + 0.4), hd.Y(21.3), dot * 0.28, sparkle)
    if ((x * 5 + 46) % 11 === 0) hd.disk(hd.X(x + 0.4), hd.Y(23.2), dot * 0.28, hdMix(sparkle, lawn, 0.2))
  }
  for (const lampX of EIFFEL_LAMPS) {
    hd.rect(hd.X(lampX + 0.28), hd.Y(17.15), hd.X(lampX + 0.58), hd.Y(19.8), ironDark)
    hd.disk(hd.X(lampX + 0.43), hd.Y(16.9), night ? dot * 0.7 : dot * 0.4, lamp)
  }
  const ride = EIFFEL_CAROUSEL
  hd.blob(hd.X(ride.x + 1.6), hd.Y(ride.top + 0.3), hd.cw * 2.1, hd.ch * 0.4, carousel, hdDarken(carousel, 0.75))
  hd.stroke(ride.x + 1.6, ride.top + 0.5, ride.x + 1.6, ride.base, Math.max(1.2, hd.cw * 0.1), ironDark)
  hd.rect(hd.X(ride.x), hd.Y(ride.base), hd.X(ride.x + 3.4), hd.Y(ride.base + 0.35), carousel)
  const jet = EIFFEL_FOUNTAIN
  hd.disk(hd.X(jet.x), hd.Y(jet.top + 0.15), dot * 0.4, fountain)
  hd.disk(hd.X(jet.x - 0.7), hd.Y(jet.top + 0.85), dot * 0.32, fountain)
  hd.disk(hd.X(jet.x + 0.7), hd.Y(jet.top + 0.85), dot * 0.32, hdMix(fountain, cloud, 0.25))
  hd.rect(hd.X(jet.x - 1.1), hd.Y(jet.base), hd.X(jet.x + 1.6), hd.Y(jet.base + 0.4), ironDark)

  for (const roofX of EIFFEL_ROOFS) {
    hd.rect(hd.X(roofX), hd.Y(16.25), hd.X(roofX + 1.35), hd.Y(19), roof)
    hd.rect(hd.X(roofX + 1.35), hd.Y(16.25), hd.X(roofX + 2), hd.Y(19), hdDarken(roof, 0.72))
  }
  return hd.pixels
}
