import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  SPACE_COLUMNS,
  SPACE_CRATERS,
  SPACE_COLORS,
  SPACE_HORIZON_ROW,
  SPACE_NEBULAE,
  SPACE_ROCKET_X,
  SPACE_ROWS,
  SPACE_SATELLITE_ROW,
  SPACE_STARS,
  spaceFlicker,
  spaceNebulaShift,
  spaceRocketY,
  spaceSatelliteX,
  spaceSkyRgb,
  spaceTwinkle,
  type SpaceStyle,
} from "./space-view-model"

/**
 * Freeform HD renderer. Gradient sky, dawn halo, shaded rocket, nebula
 * blobs, crater disks, and a curved planet limb all come from the shared
 * scene model. Pure: every pixel derives from `elapsedMs`.
 */
export function renderSpacePixels(width: number, height: number, style: SpaceStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const hd = createHdCanvas(w, h, SPACE_COLUMNS, SPACE_ROWS)
  if (w === 0 || h === 0) return hd.pixels
  const launch = style === "space-launch"
  const c = SPACE_COLORS[style]
  const star = hdHex(c.star)
  const planet = hdHex(c.planet)
  const horizon = hdHex(c.horizon)
  const hull = hdHex(c.hull)
  const hullDark = hdHex(c.hullDark)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)

  hd.sky((t) => spaceSkyRgb(style, t))
  hd.stars(SPACE_STARS, star, (index) => spaceTwinkle(elapsedMs, index))

  if (launch) {
    hd.halo(hd.X(20), hd.Y(SPACE_HORIZON_ROW - 0.35), coreR, hdHex(c.flame), horizon, spaceSkyRgb(style, 0.72))
  } else {
    const nebula = hdHex(c.nebula)
    const speck = hdMix(nebula, star, 0.5)
    const shift = spaceNebulaShift(elapsedMs)
    for (const cloud of SPACE_NEBULAE) {
      const nx = (((cloud.x - shift) % SPACE_COLUMNS) + SPACE_COLUMNS) % SPACE_COLUMNS
      const draw = (x: number) => {
        hd.blob(hd.X(x + 2.5), hd.Y(cloud.y + 0.5), hd.cw * 3.6, hd.ch * 0.95, nebula, speck)
        hd.blob(hd.X(x + 1.1), hd.Y(cloud.y + 0.1), hd.cw * 1.7, hd.ch * 0.42, hdMix(nebula, star, 0.28))
      }
      draw(nx)
      if (nx > SPACE_COLUMNS - 6) draw(nx - SPACE_COLUMNS)
      if (nx < 3) draw(nx + SPACE_COLUMNS)
    }
  }

  // Curved limb. The fill below the arc is flat planet color, so a sample
  // deep in the disk does not move between frames.
  const crest = hd.Y(SPACE_HORIZON_ROW)
  const sag = hd.ch * 0.65
  const glow = Math.max(2, hd.ch * 0.28)
  const haze = hdMix(horizon, spaceSkyRgb(style, 0.78), 0.5)
  const yStart = Math.max(0, Math.floor(crest - sag - glow))
  for (let y = yStart; y < hd.h; y++) {
    for (let x = 0; x < hd.w; x++) {
      const nx = (x + 0.5) / hd.w - 0.5
      const limb = crest - sag * (1 - 4 * nx * nx)
      const py = y + 0.5
      if (py >= limb + glow) hd.set(x, y, planet)
      else if (py >= limb) hd.set(x, y, horizon)
      else if (py >= limb - glow) hd.set(x, y, haze)
    }
  }
  const crater = hdHex(c.crater)
  const rim = hdMix(planet, horizon, 0.45)
  for (const pit of SPACE_CRATERS) {
    const cx = hd.X(pit.x + 0.5)
    const cy = hd.Y(pit.y + 0.5)
    hd.disk(cx, cy, Math.max(2.5, hd.cw * 0.85), rim)
    hd.disk(cx, cy + hd.ch * 0.06, Math.max(1.8, hd.cw * 0.55), crater)
  }

  if (launch) {
    const nose = spaceRocketY(elapsedMs)
    const cx = SPACE_ROCKET_X + 0.5
    const hot = spaceFlicker(elapsedMs)
    hd.mass(cx, nose + 1.05, nose + 3.05, 1.15, 1.4, hull, hdDarken(hull, 0.78), hullDark)
    hd.rect(hd.X(cx - 0.16), hd.Y(nose + 1.3), hd.X(cx + 0.16), hd.Y(nose + 2.85), hullDark)
    hd.mass(cx, nose, nose + 1.4, 0.08, 1.2, hull, hdMix(hull, hullDark, 0.45), hullDark)
    hd.disk(hd.X(cx + 0.22), hd.Y(nose + 1.85), Math.max(2, hd.cw * 0.32), hdHex(c.porthole))
    hd.disk(hd.X(cx + 0.28), hd.Y(nose + 1.78), Math.max(1, hd.cw * 0.12), hdMix(hdHex(c.porthole), star, 0.6))
    hd.stroke(cx - 1.15, nose + 2.3, cx - 2.2, nose + 3.35, Math.max(1.4, hd.cw * 0.22), hullDark)
    hd.stroke(cx + 1.15, nose + 2.3, cx + 2.2, nose + 3.35, Math.max(1.4, hd.cw * 0.22), hullDark)
    const flame = hdHex(c.flame)
    hd.halo(
      hd.X(cx),
      hd.Y(nose + (hot ? 3.6 : 3.4)),
      coreR * (hot ? 0.62 : 0.34),
      hot ? flame : hdDarken(flame, 0.72),
      hot ? hdDarken(flame, 0.72) : hullDark,
      spaceSkyRgb(style, 0.7),
    )
  } else {
    const sx = spaceSatelliteX(elapsedMs)
    const sat = hdHex(c.satellite)
    hd.stroke(
      sx,
      SPACE_SATELLITE_ROW + 0.5,
      sx + 3,
      SPACE_SATELLITE_ROW + 0.5,
      Math.max(1.2, hd.ch * 0.1),
      hdDarken(sat, 0.7),
    )
    hd.disk(hd.X(sx + 1.5), hd.Y(SPACE_SATELLITE_ROW + 0.5), Math.max(2, hd.cw * 0.4), sat)
    hd.disk(hd.X(sx + 1.65), hd.Y(SPACE_SATELLITE_ROW + 0.38), Math.max(1, hd.cw * 0.14), hdMix(sat, star, 0.55))
  }
  return hd.pixels
}
