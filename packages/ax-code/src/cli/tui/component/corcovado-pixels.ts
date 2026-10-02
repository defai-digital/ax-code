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
  corcovadoGulls,
  corcovadoSail,
  corcovadoSkyRgb,
  corcovadoSurf,
  type CorcovadoStyle,
} from "./corcovado-view-model"

/** Deterministic hash in [0, 1). */
function hash(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/** Smooth 2D value noise. */
function vnoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix + seed * 131, iy)
  const b = hash(ix + 1 + seed * 131, iy)
  const c = hash(ix + seed * 131, iy + 1)
  const d = hash(ix + 1 + seed * 131, iy + 1)
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy
}

/**
 * Freeform HD renderer. Corcovado is a forested granite dome with bare cliff
 * faces, crowned by a floodlit-able Christ statue on a pedestal. Hazy
 * Tijuca ridges, Sugarloaf with its cable car, a glittering Guanabara Bay
 * with a sailboat, swirling clouds that pass behind and in front of the
 * peak, hang gliders, gulls, and a beach promenade with umbrellas and palms
 * complete it. The gold ending is dusk: the sky blazes, the statue is lit,
 * and the shoreline fills with city lights. Pure and deterministic:
 * everything derives from `elapsedMs`.
 */
export function renderCorcovadoPixels(width: number, height: number, style: CorcovadoStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, CORCOVADO_COLUMNS, CORCOVADO_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const gold = style === "corcovado-gold"
  const c = CORCOVADO_COLORS[style]
  const { w, h, cw, ch, X, Y } = hd
  const px = hd.pixels
  const t = Math.max(0, elapsedMs)
  const phase = (2 * Math.PI * (t % 2400)) / 2400
  const dot = Math.max(1.7, Math.min(cw, ch) * 0.4)
  const coreR = Math.max(3, Math.min(cw, ch) * 0.9)
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
  const skyAt = (sceneY: number): RGB => {
    if (h <= 1) return corcovadoSkyRgb(style, 0)
    const py = Math.max(0, Math.min(h - 1, Math.floor(Y(sceneY))))
    return corcovadoSkyRgb(style, py / (h - 1))
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
  const glider = hdHex(c.glider)
  const sun = gold ? { x: 66, y: 3.5 } : { x: 62, y: 1.7 }
  const sunColor = gold ? hdHex("#ffd27a") : hdHex("#fff6d0")
  const lightDir = gold ? 1 : -1
  const warmRim = gold ? hdHex("#ffb060") : hdHex("#ffffff")
  const peak = CORCOVADO_PEAK
  const cx = X(peak.x)
  const loaf = CORCOVADO_SUGARLOAF
  const hazeOf = (color: RGB, amount: number) => hdMix(color, skyAt(12), amount)

  // Sky with a sun glare; the gold ending glows along the horizon.
  hd.sky((v) => corcovadoSkyRgb(style, v))
  glow(X(sun.x), Y(sun.y), cw * 22, ch * 9, sunColor, gold ? 0.6 : 0.5)
  if (gold) glow(X(sun.x), Y(14), cw * 50, ch * 6, hdHex("#ff9a50"), 0.35)
  hd.halo(X(sun.x), Y(sun.y), coreR * 1.1, hdHex("#fffbe8"), sunColor, skyAt(sun.y))

  // Clouds on the swirl: the far half is painted behind the peak, the near half in front.
  const cloudAt = (i: number) => {
    const angle = (2 * Math.PI * (t / 4800 + i / 6)) % (2 * Math.PI)
    return { x: peak.x + Math.cos(angle) * 22 - 3, y: 9 + Math.sin(angle) * 3, front: Math.sin(angle) > 0 }
  }
  const paintCloud = (cloudX: number, cloudY: number, scale: number) => {
    for (let k = 0; k < 6; k++) {
      const bx = X(cloudX + 0.5 + k * 1.05)
      const by = Y(cloudY)
      const lift = Math.sin(k * 1.7 + cloudX) * ch * 0.22
      hd.blob(
        bx,
        by + ch * 0.16,
        cw * 1.8 * scale,
        ch * 0.5 * scale,
        hdMix(cloud, hdHex(gold ? "#c8805a" : "#a8bcd0"), 0.45),
      )
      hd.blob(bx, by - lift * 0.4, cw * 1.7 * scale, ch * 0.52 * scale + Math.abs(lift) * 0.4, cloud)
      hd.blob(
        bx - cw * 0.2,
        by - ch * 0.2 - lift * 0.4,
        cw * 1.0 * scale,
        ch * 0.22 * scale,
        hdMix(cloud, hdHex("#ffffff"), 0.6),
      )
    }
  }
  for (let i = 0; i < 6; i++) {
    const cl = cloudAt(i)
    if (!cl.front) paintCloud(cl.x, cl.y, 0.85)
  }

  // Hazy Tijuca ridges.
  for (const [layer, amount, base, amp] of [
    [0, 0.72, 12.4, 1.6],
    [1, 0.55, 13.4, 1.2],
  ] as const) {
    const ridge = hazeOf(hdMix(forestDeep, rock, 0.3), amount)
    for (let x = 0; x < w; x++) {
      const sx = x / cw
      const top = base - amp * (vnoise(sx * 0.12, layer, 2) * 1.2 + Math.sin(sx * 0.2 + layer * 2) * 0.3)
      for (let y = Math.max(0, Math.floor(Y(top))); y < Math.ceil(Y(16)); y++) {
        const u = (y - Y(top)) / (ch * 3)
        hd.set(x, y, hdMix(ridge, hdDarken(ridge, 0.85), Math.min(1, u)))
      }
    }
  }

  // Sea: depth gradient, wind ripples, and a sun track.
  const seaTop = 15.4
  const seaBottom = CORCOVADO_GROUND_TOP + 0.15
  for (let y = Math.floor(Y(seaTop)); y < Math.ceil(Y(seaBottom)); y++) {
    const u = (y - Y(seaTop)) / (Y(seaBottom) - Y(seaTop) || 1)
    for (let x = 0; x < w; x++) {
      const sx = x / cw
      const ripple = Math.sin(sx * 2.1 + phase * 1 + u * 9) * 0.5 + Math.sin(sx * 0.9 - phase * 2 + u * 5) * 0.5
      let color = hdMix(hdMix(sea, skyAt(15.5), 0.35 * (1 - u)), hdDarken(sea, 0.6), u)
      color = hdDarken(color, 1 + ripple * 0.06)
      if (ripple > 0.82) color = hdMix(color, hdMix(sunColor, foam, 0.3), 0.18 * (1 - u * 0.5))
      px[(y * w + x) * 3] = color[0]
      px[(y * w + x) * 3 + 1] = color[1]
      px[(y * w + x) * 3 + 2] = color[2]
    }
  }
  // Sun glitter: a column of bright flecks that shimmer along the loop.
  for (let k = 0; k < 90; k++) {
    const u = hash(k, 1)
    const y = Y(seaTop) + u * (Y(seaBottom) - Y(seaTop))
    const spread = cw * (2 + u * 7)
    const x = X(sun.x) + (hash(k, 2) - 0.5) * 2 * spread
    const on = Math.sin(phase * 2 + k * 1.3) > -0.2
    if (on) blend(Math.round(x), Math.round(y), sunColor, 0.8 - u * 0.3)
  }

  // Sugarloaf: a granite dome with a forest cap and the cable line.
  const loafX = X((loaf.x0 + loaf.x1) / 2)
  const loafTop = Y(loaf.top)
  const loafBase = Y(loaf.base + 0.6)
  for (let y = Math.floor(loafTop); y < loafBase; y++) {
    const v = (y - loafTop) / (loafBase - loafTop)
    const half = cw * (1.0 + 2.7 * Math.pow(v, 0.62) + v * 1.4) * (v < 0.1 ? Math.sqrt(v / 0.1) : 1)
    for (let x = Math.floor(loafX - half); x < loafX + half; x++) {
      const u = (x + 0.5 - loafX) / (half || 1)
      let color = hdMix(
        hdMix(sugar, hdHex(gold ? "#8a6a52" : "#7a8a98"), 0.4),
        hdDarken(sugar, 0.65),
        (u * -lightDir + 1) / 2,
      )
      // Streaked granite and a green cap on the crown.
      color = hdDarken(color, 0.9 + vnoise(x / 2.5, y / 14, 4) * 0.22)
      if (v < 0.22 && vnoise(x / 3, y / 3, 5) > 0.45) color = hdMix(color, forest, 0.55)
      color = hdMix(hazeOf(color, 0.18), color, 0.7)
      if (Math.abs(u) > 0.93) color = hdMix(color, warmRim, 0.15)
      hd.set(x, y, color)
    }
  }
  hd.stroke(
    CORCOVADO_CABLE_X0,
    CORCOVADO_CABLE_ROW - 0.6,
    CORCOVADO_CABLE_X1,
    CORCOVADO_CABLE_ROW + 0.9,
    Math.max(0.7, ch * 0.035),
    hdDarken(rockDark, 1.1),
  )
  hd.rect(
    X(CORCOVADO_CABLE_X0) - 1,
    Y(CORCOVADO_CABLE_ROW - 0.8),
    X(CORCOVADO_CABLE_X0) + 1,
    Y(CORCOVADO_CABLE_ROW + 1.6),
    rockDark,
  )
  const progress = ((t / 200) % 12) / 11
  const carX = X(CORCOVADO_CABLE_X0) + (X(CORCOVADO_CABLE_X1) - X(CORCOVADO_CABLE_X0)) * Math.min(1, progress)
  const carY =
    Y(CORCOVADO_CABLE_ROW - 0.6) + (Y(CORCOVADO_CABLE_ROW + 0.9) - Y(CORCOVADO_CABLE_ROW - 0.6)) * Math.min(1, progress)
  hd.rect(carX - cw * 0.7, carY + 2, carX + cw * 0.7, carY + ch * 0.45, hdHex("#e0e4ea"))
  hd.rect(carX - cw * 0.7, carY + 2, carX + cw * 0.7, carY + 4, hdHex("#c33d4e"))
  hd.rect(carX - cw * 0.55, carY + 5, carX + cw * 0.55, carY + ch * 0.3, hdHex("#6a7a8a"))
  hd.rect(carX - 1, carY, carX + 1, carY + 2, rockDark)

  // The peak: forested granite dome with bare cliffs, lit from one side.
  const shoreBottom = (dx: number) => 16.9 + 0.55 * Math.sqrt(Math.max(0, 1 - dx * dx))
  const peakTopY = Y(peak.top - 0.15)
  const peakBottomY = Y(peak.base + 1)
  for (let y = Math.max(0, Math.floor(peakTopY)); y < Math.min(h, Math.ceil(peakBottomY)); y++) {
    const sy = (y + 0.5) / ch
    const v = Math.max(0, (sy - peak.top) / (peak.base - peak.top))
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1
      const bump = (vnoise(sy * 0.8 + side * 50, 3, 7) - 0.5) * 2.4 * Math.min(1, v * 1.3)
      const env = 2.2 + 21.5 * Math.pow(v, 0.82) + bump
      const half = env * cw
      for (let k = 0; k < half; k++) {
        const x = Math.round(cx + sign * (k + 0.5))
        const dxn = (sign * (k + 0.5)) / (half || 1)
        if (shoreBottom(Math.min(1, Math.abs(dxn))) < sy) continue
        // Surface: cliffs high up and in streaks, forest low and in gullies.
        const altitude = 1 - v
        const rockMask = vnoise(x / 24, y / 15, 8) * (0.5 + altitude * 0.75) + (hash(x >> 2, y >> 2) - 0.5) * 0.12
        let color: RGB
        if (rockMask > 0.54) {
          color = hdMix(rock, hdHex(gold ? "#7a5a5a" : "#8a96a0"), 0.35 * vnoise(x / 6, y / 30, 9))
          color = hdDarken(color, 0.82 + vnoise(x / 2.2, y / 20, 3) * 0.3)
        } else {
          const crown = vnoise(x / 3.4, y / 3.4, 10)
          color = hdMix(forestDeep, forest, crown * 0.9 + 0.1)
          if (crown > 0.72) color = hdMix(color, hdHex(gold ? "#8a7a3a" : "#4a8a44"), 0.35)
          if (hash(x, y) > 0.96) color = hdDarken(color, 0.7)
        }
        // Directional lighting across the dome: bright on the lit side, deep in shade, rim at the edge.
        const across = dxn * -lightDir
        let light = 1.08 - (across + 1) * 0.3 + (1 - Math.abs(dxn)) * 0.1
        light *= 0.92 + vnoise(x / 18, y / 10, 11) * 0.16
        color = hdDarken(color, Math.max(0.45, light))
        if (Math.abs(dxn) > 0.94 && across < 0) color = hdMix(color, warmRim, 0.18)
        // Distant haze at the top of the peak, none at the foot.
        color = hdMix(color, skyAt(sy), Math.max(0, 0.12 - v * 0.2))
        hd.set(x, y, color)
      }
    }
  }
  // City lights and white buildings along the foot of the peak.
  for (let i = 0; i < 60; i++) {
    const dxn = (hash(i, 31) - 0.5) * 1.9
    const bx = cx + dxn * X(23.5)
    const by = Y(shoreBottom(Math.min(1, Math.abs(dxn)))) - ch * (0.1 + hash(i, 32) * 0.55)
    const bw = Math.max(2, cw * (0.2 + hash(i, 33) * 0.28))
    const bh = Math.max(2, ch * (0.2 + hash(i, 34) * 0.35))
    const body = gold
      ? hdMix(hdHex("#5a4048"), hdHex("#c8a08a"), hash(i, 35))
      : hdMix(hdHex("#d8d4c8"), hdHex("#e8b89a"), hash(i, 35))
    hd.rect(bx, by - bh, bx + bw, by, hdDarken(body, 0.82))
    hd.rect(bx, by - bh, bx + bw * 0.6, by, body)
    if (gold && hash(i, 36) > 0.35) {
      glow(bx + bw / 2, by - bh / 2, cw * 0.9, ch * 0.45, lights, 0.5)
      hd.rect(bx + 1, by - bh * 0.7, bx + 2.5, by - bh * 0.4, lights)
    }
  }

  // Christ the Redeemer: pedestal, robe, outstretched arms, head.
  const figure = CORCOVADO_STATUE
  const fx = X(figure.x)
  const headY = Y(figure.head + 0.2)
  const shoulderY = Y(figure.arms)
  const hemY = Y(figure.base - 0.45)
  const pedestalTop = Y(figure.base - 0.45)
  const pedestalBottom = Y(figure.base + 0.45)
  const arm = Math.max(3, cw * 4.3)
  if (gold) glow(fx, (headY + hemY) / 2, cw * 9, ch * 4.2, hdHex("#ffcf80"), 0.5)
  // Pedestal and chapel base.
  for (let y = Math.floor(pedestalTop); y < pedestalBottom; y++) {
    const v = (y - pedestalTop) / (pedestalBottom - pedestalTop)
    const half = cw * (0.85 + v * 0.55)
    for (let x = Math.floor(fx - half); x < fx + half; x++) {
      const u = (x + 0.5 - fx) / half
      hd.set(x, y, hdDarken(hdMix(statueShade, statue, 0.3 + (-u * lightDir + 1) * 0.15), 0.85 + (1 - v) * 0.1))
    }
  }
  // Robe: tapering column with fold shading.
  for (let y = Math.floor(shoulderY - ch * 0.15); y < hemY; y++) {
    const v = (y - shoulderY) / (hemY - shoulderY || 1)
    const half = cw * (0.55 + Math.max(0, v) * 0.2) * (v < 0 ? 0.8 : 1)
    for (let x = Math.floor(fx - half); x < fx + half; x++) {
      const u = (x + 0.5 - fx) / half
      const fold = 0.92 + 0.1 * Math.sin(u * 5 + v * 2)
      hd.set(x, y, hdDarken(hdMix(statue, statueShade, ((u * lightDir + 1) / 2) * 0.7), fold))
    }
  }
  // Arms: sleeves with a slight droop to the hands.
  for (const sign of [-1, 1]) {
    for (let k = 0; k <= arm; k++) {
      const u = k / arm
      const y = shoulderY + u * ch * 0.2 + ch * 0.05
      const thick = Math.max(2, ch * 0.13) * (1 - u * 0.35)
      for (let yy = Math.floor(y - thick); yy <= y + thick; yy++) {
        const shade = yy < y ? 0 : 0.35
        hd.set(
          Math.round(fx + sign * (cw * 0.5 + k)),
          yy,
          hdMix(statue, statueShade, shade + (sign === lightDir ? 0.3 : 0)),
        )
      }
    }
    hd.disk(fx + sign * (cw * 0.5 + arm), shoulderY + ch * 0.27, Math.max(1.3, cw * 0.1), statue)
  }
  hd.disk(fx, headY, Math.max(2.2, cw * 0.36), hdMix(statue, statueShade, 0.25))
  hd.rect(fx - cw * 0.12, headY + cw * 0.3, fx + cw * 0.12, shoulderY, statueShade)
  hd.disk(fx - lightDir * cw * -0.1, headY - cw * 0.08, Math.max(1, cw * 0.14), hdMix(statue, warmRim, 0.5))
  if (gold) {
    // Floodlight halo behind the head.
    glow(fx, headY, cw * 3, ch * 1.4, hdHex("#fff0b0"), 0.45)
  }

  // Clouds passing in front of the peak.
  for (let i = 0; i < 6; i++) {
    const cl = cloudAt(i)
    if (cl.front) paintCloud(cl.x, cl.y + 0.6, 1)
  }

  // Hang gliders carving slow loops off the peak.
  const g = t / 1200
  for (let i = 0; i < 2; i++) {
    const gx = 38 + Math.cos(g + i * Math.PI) * 24
    const gy = 7 + Math.sin(g + i * Math.PI) * 2
    const tilt = Math.sin(g * 2 + i) * 0.2
    const wing = i === 0 ? glider : hdMix(glider, hdHex("#e0a030"), 0.6)
    for (let k = -14; k <= 14; k++) {
      const wx = X(gx) + k * (cw / 10)
      const sweep = Math.abs(k) * 0.28 * (ch / 20)
      const wy = Y(gy) + sweep + tilt * k
      hd.rect(wx, wy - 1, wx + cw / 10 + 0.5, wy + 2, hdDarken(wing, k % 6 < 3 ? 1 : 0.85))
    }
    hd.rect(X(gx) - 1, Y(gy) + 2, X(gx) + 1, Y(gy) + ch * 0.5, hdHex("#3a3a46"))
    hd.disk(X(gx), Y(gy) + ch * 0.55, Math.max(1.4, dot * 0.3), hdHex("#e8c8a8"))
  }
  // Gulls with beating wings.
  for (const [i, gull] of corcovadoGulls(t).entries()) {
    const bx = X(gull.x + 0.5)
    const by = Y(gull.y + 0.5)
    const flap = Math.sin(phase * 6 + i * 2.1) * ch * 0.16
    for (const dir of [-1, 1]) {
      hd.stroke(
        bx / cw,
        by / ch,
        (bx + dir * cw * 0.55) / cw,
        (by - ch * 0.12 + flap) / ch,
        Math.max(1.2, dot * 0.2),
        foam,
      )
      hd.stroke(
        (bx + dir * cw * 0.55) / cw,
        (by - ch * 0.12 + flap) / ch,
        (bx + dir * cw * 1.05) / cw,
        (by + ch * 0.03 + flap) / ch,
        Math.max(1, dot * 0.16),
        foam,
      )
    }
    hd.blob(bx, by, cw * 0.2, ch * 0.08, foam)
  }

  // Sailboat with a bright mainsail, jib, and hull, with a reflection.
  const sailX = corcovadoSail(t)
  const hullY = Y(18.65)
  const hullColor = hdDarken(sail, 0.45)
  const lit = hdMix(sail, warmRim, 0.3)
  for (let y = Math.floor(Y(16.0)); y < Y(18.4); y++) {
    const v = (y - Y(16.0)) / (Y(18.4) - Y(16.0))
    const mainHalf = cw * 1.5 * v
    for (let x = Math.floor(X(sailX + 1.2) - mainHalf * 0.2); x < X(sailX + 1.2) + mainHalf; x++)
      hd.set(x, y, hdDarken(lit, 0.9 + (1 - v) * 0.12))
    const jibHalf = cw * 1.0 * v
    for (let x = Math.floor(X(sailX + 0.75) - jibHalf); x < X(sailX + 0.75) - cw * 0.05; x++)
      hd.set(x, y, hdDarken(sail, 0.8 + (1 - v) * 0.1))
  }
  hd.rect(X(sailX + 0.9), Y(15.9), X(sailX + 0.9) + 1.5, hullY, hdDarken(rockDark, 1.2))
  hd.blob(X(sailX + 1.3), hullY + ch * 0.1, cw * 1.8, ch * 0.18, hullColor)
  hd.rect(X(sailX - 0.5), hullY + ch * 0.2, X(sailX + 3.1), hullY + ch * 0.28, hdMix(sea, sail, 0.25))

  // Shoreline surf: foam that rolls up and back with the surf phase.
  const surf = corcovadoSurf(t)
  for (let x = 0; x < w; x++) {
    const sx = x / cw
    const roll = Math.sin(sx * 1.4 + surf * 1.57 + phase) * 0.5 + 0.5
    const yEdge = Y(CORCOVADO_GROUND_TOP) - roll * ch * 0.22
    for (let y = Math.floor(yEdge); y < Math.ceil(Y(CORCOVADO_GROUND_TOP + 0.35)); y++) {
      blend(x, y, foam, y < yEdge + 2 ? 0.9 : 0.5)
    }
  }
  if (gold) {
    for (let x = 2; x < CORCOVADO_COLUMNS; x += 5) {
      glow(X(x + 0.3), Y(CORCOVADO_GROUND_TOP - 0.35), cw * 1.4, ch * 0.9, lights, 0.5)
      hd.disk(X(x + 0.3), Y(CORCOVADO_GROUND_TOP - 0.35), dot * 0.35, lights)
    }
  }

  // Beach, mosaic promenade, and park.
  const sandTop = Y(CORCOVADO_GROUND_TOP + 0.35)
  const sand = gold ? hdHex("#8a6a4a") : hdHex("#e6d3a0")
  const lawn = hdHex(c.ground)
  for (let y = Math.floor(sandTop); y < h; y++) {
    const sy = (y + 0.5) / ch
    const u = (sy - CORCOVADO_GROUND_TOP) / (CORCOVADO_ROWS - CORCOVADO_GROUND_TOP)
    for (let x = 0; x < w; x++) {
      const sx = x / cw
      let color: RGB
      if (sy < CORCOVADO_GROUND_TOP + 1.1) {
        // Wet sand then dry sand.
        color = hdMix(hdDarken(sand, 0.8), sand, Math.min(1, (sy - CORCOVADO_GROUND_TOP - 0.35) / 0.8))
        color = hdDarken(color, 0.95 + hash(x >> 1, y >> 1) * 0.1)
      } else if (sy < CORCOVADO_GROUND_TOP + 2.7) {
        // Wave-pattern promenade of dark and light stone.
        const wave = Math.sin(sy * 3.2 + Math.sin(sx * 0.7) * 1.4)
        const dark = wave > 0 ? hdHex(gold ? "#2a2024" : "#3a3a42") : hdHex(gold ? "#c8a888" : "#e8e2d6")
        color = hdDarken(dark, 0.95 + hash(x >> 2, y >> 2) * 0.08)
      } else {
        color = hdMix(lawn, hdDarken(lawn, 0.7), u)
        color = hdDarken(color, 0.93 + hash(x, y >> 1) * 0.14)
      }
      hd.set(x, y, color)
    }
  }
  // Beach umbrellas with striped canopies and soft shadows.
  const stripes = [hdHex("#e8483a"), hdHex("#f2d24a"), hdHex("#3a8ae8")]
  CORCOVADO_UMBRELLAS.forEach((shade, index) => {
    const ux = X(shade + 1)
    const uy = Y(CORCOVADO_GROUND_TOP + 1.1)
    const base = stripes[index % stripes.length]!
    hd.blob(ux + cw * 0.9, Y(CORCOVADO_GROUND_TOP + 1.85), cw * 1.5, ch * 0.13, hdDarken(sand, 0.6))
    hd.rect(ux - 1, uy, ux + 1, Y(CORCOVADO_GROUND_TOP + 1.9), hdHex(gold ? "#6a5a4a" : "#d8d8e0"))
    for (let k = -8; k <= 8; k++) {
      const xx = ux + (k / 8) * cw * 1.5
      const top = uy - Math.sqrt(Math.max(0, 1 - (k / 8) ** 2)) * ch * 0.4
      const stripe = Math.floor((k + 8) / 3) % 2 === 0 ? base : hdMix(base, hdHex("#ffffff"), 0.85)
      hd.rect(xx, top, xx + cw * 0.2 + 0.6, uy + 2, hdDarken(stripe, gold ? 0.75 : 1))
    }
    hd.rect(ux - cw * 1.5, uy + 1, ux + cw * 1.5, uy + 3, hdDarken(base, 0.7))
    hd.stroke(
      shade + 0.1,
      CORCOVADO_GROUND_TOP + 2.2,
      shade + 1.7,
      CORCOVADO_GROUND_TOP + 2.2,
      Math.max(1, ch * 0.05),
      hdMix(base, hdHex("#ffffff"), 0.5),
    )
  })
  // Palms swaying at the corners of the park.
  for (const [i, palmX] of [3.5, 21, 49, 71].entries()) {
    const sway = Math.sin(phase + i * 1.3) * cw * 0.2
    const baseY = Y(CORCOVADO_ROWS - 0.2)
    const topX = X(palmX) + sway
    const topY = Y(CORCOVADO_GROUND_TOP + 1.6) + i * ch * 0.2
    hd.stroke(
      palmX,
      baseY / ch,
      topX / cw,
      topY / ch,
      Math.max(1.3, cw * 0.1),
      hdMix(hdHex("#6a4a2a"), hdHex(gold ? "#2a2018" : "#8a6a3a"), 0.3),
    )
    for (let f = 0; f < 7; f++) {
      const a = -Math.PI * 0.95 + (f / 6) * Math.PI * 0.9
      const fl = cw * 2.2
      const ex = topX + Math.cos(a) * fl
      const ey = topY + Math.sin(a) * fl * 0.55 + fl * 0.35 * Math.abs(Math.cos(a))
      hd.stroke(
        topX / cw,
        topY / ch,
        (topX + ex) / 2 / cw,
        (topY + (ey - topY) * 0.3 - ch * 0.2) / ch,
        Math.max(1.2, cw * 0.09),
        hdDarken(forest, 0.9),
      )
      hd.stroke(
        (topX + ex) / 2 / cw,
        (topY + (ey - topY) * 0.3 - ch * 0.2) / ch,
        ex / cw,
        ey / ch,
        Math.max(1, cw * 0.07),
        hdMix(forest, hdHex("#6aaa44"), gold ? 0.1 : 0.4),
      )
    }
  }
  return hd.pixels
}
