import {
  FUJI_COLORS,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  TRAIN_CYCLE_MS,
  TRAIN_JR_OFFSET,
  TRAIN_NOSE_CELLS,
  TRAIN_WHEEL_OFFSETS,
  TRAIN_WIDTH,
  fujiPetals,
  fujiSkyRgb,
  fujiTrainX,
  type FujiStyle,
} from "./fuji-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import { clamp01 } from "./atmos-paint"

// Scene-map anchors in the shared 74x20 space. The text path paints the same
// rows, so both renderers agree on layout for the same millisecond.
const PEAK_X = 37
const MOUNTAIN_TOP = 3
const MOUNTAIN_BOTTOM = 10
const SNOW_BOTTOM = 6.4
const CRATER_HALF = 2.5
const BASE_HALF = 23.5
const WATER_TOP = 10
const WATER_BOTTOM = 12.4
const LEFT_TREE_X = 7.5
const RIGHT_TREE_X = 65.5
const PLATFORM_ROWS = [14.4, 15.4]
const TRAIN_TOP = 16
const TRAIN_BODY_BOTTOM = 19
const SUN = { x: 37, y: 1.2 }
const MOON = { x: 56, y: 0.8 }
const REFLECTION_X = { day: 35, night: 54 }
const REFLECTION_WIDTH = 5
const STAR_COUNT = 70
/** Text-path window cells: "[]" every six columns starting at column 12. */
const WINDOW_FIRST = 12
const WINDOW_PITCH = 6

const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Freeform HD renderer. Fuji is a concave stratovolcano with a snow cap that
 * runs down in gullies, lit from one side and hazed into the lake, a mirrored
 * lake, sakura in bloom, and a shinkansen with a nose cab and window glow.
 * Layout, palette, train phase, and petal paths come from the shared view
 * model, so the HD frame and the text fallback show the same scene for the
 * same millisecond. Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderFujiPixels(width: number, height: number, style: FujiStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, SCENE_WIDTH, SCENE_HEIGHT)
  const { w, h, cw, ch, X, Y } = hd
  if (w === 0 || h === 0) return hd.pixels
  const night = style === "fuji-night"
  const c = FUJI_COLORS[style]
  const unit = Math.max(1, Math.min(cw, ch / 2))
  const phase = (Math.max(0, elapsedMs) % TRAIN_CYCLE_MS) / TRAIN_CYCLE_MS
  const wavePhase = 2 * Math.PI * 2 * phase
  const skyAt = (y: number): RGB => fujiSkyRgb(style, h <= 1 ? 0 : y / (h - 1))

  /** Additive soft radial light in pixel space. */
  const glow = (cx: number, cy: number, radius: number, color: RGB, strength: number, floor = h) => {
    const xa = Math.max(0, Math.floor(cx - radius)),
      xb = Math.min(w - 1, Math.ceil(cx + radius))
    const ya = Math.max(0, Math.floor(cy - radius)),
      yb = Math.min(floor - 1, Math.ceil(cy + radius))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
        if (d >= 1) continue
        const a = strength * (1 - d) * (1 - d)
        const i = (y * w + x) * 3
        for (let k = 0; k < 3; k++)
          hd.pixels[i + k] = Math.round(hd.pixels[i + k]! + (color[k]! - hd.pixels[i + k]!) * a)
      }
    }
  }
  const tint = (x: number, y: number, color: RGB, a: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return
    const i = (y * w + x) * 3
    for (let k = 0; k < 3; k++) hd.pixels[i + k] = Math.round(hd.pixels[i + k]! + (color[k]! - hd.pixels[i + k]!) * a)
  }
  const get = (x: number, y: number): RGB => {
    const xi = Math.max(0, Math.min(w - 1, Math.floor(x))),
      yi = Math.max(0, Math.min(h - 1, Math.floor(y)))
    const i = (yi * w + xi) * 3
    return [hd.pixels[i]!, hd.pixels[i + 1]!, hd.pixels[i + 2]!]
  }

  // --- Sky -----------------------------------------------------------------
  hd.sky((t) => skyAt(t * (h - 1)))
  const light = hdHex(c.light),
    orbBg = hdHex(c.orbBg),
    glowBg = hdHex(c.glowBg)
  const horizonY = Y(MOUNTAIN_BOTTOM)
  const orbR = Math.max(2, Math.min(64, Math.min(w, h) * 0.045))
  const sunX = X(SUN.x),
    sunY = Y(SUN.y)
  const moonX = X(MOON.x),
    moonY = Y(MOON.y)
  if (night) {
    // Stars thicken toward the zenith and twinkle on a loop.
    const bandH = Math.max(1, horizonY * 0.85)
    for (let i = 0; i < STAR_COUNT; i++) {
      const sx = Math.floor(hash(i + 1) * w),
        sy = Math.floor(Math.pow(hash(i + 90), 1.4) * bandH)
      if (Math.hypot(sx - moonX, sy - moonY) < orbR * 3.4) continue
      const tw = 0.55 + 0.45 * Math.sin(2 * Math.PI * (phase * (1 + (i % 2)) + hash(i + 200)))
      const color = hdMix(skyAt(sy), light, 0.45 + 0.55 * tw)
      hd.set(sx, sy, color)
      if (i % 7 === 0 && w > 500) {
        hd.set(sx + 1, sy, hdMix(skyAt(sy), light, 0.4 * tw))
        hd.set(sx, sy + 1, hdMix(skyAt(sy), light, 0.4 * tw))
      }
    }
    glow(moonX, moonY, orbR * 7, hdMix(glowBg, light, 0.4), 0.55)
    glow(moonX, moonY, orbR * 3, light, 0.28)
    hd.disk(moonX, moonY, orbR, light)
    // Maria on the moon.
    const mare = hdMix(light, hdHex("#8ba6d1"), 0.55)
    hd.disk(moonX - orbR * 0.28, moonY - orbR * 0.2, orbR * 0.28, mare)
    hd.disk(moonX + orbR * 0.25, moonY + orbR * 0.22, orbR * 0.22, mare)
    hd.disk(moonX + orbR * 0.1, moonY - orbR * 0.5, orbR * 0.14, mare)
    // Thin moon-lit clouds.
    for (let i = 0; i < 3; i++) {
      const cx = X(10 + i * 26 + Math.sin(phase * 2 * Math.PI + i) * 0.5),
        cy = Y(2.2 + (i % 2) * 1.1)
      for (let k = 0; k < 5; k++)
        hd.blob(cx + k * unit * 4, cy + Math.sin(k) * unit, unit * 7, unit * 0.9, hdMix(skyAt(cy), light, 0.07))
    }
  } else {
    // Low sun: wide warm bloom lifting the whole horizon, then streaked clouds.
    const warm = hdMix(hdHex("#ffb070"), light, 0.3)
    glow(sunX, horizonY, w * 0.5, hdHex("#e8884c"), 0.4)
    glow(sunX, sunY, orbR * 11, warm, 0.45)
    glow(sunX, sunY, orbR * 4.5, hdMix(warm, light, 0.5), 0.5)
    hd.disk(sunX, sunY, orbR * 1.7, hdMix(orbBg, light, 0.55))
    hd.disk(sunX, sunY, orbR, light)
    const cloud = hdMix(hdHex("#c97b91"), hdHex("#ffc89a"), 0.4)
    const cloudA = 0.28
    for (let i = 0; i < 4; i++) {
      const cx = X(6 + i * 19 + phase * 3 * (i % 2 ? 1 : -1)),
        cy = Y(3.2 + (i % 3) * 1.15)
      for (let k = 0; k < 6; k++) {
        hd.blob(
          cx + k * unit * 4.5,
          cy + Math.sin(k * 1.3 + i) * unit * 0.5,
          unit * 8,
          unit * 0.7,
          hdMix(skyAt(cy), cloud, cloudA),
        )
      }
    }
    // Distant birds across the sun.
    for (let i = 0; i < 3; i++) {
      const bx = X(26 + i * 4 + phase * 8) % w
      const by = Y(1 + i * 0.6)
      const flap = Math.sin(phase * 2 * Math.PI * 4 + i) * unit * 0.4
      hd.stroke(bx / cw - 1.2, by / ch + flap / ch, bx / cw, by / ch, Math.max(0.6, unit * 0.1), hdHex("#3a2233"))
      hd.stroke(bx / cw, by / ch, bx / cw + 1.2, by / ch + flap / ch, Math.max(0.6, unit * 0.1), hdHex("#3a2233"))
    }
  }

  // --- Distant ranges, hazed into the sky -----------------------------------
  const rockLit = hdHex(c.mountain),
    rockDark = hdHex(c.mountainBg)
  for (const [layer, lift, haze] of [
    [0, 0.8, 0.78],
    [1, 0.42, 0.6],
  ] as const) {
    const col = hdMix(hdMix(rockLit, rockDark, 0.5), skyAt(horizonY - Y(2)), haze)
    for (let x = 0; x < w; x++) {
      const s = x / cw
      const ridge =
        horizonY -
        Y(lift) * (1.1 + Math.sin(s * 0.21 + layer * 2.3) * 0.7 + Math.sin(s * 0.57 + layer) * 0.35) -
        Y(0.25)
      for (let y = Math.max(0, Math.floor(ridge)); y < horizonY; y++)
        hd.set(x, y, hdMix(col, skyAt(y), (y - ridge) * -0.0))
    }
  }

  // --- Fuji ------------------------------------------------------------------
  const snow = hdHex(c.snow),
    snowShade = hdHex(c.snowBg)
  const peakX = X(PEAK_X),
    topY = Y(MOUNTAIN_TOP),
    baseY = horizonY
  const haze = hdMix(skyAt(baseY), night ? hdHex("#8ba6d1") : hdHex("#e8a07a"), 0.45)
  const rimWarm = night ? hdHex("#e2eafc") : hdHex("#ffd9a0")
  const snowBase = Y(SNOW_BOTTOM)
  const snowEdge = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const s = x / cw
    const fingers = Math.pow(Math.abs(Math.sin(s * 1.35 + 0.6)), 3) * Math.max(0, 1 - Math.abs(s - PEAK_X) / 9)
    const wobble = Math.sin(s * 0.9) * 0.28 + Math.cos(s * 2.3) * 0.12
    snowEdge[x] = snowBase + (wobble + fingers * 1.25 - Math.pow(Math.abs(s - PEAK_X) / 12, 2) * 0.6) * ch * 0.75
  }
  const rowTop = Math.max(0, Math.floor(topY)),
    rowBottom = Math.min(h, Math.ceil(baseY))
  const halfAt = (t: number) => (CRATER_HALF + Math.pow(clamp01(t), 1.72) * (BASE_HALF - CRATER_HALF)) * cw
  for (let y = rowTop; y < rowBottom; y++) {
    const t = (y + 0.5 - topY) / (baseY - topY || 1)
    const halfW = halfAt(t)
    const xa = Math.max(0, Math.floor(peakX - halfW)),
      xb = Math.min(w, Math.ceil(peakX + halfW))
    for (let x = xa; x < xb; x++) {
      const s = (x + 0.5 - peakX) / (halfW || 1)
      // Light falls from the left; the terminator is a soft, slightly wavering line.
      const shadow = smooth(-0.1, 0.45, s + Math.sin(y * 0.07) * 0.03)
      const gullies = Math.sin(s * 17 + t * 4) * 0.5 + Math.sin(s * 41) * 0.25
      let color: RGB
      if (y + 0.5 < snowEdge[x]!) {
        color = hdMix(snow, snowShade, shadow)
        color = hdDarken(color, 0.95 + gullies * 0.035)
        if (!night) color = hdMix(color, rimWarm, 0.22 * (1 - shadow))
      } else {
        const lit = hdMix(rockLit, hdDarken(rockLit, 0.82), t)
        const dark = hdMix(rockDark, hdDarken(rockDark, 0.82), t * 0.6)
        color = hdMix(lit, dark, shadow)
        color = hdDarken(color, 1 + gullies * 0.07 * (0.3 + t))
        // Snow patches below the cap, aligned with the gullies.
        const lowSnow = y + 0.5 < snowEdge[x]! + ch * 0.9 && gullies > 0.35
        if (lowSnow) color = hdMix(color, hdMix(snow, snowShade, shadow), 0.55)
        // Warm rim on the lit ridge, haze toward the base.
        if (s < -0.82 && !night) color = hdMix(color, rimWarm, 0.28 * smooth(-0.82, -1, s))
        color = hdMix(color, haze, smooth(0.62, 1, t) * 0.7)
      }
      hd.set(x, y, color)
    }
    hd.set(xa, y, hdMix(snow, rockLit, smooth(0.3, 0.5, t)))
  }
  // Crater rim.
  hd.blob(peakX, topY + ch * 0.12, CRATER_HALF * cw * 0.85, ch * 0.2, hdMix(snowShade, rockDark, 0.4))
  hd.blob(peakX, topY + ch * 0.02, CRATER_HALF * cw * 0.95, ch * 0.1, snow)

  // Foothill forest and a mist band where the slopes meet the lake.
  const forest = hdMix(hdDarken(rockDark, 0.7), haze, 0.35)
  for (let x = 0; x < w; x++) {
    const s = x / cw
    const top = baseY - Y(0.25) - (Math.sin(s * 3.1) * 0.5 + Math.sin(s * 7.7) * 0.3 + 1) * ch * 0.14
    for (let y = Math.max(0, Math.floor(top)); y < baseY; y++) hd.set(x, y, forest)
  }
  for (let y = Math.floor(baseY - ch * 1.1); y < baseY; y++) {
    const a = smooth(baseY - ch * 1.1, baseY, y) * 0.5
    for (let x = 0; x < w; x++) tint(x, y, haze, a * (0.75 + 0.25 * Math.sin(x * 0.02 + wavePhase * 0.5)))
  }

  // --- Lake ------------------------------------------------------------------
  const lakeTop = Y(WATER_TOP),
    lakeBottom = Y(WATER_BOTTOM)
  hd.water(WATER_TOP, WATER_BOTTOM, hdHex(c.waterBg), hdHex(c.waterDeep), wavePhase)
  // Mirror the mountain and sky above, compressed and broken by ripples.
  for (let y = Math.max(0, Math.floor(lakeTop)); y < Math.min(h, Math.ceil(lakeBottom)); y++) {
    const u = (y - lakeTop) / (lakeBottom - lakeTop || 1)
    const src = lakeTop - 1 - (y - lakeTop) * 2.4
    for (let x = 0; x < w; x++) {
      const dx = Math.sin(y * 0.55 + x * 0.015 + wavePhase) * unit * 0.9
      const mirrored = get(x + dx, src)
      tint(x, y, mirrored, 0.5 * (1 - u * 0.7))
    }
  }
  // Sun or moon pillar and glints.
  const rx = night ? REFLECTION_X.night : REFLECTION_X.day
  hd.reflection(
    rx + REFLECTION_WIDTH / 2,
    WATER_TOP,
    WATER_BOTTOM,
    hdMix(orbBg, light, 0.4),
    wavePhase,
    REFLECTION_WIDTH,
  )
  const rxCenter = X(rx + REFLECTION_WIDTH / 2)
  for (let i = 0; i < 26; i++) {
    const gy = lakeTop + hash(i + 400) * (lakeBottom - lakeTop - 2)
    const spread = (night ? 0.9 : 3.2) * cw
    const gx = rxCenter + (hash(i + 500) - 0.5) * 2 * spread * (0.4 + (gy - lakeTop) / (lakeBottom - lakeTop))
    const on = Math.sin(wavePhase + i * 1.7) > -0.2
    if (on) hd.rect(gx, gy, gx + unit * (1.5 + hash(i + 600) * 2.5), gy + Math.max(1, unit * 0.2), light)
  }

  // --- Shore bank ------------------------------------------------------------
  const bankTop = Y(12.35)
  const bankA = hdMix(hdHex(c.trunk), hdHex(c.underBg), night ? 0.55 : 0.6)
  const bankB = hdHex(c.underBg)
  const reedC = hdMix(bankA, skyAt(bankTop), 0.25)
  for (let x = 0; x < w; x++) {
    const s = x / cw
    const edge = bankTop + Math.sin(s * 0.8) * ch * 0.08
    for (let y = Math.max(0, Math.floor(edge)); y < h; y++) {
      const v = (y - bankTop) / (h - bankTop || 1)
      hd.set(x, y, hdMix(bankA, bankB, smooth(0, 0.8, v)))
    }
    // Reed tufts on the waterline.
    if (hash(x * 0.37) > 0.82) {
      const rh = ch * (0.15 + hash(x) * 0.25)
      hd.rect(x, edge - rh, x + 1, edge, reedC)
    }
  }

  const track = hdHex(c.track)
  // Catenary poles and wire.
  for (let k = 0; k < 6; k++) {
    const px = X(k * 15 + 6 - ((fujiTrainX(0) * 0) % 1))
    hd.rect(px, Y(11.2), px + Math.max(1, unit * 0.35), Y(14.4), hdDarken(track, 0.75))
    hd.rect(px - unit, Y(11.2), px + unit * 1.4, Y(11.2) + Math.max(1, unit * 0.3), hdDarken(track, 0.75))
  }
  hd.rect(0, Y(11.55), w, Y(11.55) + 1, hdDarken(track, 0.8))

  // --- Sakura ---------------------------------------------------------------
  const petalCol = hdHex(c.petal)
  const blossom = hdHex(c.blossom),
    blossomBg = hdHex(c.blossomBg)
  const bark = hdHex(c.trunk)
  const drawSakura = (cxCells: number, lean: number, seed: number) => {
    const cx = X(cxCells)
    const ground = Y(14.0)
    const trunkTop = Y(11.9)
    // Trunk with a lean, tapering, plus two branches.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      const tx = cx + lean * unit * 3.2 * t * t
      hd.disk(
        tx,
        ground + (trunkTop - ground) * t,
        Math.max(1.5, unit * (1.1 - t * 0.55)),
        hdDarken(bark, 0.75 + 0.2 * t),
      )
    }
    const tipX = cx + lean * unit * 3.2
    hd.stroke(
      tipX / cw,
      trunkTop / ch,
      (tipX - unit * 7) / cw,
      (trunkTop - ch * 0.5) / ch,
      Math.max(1.2, unit * 0.35),
      bark,
    )
    hd.stroke(
      tipX / cw,
      trunkTop / ch,
      (tipX + unit * 7) / cw,
      (trunkTop - ch * 0.8) / ch,
      Math.max(1.2, unit * 0.35),
      bark,
    )
    // Blossom clusters: dark underside, mid body, bright crown, speckled.
    const clusters: [number, number, number][] = [
      [-8, 0.05, 1.0],
      [-4, -0.7, 1.15],
      [0, -1.15, 1.25],
      [4.5, -0.75, 1.15],
      [8.5, -0.05, 1.0],
      [-1.5, 0.05, 1.0],
      [3, 0.1, 0.9],
    ]
    for (const [dx, dy, size] of clusters) {
      const bx = tipX + dx * unit,
        by = trunkTop + dy * ch
      const rxx = unit * 5.2 * size,
        ryy = ch * 0.78 * size
      hd.blob(bx, by + ryy * 0.18, rxx, ryy, hdDarken(blossomBg, 0.78))
      hd.blob(bx, by, rxx * 0.95, ryy * 0.9, blossomBg)
      hd.blob(bx - rxx * 0.1, by - ryy * 0.28, rxx * 0.72, ryy * 0.55, hdMix(blossom, petalCol, 0.35))
    }
    // Flecks of highlight.
    for (let i = 0; i < 26; i++) {
      const a = hash(seed + i) * Math.PI * 2,
        r = Math.sqrt(hash(seed + i + 50))
      const px = tipX + Math.cos(a) * r * unit * 12,
        py = trunkTop - ch * 0.5 + Math.sin(a) * r * ch * 0.9
      hd.set(Math.round(px), Math.round(py), hdMix(petalCol, light, 0.35))
    }
    // Soft shadow of the tree on the bank.
    hd.blob(cx + unit * 2, ground + ch * 0.35, unit * 10, ch * 0.16, hdDarken(bankA, 0.7))
  }
  drawSakura(LEFT_TREE_X, 0.7, 11)
  drawSakura(RIGHT_TREE_X, -0.7, 31)

  // --- Track bed --------------------------------------------------------------
  hd.rect(0, Y(14.25), w, Y(15.95), hdMix(bankA, bankB, 0.5))
  // Ballast and sleepers.
  for (let x = 0; x < w; x += Math.max(3, Math.round(unit * 2.4)))
    hd.rect(x, Y(15.15), x + Math.max(1, unit * 0.5), Y(15.9), hdDarken(track, 0.7))
  for (const row of PLATFORM_ROWS) {
    hd.rect(0, Y(row), w, Y(row) + Math.max(2, unit * 0.45), hdMix(track, light, night ? 0.35 : 0.2))
    hd.rect(0, Y(row) + Math.max(2, unit * 0.45), w, Y(row) + Math.max(3, unit * 0.8), hdDarken(track, 0.6))
  }
  // --- Shinkansen ----------------------------------------------------------------
  const trainX = fujiTrainX(elapsedMs) * cw,
    trainW = TRAIN_WIDTH * cw
  const bodyTop = Y(TRAIN_TOP),
    bodyH = Y(TRAIN_BODY_BOTTOM) - bodyTop
  const noseLen = TRAIN_NOSE_CELLS * cw
  const body = hdHex(c.train),
    belt = hdHex(c.trainBg),
    glass = hdHex(c.underBg),
    plate = hdHex(c.jr),
    skirt = hdHex(c.skirt)
  const ambient = night ? 0.78 : 0.92
  const winLit = night ? plate : hdMix(hdHex("#3a4a6a"), skyAt(bodyTop), 0.4)
  const txa = Math.floor(trainX),
    txb = Math.ceil(trainX + trainW)
  // Headlight beam before the body.
  for (let y = Math.max(0, Math.floor(bodyTop)); y < Math.min(h, Math.ceil(bodyTop + bodyH)); y++) {
    const band = (y + 0.5 - bodyTop) / (bodyH || 1)
    // Aerodynamic nose: low-slung wedge with a concave upper curve.
    const cut = noseLen * Math.pow(1 - band, 1.35)
    // Roof curve: the car is rounded at the top corners.
    for (let x = Math.max(0, txa); x < Math.min(w, txb); x++) {
      const localX = x + 0.5 - trainX
      if (localX < cut) continue
      const tailTaper = trainW - localX < unit * 1.5 && band < 0.12
      if (tailTaper) continue
      // Vertical shading: bright shoulder, fading to shade near the skirt.
      let color: RGB = hdDarken(body, ambient * (1.03 - band * 0.2))
      if (band < 0.07)
        color = hdDarken(hdMix(body, glass, 0.5), ambient) // dark roof line
      else if (band >= 0.2 && band < 0.5) {
        const wi = (localX / cw - WINDOW_FIRST) / WINDOW_PITCH
        const inWin = localX / cw >= WINDOW_FIRST && Math.abs((wi % 1) - 0.17) < 0.2 && localX < trainW - 2 * cw
        const cab = localX < noseLen * 0.9 && localX > cut + unit * 0.5 && band > 0.24 && band < 0.42
        if (inWin || cab) {
          const gv = (band - 0.2) / 0.3
          color = hdMix(winLit, glass, night && !cab ? gv * 0.35 : 0.5 + gv * 0.4)
          if (cab) color = hdMix(glass, hdHex("#5a6e96"), 0.4 * (1 - gv))
        }
      } else if (band >= 0.52 && band < 0.62) color = belt
      else if (band >= 0.7 && band < 0.92) color = hdDarken(skirt, 0.9 + (0.92 - band) * 0.4)
      else if (band >= 0.92) color = hdDarken(belt, 0.8)
      hd.set(x, y, color)
    }
  }
  // Roof highlight and gold JR plate.
  hd.rect(
    trainX + cw * 6,
    bodyTop + 1,
    trainX + trainW - cw,
    bodyTop + Math.max(1.5, bodyH * 0.03),
    hdMix(body, [255, 255, 255], 0.4),
  )
  hd.rect(trainX + TRAIN_JR_OFFSET * cw, Y(17.15), trainX + (TRAIN_JR_OFFSET + 2) * cw, Y(17.85), plate)
  // Nose headlight.
  hd.disk(trainX + unit * 1.4, bodyTop + bodyH * 0.8, Math.max(1.2, unit * 0.45), hdHex("#fff2c0"))
  // Undercarriage with bogies and wheels.
  const underBg = hdHex(c.underBg),
    wheel = hdHex(c.wheel)
  const underTop = Y(TRAIN_BODY_BOTTOM)
  hd.rect(trainX + noseLen * 0.25, underTop, trainX + trainW, h, underBg)
  hd.rect(trainX + noseLen * 0.25, underTop, trainX + trainW, underTop + Math.max(1, unit * 0.3), hdDarken(belt, 0.7))
  const wheelR = Math.max(1, Math.min(cw * 1.2, (h - underTop) * 0.4))
  for (const offset of TRAIN_WHEEL_OFFSETS) {
    const wx = trainX + offset * cw + cw
    hd.disk(wx, underTop + (h - underTop) / 2, wheelR * 1.25, hdDarken(wheel, 0.35))
    hd.disk(wx, underTop + (h - underTop) / 2, wheelR, wheel)
    hd.disk(wx, underTop + (h - underTop) / 2, wheelR * 0.4, underBg)
  }

  // Petals from the shared deterministic paths, painted last (front).
  fujiPetals(elapsedMs).forEach((p, i) => {
    const px = (p.x + 0.5) * cw,
      py = (p.y + 0.5) * ch
    const r = Math.max(1, Math.min(5, (1 + (i % 3)) * (unit / 6)))
    hd.blob(px, py, r * 1.5, r * 0.9, petalCol, hdMix(petalCol, blossom, 0.5))
  })

  return hd.pixels
}
