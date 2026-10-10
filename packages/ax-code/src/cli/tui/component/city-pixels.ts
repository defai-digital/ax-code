import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  CITY_CAR_ROW,
  CITY_COLORS,
  CITY_COLUMNS,
  CITY_LAMPS,
  CITY_MOON,
  CITY_ROWS,
  CITY_STARS,
  CITY_STREET_TOP,
  CITY_SUN,
  cityAntennas,
  cityBeaconBright,
  cityBuildings,
  cityCars,
  citySkyRgb,
  cityStarBright,
  cityWindowLit,
  cityWindows,
  type CityStyle,
} from "./city-view-model"
import { hash } from "./atmos-paint"

/** Deterministic hash in [0, 1). */
/**
 * Freeform HD renderer. The skyline comes from the shared scene model and is
 * painted with depth: a hazy far skyline, volumetric towers lit from the
 * orb's side with roof details, glowing windows, blinking rooftop beacons,
 * and a wet street with lamp pools, headlight beams, and reflections. The
 * night opening glows at the horizon under the moon; the dawn ending warms
 * every edge toward the sun. Pure and deterministic: everything derives from
 * `elapsedMs`.
 */
export function renderCityPixels(width: number, height: number, style: CityStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, CITY_COLUMNS, CITY_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "city-night"
  const c = CITY_COLORS[style]
  const { w, h, cw, ch, X, Y } = hd
  const px = hd.pixels
  const t = Math.max(0, elapsedMs)
  const blend = (x: number, y: number, color: RGB, alpha: number) => {
    if (alpha <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const a = Math.min(1, alpha)
    const i = (y * w + x) * 3
    px[i] = Math.round(px[i]! + (color[0] - px[i]!) * a)
    px[i + 1] = Math.round(px[i + 1]! + (color[1] - px[i + 1]!) * a)
    px[i + 2] = Math.round(px[i + 2]! + (color[2] - px[i + 2]!) * a)
  }
  const glow = (cx: number, cy: number, rx: number, ry: number, color: RGB, strength: number) => {
    const xa = Math.max(0, Math.floor(cx - rx))
    const xb = Math.min(w - 1, Math.ceil(cx + rx))
    const ya = Math.max(0, Math.floor(cy - ry))
    const yb = Math.min(h - 1, Math.ceil(cy + ry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d < 1) blend(x, y, color, strength * (1 - d) * (1 - d))
      }
    }
  }
  const building = hdHex(c.building)
  const shade = hdHex(c.shade)
  const edge = hdHex(c.edge)
  const lit = hdHex(c.windowLit)
  const dim = hdHex(c.windowDim)
  const orb = hdHex(c.orb)
  const orbAt = night ? CITY_MOON : CITY_SUN
  const orbX = X(orbAt.x)
  const orbY = Y(orbAt.y)
  const streetY = Y(CITY_STREET_TOP)
  const baseY = Y(CITY_STREET_TOP - 1)
  const horizon = hdHex(c.skyBottom)

  // Sky with horizon glow and a bloom around the orb.
  hd.sky((v) => citySkyRgb(style, v))
  glow(w / 2, baseY, w * 0.75, h * 0.55, night ? hdHex("#c0743a") : hdHex("#ffb070"), night ? 0.28 : 0.5)
  glow(orbX, orbY, cw * 15, ch * 7, orb, night ? 0.2 : 0.5)
  if (night) {
    const star = hdHex(c.sky)
    hd.stars(CITY_STARS, star, (index) => cityStarBright(t, index))
    for (let i = 0; i < 40; i++) {
      const sx = Math.floor(hash(i, 1) * w)
      const sy = Math.floor(hash(i, 2) * Y(6))
      if (Math.hypot(sx - orbX, sy - orbY) < cw * 4) continue
      const bright = (Math.floor(t / 400) + i) % 3 === 0
      blend(sx, sy, star, bright ? 0.9 : 0.4)
    }
  }
  const r = Math.max(2, Math.min(cw, ch) * 1.15)
  hd.disk(orbX, orbY, r * 1.35, hdMix(orb, citySkyRgb(style, orbAt.y / CITY_ROWS), 0.6))
  hd.disk(orbX, orbY, r, night ? hdHex("#f4f7ff") : hdHex("#fff2c8"))
  if (night) {
    hd.disk(orbX - r * 0.3, orbY - r * 0.25, r * 0.25, hdHex("#d4dbee"))
    hd.disk(orbX + r * 0.35, orbY + r * 0.3, r * 0.2, hdHex("#d4dbee"))
  }
  // Thin clouds drifting across the glow; they loop with the 9.6s cycle.
  const drift = ((t % 9600) / 9600) * CITY_COLUMNS
  for (let i = 0; i < 3; i++) {
    const cx = X(((i * 27 + drift + 10) % (CITY_COLUMNS + 20)) - 10)
    const cy = Y(4.5 + i * 1.7)
    for (let k = 0; k < 6; k++) {
      hd.blob(
        cx + k * cw * 2.4,
        cy + Math.sin(k * 1.9 + i) * ch * 0.1,
        cw * 3.2,
        ch * 0.3,
        night
          ? hdMix(hdHex("#2e3868"), citySkyRgb(style, 0.3), 0.4)
          : hdMix(hdHex("#f0a58a"), citySkyRgb(style, 0.3), 0.3),
      )
    }
  }

  // Far skyline: hazy, low, and unlit so the near towers pop.
  const haze = hdMix(horizon, building, night ? 0.35 : 0.3)
  const farTop = (x: number) => {
    const slab = Math.floor(x / (cw * 3.4))
    return Y(CITY_STREET_TOP - 1 - (3 + hash(slab, 5) * 4))
  }
  for (let x = 0; x < w; x++) {
    const top = farTop(x)
    for (let y = Math.max(0, Math.floor(top)); y < Math.ceil(baseY); y++) {
      const u = (y - top) / (baseY - top || 1)
      let color = hdMix(haze, hdDarken(haze, 0.8), u)
      const slab = Math.floor(x / (cw * 3.4))
      if (y - top < 2) color = hdMix(color, hdMix(orb, haze, 0.5), 0.35)
      // Tiny far windows.
      if (hash((slab * 13 + x / 4) | 0, (y / 8) | 0) > 0.93 && night) color = hdMix(color, lit, 0.55)
      blend(x, y, color, 1)
    }
  }

  // Near towers with lit edges, roof furniture, gradient bodies, and windows.
  const towers = cityBuildings()
  towers.forEach((tower, i) => {
    const x0 = Math.round(X(tower.x))
    const x1 = Math.round(X(tower.x + tower.w))
    const y0 = Math.round(Y(tower.top))
    const y1 = Math.round(baseY)
    const lightLeft = !night
    const faceW = Math.max(2, Math.round((x1 - x0) * 0.22))
    for (let y = y0; y < y1; y++) {
      const v = (y - y0) / (y1 - y0 || 1)
      // Night: street glow warms the base. Dawn: the sun warms the crown.
      let body = hdMix(shade, building, Math.min(1, v * 1.4))
      body = night
        ? hdMix(body, hdHex("#3c2a3a"), Math.max(0, v - 0.7) * 0.8)
        : hdMix(body, hdHex("#8a4a50"), Math.max(0, 0.4 - v) * 0.9)
      for (let x = x0; x < x1; x++) {
        const fromLight = lightLeft ? x - x0 : x1 - 1 - x
        let color = body
        if (fromLight >= x1 - x0 - faceW) color = hdDarken(body, 0.72) // shadowed side face
        if (fromLight < 2) color = hdMix(color, night ? hdMix(orb, edge, 0.3) : hdHex("#ffbe86"), 0.65)
        color = hdDarken(color, 0.96 + hash(x, y >> 2) * 0.08)
        hd.set(x, y, color)
      }
    }
    // Parapet cap and a stepped crown.
    hd.rect(x0, y0, x1, y0 + 2, hdMix(edge, orb, night ? 0.2 : 0.3))
    hd.rect(x0 + 1, y0 + 2, x1 - 1, y0 + 4, hdDarken(edge, 0.8))
    const crownW = Math.round((x1 - x0) * 0.5)
    const crownX = x0 + Math.round((x1 - x0 - crownW) * (i % 2 === 0 ? 0.3 : 0.6))
    hd.rect(crownX, y0 - Math.round(ch * 0.55), crownX + crownW, y0, hdMix(building, shade, 0.5))
    hd.rect(crownX, y0 - Math.round(ch * 0.55), crownX + crownW, y0 - Math.round(ch * 0.55) + 2, hdMix(edge, orb, 0.2))
    if (i % 3 === 1) {
      // Water tank on the roof.
      hd.rect(x1 - cw * 2, y0 - ch * 0.5, x1 - cw * 1.2, y0, hdDarken(building, 0.8))
      hd.rect(x1 - cw * 2.1, y0 - ch * 0.62, x1 - cw * 1.1, y0 - ch * 0.5, hdDarken(edge, 0.7))
    }
    // Windows with soft glow.
    for (const window of cityWindows(tower)) {
      const on = cityWindowLit(style, i, window.wx, window.wy, t)
      const wx0 = Math.round(X(window.x) + cw * 0.15)
      const wx1 = Math.round(X(window.x + 1) - cw * 0.15)
      const wy0 = Math.round(Y(window.y) + ch * 0.18)
      const wy1 = Math.round(Y(window.y + 1) - ch * 0.12)
      if (on) {
        const warm = hdMix(lit, hdHex("#ff9a4a"), hash(i * 7 + window.wx, window.wy) * 0.35)
        glow((wx0 + wx1) / 2, (wy0 + wy1) / 2, cw * 1.4, ch * 1.0, warm, night ? 0.28 : 0.2)
        for (let y = wy0; y < wy1; y++) {
          const v = (y - wy0) / (wy1 - wy0 || 1)
          hd.rect(wx0, y, wx1, y + 1, hdMix(warm, hdDarken(warm, 0.78), v))
        }
        // Mullion and a blind pulled over part of the pane.
        hd.rect((wx0 + wx1) / 2, wy0, (wx0 + wx1) / 2 + 1, wy1, hdDarken(warm, 0.6))
        if (hash(window.wx + i * 5, window.wy * 3) > 0.7)
          hd.rect(wx0, wy0, wx1, wy0 + Math.round((wy1 - wy0) * 0.4), hdDarken(warm, 0.7))
      } else {
        for (let y = wy0; y < wy1; y++) {
          const v = (y - wy0) / (wy1 - wy0 || 1)
          hd.rect(wx0, y, wx1, y + 1, hdMix(hdMix(dim, citySkyRgb(style, 0.85), 0.25), hdDarken(dim, 0.6), v))
        }
        hd.rect(wx0, wy0, wx1, wy0 + 1, hdMix(dim, orb, 0.25))
      }
    }
  })

  // Antennas with blinking beacons and a soft red halo.
  const beaconOn = cityBeaconBright(t)
  for (const antenna of cityAntennas()) {
    const mx = X(antenna.x) + cw / 2
    hd.rect(mx - 1, Y(antenna.tipY + 0.7), mx + 1, Y(antenna.tipY + 2.4), hdMix(edge, orb, 0.2))
    hd.rect(mx - 3, Y(antenna.tipY + 1.4), mx + 3, Y(antenna.tipY + 1.4) + 1, edge)
    if (beaconOn) glow(mx, Y(antenna.tipY + 0.5), cw * 2.6, ch * 1.2, hdHex(c.beacon), 0.5)
    hd.disk(mx, Y(antenna.tipY + 0.5), Math.max(2, cw * 0.25), beaconOn ? hdHex(c.beacon) : hdHex(c.beaconDim))
  }

  // Sidewalk strip and wet asphalt.
  hd.rect(0, baseY, w, streetY, hdMix(hdHex(c.street), edge, 0.25))
  hd.rect(0, baseY, w, baseY + 2, hdMix(edge, orb, 0.2))
  for (let y = Math.floor(streetY); y < h; y++) {
    const v = (y - streetY) / (h - streetY || 1)
    const asphalt = hdMix(hdHex(c.street), hdDarken(hdHex(c.street), 0.7), v)
    hd.rect(0, y, w, y + 1, asphalt)
  }
  // Lane dashes.
  for (let x = 0; x < CITY_COLUMNS; x += 4)
    hd.rect(
      X(x + 0.5),
      Y(CITY_STREET_TOP + 1.45),
      X(x + 2.5),
      Y(CITY_STREET_TOP + 1.45) + 2,
      hdMix(hdHex(c.street), edge, 0.6),
    )
  // Tower reflections smear down the wet street.
  towers.forEach((tower, i) => {
    for (const window of cityWindows(tower)) {
      if (window.y < CITY_STREET_TOP - 6) continue
      if (!cityWindowLit(style, i, window.wx, window.wy, t)) continue
      const rx = X(window.x + 0.5)
      for (let y = Math.floor(streetY); y < h; y++) {
        const v = (y - streetY) / (h - streetY || 1)
        blend(Math.round(rx), y, lit, 0.16 * (1 - v) * (1 + Math.sin(y * 0.8 + t * 0.004) * 0.3))
      }
    }
  })
  // Street lamps: pole, head, light cone, and a pool on the asphalt.
  const lamp = hdHex(c.lamp)
  for (const lx of CITY_LAMPS) {
    const lampX = X(lx + 0.5)
    const lampY = Y(CITY_STREET_TOP - 0.3)
    hd.rect(lampX - 1, lampY, lampX + 1, Y(CITY_STREET_TOP + 0.9), hdDarken(edge, 0.7))
    glow(lampX, Y(CITY_STREET_TOP + 0.9), cw * 4.5, ch * 1.2, lamp, 0.4)
    glow(lampX, lampY, cw * 2.2, ch * 1.5, lamp, 0.45)
    hd.disk(lampX, lampY, Math.max(2, cw * 0.28), hdMix(lamp, hdHex("#ffffff"), 0.4))
  }
  // Cars with headlight beams and tail glow.
  const head = hdHex(c.head)
  const tail = hdHex(c.tail)
  for (const car of cityCars(t)) {
    const carX = X(car.x + 0.5)
    const carY = Y(CITY_CAR_ROW + 0.55)
    const bodyColor = hdMix(hdHex("#2a2f4a"), edge, 0.4)
    const length = cw * 4
    const x0 = car.dir > 0 ? carX - length + cw : carX - cw
    hd.rect(x0, carY - ch * 0.28, x0 + length, carY + ch * 0.22, bodyColor)
    hd.rect(x0 + length * 0.22, carY - ch * 0.5, x0 + length * 0.78, carY - ch * 0.28, hdDarken(bodyColor, 0.8))
    hd.rect(x0 + length * 0.28, carY - ch * 0.46, x0 + length * 0.72, carY - ch * 0.3, hdMix(bodyColor, orb, 0.3))
    hd.disk(x0 + length * 0.2, carY + ch * 0.22, Math.max(1.5, cw * 0.22), hdHex("#0a0c18"))
    hd.disk(x0 + length * 0.8, carY + ch * 0.22, Math.max(1.5, cw * 0.22), hdHex("#0a0c18"))
    const frontX = car.dir > 0 ? x0 + length : x0
    const backX = car.dir > 0 ? x0 : x0 + length
    glow(frontX + car.dir * cw * 2.6, carY, cw * 3.6, ch * 0.9, head, night ? 0.5 : 0.3)
    glow(backX, carY, cw * 1.8, ch * 0.7, tail, 0.5)
    hd.disk(frontX, carY - ch * 0.05, Math.max(1.5, cw * 0.2), head)
    hd.disk(backX, carY - ch * 0.05, Math.max(1.2, cw * 0.15), tail)
  }
  return hd.pixels
}
