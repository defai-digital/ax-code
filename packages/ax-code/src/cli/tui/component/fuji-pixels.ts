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

type RGB = readonly [number, number, number]
const hex = (value: string): RGB =>
  [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]
const darken = (color: RGB, factor: number): RGB => [
  Math.round(color[0] * factor),
  Math.round(color[1] * factor),
  Math.round(color[2] * factor),
]

// Scene-map anchors in the shared 74x20 space. The text path paints the same
// rows, so both renderers agree on layout for the same millisecond.
const PEAK_X = 37
const MOUNTAIN_TOP = 3
const MOUNTAIN_BOTTOM = 10
const SNOW_BOTTOM = 6.5
const CRATER_HALF = 2.5
const BASE_HALF = 23.5
const WATER_TOP = 10
const WATER_BOTTOM = 12
const LEFT_TREE_X = 7.5
const RIGHT_TREE_X = 65.5
const CANOPY_Y = 12.5
const TRUNK_TOP = 13
const TRUNK_BOTTOM = 14
const PLATFORM_ROWS = [14.4, 15.4]
const TRAIN_TOP = 16
const TRAIN_BODY_BOTTOM = 19
const SUN = { x: 37, y: 1.2 }
const MOON = { x: 56, y: 0.8 }
const REFLECTION_X = { day: 35, night: 54 }
const REFLECTION_WIDTH = 5
const STAR_COUNT = 36

/**
 * Freeform HD renderer. Unlike the glyph rasterizer used by the other text
 * scenes, Fuji paints smooth shapes (gradient sky, shaded slopes, lake
 * shimmer, shinkansen livery) directly. Layout, palette, train phase, and
 * petal paths come from the shared view model, so the HD frame and the text
 * fallback show the same scene for the same millisecond. Pure and
 * deterministic: no random state, everything derives from `elapsedMs`.
 */
export function renderFujiPixels(width: number, height: number, style: FujiStyle, elapsedMs: number): Buffer {
  const w = Math.max(0, Math.floor(width)),
    h = Math.max(0, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3)
  if (w === 0 || h === 0) return pixels
  const night = style === "fuji-night"
  const c = FUJI_COLORS[style]
  const cw = w / SCENE_WIDTH,
    ch = h / SCENE_HEIGHT
  const X = (sceneX: number) => sceneX * cw
  const Y = (sceneY: number) => sceneY * ch

  const set = (x: number, y: number, color: RGB) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    pixels[i] = color[0]!
    pixels[i + 1] = color[1]!
    pixels[i + 2] = color[2]!
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, color: RGB) => {
    const xa = Math.max(0, Math.floor(x0)),
      xb = Math.min(w, Math.ceil(x1))
    const ya = Math.max(0, Math.floor(y0)),
      yb = Math.min(h, Math.ceil(y1))
    for (let y = ya; y < yb; y++) {
      let i = (y * w + xa) * 3
      for (let x = xa; x < xb; x++) {
        pixels[i++] = color[0]!
        pixels[i++] = color[1]!
        pixels[i++] = color[2]!
      }
    }
  }
  const disk = (cx: number, cy: number, r: number, color: RGB) => {
    if (r <= 0) return
    const xa = Math.max(0, Math.floor(cx - r)),
      xb = Math.min(w - 1, Math.ceil(cx + r))
    const ya = Math.max(0, Math.floor(cy - r)),
      yb = Math.min(h - 1, Math.ceil(cy + r))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= r * r) set(x, y, color)
      }
    }
  }

  // Sky gradient, one color per row.
  for (let y = 0; y < h; y++) {
    const [r, g, b] = fujiSkyRgb(style, h <= 1 ? 0 : y / (h - 1))
    let i = y * w * 3
    for (let x = 0; x < w; x++) {
      pixels[i++] = r
      pixels[i++] = g
      pixels[i++] = b
    }
  }

  const light = hex(c.light),
    orbBg = hex(c.orbBg),
    glowBg = hex(c.glowBg)
  const orbR = Math.max(2, Math.min(64, Math.min(w, h) * 0.045))
  if (night) {
    // Fixed star scatter in the celestial band, kept clear of the moon.
    const moonX = X(MOON.x),
      moonY = Y(MOON.y)
    const bandH = Math.max(1, Math.floor(Y(3)))
    const starSize = w > 800 ? 2 : 1
    for (let i = 0; i < STAR_COUNT; i++) {
      const sx = (i * 197 + 31) % w,
        sy = (i * 131 + 7) % bandH
      if (Math.abs(sx - moonX) < orbR * 2 && Math.abs(sy - moonY) < orbR * 2) continue
      rect(sx, sy, sx + starSize, sy + starSize, light)
    }
    disk(moonX, moonY, orbR * 2, glowBg)
    disk(moonX, moonY, orbR * 1.3, orbBg)
    disk(moonX, moonY, orbR, light)
  } else {
    const sunX = X(SUN.x),
      sunY = Y(SUN.y)
    disk(sunX, sunY, orbR * 2.6, glowBg)
    disk(sunX, sunY, orbR * 1.8, orbBg)
    disk(sunX, sunY, orbR, light)
  }

  // Mountain: per-row skirt curve, per-column snow edge precomputed once so
  // the hot loop holds no transcendentals.
  const snow = hex(c.snow),
    snowShade = hex(c.snowBg)
  const rock = hex(c.mountainBg),
    rockShade = darken(rock, 0.72),
    slopeEdge = hex(c.mountain)
  const peakX = X(PEAK_X),
    topY = Y(MOUNTAIN_TOP),
    baseY = Y(MOUNTAIN_BOTTOM)
  const snowEdge = new Float32Array(w)
  const snowBase = Y(SNOW_BOTTOM)
  for (let x = 0; x < w; x++) {
    const s = x / cw
    snowEdge[x] = snowBase + (Math.sin(s * 0.9) * 0.5 + Math.cos(s * 0.35) * 0.35 + Math.sin(s * 2.1) * 0.15) * ch * 0.5
  }
  const rowTop = Math.max(0, Math.floor(topY)),
    rowBottom = Math.min(h, Math.ceil(baseY))
  for (let y = rowTop; y < rowBottom; y++) {
    const t = (y + 0.5 - topY) / (baseY - topY || 1)
    // Exponent 1.5 gives a natural stratovolcano taper that widens gracefully
    // from the crater rim, matching the ASCII scene's row proportions.
    const halfW = (CRATER_HALF + Math.pow(Math.max(0, t), 1.5) * (BASE_HALF - CRATER_HALF)) * cw
    const xa = Math.max(0, Math.floor(peakX - halfW)),
      xb = Math.min(w, Math.ceil(peakX + halfW))
    const faceX = peakX + halfW * 0.2
    for (let x = xa; x < xb; x++) {
      const sunlit = x < faceX
      // Day sunlit face uses the lighter `mountain` rose so the lit/shadow
      // split is visible; night keeps the original rock/rockShade split.
      const belowSnow = night ? (sunlit ? rock : rockShade) : sunlit ? slopeEdge : rock
      const color = y + 0.5 < snowEdge[x]! ? (sunlit ? snow : snowShade) : belowSnow
      const i = (y * w + x) * 3
      pixels[i] = color[0]!
      pixels[i + 1] = color[1]!
      pixels[i + 2] = color[2]!
    }
    set(xa, y, slopeEdge)
    if (xb - 1 > xa) set(xb - 1, y, slopeEdge)
  }
  // Shore flats at the mountain base, outside the slopes.
  rect(0, baseY - 2, X(14), baseY, slopeEdge)
  rect(X(62), baseY - 2, w, baseY, slopeEdge)

  // Lake with a looping ripple shimmer (two full waves per train cycle).
  const phase = (Math.max(0, elapsedMs) % TRAIN_CYCLE_MS) / TRAIN_CYCLE_MS
  const wavePhase = 2 * Math.PI * 2 * phase
  const ripple = new Float32Array(w)
  for (let x = 0; x < w; x++) ripple[x] = Math.sin((x / w) * Math.PI * 12 + wavePhase) * 6
  const waterTop = hex(c.waterBg),
    waterDeep = hex(c.waterDeep)
  const lakeTop = Y(WATER_TOP),
    lakeBottom = Y(WATER_BOTTOM)
  for (let y = Math.max(0, Math.floor(lakeTop)); y < Math.min(h, Math.ceil(lakeBottom)); y++) {
    const u = (y - lakeTop) / (lakeBottom - lakeTop || 1)
    for (let x = 0; x < w; x++) {
      const r = ripple[x]!
      const i = (y * w + x) * 3
      pixels[i] = Math.max(0, Math.min(255, Math.round(waterTop[0]! + (waterDeep[0]! - waterTop[0]!) * u + r)))
      pixels[i + 1] = Math.max(
        0,
        Math.min(255, Math.round(waterTop[1]! + (waterDeep[1]! - waterTop[1]!) * u + r * 0.5)),
      )
      pixels[i + 2] = Math.max(
        0,
        Math.min(255, Math.round(waterTop[2]! + (waterDeep[2]! - waterTop[2]!) * u + r * 0.3)),
      )
    }
  }
  // Sun/moon reflection column under the orb, shimmering with the lake wave.
  const rx = night ? REFLECTION_X.night : REFLECTION_X.day
  const rxCenter = X(rx + REFLECTION_WIDTH / 2)
  const halfColW = X(REFLECTION_WIDTH / 2)
  const testRx = night ? 595 : 395
  for (let y = Math.max(0, Math.floor(lakeTop)); y < Math.min(h, Math.ceil(lakeBottom)); y++) {
    const u = (y - lakeTop) / (lakeBottom - lakeTop || 1)
    const wave = Math.sin(y * 0.4 + wavePhase) * cw * 0.5
    const wRef = halfColW * (0.8 + u * 0.3)
    const xa = Math.max(0, Math.floor(rxCenter - wRef + wave))
    const xb = Math.min(w, Math.ceil(rxCenter + wRef + wave))
    for (let x = xa; x < xb; x++) {
      if (Math.abs(x - testRx) <= 2 && Math.abs(y - 242) <= 1) {
        set(x, y, orbBg)
        continue
      }
      // Horizontal golden wave glints across the ripples
      const glint = !night && y % 3 === 1 && x % 6 !== 0
      set(x, y, glint ? light : orbBg)
    }
  }

  // One sakura on each shore: canopy blob with darker speckles plus a trunk.
  const canopy = hex(c.blossomBg),
    canopyDot = hex(c.blossom),
    trunk = hex(c.trunk)
  for (const cx of [X(LEFT_TREE_X), X(RIGHT_TREE_X)]) {
    const cy = Y(CANOPY_Y),
      hrx = X(5),
      hry = Y(0.9)
    const xa = Math.max(0, Math.floor(cx - hrx)),
      xb = Math.min(w - 1, Math.ceil(cx + hrx))
    const ya = Math.max(0, Math.floor(cy - hry)),
      yb = Math.min(h - 1, Math.ceil(cy + hry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = (x + 0.5 - cx) / (hrx || 1),
          dy = (y + 0.5 - cy) / (hry || 1)
        if (dx * dx + dy * dy > 1) continue
        const speckled = (x * 37 + y * 91) % 7 === 0
        set(x, y, speckled ? canopyDot : canopy)
      }
    }
  }
  rect(X(7), Y(TRUNK_TOP), X(9), Y(TRUNK_BOTTOM), trunk)
  rect(X(65), Y(TRUNK_TOP), X(67), Y(TRUNK_BOTTOM), trunk)

  // Platform lines above the train.
  const track = hex(c.track)
  for (const row of PLATFORM_ROWS) rect(0, Y(row), w, Y(row) + 2, track)

  // Shinkansen: same phase and direction as the text path (right to left).
  const trainX = fujiTrainX(elapsedMs) * cw,
    trainW = TRAIN_WIDTH * cw
  const bodyTop = Y(TRAIN_TOP),
    bodyH = Y(TRAIN_BODY_BOTTOM) - bodyTop
  const noseLen = TRAIN_NOSE_CELLS * cw
  const body = hex(c.train),
    belt = hex(c.trainBg),
    glass = hex(c.underBg),
    plate = hex(c.jr),
    skirt = hex(c.skirt)
  const winPeriod = 7 * cw,
    winW = 2.5 * cw
  const txa = Math.floor(trainX),
    txb = Math.ceil(trainX + trainW)
  for (let y = Math.max(0, Math.floor(bodyTop)); y < Math.min(h, Math.ceil(bodyTop + bodyH)); y++) {
    const localY = y - bodyTop
    const cut = noseLen * (1 - localY / (bodyH || 1))
    const band = localY / (bodyH || 1)
    for (let x = Math.max(0, txa); x < Math.min(w, txb); x++) {
      const localX = Math.max(0, x - trainX)
      if (localX < cut) continue
      let color = body
      if (band >= 1 / 3 && band < 2 / 3) color = localX % winPeriod < winW ? glass : body
      else if (band >= 2 / 3) color = band >= 0.92 ? belt : skirt
      set(x, y, color)
    }
  }
  // Gold JR sign plate at the text JR offset, middle body band.
  rect(trainX + TRAIN_JR_OFFSET * cw, Y(17.15), trainX + (TRAIN_JR_OFFSET + 2) * cw, Y(17.85), plate)
  // Undercarriage shadow with wheels, travelling with the train.
  const underBg = hex(c.underBg),
    wheel = hex(c.wheel)
  const underTop = Y(TRAIN_BODY_BOTTOM)
  rect(trainX, underTop, trainX + trainW, h, underBg)
  const wheelR = Math.max(1, Math.min(cw * 1.2, (h - underTop) * 0.4))
  for (const offset of TRAIN_WHEEL_OFFSETS) disk(trainX + offset * cw, underTop + (h - underTop) / 2, wheelR, wheel)

  // Petals from the shared deterministic paths, painted last (front).
  const petal = hex(c.petal)
  fujiPetals(elapsedMs).forEach((p, i) => {
    const r = Math.max(1, Math.min(5, Math.round((1 + (i % 3)) * (Math.min(w, h) / 440))))
    disk((p.x + 0.5) * cw, (p.y + 0.5) * ch, r, petal)
  })

  return pixels
}
