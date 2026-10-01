import {
  DOMES_BASE_BOTTOM,
  DOMES_BASE_TOP,
  DOMES_BELL,
  DOMES_CHIMNEY_X,
  DOMES_COLUMNS,
  DOMES_DOME,
  DOMES_GROUND_TOP,
  DOMES_PINES,
  DOMES_ROWS,
  DOMES_COLORS,
  domesFlakes,
  domesFlakesBig,
  domesGlint,
  domesSkyRgb,
  type DomesStyle,
} from "./domes-view-model"
import { createHdCanvas, hdDarken, hdHex } from "./scene-hd"

/**
 * Freeform HD renderer. Stacked onion-dome ellipses, plaster walls, a bell
 * arch, speckled evergreens, and snowfall disks come from the shared scene
 * model. Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderDomesPixels(width: number, height: number, style: DomesStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, DOMES_COLUMNS, DOMES_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const snow = style === "domes-snow"
  const c = DOMES_COLORS[style]
  const dome = hdHex(c.dome)
  const shade = hdHex(c.domeShade)
  const cross = hdHex(c.cross)
  const wall = hdHex(c.wall)
  const wallDark = hdHex(c.wallDark)
  const pines = hdHex(c.pines)
  const drum = hdHex(c.drum)

  hd.sky((t) => domesSkyRgb(style, t))
  DOMES_DOME.forEach((bulb) => {
    const cx = hd.X(bulb.x + 0.5)
    const base = DOMES_BASE_TOP
    hd.blob(cx, hd.Y(base - bulb.r * 0.12), bulb.r * hd.cw * 0.92, bulb.r * hd.ch * 0.38, shade)
    hd.blob(cx, hd.Y(base - bulb.r * 0.5), bulb.r * hd.cw * 0.74, bulb.r * hd.ch * 0.46, dome, shade)
    hd.blob(cx, hd.Y(base - bulb.r * 0.92), bulb.r * hd.cw * 0.4, bulb.r * hd.ch * 0.3, dome)
    hd.stroke(bulb.x + 0.5, base - bulb.r - 3.05, bulb.x + 0.5, base - bulb.r - 1.15, Math.max(1.2, hd.cw * 0.1), cross)
    hd.stroke(
      bulb.x - 0.15,
      base - bulb.r - 2.45,
      bulb.x + 1.15,
      base - bulb.r - 2.45,
      Math.max(1.2, hd.cw * 0.1),
      cross,
    )
    hd.rect(hd.X(bulb.x - 2), hd.Y(base - 1), hd.X(bulb.x + 3), hd.Y(base), drum)
  })
  if (snow) {
    const flake = hdHex(c.flake)
    for (const bit of domesFlakes(elapsedMs)) {
      hd.disk(hd.X(bit.x + 0.5), hd.Y(bit.y + 0.5), Math.max(1.3, Math.min(hd.cw, hd.ch) * 0.12), flake)
    }
    for (const bit of domesFlakesBig(elapsedMs)) {
      hd.disk(hd.X(bit.x + 0.5), hd.Y(bit.y + 0.5), Math.max(2.2, Math.min(hd.cw, hd.ch) * 0.22), flake)
    }
  }
  DOMES_DOME.forEach((bulb, domeIndex) => {
    if (snow && domesGlint(elapsedMs, domeIndex)) {
      hd.disk(hd.X(bulb.x - 0.5), hd.Y(DOMES_BASE_TOP - bulb.r - 2.5), Math.max(2, hd.cw * 0.26), cross)
    }
  })

  hd.rect(hd.X(12), hd.Y(DOMES_BASE_TOP), hd.X(65), hd.Y(DOMES_BASE_BOTTOM + 1), wall)
  hd.rect(hd.X(12), hd.Y(DOMES_BASE_TOP), hd.X(13.15), hd.Y(DOMES_BASE_BOTTOM + 1), wallDark)
  hd.rect(hd.X(63.85), hd.Y(DOMES_BASE_TOP), hd.X(65), hd.Y(DOMES_BASE_BOTTOM + 1), wallDark)
  const windowGlow = hdHex(snow ? c.glow : c.wallDark)
  for (const wx of [20, 30, 40, 50]) {
    hd.blob(hd.X(wx + 1), hd.Y(14.35), hd.cw * 0.85, hd.ch * 0.42, windowGlow)
    hd.rect(hd.X(wx + 0.35), hd.Y(14.7), hd.X(wx + 1.65), hd.Y(15.85), windowGlow)
  }
  hd.blob(hd.X(38), hd.Y(16.15), hd.cw * 1.15, hd.ch * 0.55, hdHex(c.door))
  hd.rect(hd.X(37.15), hd.Y(16.35), hd.X(38.85), hd.Y(18), hdHex(c.door))

  hd.rect(hd.X(DOMES_CHIMNEY_X), hd.Y(10), hd.X(DOMES_CHIMNEY_X + 2), hd.Y(12), wallDark)
  const smoke = hdHex(c.smoke)
  hd.disk(hd.X(60.5), hd.Y(9.4), Math.max(2, hd.cw * 0.28), smoke)
  hd.disk(hd.X(61.6), hd.Y(8.35), Math.max(2.4, hd.cw * 0.34), smoke)
  hd.disk(hd.X(62.8), hd.Y(7.3), Math.max(2.8, hd.cw * 0.4), smoke)
  hd.rect(hd.X(8), hd.Y(17), hd.X(11), hd.Y(18), hdHex(c.wood))
  for (let x = 2; x < DOMES_COLUMNS - 2; x += 3) {
    hd.stroke(x + 0.2, DOMES_GROUND_TOP - 1, x + 0.2, DOMES_GROUND_TOP, Math.max(1.1, hd.cw * 0.08), wallDark)
  }

  for (const pine of DOMES_PINES) {
    hd.blob(hd.X(pine + 0.5), hd.Y(16), hd.cw * 1.6, hd.ch * 1.15, pines, hdDarken(pines, 0.72))
    hd.blob(hd.X(pine + 0.2), hd.Y(15.35), hd.cw * 1.05, hd.ch * 0.7, pines, hdDarken(pines, 0.8))
    hd.stroke(pine + 0.5, 17.05, pine + 0.5, 18.15, Math.max(1.5, hd.cw * 0.14), hdDarken(pines, 0.62))
  }
  const bell = DOMES_BELL
  hd.stroke(bell.x + 0.2, bell.top + 0.35, bell.x + 3.8, bell.top + 0.35, Math.max(2, hd.cw * 0.2), wallDark)
  hd.stroke(bell.x + 0.5, bell.top + 1, bell.x + 0.5, bell.base, Math.max(2.4, hd.cw * 0.3), wallDark)
  hd.stroke(bell.x + 3.5, bell.top + 1, bell.x + 3.5, bell.base, Math.max(2.4, hd.cw * 0.3), wallDark)
  hd.disk(hd.X(bell.x + 2), hd.Y(bell.top + 1.35), Math.max(2, hd.cw * 0.22), cross)

  hd.rect(0, hd.Y(DOMES_GROUND_TOP), hd.w, hd.h, hdHex(c.ground))
  hd.disk(hd.X(37.5), hd.Y(DOMES_GROUND_TOP + 0.45), Math.max(1.2, hd.cw * 0.12), wallDark)
  hd.disk(hd.X(38.5), hd.Y(DOMES_GROUND_TOP + 1.45), Math.max(1.2, hd.cw * 0.12), wallDark)
  hd.disk(hd.X(37.5), hd.Y(DOMES_GROUND_TOP + 2.45), Math.max(1.2, hd.cw * 0.12), wallDark)
  return hd.pixels
}
