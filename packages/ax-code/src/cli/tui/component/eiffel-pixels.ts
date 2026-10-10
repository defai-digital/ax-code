import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
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
  eiffelFlash,
  eiffelHalf,
  eiffelPigeons,
  eiffelSkyRgb,
  type EiffelStyle,
} from "./eiffel-view-model"
import { clamp01, hash } from "./atmos-paint"

/**
 * Freeform HD tower. A curved wrought-iron lattice: four flared legs joined by
 * a grand arch, three decks, X-bracing in every bay, and a slim spire with a
 * beacon. Behind it sits a Haussmann skyline; in front the Champ de Mars runs
 * in perspective with tree rows, lamps, a carousel and a fountain. Day is
 * sunlit iron under soft clouds; night floodlights the iron, twinkles the
 * lattice, and sweeps a searchlight. Pure and deterministic from `elapsedMs`.
 */
export function renderEiffelPixels(width: number, height: number, style: EiffelStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, EIFFEL_COLUMNS, EIFFEL_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "eiffel-night"
  const c = EIFFEL_COLORS[style]
  const t = Math.max(0, elapsedMs)
  const w = hd.w
  const h = hd.h
  const px = hd.pixels
  const s = Math.max(1, Math.min(hd.cw, hd.ch / 2))
  const iron = hdHex(c.iron)
  const ironDark = hdHex(c.ironDark)
  const sparkle = hdHex(c.sparkle)
  const lawn = hdHex(c.lawn)
  const path = hdHex(c.path)
  const lamp = hdHex(c.lampGlow)
  const roof = hdHex(c.roof)
  const cloud = hdHex(c.cloud)
  const carousel = hdHex(c.carousel)
  const fountain = hdHex(c.fountain)
  const groundY = hd.Y(EIFFEL_GROUND_TOP)
  const cx = hd.X(EIFFEL_CX + 0.5)
  const horizonSky = eiffelSkyRgb(style, EIFFEL_GROUND_TOP / EIFFEL_ROWS)

  const blend = (x: number, y: number, color: RGB, a: number) => {
    if (a <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    px[i] = Math.round(px[i]! + (color[0] - px[i]!) * a)
    px[i + 1] = Math.round(px[i + 1]! + (color[1] - px[i + 1]!) * a)
    px[i + 2] = Math.round(px[i + 2]! + (color[2] - px[i + 2]!) * a)
  }
  const glow = (gx: number, gy: number, r: number, color: RGB, peak: number) => {
    const xa = Math.max(0, Math.floor(gx - r))
    const xb = Math.min(w - 1, Math.ceil(gx + r))
    const ya = Math.max(0, Math.floor(gy - r))
    const yb = Math.min(h - 1, Math.ceil(gy + r))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy) / r
        if (d < 1) blend(x, y, color, peak * (1 - d) * (1 - d))
      }
    }
  }

  // Sky with horizon glow.
  hd.sky((v) => eiffelSkyRgb(style, v))
  const orb = night ? EIFFEL_MOON : { x: 64, y: 1.8 }
  const ox = hd.X(orb.x)
  const oy = hd.Y(orb.y)
  if (night) {
    hd.stars(EIFFEL_STARS, hdHex(c.sky), (i) => eiffelFlash(elapsedMs, i))
    for (let i = 0; i < 40; i++) {
      const sx = hash(i, 3) * w
      const sy = hash(i, 5) * groundY * 0.62
      if (Math.hypot(sx - ox, sy - oy) < s * 8) continue
      hd.set(Math.floor(sx), Math.floor(sy), hdMix(hdHex(c.sky), [255, 255, 255], 0.4 + 0.5 * hash(i, 9)))
    }
    glow(ox, oy, s * 9, [150, 170, 215], 0.55)
    hd.disk(ox, oy, s * 1.7, hdMix(sparkle, [255, 255, 255], 0.5))
  } else {
    glow(ox, oy, s * 13, [255, 247, 215], 0.7)
    hd.disk(ox, oy, s * 1.8, [255, 252, 232])
    for (const [gx, gy, cw] of [
      [10, 3, 9],
      [24, 6.4, 6],
      [50, 4.6, 8],
      [66, 8, 6],
    ] as const) {
      for (let k = 0; k < 8; k++) {
        const kk = k - 3.5
        glow(
          hd.X(gx + kk * cw * 0.12 + (t / 1000) * 0.3 * (gx > 40 ? 1 : 0.6)),
          hd.Y(gy + Math.sin(k * 2.3) * 0.3),
          s * (2.6 + 1.2 * Math.cos(kk * 0.5)),
          cloud,
          0.55,
        )
      }
    }
  }
  const hazeBand = (y: number) => clamp01((y - groundY * 0.6) / (groundY * 0.4))
  for (let y = Math.floor(groundY * 0.6); y < Math.min(h, Math.ceil(groundY)); y++) {
    const col: RGB = night ? [96, 74, 70] : [255, 238, 214]
    for (let x = 0; x < w; x++) blend(x, y, col, hazeBand(y) * (night ? 0.4 : 0.35))
  }

  // Haussmann skyline: cream stone, slate mansards, lit windows at night.
  const stone: RGB = night ? [58, 56, 74] : [214, 200, 176]
  const slate = hdMix(roof, [60, 66, 84], night ? 0.2 : 0.55)
  let x = -s * 2
  let block = 0
  while (x < w) {
    const bw = s * (6 + hash(block, 1) * 6)
    const bh = s * (4.6 + hash(block, 2) * 2.4)
    const top = groundY - bh
    const shade = 0.86 + 0.18 * hash(block, 7)
    const body = hdDarken(hdMix(stone, horizonSky, 0.18), shade)
    hd.rect(x, top, x + bw, groundY, body)
    // Mansard roof, a darker slope with a bright ridge.
    hd.rect(x, top - s * 1.5, x + bw, top, slate)
    hd.rect(x, top - s * 1.5, x + bw, top - s * 1.5 + 1.5, hdMix(slate, horizonSky, 0.5))
    for (let wx = x + s * 0.8; wx < x + bw - s * 0.8; wx += s * 1.5) {
      const lit = night && hash(Math.floor(wx / s), block) < 0.45
      for (let wy = top + s * 0.6; wy < groundY - s * 0.8; wy += s * 1.5) {
        hd.rect(
          wx,
          wy,
          wx + s * 0.55,
          wy + s * 0.95,
          lit ? hdMix(lamp, [255, 220, 150], 0.4) : hdDarken(body, night ? 0.6 : 0.68),
        )
      }
      if (hash(Math.floor(wx / s), block + 40) < 0.12)
        hd.rect(wx, top - s * 1.5, wx + s * 0.5, top - s * 2.3, hdDarken(slate, 0.8))
    }
    x += bw + 1
    block++
  }
  // Named chimneys from the shared model sit at the skyline's edge.
  for (const roofX of EIFFEL_ROOFS) {
    hd.rect(hd.X(roofX + 0.5), hd.Y(15.7), hd.X(roofX + 1.5), hd.Y(16.5), hdDarken(roof, night ? 0.7 : 0.55))
  }
  // Distant haze over the skyline.
  for (let y = Math.floor(groundY - s * 9); y < Math.min(h, Math.ceil(groundY)); y++) {
    for (let xx = 0; xx < w; xx++) blend(xx, y, horizonSky, 0.22)
  }
  // Tree line along the Champ de Mars.
  const leaf = hdDarken(hdMix(lawn, hdHex("#3d6a30"), night ? 0.1 : 0.7), night ? 0.8 : 1)
  for (let i = 0; i < w / (s * 2.4) + 2; i++) {
    const tx = i * s * 2.4 + hash(i, 12) * s
    if (Math.abs(tx - cx) < s * 12) continue
    const r = s * (1.5 + hash(i, 3) * 0.7)
    hd.rect(tx - 1, groundY - s * 1.2, tx + 1, groundY, hdDarken(leaf, 0.5))
    hd.blob(tx, groundY - s * 2.4, r, r * 1.05, hdDarken(leaf, 0.9 + hash(i, 4) * 0.2))
    hd.blob(tx - r * 0.3, groundY - s * 2.8, r * 0.6, r * 0.55, hdMix(leaf, [200, 230, 150], night ? 0.05 : 0.2))
  }

  // Tower geometry.
  const yTop = hd.Y(EIFFEL_TOP)
  const yBase = hd.Y(EIFFEL_BASE + 1)
  const rowOf = (y: number) => EIFFEL_TOP + (y - yTop) / hd.ch
  const halfAt = (y: number) => eiffelHalf(rowOf(y)) * hd.cw
  const plat1 = hd.Y(EIFFEL_PLATFORMS[0])
  const plat2 = hd.Y(EIFFEL_PLATFORMS[1])
  const archTop = hd.Y(EIFFEL_BASE - 4)
  const bands = [1, 2.5, 4.5, 6.5, 8, 10, 12, 14]
  const lightSide = night ? -1 : 1
  const ironLit = night ? hdMix(iron, [255, 190, 90], 0.55) : hdMix(iron, [255, 214, 170], 0.25)
  const ironBase = hdMix(iron, ironDark, 0.4)
  const ironShade = hdDarken(ironDark, 0.8)
  const post = (y: number) => 1.1 + (halfAt(y) / hd.cw) * 0.1 * s * 0.4 + (y > plat2 ? 0.25 * s : 0)
  for (let y = Math.floor(yTop); y < Math.min(h, Math.ceil(yBase)); y++) {
    const half = halfAt(y + 0.5)
    const row = rowOf(y + 0.5)
    const hv = clamp01((y - yTop) / (yBase - yTop || 1))
    const xa = Math.max(0, Math.floor(cx - half - 3))
    const xb = Math.min(w - 1, Math.ceil(cx + half + 3))
    for (let xx = xa; xx <= xb; xx++) {
      const dx = xx + 0.5 - cx
      const adx = Math.abs(dx)
      const de = half - adx
      if (de < -2) continue
      const thick = post(y + 0.5)
      let hit = 0
      const lower = y > plat2
      if (de > -1.5 && de < thick) hit = 1
      if (!hit && !lower) {
        // Upper tower: X-braced bays and ribs across the full width.
        const u = dx / (half || 1)
        for (let b = 0; b < bands.length - 1 && !hit; b++) {
          const y0 = hd.Y(bands[b]!)
          const y1 = hd.Y(bands[b + 1]!)
          if (y < y0 || y >= y1) continue
          const lt = (y - y0) / (y1 - y0)
          const dd = Math.min(Math.abs(u - (2 * lt - 1)), Math.abs(u + (2 * lt - 1))) * half
          if (dd < Math.max(0.9, s * 0.1 + 0.35)) hit = 0.8
          if (y - y0 < 1.6 || y1 - y < 1.2) hit = 1
          // Inner core posts on the lower upper section.
          if (row > 8 && Math.abs(adx - half * 0.4) < thick * 0.5) hit = 0.8
        }
      } else if (!hit) {
        // Lower tower: lattice leg strips with an open arch between them.
        const legIn = half * 0.56
        const archR = half * 0.6
        const ay = (y - archTop) / (yBase - archTop)
        const insideArch = adx < archR * Math.sqrt(Math.max(0, 1 - Math.pow(1 - ay, 2))) && y > archTop
        if (adx > legIn - 0 && adx < half) {
          const u = (adx - legIn) / (half - legIn || 1)
          const lt = ((y - plat2) / (yBase - plat2)) * 3
          const ph = lt - Math.floor(lt)
          const dd = Math.min(Math.abs(u - ph), Math.abs(u - (1 - ph))) * (half - legIn)
          if (dd < Math.max(0.9, s * 0.1 + 0.3)) hit = 0.75
          if (Math.abs(adx - legIn) < thick * 0.6) hit = 1
          if (ph < 0.05) hit = 0.9
        } else if (adx <= legIn && !insideArch) {
          // Spandrel above the arch: fine crosshatch.
          const q = (adx + y) / (s * 1.1)
          const q2 = (adx - y) / (s * 1.1)
          if (Math.abs(q - Math.round(q)) < 0.1 || Math.abs(q2 - Math.round(q2)) < 0.1) hit = 0.6
        }
        // Arch ring.
        if (adx < archR + thick * 0.8) {
          const ex = adx / (archR || 1)
          const yy = yBase - Math.sqrt(Math.max(0, 1 - ex * ex)) * (yBase - archTop)
          if (ex <= 1 && Math.abs(y - yy) < thick * 0.9) hit = 1
        }
      }
      // Platforms: wide decks with railing and shadow underneath.
      for (const [py, ext, th] of [
        [plat1, 1.3, 0.55],
        [plat2, 1.18, 0.7],
      ] as const) {
        const hh = halfAt(py) * ext
        if (adx < hh && y >= py - th * s && y < py + th * s * 0.8) hit = 1
        if (adx < hh && y >= py - th * s * 2 && y < py - th * s && xx % Math.max(2, Math.round(s * 0.5)) < 1)
          hit = Math.max(hit, 0.7)
      }
      // Observation deck below the spire.
      const topDeck = hd.Y(4.5)
      const dh = halfAt(topDeck) * 1.5
      if (adx < dh && y >= topDeck - s * 0.5 && y < topDeck + s * 0.4) hit = 1
      if (hit === 0) continue
      // Lighting: lit side, floodlight from below at night, haze by day.
      const side = (dx * lightSide) / (half || 1)
      const sh = clamp01(0.5 + side * 0.5)
      let col = hdMix(ironShade, ironLit, sh * 0.7 + (1 - hv) * 0.15)
      col = hdMix(ironBase, col, 0.55 + 0.45 * hit)
      if (night) col = hdMix(col, [255, 170, 70], 0.18 + 0.55 * hv * hv * (0.4 + sh * 0.6))
      else col = hdMix(col, horizonSky, 0.1 * (1 - hv))
      blend(xx, y, col, Math.min(1, 0.55 + hit * 0.45))
    }
  }
  // Spire mast above the observation deck.
  hd.rect(cx - 1, yTop - s * 0.6, cx + 1, hd.Y(2.6), hdMix(ironDark, ironLit, 0.4))
  // Beacon with a breathing glow.
  const beaconOn = eiffelBeacon(elapsedMs)
  const beaconPulse = 0.5 + 0.5 * Math.sin((t / 1200) * Math.PI * 2)
  glow(cx, yTop - s * 0.4, s * (2 + beaconPulse * 2), [255, 70, 70], beaconOn ? 0.55 : 0.25)
  hd.disk(cx, yTop - s * 0.4, Math.max(1.4, s * (beaconOn ? 0.4 : 0.25)), hdHex(c.beacon))

  // Night sparkle: glitter over the lattice, a searchlight sweep, and flare stars.
  if (night) {
    const slot = Math.floor(t / 150)
    for (let y = Math.floor(yTop); y < Math.min(h, Math.ceil(yBase)); y += 2) {
      const half = halfAt(y)
      for (let xx = Math.floor(cx - half); xx < Math.ceil(cx + half); xx += 2) {
        const i = (y * w + xx) * 3
        if (xx < 0 || xx >= w || px[i]! < 120) continue
        if (hash(xx * 7 + slot, y * 13 + slot * 3) < 0.04) hd.disk(xx, y, 1.1, [255, 244, 190])
      }
    }
    const sweep = -Math.cos((t / 1200) * Math.PI * 2)
    for (const k of [0, 1]) {
      const ang = (k === 0 ? sweep : -sweep) * 0.8 + (k === 0 ? -0.25 : 0.25)
      const len = Math.hypot(w, h)
      const bx = cx
      const by = yTop - s * 0.2
      for (let step = 0; step < 90; step++) {
        const f = step / 90
        const gx = bx + Math.sin(ang) * len * f
        const gy = by - Math.cos(ang) * len * f * 0.9
        glow(gx, gy, s * (1.2 + f * 5), [255, 244, 200], 0.1 * (1 - f))
      }
    }
  }
  EIFFEL_SPARKLES.forEach((spark, i) => {
    if (!eiffelFlash(elapsedMs, i)) return
    const sx = hd.X(spark.x + 0.5)
    const sy = hd.Y(spark.y + 0.5)
    glow(sx, sy, s * 3, sparkle, night ? 0.7 : 0.45)
    hd.disk(sx, sy, Math.max(1.2, s * 0.22), [255, 255, 240])
  })

  // Pigeons.
  const flap = Math.floor(t / 300) % 2 === 0
  for (const pigeon of eiffelPigeons(elapsedMs)) {
    const bx = hd.X(pigeon.x + 0.5)
    const by = hd.Y(pigeon.y + 0.5)
    const wing = s * 0.9
    const lift = flap ? -s * 0.5 : s * 0.3
    const col = hdDarken(ironDark, night ? 1 : 1.2)
    for (let k = 0; k <= 8; k++) {
      const f = k / 8
      hd.disk(bx - wing * f, by + lift * f * (1 - f) * 2 - s * 0.1 * f, Math.max(0.9, s * 0.12), col)
      hd.disk(bx + wing * f, by + lift * f * (1 - f) * 2 - s * 0.1 * f, Math.max(0.9, s * 0.12), col)
    }
    hd.disk(bx, by, Math.max(1.1, s * 0.2), col)
  }

  // Champ de Mars: perspective lawn with mown stripes and a converging gravel walk.
  for (let y = Math.floor(groundY); y < h; y++) {
    const f = clamp01((y - groundY) / (h - groundY || 1))
    for (let xx = 0; xx < w; xx++) {
      const stripe = Math.floor((xx - cx) / (s * (2 + f * 8)) + 100) % 2 === 0 ? 1 : 0.9
      const n = 0.92 + 0.12 * hash(xx >> 1, y >> 1)
      const g = hdDarken(hdMix(hdMix(lawn, horizonSky, 0.18 * (1 - f)), hdDarken(lawn, 0.8), f * 0.7), stripe * n)
      px[(y * w + xx) * 3] = g[0]
      px[(y * w + xx) * 3 + 1] = g[1]
      px[(y * w + xx) * 3 + 2] = g[2]
    }
    // Gravel walk, narrow at the horizon and widening toward the viewer.
    const half = s * (1.4 + f * 4.2)
    const pcol = hdMix(hdMix(path, horizonSky, 0.25 * (1 - f)), hdDarken(path, 0.85), f)
    for (let xx = Math.floor(cx - half); xx < Math.ceil(cx + half); xx++) {
      const edge = clamp01((half - Math.abs(xx + 0.5 - cx)) / 1.6)
      blend(xx, y, hdDarken(pcol, 0.95 + 0.1 * hash(xx >> 1, y >> 1)), edge)
    }
  }
  // Cross walk (shared "=" row of the text view).
  hd.rect(hd.X(20), hd.Y(22.1), hd.X(57), hd.Y(22.45), hdMix(path, lawn, 0.2))
  // Flower beds.
  for (let xx = 2; xx < EIFFEL_COLUMNS; xx++) {
    for (const [row, off] of [
      [21.3, 42],
      [23.2, 46],
    ] as const) {
      if ((xx * 5 + off) % 11 !== 0) continue
      const fx = hd.X(xx + 0.4)
      const fy = hd.Y(row)
      for (let k = 0; k < 5; k++)
        hd.disk(
          fx + (k - 2) * s * 0.28,
          fy + (k % 2) * s * 0.18,
          Math.max(1, s * 0.2),
          k % 2 ? hdMix(sparkle, lawn, 0.1) : hdMix([220, 90, 120], lawn, 0.15),
        )
    }
  }
  // Lamps with glow pools.
  for (const lampX of EIFFEL_LAMPS) {
    const lx = hd.X(lampX + 0.43)
    hd.rect(lx - 1, hd.Y(17.4), lx + 1, hd.Y(19.8), ironDark)
    hd.rect(lx - s * 0.5, hd.Y(17.3), lx + s * 0.5, hd.Y(17.3) + 2, ironDark)
    if (night) glow(lx, hd.Y(17), s * 4.5, lamp, 0.6)
    hd.disk(lx, hd.Y(17.05), night ? s * 0.45 : s * 0.3, lamp)
  }
  // Carousel: striped canopy, pole, and bulb ring.
  const ride = EIFFEL_CAROUSEL
  const rcx = hd.X(ride.x + 1.6)
  const baseY = hd.Y(ride.base + 0.2)
  hd.rect(rcx - s * 2.1, baseY, rcx + s * 2.1, baseY + s * 0.5, hdDarken(carousel, 0.6))
  hd.stroke(ride.x + 1.6, ride.top + 0.5, ride.x + 1.6, ride.base, Math.max(1.2, s * 0.14), ironDark)
  for (let i = 0; i < 4; i++) {
    const horse = rcx + Math.sin((t / 800) * Math.PI * 2 + i * 1.6) * s * 1.5
    hd.disk(
      horse,
      baseY - s * 0.9 + Math.sin(t / 250 + i * 2) * s * 0.2,
      s * 0.32,
      hdMix(carousel, [255, 240, 220], 0.4),
    )
  }
  for (let y = Math.floor(hd.Y(ride.top)); y < Math.ceil(hd.Y(ride.top + 0.9)); y++) {
    const f = (y - hd.Y(ride.top)) / (hd.Y(ride.top + 0.9) - hd.Y(ride.top))
    const half = s * (0.6 + f * 1.9)
    for (let xx = Math.floor(rcx - half); xx < Math.ceil(rcx + half); xx++) {
      hd.set(xx, y, Math.floor((xx - rcx + 100) / (s * 0.5)) % 2 ? carousel : hdMix(carousel, [255, 245, 235], 0.7))
    }
  }
  if (night) glow(rcx, baseY - s, s * 4, [255, 190, 150], 0.35)
  // Fountain: basin, layered jets that sway with the clock.
  const jet = EIFFEL_FOUNTAIN
  const jx = hd.X(jet.x)
  const jy = hd.Y(jet.base + 0.3)
  hd.blob(jx, jy, s * 2.2, s * 0.55, hdMix(ironDark, lawn, 0.3))
  hd.blob(jx, jy - 1, s * 1.8, s * 0.38, hdMix(fountain, horizonSky, 0.3))
  for (let k = 0; k < 3; k++) {
    for (let st = 0; st < 14; st++) {
      const f = st / 13
      const sway = Math.sin((t / 600) * Math.PI * 2 + k) * s * 0.15
      const spread = (k - 1) * s * 0.9 * f
      const yy = jy - Math.sin(f * Math.PI) * s * (2.6 - Math.abs(k - 1) * 0.7) + 0
      hd.disk(jx + spread + sway, yy, Math.max(0.9, s * 0.13), hdMix(fountain, [235, 248, 255], 0.5 + 0.3 * f))
    }
  }
  return hd.pixels
}
