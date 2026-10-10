import {
  BOROBUDUR_COLUMNS,
  BOROBUDUR_GROUND_TOP,
  BOROBUDUR_MIST_BANDS,
  BOROBUDUR_OFFERINGS,
  BOROBUDUR_PALMS,
  BOROBUDUR_PILGRIMS,
  BOROBUDUR_ROWS,
  BOROBUDUR_STUPA,
  BOROBUDUR_SUN,
  BOROBUDUR_TIERS,
  BOROBUDUR_VOLCANO,
  BOROBUDUR_COLORS,
  borobudurBirds,
  borobudurSkyRgb,
  type BorobudurStyle,
} from "./borobudur-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import { clamp01 } from "./atmos-paint"

const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}
const WHITE: RGB = [255, 255, 255]

/**
 * Freeform HD renderer. Merapi smokes behind a layered rainforest while
 * Borobudur rises in battered terraces with cornices, Buddha niches, a central
 * stairway, perforated bell stupas, and the great crowning stupa. The misty
 * variant wraps the terraces in drifting fog; noon adds cumulus and hard
 * sunlight. Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderBorobudurPixels(width: number, height: number, style: BorobudurStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, BOROBUDUR_COLUMNS, BOROBUDUR_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const { w, h, cw, ch } = hd
  const misty = style === "borobudur-mist"
  const c = BOROBUDUR_COLORS[style]
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const stupaStone = hdHex(c.stupa)
  const palms = hdHex(c.palms)
  const leaf = hdHex(c.leaf)
  const sun = hdHex(c.sun)
  const mist = hdHex(c.mist)
  const t = Math.max(0, elapsedMs)
  const loop = (t % 4800) / 4800
  const theta = loop * Math.PI * 2
  const groundY = hd.Y(BOROBUDUR_GROUND_TOP)
  const sunX = hd.X(BOROBUDUR_SUN.x)
  const sunY = hd.Y(BOROBUDUR_SUN.y + 0.45)
  const warm: RGB = misty ? [255, 240, 214] : [255, 226, 170]

  const blend = (i: number, color: RGB, alpha: number) => {
    if (alpha <= 0) return
    const a = alpha > 1 ? 1 : alpha
    hd.pixels[i] = Math.round(hd.pixels[i]! + (color[0] - hd.pixels[i]!) * a)
    hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! + (color[1] - hd.pixels[i + 1]!) * a)
    hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! + (color[2] - hd.pixels[i + 2]!) * a)
  }
  const softBlob = (cx: number, cy: number, rx: number, ry: number, color: RGB, alpha: number, pow = 1) => {
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, Math.ceil(cx + rx)); x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d < 1) blend((y * w + x) * 3, color, alpha * Math.pow(1 - smooth(0, 1, d), pow))
      }
    }
  }

  // Sky, sun bloom, and (noon) cumulus.
  hd.sky((v) => borobudurSkyRgb(style, v))
  softBlob(sunX, sunY, w * 0.45, h * 0.6, warm, misty ? 0.5 : 0.45, 1.3)
  const coreR = Math.max(3, Math.min(cw, ch) * (misty ? 1.2 : 0.95))
  hd.disk(sunX, sunY, coreR * 1.7, hdMix(sun, borobudurSkyRgb(style, 0.1), misty ? 0.55 : 0.7))
  hd.disk(sunX, sunY, coreR, sun)
  if (!misty) {
    const bank = (cx: number, cy: number, span: number) => {
      for (let k = 0; k < 7; k++) {
        const ox = (k - 3) * span * 0.14
        const oy = -Math.sin(k * 1.3) * ch * 0.25
        const rr = ch * (0.8 + 0.25 * Math.sin(k * 2.2 + 1))
        softBlob(cx + ox, cy + oy, rr * 1.6, rr, WHITE, 0.9, 0.55)
        softBlob(cx + ox, cy + oy + rr * 0.35, rr * 1.4, rr * 0.55, [186, 204, 224], 0.35, 0.7)
      }
    }
    bank(hd.X(10 + loop * 3), hd.Y(3.2), cw * 12)
    bank(hd.X(48 - loop * 2), hd.Y(1.6), cw * 10)
    bank(hd.X(24), hd.Y(6.4), cw * 8)
  } else {
    // Overcast streaks.
    for (let y = 0; y < Math.min(h, Math.ceil(groundY)); y++) {
      for (let x = 0; x < w; x++) {
        const k = 0.5 + 0.5 * Math.sin(x * 0.012 + y * 0.03 + Math.sin(y * 0.05) * 2)
        blend((y * w + x) * 3, mist, 0.14 * k)
      }
    }
  }

  // Layered hills and Merapi with a drifting plume.
  const hill = (base: number, amp: number, f: number, p: number, color: RGB, haze: number) => {
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      const top = hd.Y(base - amp * (0.5 + 0.5 * Math.sin(sx * f + p)) - amp * 0.35 * Math.sin(sx * f * 2.9 + p * 1.7))
      for (let y = Math.max(0, Math.floor(top)); y < Math.ceil(groundY); y++) {
        const depth = clamp01((y - top) / hd.Y(3))
        hd.set(x, y, hdMix(hdMix(color, borobudurSkyRgb(style, 0.8), haze), hdDarken(color, 0.85), depth * 0.5))
      }
    }
  }
  const coneBase = hdHex(c.volcano)
  hill(15.2, 2.6, 0.07, 2, hdMix(coneBase, hdHex(c.leaf), 0.3), misty ? 0.62 : 0.4)
  const vx = hd.X(BOROBUDUR_VOLCANO.x)
  const vTop = hd.Y(BOROBUDUR_VOLCANO.top - 0.3)
  for (let y = Math.floor(vTop); y < Math.ceil(groundY); y++) {
    const u = (y - vTop) / (groundY - vTop || 1)
    const half = hd.X(1.2) + Math.pow(u, 0.8) * hd.X(13.5)
    for (let x = Math.max(0, Math.floor(vx - half)); x < Math.min(w, Math.ceil(vx + half)); x++) {
      const side = (x + 0.5 - vx) / (half || 1)
      const lit = side > -0.1 ? 1 : 0.76
      const ridge = 1 + 0.07 * Math.sin((x + 0.5) * 0.09 + u * 6)
      const col = hdMix(hdDarken(coneBase, lit * ridge), borobudurSkyRgb(style, 0.8), (misty ? 0.5 : 0.28) + u * 0.25)
      hd.set(x, y, hdMix(col, warm, side > 0.2 ? 0.12 * (1 - u) : 0))
    }
  }
  // Smoke plume leaning away from the sun.
  for (let k = 0; k < 8; k++) {
    const px = vx - hd.X(0.7 * k) + Math.sin(theta + k) * cw * 0.35
    const py = vTop - ch * (0.4 + k * 0.45)
    softBlob(
      px,
      py,
      cw * (1.1 + k * 0.28),
      ch * (0.65 + k * 0.1),
      hdMix(mist, [120, 120, 126], 0.35),
      0.55 - k * 0.04,
      0.8,
    )
  }

  // Rainforest behind the temple, bumpy canopy with lit tops.
  const forestDark = hdDarken(leaf, misty ? 0.6 : 0.5)
  for (let i = 0; i < 90; i++) {
    const sx = i * 0.86 + ((i * 17) % 5) * 0.15
    const edge = Math.abs(sx - 38)
    const heightRows = 1.3 + clamp01((edge - 22) / 8) * 2.2 + ((i * 7) % 4) * 0.25
    const cx = hd.X(sx)
    const cy = hd.Y(BOROBUDUR_GROUND_TOP - heightRows * 0.5 - 0.6)
    const rx = cw * (1.7 + ((i * 3) % 3) * 0.3)
    const ry = ch * (heightRows * 0.42 + 0.35)
    hd.blob(cx, cy, rx, ry, hdMix(forestDark, leaf, ((i * 5) % 4) / 8))
    hd.blob(
      cx - rx * 0.2,
      cy - ry * 0.35,
      rx * 0.65,
      ry * 0.5,
      hdMix(leaf, misty ? [210, 220, 205] : [200, 230, 140], 0.12 + ((i * 3) % 3) * 0.06),
    )
  }
  for (let y = Math.floor(hd.Y(BOROBUDUR_GROUND_TOP - 4)); y < Math.ceil(groundY); y++) {
    const k = smooth(BOROBUDUR_GROUND_TOP - 4, BOROBUDUR_GROUND_TOP, (y + 0.5) / ch) * (misty ? 0.4 : 0.2)
    for (let x = 0; x < w; x++) blend((y * w + x) * 3, borobudurSkyRgb(style, 0.85), k * 0.4)
  }

  // Temple: battered terraces, cornices, niches with seated Buddhas, and stairs.
  const sandstone = (u: number, v: number, lit: number): RGB => {
    const course = 1 + 0.045 * Math.sin(v * 0.9)
    const tone = hdMix(stoneDark, stone, clamp01(0.55 + lit * 0.5))
    return hdDarken(hdMix(tone, warm, 0.12 * clamp01(lit)), course * (1 - 0.04 * Math.abs(Math.sin(u * 0.19))))
  }
  const tiers = [...BOROBUDUR_TIERS]
  const plinthY0 = hd.Y(BOROBUDUR_TIERS[0]![3] + 1)
  const plinthY1 = hd.Y(BOROBUDUR_GROUND_TOP - 0.4)
  // Base plinth below the first terrace.
  {
    const x0 = hd.X(BOROBUDUR_TIERS[0]![0] - 1.5)
    const x1 = hd.X(BOROBUDUR_TIERS[0]![1] + 2.5)
    for (let y = Math.floor(plinthY0); y < Math.ceil(plinthY1); y++) {
      const k = (y - plinthY0) / (plinthY1 - plinthY0 || 1)
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const lit = (x - x0) / (x1 - x0) - 0.35
        hd.set(x, y, hdDarken(sandstone(x, y, lit), 0.82 - k * 0.1))
      }
    }
    hd.rect(x0, plinthY0, x1, plinthY0 + Math.max(1, ch * 0.1), hdMix(stone, warm, 0.3))
  }
  const centerX = hd.X(38.5)
  tiers.forEach(([x0, x1, y0, y1], index) => {
    const top = hd.Y(y0)
    const bottom = hd.Y(y1 + 1)
    const xl = hd.X(x0 - 0.5 + 0)
    const xr = hd.X(x1 + 1.5)
    const slope = hd.X(0.55)
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      const k = (y - top) / (bottom - top || 1)
      const inset = slope * (1 - k)
      for (let x = Math.floor(xl + inset); x < Math.ceil(xr - inset); x++) {
        const lit = (x - xl) / (xr - xl) - 0.3 + 0.1 * (1 - k)
        hd.set(x, y, sandstone(x, y, lit))
      }
    }
    // Cornice and base molding.
    hd.rect(xl + slope - 3, top, xr - slope + 3, top + Math.max(2, ch * 0.2), hdMix(stone, warm, 0.35))
    hd.rect(xl + slope - 3, top + ch * 0.2, xr - slope + 3, top + ch * 0.28, hdDarken(stoneDark, 0.75))
    hd.rect(xl, bottom - ch * 0.2, xr, bottom, hdDarken(stoneDark, 0.9))
    hd.rect(xl, bottom - ch * 0.22, xr, bottom - ch * 0.18, hdMix(stone, warm, 0.2))
    // Pinnacle crenellations on the balustrade.
    for (let x = x0 + 1; x < x1 + 1; x += 1.5) {
      const px = hd.X(x)
      hd.blob(px, top - ch * 0.16, cw * 0.28, ch * 0.2, hdMix(stupaStone, warm, 0.2))
    }
    // Niches with seated Buddhas.
    const nicheTop = top + ch * 0.45
    const nicheBottom = bottom - ch * 0.42
    const nicheStep = index === 0 ? 3.2 : 2.8
    for (let x = x0 + 1.4; x < x1; x += nicheStep) {
      if (Math.abs(x - 38) < 2.4) continue
      const nx = hd.X(x)
      const half = cw * 0.55
      for (let y = Math.floor(nicheTop); y < Math.ceil(nicheBottom); y++) {
        const k = (y - nicheTop) / (nicheBottom - nicheTop || 1)
        const archK = k < 0.3 ? Math.sqrt(1 - (1 - k / 0.3) ** 2) : 1
        const hw = half * archK
        for (let xx = Math.floor(nx - hw); xx < Math.ceil(nx + hw); xx++) {
          hd.set(xx, y, hdDarken(stoneDark, 0.55 + 0.25 * (1 - k)))
        }
      }
      // Seated Buddha: halo-less head, shoulders, and folded legs.
      const body = hdMix(stone, warm, 0.25)
      hd.disk(nx, nicheTop + (nicheBottom - nicheTop) * 0.36, cw * 0.17, body)
      hd.blob(nx, nicheTop + (nicheBottom - nicheTop) * 0.62, cw * 0.32, (nicheBottom - nicheTop) * 0.2, body)
      hd.blob(nx, nicheBottom - (nicheBottom - nicheTop) * 0.12, cw * 0.46, (nicheBottom - nicheTop) * 0.1, body)
    }
  })
  // Central stairway with a gateway arch rising through every tier.
  {
    const sx0 = hd.X(37.2)
    const sx1 = hd.X(39.8)
    const top = hd.Y(BOROBUDUR_TIERS[2]![2] + 0.3)
    const bottom = plinthY1
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      const k = (y - top) / (bottom - top || 1)
      const flare = cw * (0.2 + 0.9 * k)
      for (let x = Math.floor(sx0 - flare); x < Math.ceil(sx1 + flare); x++) {
        const tread = Math.floor(y / (ch * 0.18)) % 2 === 0 ? 1 : 0.8
        hd.set(x, y, hdDarken(hdMix(stone, warm, 0.2), (0.78 + 0.22 * k) * tread))
      }
    }
    for (const tier of tiers) {
      const gx0 = hd.X(37.5)
      const gx1 = hd.X(39.5)
      const gy0 = hd.Y(tier[2] + 0.6)
      const gy1 = hd.Y(tier[3] + 1) - ch * 0.15
      for (let y = Math.floor(gy0); y < Math.ceil(gy1); y++) {
        const k = (y - gy0) / (gy1 - gy0 || 1)
        const arch = k < 0.35 ? Math.sqrt(1 - (1 - k / 0.35) ** 2) : 1
        const half = ((gx1 - gx0) / 2) * arch
        for (let x = Math.floor(centerX - half); x < Math.ceil(centerX + half); x++)
          hd.set(x, y, hdDarken(stoneDark, 0.5))
      }
    }
  }

  // Perforated bell stupas on the upper terraces and the crowning stupa.
  const bell = (cx: number, baseY: number, bw: number, bh: number, withSpire: boolean) => {
    for (let y = Math.floor(baseY - bh); y < Math.ceil(baseY); y++) {
      const k = (y - (baseY - bh)) / (bh || 1)
      const profile = k < 0.08 ? 0.15 : Math.sqrt(Math.max(0, 1 - ((1 - k) * 0.95 - 0.02) ** 2)) * (k > 0.88 ? 1.05 : 1)
      const half = bw * clamp01(profile)
      for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
        const u = (x + 0.5 - cx) / (half || 1)
        const hole =
          (x - Math.floor(cx)) % 4 === 0 &&
          Math.floor(y / (bh * 0.2)) % 2 === 0 &&
          y % Math.max(2, Math.round(bh * 0.2)) < 2 &&
          k > 0.15 &&
          k < 0.85
        const lit = 0.72 + 0.38 * (u * 0.6 + 0.4)
        const base = hdMix(stupaStone, warm, 0.18)
        hd.set(x, y, hole ? hdDarken(stoneDark, 0.8) : hdDarken(base, lit))
      }
    }
    hd.rect(cx - bw * 1.05, baseY - bh * 0.1, cx + bw * 1.05, baseY, hdDarken(stoneDark, 0.9))
    hd.rect(cx - bw * 0.9, baseY - bh * 0.14, cx + bw * 0.9, baseY - bh * 0.1, hdMix(stone, warm, 0.3))
    if (withSpire) {
      hd.rect(cx - bw * 0.35, baseY - bh * 1.12, cx + bw * 0.35, baseY - bh, hdMix(stone, warm, 0.2))
      for (let y = 0; y < bh * 0.55; y++) {
        const half = bw * 0.22 * (1 - y / (bh * 0.55))
        hd.rect(cx - half, baseY - bh * 1.12 - y, cx + half, baseY - bh * 1.12 - y + 1, hdMix(stupaStone, warm, 0.4))
      }
    }
  }
  const tier2 = BOROBUDUR_TIERS[1]!
  const tier3 = BOROBUDUR_TIERS[2]!
  for (let x = tier2[0] + 2; x <= tier2[1] - 1; x += 3.2) {
    if (Math.abs(x - 38) < 7) continue
    bell(hd.X(x + 0.5), hd.Y(tier2[2]) + 1, cw * 0.62, ch * 0.9, false)
  }
  for (let x = tier3[0] + 1.6; x <= tier3[1] + 1; x += 2.8) {
    if (Math.abs(x - 38.5) < 4) continue
    bell(hd.X(x), hd.Y(tier3[2]) + 1, cw * 0.55, ch * 0.8, false)
  }
  // Central dome: lotus pedestal, lattice bell, and a tiered spire.
  {
    const crown = BOROBUDUR_STUPA
    const cx = hd.X(crown.x + 0.5)
    const baseY = hd.Y(tier3[2]) + 1
    hd.rect(cx - cw * 3.4, baseY - ch * 0.3, cx + cw * 3.4, baseY, hdDarken(stoneDark, 0.9))
    hd.rect(cx - cw * 3.0, baseY - ch * 0.55, cx + cw * 3.0, baseY - ch * 0.3, hdMix(stone, warm, 0.2))
    bell(cx, baseY - ch * 0.55, cw * 2.5, ch * 2.3, true)
    for (let i = 0; i < 5; i++) {
      hd.rect(
        cx - cw * (0.9 - i * 0.12),
        hd.Y(crown.top) - i * 2,
        cx + cw * (0.9 - i * 0.12),
        hd.Y(crown.top) - i * 2 + 2,
        hdMix(stupaStone, warm, 0.35),
      )
    }
  }

  // Foreground lawn, shrubs, and a fog layer that drifts through the terraces.
  for (let y = Math.floor(groundY); y < h; y++) {
    const u = (y - groundY) / (h - groundY || 1)
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      const mow = 1 + 0.05 * Math.sin(sx * 0.55 + u * 9) * (0.5 + u)
      hd.set(x, y, hdDarken(hdMix(hdHex(c.ground), warm, 0.08 * (1 - u)), (1 - u * 0.25) * mow))
    }
  }
  for (let x = 2; x < BOROBUDUR_COLUMNS; x += 6.5) {
    hd.blob(hd.X(x), hd.Y(BOROBUDUR_GROUND_TOP + 0.1), cw * 1.5, ch * 0.42, hdDarken(leaf, 0.7), hdDarken(leaf, 0.55))
    hd.blob(hd.X(x - 0.2), hd.Y(BOROBUDUR_GROUND_TOP - 0.1), cw * 1.0, ch * 0.3, leaf)
  }
  const fog = (band: number, strength: number, speed: number, scale: number) => {
    const y0 = Math.floor(hd.Y(band - 1.2))
    const y1 = Math.ceil(hd.Y(band + 1.2))
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      const sy = (y + 0.5) / ch
      const profile = Math.exp(-(((sy - band) / 0.7) ** 2))
      for (let x = 0; x < w; x++) {
        const sx = (x + 0.5) / cw
        const wisp =
          0.5 + 0.5 * Math.sin(sx * scale + speed * theta + band) * Math.cos(sx * scale * 0.37 - theta * speed * 0.5)
        blend((y * w + x) * 3, mist, strength * profile * (0.35 + wisp * 0.65))
      }
    }
  }
  if (misty) {
    for (const band of BOROBUDUR_MIST_BANDS) fog(band + 0.5, 0.62, 1, 0.33)
    fog(BOROBUDUR_GROUND_TOP - 0.3, 0.55, 1, 0.21)
  } else {
    fog(BOROBUDUR_MIST_BANDS[1]! + 1.1, 0.16, 1, 0.27)
    fog(BOROBUDUR_GROUND_TOP - 0.4, 0.28, 1, 0.19)
  }

  // Flanking coconut palms, curved trunks with drooping fronds.
  BOROBUDUR_PALMS.forEach((trunkX, index) => {
    const dir = trunkX < BOROBUDUR_COLUMNS / 2 ? 1 : -1
    const baseX = hd.X(trunkX + 0.5)
    const baseY = hd.Y(BOROBUDUR_GROUND_TOP + 0.6)
    const crownX = baseX + dir * cw * 2.2 + Math.sin(theta + index * 2) * cw * 0.15
    const crownY = hd.Y(11.2)
    const ctrlX = baseX - dir * cw * 1.2
    const ctrlY = (baseY + crownY) / 2
    const trunkTone = hdDarken(hdMix(hdHex("#6a5a44"), leaf, 0.2), misty ? 0.85 : 0.75)
    for (let i = 0; i <= 90; i++) {
      const k = i / 90
      const px = (1 - k) * (1 - k) * baseX + 2 * (1 - k) * k * ctrlX + k * k * crownX
      const py = (1 - k) * (1 - k) * baseY + 2 * (1 - k) * k * ctrlY + k * k * crownY
      const r = cw * (0.42 - 0.14 * k)
      const ring = Math.sin(i * 0.9) > 0.5
      hd.disk(px, py, r, ring ? hdDarken(trunkTone, 0.8) : trunkTone)
      hd.disk(px + r * 0.4, py, r * 0.4, hdMix(trunkTone, warm, 0.25))
    }
    const fronds: [number, number, number][] = [
      [Math.PI * 0.96, 4.3, 1.9],
      [Math.PI * 0.75, 3.6, 0.5],
      [Math.PI * 0.5, 2.8, -0.2],
      [Math.PI * 0.25, 3.6, 0.5],
      [Math.PI * 0.04, 4.3, 1.9],
      [Math.PI * 1.15, 3, 2.8],
      [-Math.PI * 0.15, 3, 2.8],
    ]
    fronds.forEach(([angle, length, droop], fi) => {
      const sway = Math.sin(theta + fi * 0.8 + index * 1.7) * ch * 0.12
      const tipX = crownX + Math.cos(angle) * length * cw
      const tipY = crownY - Math.sin(angle) * length * ch * 0.45 + droop * ch + sway
      const midX = crownX + Math.cos(angle) * length * cw * 0.5
      const midY = crownY - Math.sin(angle) * length * ch * 0.45 - ch * 0.6
      const shade = fi % 2 === 0 ? palms : hdDarken(palms, 0.75)
      for (let i = 0; i <= 26; i++) {
        const k = i / 26
        const px = (1 - k) * (1 - k) * crownX + 2 * (1 - k) * k * midX + k * k * tipX
        const py = (1 - k) * (1 - k) * crownY + 2 * (1 - k) * k * midY + k * k * tipY
        hd.disk(px, py, Math.max(0.8, cw * 0.1 * (1 - k)), shade)
        const lenLeaf = ch * 0.8 * Math.sin(Math.min(1, k * 1.1 + 0.1) * Math.PI) ** 0.7 + 2
        for (const side of [-1, 1]) {
          const ex = px + side * lenLeaf * 0.25
          const ey = py + lenLeaf * 0.9
          const steps = Math.ceil(Math.hypot(ex - px, ey - py))
          for (let s = 0; s <= steps; s++) {
            const q = s / steps
            hd.set(
              Math.round(px + (ex - px) * q),
              Math.round(py + (ey - py) * q),
              q < 0.6 ? hdMix(shade, leaf, 0.2) : hdDarken(shade, 0.85),
            )
          }
        }
      }
    })
    hd.disk(crownX, crownY + ch * 0.25, cw * 0.28, hdDarken(trunkTone, 0.7))
  })

  // Pilgrims on the lowest terrace, a hint of life in the stonework.
  for (const climber of BOROBUDUR_PILGRIMS) {
    const px = hd.X(climber + 0.5)
    const py = hd.Y(BOROBUDUR_TIERS[0]![2] - 0.1)
    const robe = hdHex(c.pilgrim)
    hd.rect(px - cw * 0.14, py - ch * 0.3, px + cw * 0.14, py + ch * 0.38, robe)
    hd.disk(px, py - ch * 0.42, cw * 0.13, hdMix(robe, WHITE, 0.25))
  }
  for (const bloom of BOROBUDUR_OFFERINGS) {
    hd.disk(hd.X(bloom + 0.5), hd.Y(BOROBUDUR_TIERS[2]![3] + 0.45), Math.max(1.5, cw * 0.12), hdHex(c.offer))
  }

  // Swifts.
  for (const swift of borobudurBirds(elapsedMs)) {
    const bx = hd.X(swift.x + 0.5)
    const by = hd.Y(swift.y + 0.5)
    const flap = Math.floor(t / 180) % 2 === 0 ? -ch * 0.25 : ch * 0.2
    const bird = hdHex(c.bird)
    for (const side of [-1, 1]) {
      const steps = Math.ceil(cw * 0.7)
      for (let s = 0; s <= steps; s++) {
        const q = s / steps
        hd.disk(bx + side * q * cw * 0.7, by + flap * q * (1 - q * 0.3), Math.max(0.8, cw * 0.05), bird)
      }
    }
  }
  return hd.pixels
}
