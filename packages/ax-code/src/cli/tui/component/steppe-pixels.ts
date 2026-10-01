import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  STEPPE_COLORS,
  STEPPE_COLUMNS,
  STEPPE_CYCLE_MS,
  STEPPE_GROUND_TOP,
  STEPPE_MOON,
  STEPPE_ROWS,
  STEPPE_SMOKE_X,
  STEPPE_STARS,
  STEPPE_YURT,
  steppeClouds,
  steppeHerd,
  steppeSkyRgb,
  steppeTick,
  type SteppeStyle,
} from "./steppe-view-model"

/**
 * Freeform HD steppe. Rolling hill masses, drifting cloud puffs, a speckled
 * ger, and a galloping herd come from the shared scene model. Pure and
 * deterministic: everything derives from `elapsedMs` and loops at 2400ms.
 * Deep grassland below the tufts stays the flat ground color.
 */
export function renderSteppePixels(width: number, height: number, style: SteppeStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, STEPPE_COLUMNS, STEPPE_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "steppe-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % STEPPE_CYCLE_MS) / STEPPE_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = STEPPE_COLORS[style]
  const ground = hdHex(c.ground)
  const grass = hdHex(c.grass)
  const lit = hdMix(grass, ground, 0.18)
  const shade = hdDarken(grass, 0.76)
  const hillEdge = hdDarken(ground, 0.82)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const around = steppeSkyRgb(style, 0.12)
  const tick = steppeTick(elapsed)

  hd.sky((t) => steppeSkyRgb(style, t))
  if (night) {
    const moon = hdMix(hdHex(c.smoke), hdHex(c.glow), 0.72)
    hd.stars(STEPPE_STARS, moon, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    hd.halo(hd.X(STEPPE_MOON.x), hd.Y(STEPPE_MOON.y), coreR, moon, hdHex(c.smoke), around)
  }
  for (const cloud of steppeClouds(elapsed)) hd.puff(cloud.x, cloud.y, 5, hdHex(c.cloud))

  hd.mass(18, 11.4, STEPPE_GROUND_TOP, 1.6, 20, lit, shade, hillEdge)
  hd.mass(40, 12.6, STEPPE_GROUND_TOP, 1.3, 16, hdMix(lit, shade, 0.3), hdDarken(shade, 0.92), hillEdge)
  hd.mass(62, 13.2, STEPPE_GROUND_TOP, 1, 13, lit, shade, hillEdge)

  hd.rect(0, hd.Y(STEPPE_GROUND_TOP), hd.w, hd.h, ground)
  hd.rect(0, hd.Y(23), hd.w, hd.h, hdDarken(ground, 0.84))
  for (let x = 1; x < STEPPE_COLUMNS; x += 5) {
    hd.rect(hd.X(x + 0.2), hd.Y(STEPPE_GROUND_TOP + 2.7), hd.X(x + 0.5), hd.Y(STEPPE_GROUND_TOP + 3.45), grass)
    hd.rect(hd.X(x + 2.2), hd.Y(STEPPE_GROUND_TOP + 4.7), hd.X(x + 2.5), hd.Y(STEPPE_GROUND_TOP + 5.4), grass)
  }
  hd.blob(hd.X(8), hd.Y(STEPPE_GROUND_TOP - 0.35), hd.cw * 1.4, hd.ch * 0.42, grass, hdDarken(grass, 0.8))
  hd.blob(hd.X(30), hd.Y(STEPPE_GROUND_TOP - 0.15), hd.cw * 1.7, hd.ch * 0.38, lit, shade)

  const felt = hdHex(c.yurt)
  const feltDark = hdHex(c.yurtBg)
  const door = hdHex(c.door)
  const yurt = STEPPE_YURT
  const cx = (yurt.x0 + yurt.x1) / 2
  hd.blob(hd.X(cx), hd.Y(yurt.top + 1.2), hd.cw * 4.3, hd.ch * 1.35, felt, feltDark)
  hd.rect(hd.X(yurt.x0 + 0.35), hd.Y(yurt.top + 1.85), hd.X(yurt.x1 - 0.25), hd.Y(yurt.base + 0.85), feltDark)
  hd.rect(hd.X(54.7), hd.Y(yurt.top + 2.35), hd.X(56.5), hd.Y(yurt.base + 0.85), door)
  const window = night ? hdHex(c.glow) : door
  hd.disk(hd.X(58.3), hd.Y(yurt.top + 1.65), Math.max(1.6, hd.cw * (night ? 0.55 : 0.38)), window)

  const smoke = hdHex(c.smoke)
  for (let i = 0; i < 4; i++) {
    const rise = ((tick + i) % 4) * 0.14
    hd.disk(
      hd.X(STEPPE_SMOKE_X + Math.sin(theta + i) * 0.35),
      hd.Y(11.15 - i * 0.82 - rise),
      Math.max(1.3, hd.cw * (0.26 + i * 0.08)),
      hdMix(smoke, around, i * 0.16),
    )
  }

  const hide = hdHex(c.herd)
  for (const horse of steppeHerd(elapsed)) {
    const leg = tick % 2
    const y = STEPPE_GROUND_TOP - 1.4
    hd.blob(hd.X(horse.x + 1.05), hd.Y(y), hd.cw * 1.15, hd.ch * 0.34, hide)
    hd.disk(hd.X(horse.x + 2.05), hd.Y(y - 0.22), Math.max(1.3, hd.cw * 0.32), hide)
    hd.rect(hd.X(horse.x + 0.4), hd.Y(y + 0.12), hd.X(horse.x + 0.68), hd.Y(y + 0.72 + leg * 0.12), hide)
    hd.rect(hd.X(horse.x + 1.45), hd.Y(y + 0.12), hd.X(horse.x + 1.72), hd.Y(y + 0.84 - leg * 0.12), hide)
  }

  const mote = hdMix(grass, hdHex(c.cloud), 0.5)
  for (let i = 0; i < 12; i++) {
    const x = (i * 11 + 4 + phase * STEPPE_COLUMNS) % STEPPE_COLUMNS
    const y = 7.2 + (i % 5) * 0.7 + Math.sin(theta * 2 + i) * 0.2
    hd.disk(hd.X(x), hd.Y(y), Math.max(1, hd.cw * 0.16), mote)
  }
  return hd.pixels
}
