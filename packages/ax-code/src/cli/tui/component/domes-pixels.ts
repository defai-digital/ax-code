import { hash, vnoise } from "./atmos-paint"
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
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Freeform HD renderer. Three ribbed, gilded onion domes rise from arcaded
 * drums over a plastered church with pilasters, arched windows, and a
 * stepped door. The snow variant glows warm in its windows under an overcast
 * sky with layered snowfall and drifted ground; the clear variant adds sun,
 * clouds, and a green meadow. Pure and deterministic from `elapsedMs`.
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
  const door = hdHex(c.door)
  const ground = hdHex(c.ground)
  const w = hd.w
  const h = hd.h
  const px = hd.pixels
  const s = Math.max(1, Math.min(hd.cw, hd.ch / 2))
  const t = Math.max(0, elapsedMs)
  const horizonY = hd.Y(DOMES_GROUND_TOP)
  const skyAt = (y: number) => domesSkyRgb(style, clamp01(y / (h - 1 || 1)))

  const blend = (x: number, y: number, color: RGB, a: number) => {
    if (a <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    px[i] = Math.round(px[i]! + (color[0] - px[i]!) * a)
    px[i + 1] = Math.round(px[i + 1]! + (color[1] - px[i + 1]!) * a)
    px[i + 2] = Math.round(px[i + 2]! + (color[2] - px[i + 2]!) * a)
  }
  const fillRect = (x0: number, y0: number, x1: number, y1: number, color: RGB, a = 1) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) blend(x, y, color, a)
    }
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

  hd.sky((v) => domesSkyRgb(style, v))
  const haze = hdMix(skyAt(horizonY), [255, 255, 255], 0.35)
  if (!snow) {
    glow(hd.X(64), hd.Y(2.2), s * 14, [255, 248, 220], 0.7)
    hd.disk(hd.X(64), hd.Y(2.2), s * 1.7, [255, 252, 235])
    for (const [gx, gy, cw] of [
      [8, 3.5, 10],
      [30, 1.8, 8],
      [48, 5.4, 9],
    ] as const) {
      for (let k = 0; k < 8; k++) {
        const kk = k - 3.5
        glow(
          hd.X(gx + kk * cw * 0.12 + (t / 1000) * 0.15),
          hd.Y(gy + Math.sin(k * 2.1) * 0.3),
          s * (2.8 + Math.cos(kk * 0.5) * 1.2),
          [255, 255, 255],
          0.6,
        )
      }
    }
  } else {
    // Overcast: soft streaked cloud banks.
    for (let y = 0; y < Math.ceil(horizonY); y++) {
      for (let x = 0; x < w; x++) {
        const n = vnoise(x / (s * 9) + t / 60000, y / (s * 3)) - 0.5
        blend(x, y, [235, 240, 250], clamp01(0.25 + n * 0.5) * 0.45)
      }
    }
  }
  // Distant tree line and hills dissolving into haze.
  for (let x = 0; x < w; x++) {
    const hill = horizonY - s * (4.5 + 3 * vnoise(x / (s * 14), 3) + 1.2 * vnoise(x / (s * 4), 9))
    for (let y = Math.max(0, Math.floor(hill)); y < Math.min(h, Math.ceil(horizonY)); y++) {
      blend(x, y, hdMix(hdMix(pines, haze, 0.72), skyAt(y), 0.15), 1)
    }
    const near = horizonY - s * (2.2 + 1.8 * vnoise(x / (s * 5), 21) + 0.8 * hash(x >> 2, 4))
    for (let y = Math.max(0, Math.floor(near)); y < Math.min(h, Math.ceil(horizonY)); y++) {
      blend(x, y, hdMix(hdDarken(pines, 0.9), haze, 0.5), 1)
    }
  }

  const wallTop = hd.Y(DOMES_BASE_TOP)
  const wallBottom = hd.Y(DOMES_BASE_BOTTOM + 1)
  const wx0 = hd.X(12)
  const wx1 = hd.X(65)
  const sunSide = snow ? 0 : 1 // clear: sun on the right; snow: flat diffuse light

  // Domes and drums (behind the wall so the cornice overlaps their feet).
  DOMES_DOME.forEach((bulb, domeIndex) => {
    const cx = hd.X(bulb.x + 0.5)
    const drumHalf = (bulb.r * 0.5 + 2) * hd.cw * 0.9
    const drumTop = hd.Y(DOMES_BASE_TOP - 1.7)
    const bulbBase = drumTop
    const bulbH = (bulb.r + 0.4) * hd.ch * 1.15
    const wMax = bulb.r * hd.cw * 0.92
    // Drum with arcaded windows and pilasters.
    for (let y = Math.floor(drumTop); y < Math.ceil(wallTop + s * 0.4); y++) {
      for (let x = Math.floor(cx - drumHalf); x < Math.ceil(cx + drumHalf); x++) {
        const u = (x + 0.5 - cx) / drumHalf
        const lam = clamp01(0.62 + 0.3 * (sunSide ? u : -u * 0.2) - 0.18 * Math.abs(u) ** 3)
        blend(x, y, hdDarken(hdMix(shade, drum, 0.4 + 0.5 * lam), 0.7 + 0.5 * lam), 1)
      }
    }
    const slots = bulb.r > 4 ? 5 : 3
    for (let k = 0; k < slots; k++) {
      const sx = cx + ((k + 0.5) / slots - 0.5) * drumHalf * 1.7
      const sw = ((drumHalf * 1.7) / slots) * 0.28
      fillRect(sx - sw, drumTop + s * 0.9, sx + sw, wallTop - s * 0.1, hdDarken(shade, 0.35))
      hd.disk(sx, drumTop + s * 0.9, sw, hdDarken(shade, 0.35))
      if (snow) fillRect(sx - sw * 0.6, drumTop + s * 1.0, sx + sw * 0.6, wallTop - s * 0.2, hdHex(c.glow), 0.35)
    }
    fillRect(cx - drumHalf - 2, drumTop - 1, cx + drumHalf + 2, drumTop + s * 0.55, hdDarken(drum, 1.15))
    fillRect(cx - drumHalf - 2, drumTop + s * 0.55, cx + drumHalf + 2, drumTop + s * 0.75, hdDarken(drum, 0.55))
    if (snow) fillRect(cx - drumHalf - 3, drumTop - 3, cx + drumHalf + 3, drumTop, [244, 248, 255], 0.95)
    // Onion bulb with ribs, a lit flank, a specular streak, and a gilded neck ring.
    const halfAt = (f: number) => {
      const bulge = 0.3
      if (f < bulge) return wMax * (0.7 + 0.3 * Math.sin((f / bulge) * (Math.PI / 2)))
      const u = (f - bulge) / (1 - bulge)
      return wMax * Math.pow(Math.cos(u * (Math.PI / 2)), 1.35)
    }
    for (let y = Math.floor(bulbBase - bulbH); y < Math.ceil(bulbBase); y++) {
      const f = (bulbBase - y) / bulbH
      const half = halfAt(f)
      if (half < 0.3) continue
      for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
        const u = (x + 0.5 - cx) / (half || 1)
        if (Math.abs(u) > 1) continue
        const nz = Math.sqrt(1 - u * u)
        // Light from the upper left (clear: upper right, near the sun).
        const light = sunSide ? 0.35 + 0.65 * clamp01(nz * 0.5 + u * 0.6) : 0.35 + 0.65 * clamp01(nz * 0.55 - u * 0.45)
        const rib = 0.9 + 0.1 * Math.cos(Math.asin(Math.max(-1, Math.min(1, u))) * 9)
        let col = hdMix(hdDarken(shade, 0.8), hdMix(dome, [180, 220, 255], 0.2), clamp01(light * rib))
        col = hdDarken(col, 0.85 + 0.2 * (1 - f))
        // Specular streak and rim light.
        const hx = sunSide ? 0.42 : -0.38
        const spec = Math.exp(-Math.pow((u - hx) / 0.12, 2)) * clamp01(1 - Math.abs(f - 0.34) * 2.2)
        col = hdMix(col, [235, 248, 255], spec * 0.6)
        if (Math.abs(u) > 0.93) col = hdMix(col, hdDarken(shade, 0.5), 0.5)
        blend(x, y, col, 1)
      }
    }
    // Gilded neck ring.
    fillRect(cx - wMax * 0.74, bulbBase - s * 0.45, cx + wMax * 0.74, bulbBase, hdDarken(cross, 0.95))
    fillRect(cx - wMax * 0.74, bulbBase - s * 0.45, cx + wMax * 0.74, bulbBase - s * 0.3, hdDarken(cross, 1.25))
    // Tip ball and a gilded cross.
    const tipY = bulbBase - bulbH
    hd.disk(cx, tipY - s * 0.2, s * 0.5, hdDarken(cross, 1.05))
    hd.disk(cx - s * 0.15, tipY - s * 0.35, s * 0.2, [255, 244, 190])
    const crossH = s * 3.4
    hd.stroke(
      bulb.x + 0.5,
      (tipY - s * 0.5) / hd.ch,
      bulb.x + 0.5,
      (tipY - s * 0.5 - crossH) / hd.ch,
      Math.max(1.1, s * 0.14),
      cross,
    )
    for (const [dy, len] of [
      [crossH * 0.62, 0.9],
      [crossH * 0.9, 0.55],
    ] as const) {
      const yy = (tipY - s * 0.5 - dy) / hd.ch
      hd.stroke(
        bulb.x + 0.5 - (len * s) / hd.cw,
        yy,
        bulb.x + 0.5 + (len * s) / hd.cw,
        yy,
        Math.max(1, s * 0.11),
        cross,
      )
    }
    // Sparkle glint on a gold cross, one beat apart.
    if (snow && domesGlint(elapsedMs, domeIndex)) {
      const gx = hd.X(bulb.x - 0.5)
      const gy = hd.Y(DOMES_BASE_TOP - bulb.r - 2.5)
      glow(gx, gy, s * 3, [255, 240, 180], 0.7)
      for (let k = -5; k <= 5; k++) {
        blend(Math.round(gx + k * s * 0.3), Math.round(gy), [255, 252, 225], 0.9 * (1 - Math.abs(k) / 6))
        blend(Math.round(gx), Math.round(gy + k * s * 0.3), [255, 252, 225], 0.9 * (1 - Math.abs(k) / 6))
      }
    }
  })

  // Church wall: plaster with gradient and texture, cornice, pilasters, plinth.
  for (let y = Math.floor(wallTop); y < Math.ceil(wallBottom); y++) {
    const f = (y - wallTop) / (wallBottom - wallTop || 1)
    for (let x = Math.floor(wx0); x < Math.ceil(wx1); x++) {
      const n = 0.96 + 0.08 * vnoise((x / s) * 0.5, (y / s) * 0.5)
      const base = hdMix(wall, hdDarken(wall, 0.9), f * 0.8)
      blend(x, y, hdDarken(base, n), 1)
    }
  }
  // Cornice with a deep shadow beneath and snow along its top.
  fillRect(wx0 - s * 0.4, wallTop - 1, wx1 + s * 0.4, wallTop + s * 0.75, hdDarken(wall, 1.05))
  fillRect(wx0 - s * 0.4, wallTop + s * 0.75, wx1 + s * 0.4, wallTop + s * 0.95, hdDarken(wallDark, 0.65))
  for (let k = 0; k < s * 1.6; k++)
    fillRect(wx0, wallTop + s * 0.95 + k, wx1, wallTop + s * 0.95 + k + 1, wallDark, 0.35 * (1 - k / (s * 1.6)))
  if (snow) {
    for (let x = Math.floor(wx0 - s * 0.4); x < Math.ceil(wx1 + s * 0.4); x++) {
      const bump = vnoise((x / s) * 0.8, 31) * s * 0.7
      fillRect(x, wallTop - 1 - bump, x + 1, wallTop, [246, 250, 255])
    }
  }
  // Corner buttresses and pilasters between windows.
  for (const [px0, pw] of [
    [12, 1.15],
    [63.85, 1.15],
    [25, 0.7],
    [35, 0.7],
    [45, 0.7],
    [55, 0.7],
  ] as const) {
    const x0 = hd.X(px0)
    const x1 = hd.X(px0 + pw)
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const u = (x - x0) / (x1 - x0 || 1)
      fillRect(x, wallTop + s * 0.95, x + 1, wallBottom, hdDarken(wallDark, 0.9 + 0.3 * (1 - u)), 0.75)
    }
  }
  // Arched windows with frames, sills, and interior glow or sky reflection.
  const winPane = snow ? hdHex(c.glow) : hdMix(hdHex("#9cc2dc"), wallDark, 0.1)
  for (const wxCell of [20, 30, 40, 50]) {
    const x0 = hd.X(wxCell - 0.1)
    const x1 = hd.X(wxCell + 2.1)
    const yA = hd.Y(14.1)
    const yB = hd.Y(16.15)
    const cxw = (x0 + x1) / 2
    const half = (x1 - x0) / 2
    // Frame
    fillRect(x0 - 2, yA + half - 1, x1 + 2, yB + 2, hdDarken(wall, 1.1))
    hd.blob(cxw, yA + half - 1, half + 2, half + 2, hdDarken(wall, 1.1))
    for (let y = Math.floor(yA - 1); y < Math.ceil(yB); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const inArch = y >= yA + half ? true : Math.hypot(x + 0.5 - cxw, y + 0.5 - (yA + half)) <= half
        if (!inArch) continue
        const f = clamp01((y - yA) / (yB - yA))
        let col = snow ? hdMix(winPane, [255, 150, 60], f * 0.5) : hdMix(winPane, hdDarken(winPane, 0.7), f * 0.7)
        col = hdDarken(col, 0.85 + 0.25 * (1 - f))
        blend(x, y, col, 1)
      }
    }
    // Mullion and transom.
    fillRect(cxw - 1, yA, cxw + 1, yB, hdDarken(wall, 0.9))
    fillRect(x0, yA + (yB - yA) * 0.5, x1, yA + (yB - yA) * 0.5 + 1.5, hdDarken(wall, 0.9))
    fillRect(x0 - 3, yB, x1 + 3, yB + s * 0.35, hdDarken(wallDark, 1.1))
    if (snow) {
      glow(cxw, (yA + yB) / 2, s * 4.5, [255, 190, 90], 0.22)
      fillRect(x0 - 3, yB - 2, x1 + 3, yB, [246, 250, 255])
    }
  }
  // Arched door with steps and lantern.
  const dx0 = hd.X(36.9)
  const dx1 = hd.X(39.1)
  const dcx = (dx0 + dx1) / 2
  const dTop = hd.Y(15.4)
  const dBot = hd.Y(DOMES_BASE_BOTTOM + 1)
  for (let y = Math.floor(dTop - s); y < Math.ceil(dBot); y++) {
    for (let x = Math.floor(dx0 - s * 0.3); x < Math.ceil(dx1 + s * 0.3); x++) {
      const inside = x >= dx0 && x < dx1
      const arch = y < dTop + (dx1 - dx0) / 2
      const rr = Math.hypot(x + 0.5 - dcx, y + 0.5 - (dTop + (dx1 - dx0) / 2))
      const inArch = arch ? rr <= (dx1 - dx0) / 2 : inside
      const inFrame = arch ? rr <= (dx1 - dx0) / 2 + s * 0.3 : x >= dx0 - s * 0.3 && x < dx1 + s * 0.3
      if (!inFrame) continue
      if (!inArch) {
        blend(x, y, hdDarken(wall, 1.1), 1)
        continue
      }
      const plank = Math.floor((x - dx0) / (s * 0.55))
      blend(x, y, hdDarken(door, 0.85 + 0.35 * hash(plank, 4) - 0.15 * ((y - dTop) / (dBot - dTop || 1))), 1)
      if ((x - dx0) % (s * 0.55) < 1) blend(x, y, [0, 0, 0], 0.35)
    }
  }
  hd.disk(dcx + s * 0.5, dTop + s * 2.2, Math.max(1, s * 0.13), cross)
  for (let k = 0; k < 3; k++)
    fillRect(
      dx0 - s * (0.6 + k * 0.4),
      dBot - s * 0.35 * (3 - k),
      dx1 + s * (0.6 + k * 0.4),
      dBot - s * 0.35 * (2 - k),
      hdDarken(wallDark, 0.9 + k * 0.1),
    )
  if (snow) glow(dcx, dTop + s * 2, s * 5, [255, 190, 100], 0.3)
  // Plinth.
  fillRect(wx0, wallBottom - s * 0.5, wx1, wallBottom, hdDarken(wallDark, 0.8))

  // Chimney with drifting smoke.
  const chX0 = hd.X(DOMES_CHIMNEY_X)
  fillRect(chX0, hd.Y(10), hd.X(DOMES_CHIMNEY_X + 2), hd.Y(12), hdDarken(wallDark, 0.8))
  fillRect(chX0 - 2, hd.Y(10) - 3, hd.X(DOMES_CHIMNEY_X + 2) + 2, hd.Y(10) + 1, hdDarken(wallDark, 1))
  const smoke = hdHex(c.smoke)
  for (let i = 0; i < 8; i++) {
    const f = (t / 4000 + i / 8) % 1
    const sx = chX0 + s + f * s * 9 + Math.sin(f * 6 + i) * s * 0.6
    const sy = hd.Y(10) - f * s * 11
    glow(sx, sy, s * (1.2 + f * 2.6), snow ? hdMix(smoke, [180, 188, 205], 0.3) : smoke, 0.45 * (1 - f))
  }

  // Bell arch left of the wall with its bell.
  const bell = DOMES_BELL
  const bx0 = hd.X(bell.x)
  const bx1 = hd.X(bell.x + 4)
  fillRect(bx0, hd.Y(bell.top + 0.3), bx1, hd.Y(bell.top + 0.75), hdDarken(wallDark, 0.95))
  fillRect(bx0 - 2, hd.Y(bell.top), bx1 + 2, hd.Y(bell.top + 0.3), hdDarken(wall, 1))
  for (const px0 of [bx0, bx1 - s * 0.6])
    fillRect(px0, hd.Y(bell.top + 0.75), px0 + s * 0.6, hd.Y(bell.base + 1), hdMix(wallDark, wall, 0.3))
  const swing = Math.sin((t / 2400) * Math.PI * 2) * 0.18
  const bellX = (bx0 + bx1) / 2
  const bellY = hd.Y(bell.top + 0.8)
  for (let i = 0; i < s * 2.4; i++) {
    const f = i / (s * 2.4)
    const half = s * (0.25 + 0.65 * Math.pow(f, 0.7))
    const x = bellX + Math.sin(swing) * i
    fillRect(
      x - half,
      bellY + i + 2,
      x + half,
      bellY + i + 3,
      hdMix(hdDarken(cross, 1.1), hdDarken(cross, 0.6), 1 - 0.3 * Math.abs(Math.sin(f * 3))),
    )
  }
  if (snow) fillRect(bx0 - 2, hd.Y(bell.top) - 3, bx1 + 2, hd.Y(bell.top), [246, 250, 255])

  // Ground: snow drifts with blue shadows (snow), or meadow (clear).
  const gy = horizonY
  for (let y = Math.floor(gy); y < h; y++) {
    const f = (y - gy) / (h - gy || 1)
    for (let x = 0; x < w; x++) {
      const n = vnoise(x / (s * 5), y / (s * 1.2))
      if (snow) {
        const base = hdMix([236, 242, 252], ground, 0.3 + 0.2 * f)
        const shadow = clamp01(n - 0.5) * 0.35
        const col = hdMix(base, [150, 170, 208], shadow + (f > 0.55 ? (f - 0.55) * 0.3 : 0))
        const sparkle = hash(x, y) > 0.997 ? 1 : 0
        blend(x, y, hdMix(col, [255, 255, 255], sparkle), 1)
      } else {
        const blade = hash(x >> 1, y >> 1) * 0.14
        blend(
          x,
          y,
          hdMix(hdMix(ground, [120, 170, 110], 0.35), hdDarken(ground, 0.7), clamp01(f * 0.8 + n * 0.2 - 0.1 - blade)),
          1,
        )
      }
    }
  }
  // Shadow of the church on the ground.
  for (let k = 0; k < s * 2.2; k++)
    fillRect(wx0, gy + k, wx1, gy + k + 1, snow ? [110, 130, 175] : [40, 70, 50], 0.28 * (1 - k / (s * 2.2)))
  // Trodden path from the door with footprints.
  for (let y = Math.floor(gy); y < h; y++) {
    const f = (y - gy) / (h - gy || 1)
    const half = s * (1.5 + f * 4)
    const pathX = dcx + Math.sin(f * 3) * s * 1.5
    for (let x = Math.floor(pathX - half); x < Math.ceil(pathX + half); x++) {
      const e = clamp01((half - Math.abs(x + 0.5 - pathX)) / (s * 0.9))
      blend(x, y, snow ? [200, 212, 232] : [160, 150, 110], 0.55 * e)
    }
  }
  for (const [fx, fy] of [
    [37.5, DOMES_GROUND_TOP + 0.45],
    [38.5, DOMES_GROUND_TOP + 1.45],
    [37.5, DOMES_GROUND_TOP + 2.45],
  ] as const) {
    hd.blob(
      hd.X(fx),
      hd.Y(fy),
      Math.max(1.4, s * 0.28),
      Math.max(1.1, s * 0.4),
      snow ? [150, 168, 205] : [120, 112, 80],
    )
  }
  // Picket fence with snow caps.
  for (let x = 2; x < DOMES_COLUMNS - 2; x += 3) {
    const fx = hd.X(x + 0.2)
    const top = hd.Y(DOMES_GROUND_TOP - 1.1)
    const bot = hd.Y(DOMES_GROUND_TOP + 0.15)
    fillRect(fx - s * 0.14, top, fx + s * 0.14, bot, hdMix(wallDark, wall, 0.4))
    if (snow) fillRect(fx - s * 0.22, top - 2, fx + s * 0.22, top + 1, [248, 251, 255])
    else hd.disk(fx, top, s * 0.15, hdMix(wallDark, wall, 0.4))
  }
  fillRect(
    hd.X(2),
    hd.Y(DOMES_GROUND_TOP - 0.7),
    hd.X(DOMES_COLUMNS - 2),
    hd.Y(DOMES_GROUND_TOP - 0.55),
    hdMix(wallDark, wall, 0.4),
  )
  // Woodpile with stacked log ends.
  const wp = hd.X(8)
  const wy = hd.Y(18)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4 - row; col++) {
      const lx = wp + s * 0.5 + col * s * 0.8 + row * s * 0.4
      const ly = wy - s * 0.4 - row * s * 0.7
      hd.disk(lx, ly, s * 0.38, hdDarken(hdHex(c.wood), 0.8))
      hd.disk(lx, ly, s * 0.24, hdMix(hdHex(c.wood), [220, 180, 130], 0.5))
    }
  }
  if (snow) fillRect(wp, wy - s * 2.1, wp + s * 3.4, wy - s * 1.8, [246, 250, 255])

  // Pines: tiered boughs, snow on every tier, trunk.
  for (const pine of DOMES_PINES) {
    const pcx = hd.X(pine + 0.5)
    const base = hd.Y(18.2)
    fillRect(pcx - s * 0.25, base - s * 1.5, pcx + s * 0.25, base, hdDarken(pines, 0.5))
    const tiers = 5
    for (let k = 0; k < tiers; k++) {
      const ty = base - s * 1.2 - k * s * 1.7
      const half0 = s * (3.2 - k * 0.45)
      for (let y = Math.floor(ty - s * 2.4); y < Math.ceil(ty); y++) {
        const f = (y - (ty - s * 2.4)) / (s * 2.4)
        const half = half0 * f
        for (let x = Math.floor(pcx - half); x <= Math.ceil(pcx + half); x++) {
          const u = (x - pcx) / (half || 1)
          let col = hdMix(
            hdDarken(pines, 0.7),
            hdDarken(pines, 1.3),
            clamp01(0.5 - u * 0.4 * (sunSide ? -1 : 1) + (hash(x, y) - 0.5) * 0.3),
          )
          if (snow && f < 0.5 && hash(x >> 1, y >> 1) < 0.78 - f * 0.9) col = hdMix(col, [244, 248, 255], 0.9)
          blend(x, y, col, 1)
        }
      }
    }
  }

  if (snow) {
    // Layered snowfall: far fine specks, shared model flakes, big near flakes.
    for (let i = 0; i < 90; i++) {
      const spd = 0.35 + hash(i, 1) * 0.5
      const fx = (((hash(i, 2) * w + Math.sin(t / 900 + i) * s * 1.2 + t * 0.004 * s) % w) + w) % w
      const fy = (hash(i, 3) * h + t * 0.03 * s * spd) % h
      blend(Math.floor(fx), Math.floor(fy), [255, 255, 255], 0.45 + 0.35 * spd)
    }
    const flake = hdHex(c.flake)
    for (const bit of domesFlakes(elapsedMs)) {
      const fx = hd.X(bit.x + 0.5)
      const fy = hd.Y(bit.y + 0.5)
      glow(fx, fy, s * 0.8, flake, 0.5)
      hd.disk(fx, fy, Math.max(1.2, s * 0.14), flake)
    }
    for (const bit of domesFlakesBig(elapsedMs)) {
      const fx = hd.X(bit.x + 0.5)
      const fy = hd.Y(bit.y + 0.5)
      glow(fx, fy, s * 1.5, flake, 0.5)
      hd.disk(fx, fy, Math.max(2, s * 0.25), flake)
    }
  }
  return px
}
