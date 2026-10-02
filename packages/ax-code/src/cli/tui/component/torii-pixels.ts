import { blendPx, clamp01, fillPoly, glow, hash2, vrect } from "./atmos-paint"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  TORII_CHOCHIN,
  TORII_COLORS,
  TORII_COLUMNS,
  TORII_FIGURES,
  TORII_FOXES,
  TORII_GROUND_TOP,
  TORII_LANTERNS,
  TORII_LINTEL_TIE,
  TORII_LINTEL_TOP,
  TORII_MOON,
  TORII_PATH_SLABS,
  TORII_PILLARS,
  TORII_ROWS,
  TORII_SHRINE,
  TORII_STARS,
  toriiFlicker,
  toriiPetals,
  toriiSkyRgb,
  type ToriiStyle,
} from "./torii-view-model"

/**
 * Freeform HD renderer. A vermilion torii is built from its real parts:
 * tapered round pillars on stone bases, a tie beam with projecting ends, a
 * plaque strut, and an upswept black-capped kasagi over a vermilion shimaki.
 * Behind it a shrine hall waits at the end of a stone approach among misty
 * cedar slopes; stone lanterns, fox guardians, and worshippers line the path.
 * Day brings sun shafts and sakura petals; night lights lanterns and fireflies.
 */
export function renderToriiPixels(width: number, height: number, style: ToriiStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, TORII_COLUMNS, TORII_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "torii-night"
  const c = TORII_COLORS[style]
  const t = Math.max(0, elapsedMs)
  const S = Math.min(hd.ch, hd.cw * 2)
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, S * 0.5)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return toriiSkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return toriiSkyRgb(style, py / (hd.h - 1))
  }
  const vermilion = hdHex(c.vermilion)
  const vermilionDark = hdHex(c.vermilionDark)
  const cap = hdHex(c.cap)
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const flame = hdHex(c.flame)
  const lantern = hdHex(c.lantern)
  const mountain = hdHex(c.mountain)
  const tree = hdHex(c.tree)
  const path = hdHex(c.path)
  const petal = hdHex(c.petal)
  const ground = hdHex(c.ground)
  const robe = hdHex(c.robe)
  const orb = night ? TORII_MOON : { x: 14, y: 1.7 }
  const pillars = TORII_PILLARS
  const shrine = TORII_SHRINE
  const groundY = hd.Y(TORII_GROUND_TOP)
  const horizon = skyAt(11)
  const flicker = toriiFlicker(t)
  const phase = (t % 2400) / 2400

  // Pillar and beam geometry (pixel space).
  const lcx = hd.X(pillars.left + 0.4)
  const rcx = hd.X(pillars.right + 0.9)
  const gateMid = (lcx + rcx) / 2
  const pTop = hd.Y(pillars.top - 0.2)
  const pBase = hd.Y(pillars.base + 0.7)
  const rBase = Math.max(3, Math.min(hd.cw * 0.62, S * 0.34))
  const rTop = rBase * 0.78
  const batter = hd.cw * 0.28

  hd.sky((v) => toriiSkyRgb(style, v))
  if (night) {
    hd.stars(TORII_STARS, hdHex(c.sky), (i) => (Math.floor(t / 400) + i) % 3 === 0)
    for (let i = 0; i < 50; i++) {
      blendPx(
        hd,
        Math.floor(hash2(i, 1) * hd.w),
        Math.floor(hash2(i, 2) * hd.Y(9)),
        hdHex("#d6dcff"),
        0.2 + 0.5 * hash2(i, 3),
      )
    }
  }
  const ox = hd.X(orb.x)
  const oy = hd.Y(orb.y)
  glow(hd, ox, oy, coreR * (night ? 11 : 13), night ? hdHex("#8fa0e0") : hdHex("#fff0c0"), night ? 0.4 : 0.55)
  hd.disk(ox, oy, coreR, night ? hdHex("#eef0ff") : hdHex("#fffbe8"))
  if (night) {
    hd.disk(ox - coreR * 0.25, oy + coreR * 0.2, coreR * 0.22, hdHex("#c8cee6"))
  } else {
    // Soft sun shafts falling toward the path.
    for (let k = 0; k < 5; k++) {
      const a = 0.35 + k * 0.11
      for (let r = coreR * 3; r < hd.h * 1.1; r += 2) {
        const x = ox + Math.cos(a) * r
        const y = oy + Math.sin(a) * r
        glow(hd, x, y, 8 + r * 0.045, hdHex("#fff6d0"), 0.018, 1)
      }
    }
  }
  for (const [cxs, cys, w] of [
    [26, 3.2, 8],
    [52, 4.6, 10],
  ] as const) {
    const drift = Math.sin(phase * Math.PI * 2) * 1.2
    glow(
      hd,
      hd.X(cxs + drift),
      hd.Y(cys),
      hd.cw * w,
      night ? hdHex("#3a4478") : hdHex("#ffffff"),
      night ? 0.2 : 0.45,
      0.16,
    )
  }

  // Layered wooded slopes with mist between them.
  const ridge = (top: number, amp: number, seed: number, upper: RGB, lower: RGB) => {
    for (let x = 0; x < hd.w; x++) {
      const nx = x / hd.w
      const y =
        hd.Y(top) + hd.ch * amp * (0.5 + 0.3 * Math.sin(nx * 6.3 + seed) + 0.16 * Math.sin(nx * 15 + seed * 1.9))
      for (let py = Math.max(0, Math.floor(y)); py < groundY; py++)
        hd.set(x, py, hdMix(upper, lower, clamp01((py - y) / (hd.ch * 4))))
    }
  }
  const far = hdMix(mountain, horizon, 0.5)
  ridge(7.4, 2.2, 0.4, far, hdMix(far, horizon, 0.5))
  ridge(9, 1.8, 2.2, hdMix(mountain, tree, 0.2), hdMix(mountain, horizon, 0.35))
  glow(hd, hd.w / 2, hd.Y(11), hd.w * 0.55, night ? hdHex("#3a4c78") : hdHex("#ffffff"), night ? 0.22 : 0.4, 0.14)
  ridge(11, 1.6, 4.4, hdMix(tree, mountain, 0.35), hdDarken(tree, 0.75))
  // Cedar silhouettes crowd both flanks, rising to varying heights.
  const cedar = (cx: number, base: number, ht: number, wd: number, col: RGB) => {
    for (let y = Math.floor(base - ht); y < base; y++) {
      const v = (y - (base - ht)) / ht
      const half = wd * (0.12 + 0.88 * v) * (1 + 0.14 * Math.sin(y * 0.9 + cx))
      for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
        const u = (x - cx) / (half || 1)
        hd.set(x, y, hdMix(hdMix(col, hdHex("#ffffff"), night ? 0.02 : 0.1), hdDarken(col, 0.7), clamp01((u + 1) / 2)))
      }
    }
    hd.rect(cx - 1, base, cx + 1.5, base + hd.ch * 0.4, hdDarken(col, 0.45))
  }
  for (let i = 0; i < 16; i++) {
    const left = i < 8
    const cx = left ? hd.X(1 + i * 2.7) : hd.X(76 - 1 - (i - 8) * 2.7)
    cedar(
      cx,
      hd.Y(14 + hash2(i, 3) * 1.2),
      hd.ch * (5.5 + hash2(i, 1) * 5),
      hd.cw * (0.8 + hash2(i, 2) * 0.9),
      hdDarken(tree, 0.75 + hash2(i, 7) * 0.3),
    )
  }
  // Sakura at the edges: pink canopies in day, muted at night.
  for (const treeX of [6, 10, 66, 70]) {
    const tx = hd.X(treeX + 0.7)
    const ty = hd.Y(12.1)
    hd.rect(
      hd.X(treeX + 0.45),
      hd.Y(12.6),
      hd.X(treeX + 0.95),
      hd.Y(14.4),
      hdDarken(hdHex("#5a4030"), night ? 0.5 : 0.9),
    )
    const bloom = night ? hdDarken(petal, 0.55) : petal
    hd.blob(tx, ty, hd.cw * 2.2, hd.ch * 1.1, hdMix(bloom, hdDarken(bloom, 0.6), 0.35), hdDarken(bloom, 0.6))
    hd.blob(
      tx - hd.cw * 0.3,
      ty - hd.ch * 0.2,
      hd.cw * 1.6,
      hd.ch * 0.8,
      bloom,
      hdMix(bloom, hdHex("#ffffff"), night ? 0.05 : 0.4),
    )
  }

  // Ground, path, and stepping stones.
  vrect(
    hd,
    0,
    groundY,
    hd.w,
    hd.h,
    hdMix(ground, night ? hdHex("#2a4a2a") : hdHex("#9ac05a"), 0.2),
    hdDarken(ground, 0.8),
  )
  const pathTopY = hd.Y(13.6)
  const pathCx = hd.X(shrine.x0 + (shrine.x1 + 1 - shrine.x0) / 2)
  fillPoly(
    hd,
    [
      [pathCx - hd.cw * 1.6, pathTopY],
      [pathCx + hd.cw * 1.6, pathTopY],
      [pathCx + hd.cw * 14, hd.h],
      [pathCx - hd.cw * 14, hd.h],
    ],
    (x, y) => {
      const v = (y - pathTopY) / (hd.h - pathTopY)
      const grain = (hash2(x >> 1, y >> 1) - 0.5) * 14
      const m = hdMix(hdDarken(path, 0.78), path, 0.35 + v * 0.45)
      return [m[0] + grain, m[1] + grain, m[2] + grain].map((n) =>
        Math.max(0, Math.min(255, Math.round(n))),
      ) as unknown as RGB
    },
  )
  // Stone courses across the path, spaced wider toward the viewer.
  for (let k = 0; k < 14; k++) {
    const v = Math.pow(k / 14, 1.7)
    const y = pathTopY + v * (hd.h - pathTopY)
    const half = hd.cw * (1.6 + v * 12.4)
    hd.rect(pathCx - half, y, pathCx + half, y + Math.max(1, 1 + v * 2), hdDarken(path, 0.62))
    hd.rect(
      pathCx - half,
      y + 1 + v * 2,
      pathCx + half,
      y + 2 + v * 3,
      hdMix(path, hdHex("#ffffff"), night ? 0.02 : 0.2),
    )
  }
  for (const slab of TORII_PATH_SLABS) {
    const sx = hd.X(slab)
    hd.rect(
      sx,
      hd.Y(TORII_GROUND_TOP + 1.05),
      hd.X(slab + 3),
      hd.Y(TORII_GROUND_TOP + 1.55),
      hdMix(path, hdHex("#ffffff"), night ? 0.02 : 0.25),
    )
    hd.rect(sx, hd.Y(TORII_GROUND_TOP + 1.45), hd.X(slab + 3), hd.Y(TORII_GROUND_TOP + 1.6), hdDarken(path, 0.55))
  }
  for (let i = 0; i < 70; i++) {
    const gx = hash2(i, 11) * hd.w
    const gy = groundY + hash2(i, 12) * (hd.h - groundY)
    if (Math.abs(gx - pathCx) < hd.cw * (1.6 + ((gy - pathTopY) / (hd.h - pathTopY)) * 12.4)) continue
    for (let k = 0; k < 3; k++)
      hd.set(
        Math.round(gx + k * 0.6),
        Math.round(gy - k * 2),
        hdMix(tree, night ? hdHex("#4a6a40") : hdHex("#b0d070"), 0.5),
      )
  }

  // Shrine hall seen through the gate; painted last so petals cannot recolor it.
  const drawShrine = () => {
    const x0 = hd.X(shrine.x0)
    const x1 = hd.X(shrine.x1 + 1)
    const top = hd.Y(shrine.top)
    const base = hd.Y(shrine.base + 0.2)
    const haze = night ? 0.12 : 0.18
    const wall = hdMix(vermilion, horizon, haze)
    // Platform and steps.
    hd.rect(x0 - hd.cw * 0.4, base, x1 + hd.cw * 0.4, base + hd.ch * 0.35, hdMix(stoneDark, horizon, haze))
    // Hip roof with upswept eaves and a pale ridge.
    fillPoly(
      hd,
      [
        [x0 - hd.cw * 0.9, top + hd.ch * 0.38],
        [x0 + hd.cw * 0.6, top - hd.ch * 0.3],
        [x1 - hd.cw * 0.6, top - hd.ch * 0.3],
        [x1 + hd.cw * 0.9, top + hd.ch * 0.38],
      ],
      (_, y) =>
        hdMix(hdMix(cap, horizon, 0.18), hdMix(cap, horizon, 0.34), clamp01((y - (top - hd.ch * 0.3)) / (hd.ch * 0.7))),
    )
    hd.rect(x0 + hd.cw * 0.6, top - hd.ch * 0.34, x1 - hd.cw * 0.6, top - hd.ch * 0.22, hdMix(stone, horizon, 0.3))
    hd.rect(x0 + 0.4 * hd.cw, top + hd.ch * 0.35, x1 - 0.4 * hd.cw, base, wall)
    hd.rect(x0 + 0.4 * hd.cw, top + hd.ch * 0.35, x0 + 0.85 * hd.cw, base, hdMix(vermilionDark, horizon, haze))
    for (let k = 1; k < 5; k++) {
      const px = x0 + 0.4 * hd.cw + (k * (x1 - x0 - 0.8 * hd.cw)) / 5
      hd.rect(px - 0.8, top + hd.ch * 0.35, px + 0.8, base, hdMix(vermilionDark, horizon, haze))
    }
    const mid = (x0 + x1) / 2
    hd.rect(
      mid - hd.cw * 0.6,
      top + hd.ch * 0.55,
      mid + hd.cw * 0.6,
      base,
      night ? hdMix(flame, hdHex("#3a1a10"), 0.35) : hdMix(hdHex("#2a1810"), horizon, 0.2),
    )
    if (night) glow(hd, mid, (top + base) / 2, hd.cw * 4.5, flame, 0.45, 0.9)
    hd.disk(mid, top + hd.ch * 1.1, Math.max(1.4, hd.cw * 0.28), flame)
  }

  // Stone lanterns (toro) flank the approach, flames flickering at night.
  const drawToro = (lx: number) => {
    const cx = hd.X(lx + 1.5)
    const base = hd.Y(18.45)
    const u = Math.max(3, hd.cw * 0.5)
    const shade = (x: number, x0: number, x1: number, a: RGB, b: RGB) => hdMix(a, b, (x - x0) / (x1 - x0 || 1))
    hd.rect(cx - u * 1.5, base - u * 0.6, cx + u * 1.5, base, hdDarken(stone, 0.8))
    hd.rect(cx - u * 0.45, base - u * 3.6, cx + u * 0.45, base - u * 0.6, shade(cx, cx - u, cx + u, stone, stoneDark))
    for (let x = Math.floor(cx - u * 0.45); x < cx + u * 0.45; x++)
      hd.rect(
        x,
        base - u * 3.6,
        x + 1,
        base - u * 0.6,
        shade(x, cx - u * 0.45, cx + u * 0.45, hdMix(stone, hdHex("#ffffff"), night ? 0 : 0.2), stoneDark),
      )
    hd.rect(cx - u * 1.1, base - u * 4.1, cx + u * 1.1, base - u * 3.6, stone)
    const fireTop = base - u * 5.7
    hd.rect(cx - u * 0.95, fireTop, cx + u * 0.95, base - u * 4.1, hdDarken(stone, 0.85))
    const lit = night ? (flicker ? flame : hdMix(flame, stoneDark, 0.4)) : hdMix(lantern, stoneDark, 0.3)
    if (night) glow(hd, cx, (fireTop + base - u * 4.1) / 2, u * (flicker ? 7 : 5.5), flame, flicker ? 0.55 : 0.4, 1.1)
    hd.rect(cx - u * 0.5, fireTop + u * 0.2, cx + u * 0.5, base - u * 4.3, lit)
    fillPoly(
      hd,
      [
        [cx - u * 1.9, fireTop],
        [cx + u * 1.9, fireTop],
        [cx + u * 0.9, fireTop - u * 0.9],
        [cx - u * 0.9, fireTop - u * 0.9],
      ],
      (x) => shade(x, cx - u * 1.9, cx + u * 1.9, hdMix(stone, hdHex("#ffffff"), night ? 0 : 0.2), stoneDark),
    )
    hd.disk(cx, fireTop - u * 1.1, u * 0.45, stone)
    hd.disk(cx, fireTop - u * 1.5, u * 0.25, stone)
  }
  TORII_LANTERNS.forEach(drawToro)

  // Fox guardians sit on stone plinths with red bibs.
  for (const fox of TORII_FOXES) {
    const fx = hd.X(fox + 0.9)
    const base = hd.Y(18.45)
    const u = Math.max(3, hd.cw * 0.5)
    hd.rect(fx - u * 1.6, base - u * 0.9, fx + u * 1.6, base, hdDarken(stone, 0.75))
    hd.blob(fx, base - u * 2.5, u * 1.1, u * 1.6, hdMix(stone, hdHex("#ffffff"), night ? 0.0 : 0.15), stoneDark)
    hd.disk(fx, base - u * 4.5, u * 0.85, stone)
    fillPoly(
      hd,
      [
        [fx - u * 0.9, base - u * 4.8],
        [fx - u * 0.55, base - u * 6.1],
        [fx - u * 0.1, base - u * 4.9],
      ],
      () => stone,
    )
    fillPoly(
      hd,
      [
        [fx + u * 0.9, base - u * 4.8],
        [fx + u * 0.55, base - u * 6.1],
        [fx + u * 0.1, base - u * 4.9],
      ],
      () => stoneDark,
    )
    hd.blob(fx + u * 1.5, base - u * 1.6, u * 0.55, u * 1.2, stoneDark)
    hd.rect(fx - u * 0.6, base - u * 3.9, fx + u * 0.6, base - u * 3.2, vermilion)
  }

  // Worshippers in robes on the approach.
  for (const figure of TORII_FIGURES) {
    const fx = hd.X(figure + 0.4)
    const base = hd.Y(18.5)
    const u = Math.max(2, hd.cw * 0.4)
    fillPoly(
      hd,
      [
        [fx - u * 0.9, base],
        [fx + u * 0.9, base],
        [fx + u * 0.6, base - u * 3.8],
        [fx - u * 0.6, base - u * 3.8],
      ],
      (x) =>
        hdMix(hdMix(robe, hdHex("#ffffff"), night ? 0 : 0.15), hdDarken(robe, 0.7), clamp01((x - fx + u) / (2 * u))),
    )
    hd.disk(fx, base - u * 4.5, u * 0.7, hdMix(hdHex("#e8c8a8"), robe, night ? 0.6 : 0.1))
    hd.rect(fx - u * 0.75, base - u * 5.2, fx + u * 0.75, base - u * 4.8, hdDarken(robe, 0.5))
  }

  // Gate: tapered pillars with cylinder shading, bases, and black foot rings.
  const pillar = (cx: number, facing: -1 | 1) => {
    const lightSide = night ? 0.15 : 0.55
    for (let y = Math.floor(pTop); y < Math.ceil(pBase); y++) {
      const v = clamp01((y - pTop) / (pBase - pTop || 1))
      const half = rTop + (rBase - rTop) * v
      const mid = cx + facing * batter * (1 - v) * -1
      for (let x = Math.floor(mid - half); x < Math.ceil(mid + half); x++) {
        const u = (x + 0.5 - mid) / (half || 1)
        let col = hdMix(
          hdMix(vermilion, hdHex("#ff7a50"), night ? 0 : 0.22),
          vermilionDark,
          clamp01(((u + 1) / 2) * (1.15 - lightSide * 0.4)),
        )
        // Night: warm lantern glow near the bottom edges.
        if (night) col = hdMix(col, flame, 0.14 * v * (1 - Math.abs(u)) * (flicker ? 1 : 0.7))
        hd.set(x, y, col)
      }
    }
    const baseY = hd.Y(pillars.base + 0.55)
    hd.rect(
      cx - rBase * 1.15,
      baseY - hd.ch * 0.1,
      cx + rBase * 1.15,
      baseY + hd.ch * 0.4,
      hdMix(cap, vermilionDark, 0.2),
    )
    const stoneTop = hd.Y(pillars.base + 0.95)
    hd.rect(cx - rBase * 1.6, stoneTop, cx + rBase * 1.6, stoneTop + hd.ch * 0.4, facing < 0 ? stone : stoneDark)
    hd.rect(
      cx - rBase * 1.6,
      stoneTop,
      cx + rBase * 1.6,
      stoneTop + 1.5,
      hdMix(stone, hdHex("#ffffff"), night ? 0.05 : 0.3),
    )
  }
  const topSag = hd.Y(TORII_LINTEL_TOP)
  // Kasagi (black cap, upswept ends), shimaki, and nuki tie beam.
  const kx0 = hd.X(pillars.left - 4.6)
  const kx1 = hd.X(pillars.right + 6.6)
  const kth = Math.max(4, hd.ch * 0.85)
  const lift = hd.ch * 0.7
  const kasagi = (inset: number, y0: number, th: number, upColor: RGB, loColor: RGB) => {
    const steps = Math.max(2, Math.ceil(kx1 - kx0))
    for (let i = 0; i <= steps; i++) {
      const v = i / steps
      const x = kx0 + inset + (kx1 - kx0 - inset * 2) * v
      const curve = Math.pow(Math.abs(v - 0.5) * 2, 2.4) * lift
      const yTop = y0 - curve
      const yBot = yTop + th * (1 - 0.15 * Math.abs(v - 0.5) * 2)
      for (let y = Math.floor(yTop); y < Math.ceil(yBot); y++)
        hd.set(Math.round(x), y, hdMix(upColor, loColor, (y - yTop) / (yBot - yTop || 1)))
    }
  }
  const kas = night ? hdMix(cap, vermilionDark, 0.35) : hdMix(cap, vermilion, 0.12)
  kasagi(0, topSag, kth, hdMix(kas, hdHex("#ffffff"), night ? 0.05 : 0.18), kas)
  kasagi(hd.cw * 1.2, topSag + kth * 0.7, kth * 0.8, hdMix(vermilion, hdHex("#ff7a50"), 0.18), vermilionDark)
  pillar(lcx, -1)
  pillar(rcx, 1)
  const nukiY = hd.Y(TORII_LINTEL_TIE)
  const nukiH = Math.max(3, hd.ch * 0.55)
  vrect(
    hd,
    lcx - hd.cw * 1.8,
    nukiY,
    rcx + hd.cw * 1.8,
    nukiY + nukiH,
    hdMix(vermilion, hdHex("#ff7a50"), 0.15),
    vermilionDark,
  )
  hd.rect(lcx - hd.cw * 1.8, nukiY, lcx - hd.cw * 1.4, nukiY + nukiH, hdMix(cap, vermilion, 0.4))
  hd.rect(rcx + hd.cw * 1.4, nukiY, rcx + hd.cw * 1.8, nukiY + nukiH, hdMix(cap, vermilion, 0.4))
  // Gakuzuka plaque between the tie beam and the kasagi.
  const plY0 = topSag + kth * 1.55
  hd.rect(gateMid - hd.cw * 0.5, plY0, gateMid + hd.cw * 0.5, nukiY, vermilionDark)
  hd.rect(gateMid - hd.cw * 1.4, plY0 + hd.ch * 0.1, gateMid + hd.cw * 1.4, nukiY - hd.ch * 0.1, cap)
  hd.rect(
    gateMid - hd.cw * 1.25,
    plY0 + hd.ch * 0.2,
    gateMid + hd.cw * 1.25,
    nukiY - hd.ch * 0.2,
    hdMix(cap, flame, night ? 0.25 : 0.35),
  )
  hd.rect(gateMid - hd.cw * 1.15, plY0 + hd.ch * 0.28, gateMid + hd.cw * 1.15, nukiY - hd.ch * 0.28, cap)
  // Paper lanterns hanging from the tie beam.
  for (const chochin of TORII_CHOCHIN) {
    const px = hd.X(chochin + 0.5)
    const py = nukiY + nukiH + hd.ch * 0.9
    const r = Math.max(3, hd.cw * 0.5)
    hd.rect(px - 0.7, nukiY + nukiH, px + 0.7, py - r * 1.2, cap)
    if (night) glow(hd, px, py, r * 6, flame, 0.5, 1.1)
    hd.blob(px, py, r, r * 1.25, hdMix(hdHex("#d84a2a"), flame, night ? 0.35 : 0))
    for (let k = -2; k <= 2; k++)
      hd.rect(
        px + k * r * 0.35 - 0.4,
        py - r * 1.15,
        px + k * r * 0.35 + 0.4,
        py + r * 1.15,
        hdDarken(vermilionDark, 0.9),
      )
    hd.rect(px - r * 0.6, py - r * 1.3, px + r * 0.6, py - r * 1.05, cap)
    hd.rect(px - r * 0.6, py + r * 1.05, px + r * 0.6, py + r * 1.3, cap)
  }
  if (night) {
    glow(hd, lcx, pBase - hd.ch, hd.cw * 6, flame, 0.14, 1.4)
    glow(hd, rcx, pBase - hd.ch, hd.cw * 6, flame, 0.14, 1.4)
  }

  // Fireflies at night, petals by day; petals fall in front of the gate.
  if (night) {
    for (let i = 0; i < 12; i++) {
      const a = phase * Math.PI * 2
      const fx = hd.X(8 + hash2(i, 21) * 60 + Math.sin(a + i) * 1.3)
      const fy = hd.Y(10 + hash2(i, 22) * 9 + Math.cos(a * 2 + i) * 0.4)
      const on = (Math.floor(t / 300) + i) % 4 !== 0
      if (on) {
        glow(hd, fx, fy, S * 0.6, hdHex("#d8f070"), 0.5)
        hd.disk(fx, fy, Math.max(1, S * 0.05), hdHex("#f4ffb0"))
      }
    }
  }
  for (const flake of toriiPetals(t)) {
    const fx = hd.X(flake.x + 0.5)
    const fy = hd.Y(flake.y + 0.5)
    const r = dot * (0.45 + (flake.x % 3) * 0.12)
    hd.blob(fx, fy, r * 1.4, r * 0.8, petal, hdMix(petal, hdHex("#ffffff"), night ? 0.05 : 0.5))
  }
  drawShrine()
  return hd.pixels
}
