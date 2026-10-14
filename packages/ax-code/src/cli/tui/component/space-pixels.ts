import { blendPx, clamp01, fillPoly, hash2 } from "./atmos-paint"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  SPACE_COLUMNS,
  SPACE_CRATERS,
  SPACE_COLORS,
  SPACE_HORIZON_ROW,
  SPACE_NEBULAE,
  SPACE_ROCKET_BASE,
  SPACE_ROCKET_TOP,
  SPACE_ROCKET_X,
  SPACE_ROWS,
  SPACE_SATELLITE_ROW,
  SPACE_STARS,
  spaceFlicker,
  spaceLaunchProgress,
  spacePhase,
  spaceSkyRgb,
  spaceTwinkle,
  type SpaceStyle,
} from "./space-view-model"

/**
 * Freeform HD renderer. An ocean planet curves under an atmosphere line with
 * storm swirls (the former crater sites) and a terminator. The launch scene
 * climbs a shaded multi-stage rocket on a long flame with an expanding
 * exhaust trail into a dawn sky; the drift scene floats a solar-panel
 * satellite past a soft nebula and a shooting star. Everything derives from
 * `elapsedMs`; the environment loops while the launch ascends once and holds.
 */
export function renderSpacePixels(width: number, height: number, style: SpaceStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, SPACE_COLUMNS, SPACE_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const launch = style === "space-launch"
  const c = SPACE_COLORS[style]
  const t = Math.max(0, elapsedMs)
  const phase = spacePhase(t)
  const theta = phase * Math.PI * 2
  const S = Math.min(hd.ch, hd.cw * 2)
  const star = hdHex(c.star)
  const planet = hdHex(c.planet)
  const horizon = hdHex(c.horizon)
  const hull = hdHex(c.hull)
  const hullDark = hdHex(c.hullDark)
  const flame = hdHex(c.flame)
  const crest = hd.Y(SPACE_HORIZON_ROW)
  const pixels = hd.pixels

  /** atmos-paint glow twin with identical math. Every write in this pipeline
   * lands on integer pixels, so blending where alpha < 1/510 is provably the
   * identity and can be skipped (per pixel and via the row/column window). */
  const glowFast = (cx: number, cy: number, radius: number, color: RGB, strength: number, squash = 1) => {
    if (radius <= 0 || strength <= 0) return
    const ry = radius * squash
    const xa = Math.max(0, Math.floor(cx - radius))
    const xb = Math.min(hd.w - 1, Math.ceil(cx + radius))
    const ya = Math.max(0, Math.floor(cy - ry))
    const yb = Math.min(hd.h - 1, Math.ceil(cy + ry))
    const cr = color[0]!
    const cg = color[1]!
    const cb = color[2]!
    const dSkip = 1 - Math.sqrt(1 / (510 * strength)) - 1e-9
    for (let y = ya; y <= yb; y++) {
      const dy = (y + 0.5 - cy) / ry
      if (dy >= dSkip || dy <= -dSkip) continue
      const fxSpan = Math.sqrt(Math.max(0, dSkip * dSkip - dy * dy)) * radius + 1
      const xlo = Math.max(xa, Math.ceil(cx - fxSpan))
      const xhi = Math.min(xb, Math.floor(cx + fxSpan))
      let i = (y * hd.w + xlo) * 3
      for (let x = xlo; x <= xhi; x++, i += 3) {
        const d = Math.hypot((x + 0.5 - cx) / radius, dy)
        if (d >= dSkip) continue
        const f = 1 - d
        const alpha = strength * f * f
        if (alpha <= 0) continue
        const a = alpha > 1 ? 1 : alpha
        const p0 = pixels[i]!
        pixels[i] = Math.round(p0 + (cr - p0) * a)
        const p1 = pixels[i + 1]!
        pixels[i + 1] = Math.round(p1 + (cg - p1) * a)
        const p2 = pixels[i + 2]!
        pixels[i + 2] = Math.round(p2 + (cb - p2) * a)
      }
    }
  }

  hd.sky((v) => spaceSkyRgb(style, v))
  // Backdrop glare and distant stars (fading toward a bright horizon).
  if (launch) {
    glowFast(hd.X(20), crest, hd.cw * 40, hdHex("#ffb05a"), 0.6, 0.55)
    glowFast(hd.X(20), crest, hd.cw * 14, hdHex("#fff0c0"), 0.5, 0.5)
  }
  for (let i = 0; i < (launch ? 70 : 150); i++) {
    const x = Math.floor(hash2(i, 1) * hd.w)
    const y = Math.floor(hash2(i, 2) * crest * (launch ? 0.7 : 0.95))
    const fade = launch ? 1 - y / (crest * 0.7) : 1
    blendPx(hd, x, y, star, (0.15 + 0.5 * hash2(i, 3)) * fade)
  }
  hd.stars(SPACE_STARS, star, (i) => spaceTwinkle(t, i))
  SPACE_STARS.forEach((s, i) => {
    if (spaceTwinkle(t, i)) glowFast(hd.X(s.x + 0.5), hd.Y(s.y + 0.5), S * 0.9, star, 0.4)
  })

  if (!launch) {
    // Nebula: layered soft clouds that breathe with the loop.
    const sway = Math.sin(theta) * 3
    const tints = [hdHex("#7a4ab0"), hdHex("#3f8fb0"), hdHex("#b04a8a")]
    SPACE_NEBULAE.forEach((cloud, i) => {
      const cx = hd.X(cloud.x + 2.5 + sway * (i % 2 ? -1 : 1))
      const cy = hd.Y(cloud.y + 0.5)
      for (let k = 0; k < 7; k++) {
        const a = hash2(i, k) * Math.PI * 2
        const r = hd.cw * (2 + hash2(k, i + 5) * 5)
        glowFast(cx + Math.cos(a) * hd.cw * 5, cy + Math.sin(a) * hd.ch * 1.2, r, tints[(i + k) % 3]!, 0.5, 0.4)
      }
      glowFast(cx, cy, hd.cw * 8, hdMix(tints[i]!, star, 0.2), 0.28, 0.4)
      for (let k = 0; k < 24; k++) {
        const a = hash2(i + 7, k) * Math.PI * 2
        const d = Math.sqrt(hash2(k, i + 9)) * hd.cw * 8
        blendPx(hd, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.35), star, 0.55)
      }
    })
    // A small ringed world high on the right.
    const rx = hd.X(62)
    const ry = hd.Y(3.2)
    const rr = Math.max(4, S * 0.65)
    glowFast(rx, ry, rr * 3.5, hdHex("#d8a86a"), 0.18)
    for (let y = Math.floor(ry - rr); y <= Math.ceil(ry + rr); y++) {
      for (let x = Math.floor(rx - rr); x <= Math.ceil(rx + rr); x++) {
        const dx = (x + 0.5 - rx) / rr
        const dy = (y + 0.5 - ry) / rr
        const d2 = dx * dx + dy * dy
        if (d2 > 1) continue
        const lit = clamp01(0.55 - dx * 0.55 - dy * 0.25 + 0.2)
        const band = 0.5 + 0.5 * Math.sin(dy * 9)
        hd.set(x, y, hdMix(hdDarken(hdHex("#c89a5a"), 0.35), hdMix(hdHex("#e8c690"), hdHex("#b8804a"), band), lit))
      }
    }
    const ring = (front: boolean) => {
      for (let a = 0; a < 720; a++) {
        const ang = (a / 720) * Math.PI * 2
        const isFront = Math.sin(ang) > 0
        if (isFront !== front) continue
        for (const rad of [1.55, 1.75, 1.9]) {
          const x = rx + Math.cos(ang) * rr * rad
          const y = ry + Math.sin(ang) * rr * rad * 0.28 - rr * 0.1 + Math.cos(ang) * rr * 0.1
          blendPx(hd, Math.round(x), Math.round(y), hdHex("#e8d0a0"), rad > 1.7 ? 0.5 : 0.8)
        }
      }
    }
    ring(false)
    ring(true)
    // Shooting star once per loop.
    if (phase > 0.28 && phase < 0.4) {
      const p = (phase - 0.28) / 0.12
      const sx = hd.X(22 + p * 18)
      const sy = hd.Y(1 + p * 4)
      for (let k = 0; k < 40; k++) {
        blendPx(hd, Math.round(sx - k * 1.4), Math.round(sy - k * 0.7), hdHex("#ffffff"), (1 - k / 40) * 0.8)
      }
      glowFast(sx, sy, S * 0.8, hdHex("#ffffff"), 0.6)
    }
  }

  // Planet: shallow limb, atmosphere rim, ocean with terminator shading.
  const sag = hd.ch * 1.0
  const atmo = Math.max(3, hd.ch * 0.55)
  const rimCol = launch ? hdHex("#ffd08a") : hdHex("#6aa8e8")
  const haze = hdMix(horizon, spaceSkyRgb(style, 0.78), 0.4)
  const limbAt = (x: number) => {
    const nx = (x + 0.5) / hd.w - 0.5
    return crest - sag * (1 - 4 * nx * nx)
  }
  const oceanTop = hdMix(planet, launch ? hdHex("#8fc0e8") : hdHex("#4a78b8"), launch ? 0.45 : 0.4)
  {
    // Per-frame tones; the per-pixel chain is inlined with the same clamps
    // and round points (the [..].map clamp commutes: the bounds are integers).
    const atmoMix = hdMix(haze, rimCol, 0.5)
    const am0 = atmoMix[0]!
    const am1 = atmoMix[1]!
    const am2 = atmoMix[2]!
    const atmoK = launch ? 0.75 : 0.65
    const atmoBand = atmo * 3
    const oceanDeep = hdDarken(planet, 0.62)
    const od0 = oceanDeep[0]!
    const od1 = oceanDeep[1]!
    const od2 = oceanDeep[2]!
    const ot0 = oceanTop[0]!
    const ot1 = oceanTop[1]!
    const ot2 = oceanTop[2]!
    const rc0 = rimCol[0]!
    const rc1 = rimCol[1]!
    const rc2 = rimCol[2]!
    const rimBand = atmo * 1.4
    for (let x = 0; x < hd.w; x++) {
      const limb = limbAt(x)
      const nx = (x + 0.5) / hd.w
      // The terminator factor only depends on the column.
      const side = launch ? 1 - Math.abs(nx - 0.2) * 0.9 : 1 - nx * 0.75
      let sideK = side * 1.15
      if (sideK < 0) sideK = 0
      else if (sideK > 1) sideK = 1
      const xq = x >> 2
      let i = (Math.max(0, Math.floor(limb - atmoBand)) * hd.w + x) * 3
      for (let y = Math.max(0, Math.floor(limb - atmoBand)); y < hd.h; y++, i += hd.w * 3) {
        const d = y + 0.5 - limb
        if (d < 0) {
          let c = 1 + d / atmoBand
          if (c < 0) c = 0
          else if (c > 1) c = 1
          let a = Math.pow(c, 2.2) * atmoK
          if (a > 1) a = 1
          const p0 = pixels[i]!
          pixels[i] = Math.round(p0 + (am0 - p0) * a)
          const p1 = pixels[i + 1]!
          pixels[i + 1] = Math.round(p1 + (am1 - p1) * a)
          const p2 = pixels[i + 2]!
          pixels[i + 2] = Math.round(p2 + (am2 - p2) * a)
          continue
        }
        let v = d / (hd.h - limb || 1)
        if (v < 0) v = 0
        else if (v > 1) v = 1
        let m1 = Math.pow(v, 0.6) * 0.9
        if (m1 < 0) m1 = 0
        else if (m1 > 1) m1 = 1
        const c0 = Math.round(ot0 + (od0 - ot0) * m1)
        const c1 = Math.round(ot1 + (od1 - ot1) * m1)
        const c2 = Math.round(ot2 + (od2 - ot2) * m1)
        let m2 = 1 - d / rimBand
        if (m2 < 0) m2 = 0
        else if (m2 > 1) m2 = 1
        const r0v = Math.round(c0 + (rc0 - c0) * (m2 * 0.8))
        const r1v = Math.round(c1 + (rc1 - c1) * (m2 * 0.8))
        const r2v = Math.round(c2 + (rc2 - c2) * (m2 * 0.8))
        const s0v = Math.round(r0v * 0.55)
        const s1v = Math.round(r1v * 0.55)
        const s2v = Math.round(r2v * 0.55)
        const f0 = Math.round(s0v + (r0v - s0v) * sideK)
        const f1 = Math.round(s1v + (r1v - s1v) * sideK)
        const f2 = Math.round(s2v + (r2v - s2v) * sideK)
        const grain = (hash2(xq, y >> 2) - 0.5) * 8
        let e0 = f0 + grain
        pixels[i] = e0 < 0 ? 0 : e0 > 255 ? 255 : Math.round(e0)
        let e1 = f1 + grain
        pixels[i + 1] = e1 < 0 ? 0 : e1 > 255 ? 255 : Math.round(e1)
        let e2 = f2 + grain
        pixels[i + 2] = e2 < 0 ? 0 : e2 > 255 ? 255 : Math.round(e2)
      }
    }
  }
  // Storm swirls and landmasses stand where the old crater sites were.
  const cloudCol = launch ? hdHex("#f4f0ec") : hdHex("#9ab4d8")
  for (const pit of SPACE_CRATERS) {
    const cx = hd.X(pit.x + 0.5)
    const cy = hd.Y(pit.y + 0.5)
    for (let k = 0; k < 90; k++) {
      const a = k * 0.28
      const r = hd.cw * (0.15 + k * 0.022)
      blendPx(
        hd,
        Math.round(cx + Math.cos(a) * r),
        Math.round(cy + Math.sin(a) * r * 0.32),
        cloudCol,
        launch ? 0.55 : 0.35,
      )
    }
    glowFast(cx, cy, hd.cw * 2.8, cloudCol, launch ? 0.25 : 0.12, 0.3)
  }
  if (!launch) {
    // City lights on the dark side.
    for (let i = 0; i < 38; i++) {
      const x = Math.floor(hd.w * (0.55 + hash2(i, 4) * 0.44))
      const y = Math.floor(limbAt(x) + hd.ch * (0.5 + hash2(i, 5) * 2.8))
      blendPx(hd, x, y, hdHex("#ffd88a"), 0.5 + 0.35 * hash2(i, 6))
    }
  }

  if (launch) {
    const nose = SPACE_ROCKET_BASE - spaceLaunchProgress(t) * (SPACE_ROCKET_BASE - SPACE_ROCKET_TOP + 1)
    const hot = spaceFlicker(t)
    const cx = hd.X(SPACE_ROCKET_X + 0.5)
    const len = hd.ch * 4.4
    const hw = Math.max(2, len * 0.095)
    const topY = hd.Y(nose)
    const tailY = topY + len
    const lerpHalf = (v: number) => {
      // Ogive nose over 0..0.28, straight body after.
      if (v < 0.28) return hw * Math.pow(Math.sin((v / 0.28) * Math.PI * 0.5), 0.75)
      return hw
    }
    // Exhaust: bright plume, then a growing white-orange smoke column.
    const plumeLen = len * (hot ? 1.0 : 0.82)
    {
      const whiteHot = hdHex("#ffffff")
      const wh0 = whiteHot[0]!
      const wh1 = whiteHot[1]!
      const wh2 = whiteHot[2]!
      const flameDeep = hdHex("#ff6a2a")
      const fd0 = flameDeep[0]!
      const fd1 = flameDeep[1]!
      const fd2 = flameDeep[2]!
      const fl0 = flame[0]!
      const fl1 = flame[1]!
      const fl2 = flame[2]!
      const theta10 = theta * 10
      const rowEnd = Math.min(hd.h, Math.ceil(tailY + plumeLen))
      for (let y = Math.max(0, Math.floor(tailY)); y < rowEnd; y++) {
        const v = (y - tailY) / plumeLen
        const half = hw * (0.95 - v * 0.55) * (1 + 0.1 * Math.sin(y * 0.5 + theta10))
        const inner0 = Math.round(fl0 + (fd0 - fl0) * v)
        const inner1 = Math.round(fl1 + (fd1 - fl1) * v)
        const inner2 = Math.round(fl2 + (fd2 - fl2) * v)
        const alpha = (1 - v) * 0.95
        const xa = Math.max(0, Math.floor(cx - half))
        const xb = Math.min(hd.w - 1, Math.ceil(cx + half) - 1)
        for (let x = xa; x <= xb; x++) {
          const u = Math.abs(x + 0.5 - cx) / (half || 1)
          let m = u * 0.9 + v * 0.8
          if (m < 0) m = 0
          else if (m > 1) m = 1
          const i = (y * hd.w + x) * 3
          const c0 = Math.round(wh0 + (inner0 - wh0) * m)
          const c1 = Math.round(wh1 + (inner1 - wh1) * m)
          const c2 = Math.round(wh2 + (inner2 - wh2) * m)
          const p0 = pixels[i]!
          pixels[i] = Math.round(p0 + (c0 - p0) * alpha)
          const p1 = pixels[i + 1]!
          pixels[i + 1] = Math.round(p1 + (c1 - p1) * alpha)
          const p2 = pixels[i + 2]!
          pixels[i + 2] = Math.round(p2 + (c2 - p2) * alpha)
        }
      }
    }
    glowFast(cx, tailY + plumeLen * 0.35, hw * 9, flame, 0.55, 1.1)
    const trail = 14
    for (let k = 0; k < trail; k++) {
      const v = k / trail
      const py = tailY + plumeLen * 0.75 + v * hd.ch * 7
      const r = hw * (1.4 + v * 4.8)
      const wob = Math.sin(k * 1.7 + theta * 2) * hw * 0.4 * v
      glowFast(cx + wob, py, r, hdMix(hdHex("#fff0d8"), haze, v * 0.7), 0.55 * (1 - v * 0.75), 0.9)
    }
    // Rocket body shaded as a cylinder lit from the dawn side (left).
    const bodyLeft = hdMix(hull, hdHex("#fff6e4"), 0.55)
    const bodyRight = hdDarken(hullDark, 0.8)
    for (let y = Math.floor(topY); y < Math.ceil(tailY); y++) {
      const v = clamp01((y + 0.5 - topY) / len)
      const half = lerpHalf(v)
      for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
        const u = (x + 0.5 - cx) / (half || 1)
        let col = hdMix(bodyLeft, bodyRight, clamp01(((u + 1) / 2) * 1.1))
        if (v < 0.28) col = hdMix(col, hdHex("#d8553a"), 0.0)
        if (v > 0.5 && v < 0.56) col = hdMix(col, hdHex("#20242c"), 0.85)
        if (v > 0.74 && v < 0.78) col = hdMix(col, hdHex("#20242c"), 0.85)
        if (v > 0.33 && v < 0.35) col = hdDarken(col, 0.7)
        hd.set(x, y, col)
      }
      hd.set(Math.floor(cx - half), y, hdDarken(hullDark, 0.7))
    }
    // Porthole, flag stripe, and engine skirt.
    const px = cx + hw * 0.1
    const py = topY + len * 0.4
    hd.disk(px, py, Math.max(2.2, hw * 0.46), hdDarken(hullDark, 0.6))
    hd.disk(px, py, Math.max(1.6, hw * 0.34), hdHex(c.porthole))
    hd.disk(px - hw * 0.08, py - hw * 0.1, Math.max(1, hw * 0.12), hdMix(hdHex(c.porthole), star, 0.7))
    hd.rect(cx - hw * 0.9, topY + len * 0.9, cx + hw * 0.9, tailY + 1, hdDarken(hullDark, 0.55))
    fillPoly(
      hd,
      [
        [cx - hw * 0.8, tailY],
        [cx + hw * 0.8, tailY],
        [cx + hw * 0.55, tailY + len * 0.08],
        [cx - hw * 0.55, tailY + len * 0.08],
      ],
      () => hdDarken(hullDark, 0.4),
    )
    // Swept fins and strap-on boosters.
    for (const side of [-1, 1] as const) {
      fillPoly(
        hd,
        [
          [cx + side * hw * 0.95, topY + len * 0.72],
          [cx + side * hw * 2.3, tailY + len * 0.04],
          [cx + side * hw * 0.95, tailY - len * 0.02],
        ],
        () => (side < 0 ? hdMix(hull, hdHex("#fff0d8"), 0.2) : hdDarken(hullDark, 0.9)),
      )
    }
    glowFast(cx, tailY, hw * 2.2, hdHex("#fff2d0"), 0.6, 0.6)
  } else {
    // Satellite: gold-foil bus, two paneled wings, dish, and a blinking beacon.
    const sx = hd.X(phase * (SPACE_COLUMNS + 10) - 8)
    const sy = hd.Y(SPACE_SATELLITE_ROW + 0.5)
    const sat = hdHex(c.satellite)
    const u = Math.max(3, S * 0.22)
    const tilt = Math.sin(theta) * u * 0.25
    glowFast(sx + u * 3, sy, u * 7, hdHex("#8fa8ff"), 0.12)
    for (const side of [-1, 1] as const) {
      for (let k = 0; k < 3; k++) {
        const x0 = sx + u * 3 + side * (u * 1.5 + k * u * 1.5)
        const col = (k + (side > 0 ? 1 : 0)) % 2 ? hdHex("#2a4a9a") : hdHex("#3a60c0")
        hd.rect(x0, sy - u * 1.1 + tilt * side, x0 + u * 1.4, sy + u * 1.1 + tilt * side, col)
        hd.rect(
          x0 + u * 0.05,
          sy - u * 1.05 + tilt * side,
          x0 + u * 0.55,
          sy + u * 1.05 + tilt * side,
          hdMix(col, hdHex("#8fb0ff"), 0.45),
        )
        hd.rect(x0, sy - 0.5 + tilt * side, x0 + u * 1.4, sy + 0.5 + tilt * side, hdDarken(col, 0.6))
      }
    }
    hd.rect(sx + u * 2, sy - u * 0.9, sx + u * 4, sy + u * 0.9, hdMix(sat, hdHex("#fff4c0"), 0.2))
    hd.rect(sx + u * 2, sy - u * 0.9, sx + u * 2.6, sy + u * 0.9, hdMix(sat, hdHex("#ffffff"), 0.5))
    hd.rect(sx + u * 3.4, sy - u * 0.9, sx + u * 4, sy + u * 0.9, hdDarken(sat, 0.65))
    hd.disk(sx + u * 3, sy - u * 1.5, u * 0.7, hdMix(hdHex("#e8ecf8"), hdHex("#8a94a8"), 0.35))
    hd.rect(sx + u * 3 - 0.5, sy - u * 1.1, sx + u * 3 + 0.5, sy - u * 0.9, hullDark)
    const blink = Math.floor(t / 300) % 2 === 0
    glowFast(sx + u * 3.8, sy + u * 0.9, u * 2.5, hdHex("#ff4a3a"), blink ? 0.6 : 0.1)
    hd.disk(sx + u * 3.8, sy + u * 0.9, Math.max(1, u * 0.2), blink ? hdHex("#ff4a3a") : hullDark)
  }
  return hd.pixels
}
