import { blendPx, clamp01, glow, hash2, vrect } from "./atmos-paint"
import { createHdCanvas, hdDarken, hdHex, hdMix, type HdCanvas, type RGB } from "./scene-hd"
import {
  STEPPE_COLORS,
  STEPPE_COLUMNS,
  STEPPE_CYCLE_MS,
  STEPPE_GROUND_TOP,
  STEPPE_MOON,
  STEPPE_ROWS,
  STEPPE_SMOKE_X,
  STEPPE_STARS,
  STEPPE_YURT,
  steppeClouds,
  steppeHerd,
  steppeSkyRgb,
  steppeTick,
  type SteppeStyle,
} from "./steppe-view-model"

/** Smooth rolling ridge filled down to `floor` with a vertical tone gradient. */
function ridge(hd: HdCanvas, floor: number, top: number, amp: number, seed: number, upper: RGB, lower: RGB, rim?: RGB) {
  for (let x = 0; x < hd.w; x++) {
    const nx = x / hd.w
    const y =
      top +
      amp *
        (0.5 +
          0.28 * Math.sin(nx * 5.2 + seed) +
          0.16 * Math.sin(nx * 11.7 + seed * 1.7) +
          0.06 * Math.sin(nx * 27 + seed * 3.1))
    const ya = Math.max(0, Math.floor(y))
    for (let py = ya; py < Math.min(hd.h, Math.ceil(floor)); py++) {
      const v = (py - y) / Math.max(1, floor - y)
      hd.set(x, py, hdMix(upper, lower, clamp01(v * 1.2)))
    }
    if (rim) {
      hd.set(x, ya, rim)
      hd.set(x, ya + 1, hdMix(rim, upper, 0.5))
    }
  }
}

/**
 * Freeform HD steppe. Blue ranges recede behind layered rolling hills; soft
 * clouds drift with moving shadows over wind-combed grass. A felt ger with a
 * rope band, painted door, and smoking stove pipe sits beside a galloping herd
 * drawn with real horse silhouettes. Night adds a moon, Milky Way, and a
 * glowing window. Pure and deterministic; loops every STEPPE_CYCLE_MS.
 */
export function renderSteppePixels(width: number, height: number, style: SteppeStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, STEPPE_COLUMNS, STEPPE_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "steppe-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % STEPPE_CYCLE_MS) / STEPPE_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = STEPPE_COLORS[style]
  const S = Math.min(hd.ch, hd.cw * 2)
  const ground = hdHex(c.ground)
  const grass = hdHex(c.grass)
  const cloudRgb = hdHex(c.cloud)
  const around = steppeSkyRgb(style, 0.55)
  const tick = steppeTick(elapsed)
  const groundY = hd.Y(STEPPE_GROUND_TOP)
  const coreR = Math.max(3, S * 0.5)

  hd.sky((t) => steppeSkyRgb(style, t))
  // Sun glare low in the west by day; moon and Milky Way by night.
  if (night) {
    const moon = hdMix(hdHex(c.smoke), hdHex(c.glow), 0.72)
    // Milky Way: a diagonal band of faint stars and haze.
    for (let i = 0; i < 260; i++) {
      const u = hash2(i, 1)
      const x = u * hd.w
      const bandY = hd.Y(1 + 9 * (1 - u)) + (hash2(i, 2) - 0.5) * hd.ch * 3.2 * (0.4 + hash2(i, 3))
      blendPx(hd, Math.floor(x), Math.floor(bandY), hdHex("#c8d4ff"), 0.15 + 0.45 * hash2(i, 4))
    }
    for (let k = 0; k < 6; k++)
      glow(hd, hd.w * (0.1 + k * 0.17), hd.Y(7 - k * 1.1), hd.cw * 14, hdHex("#5a6ab0"), 0.12, 0.25)
    hd.stars(STEPPE_STARS, moon, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    const mx = hd.X(STEPPE_MOON.x)
    const my = hd.Y(STEPPE_MOON.y)
    glow(hd, mx, my, coreR * 10, hdHex("#8fa0e0"), 0.4)
    hd.disk(mx, my, coreR, moon)
    hd.disk(mx + coreR * 0.38, my - coreR * 0.18, coreR * 0.86, steppeSkyRgb(style, my / hd.h))
  } else {
    glow(hd, hd.X(14), groundY - hd.ch * 4, hd.cw * 26, hdHex("#fff2c8"), 0.5, 0.9)
    glow(hd, hd.X(14), groundY - hd.ch * 4, coreR * 6, hdHex("#ffffff"), 0.5)
    hd.disk(hd.X(14), groundY - hd.ch * 4, coreR * 0.9, hdHex("#fffdf0"))
  }
  // Layered clouds with lit tops, shaded bellies.
  for (const cloud of steppeClouds(elapsed)) {
    const px = hd.X(cloud.x + 2.5)
    const py = hd.Y(cloud.y)
    const body = night ? hdMix(cloudRgb, around, 0.2) : cloudRgb
    const belly = night ? hdDarken(cloudRgb, 0.75) : hdMix(cloudRgb, hdHex("#b4c8dc"), 0.55)
    for (const [dx, dy, r] of [
      [-2.2, 0.15, 1.1],
      [-0.9, -0.2, 1.5],
      [0.7, -0.35, 1.7],
      [2.2, -0.05, 1.3],
      [3.2, 0.2, 0.9],
    ] as const) {
      glow(hd, px + dx * hd.cw, py + dy * hd.ch + hd.ch * 0.25, hd.cw * r * 1.9, belly, 0.8, 0.42)
    }
    for (const [dx, dy, r] of [
      [-2.2, 0.0, 1.0],
      [-0.9, -0.35, 1.4],
      [0.7, -0.5, 1.6],
      [2.2, -0.2, 1.2],
    ] as const) {
      glow(hd, px + dx * hd.cw, py + dy * hd.ch, hd.cw * r * 1.8, body, 0.95, 0.4)
    }
  }

  // Distant blue ranges, then rolling green hills with atmospheric haze.
  const haze = steppeSkyRgb(style, STEPPE_GROUND_TOP / STEPPE_ROWS)
  const far = hdMix(night ? hdHex("#1e2d52") : hdHex("#8fa9c4"), haze, 0.25)
  ridge(
    hd,
    groundY,
    hd.Y(9.6),
    hd.ch * 3,
    0.8,
    far,
    hdMix(far, haze, 0.55),
    hdMix(far, hdHex("#ffffff"), night ? 0.06 : 0.25),
  )
  const hillA = hdMix(grass, haze, night ? 0.25 : 0.4)
  ridge(
    hd,
    groundY,
    hd.Y(11.6),
    hd.ch * 2.3,
    2.4,
    hdMix(hillA, ground, 0.1),
    hdDarken(hillA, 0.82),
    hdMix(hillA, hdHex("#ffffff"), night ? 0.05 : 0.2),
  )
  const hillB = hdMix(grass, ground, 0.3)
  ridge(
    hd,
    groundY,
    hd.Y(13.1),
    hd.ch * 2.2,
    4.9,
    hillB,
    hdDarken(hillB, 0.8),
    hdMix(hillB, hdHex("#ffffff"), night ? 0.06 : 0.18),
  )
  ridge(hd, groundY, hd.Y(14.4), hd.ch * 1.4, 7.2, hdMix(ground, grass, 0.35), ground)

  // Grassland: tone gradient, wind-combed blades, cloud shadows.
  vrect(hd, 0, groundY, hd.w, hd.Y(23), hdMix(ground, night ? hdHex("#3d5a3a") : hdHex("#9ac05a"), 0.18), ground)
  vrect(hd, 0, hd.Y(23), hd.w, hd.h, hdDarken(ground, 0.86), hdDarken(ground, 0.7))
  for (let i = 0; i < 420; i++) {
    const rx = hash2(i, 31) * hd.w
    const depth = Math.pow(hash2(i, 32), 0.8)
    const by = groundY + depth * (hd.Y(23) - groundY)
    const len = S * (0.12 + depth * 0.5)
    const sway = Math.sin(theta + rx * 0.012 + i) * len * 0.35
    const tone = hdMix(
      hdDarken(grass, 0.8),
      night ? hdHex("#6a8a60") : hdHex("#b8d66a"),
      hash2(i, 33) * (night ? 0.25 : 0.7),
    )
    const steps = Math.max(2, Math.ceil(len))
    for (let s = 0; s < steps; s++) {
      const f = s / steps
      hd.set(Math.round(rx + sway * f * f), Math.round(by - len * f), tone)
    }
  }
  for (const [sx, w] of [
    [0.25, 0.3],
    [0.62, 0.22],
  ] as const) {
    // Soft cloud shadow gliding over the grass, looping with the cycle.
    const cx = (((sx - phase) % 1) + 1) % 1
    glow(hd, cx * hd.w, hd.Y(19.5), hd.cw * 22 * w * 4, hdHex("#000000"), night ? 0.1 : 0.17, 0.2)
  }

  // Ger: dome, felt wall, rope band, painted door, and a stove pipe.
  const felt = hdHex(c.yurt)
  const feltDark = hdHex(c.yurtBg)
  const door = hdHex(c.door)
  const yurt = STEPPE_YURT
  const gx0 = hd.X(yurt.x0 + 0.35)
  const gx1 = hd.X(yurt.x1 - 0.25)
  const gxc = (gx0 + gx1) / 2
  const gr = (gx1 - gx0) / 2
  const wallTop = hd.Y(yurt.top + 1.85)
  const wallBot = hd.Y(yurt.base + 0.85)
  glow(hd, gxc, wallBot, gr * 1.5, hdHex("#000000"), night ? 0.35 : 0.3, 0.14)
  const wallLit = night ? hdMix(felt, hdHex(c.glow), 0.12) : hdMix(felt, hdHex("#ffffff"), 0.2)
  for (let y = Math.floor(wallTop); y < Math.ceil(wallBot); y++) {
    for (let x = Math.floor(gx0); x < Math.ceil(gx1); x++) {
      const u = (x + 0.5 - gxc) / gr
      hd.set(x, y, hdMix(wallLit, hdDarken(feltDark, night ? 0.7 : 0.85), clamp01(((u + 1) / 2) * 0.95 + 0.05)))
    }
  }
  // Conical roof with a curved profile and a roof ring.
  const roofTop = hd.Y(yurt.top + 0.45)
  for (let y = Math.floor(roofTop); y < Math.ceil(wallTop) + 1; y++) {
    const f = clamp01((y + 0.5 - roofTop) / (wallTop - roofTop || 1))
    const hw = gr * (0.28 + 0.8 * Math.pow(f, 0.8)) * 1.02
    for (let x = Math.floor(gxc - hw); x < Math.ceil(gxc + hw); x++) {
      const u = (x + 0.5 - gxc) / (hw || 1)
      let col = hdMix(hdMix(felt, hdHex("#ffffff"), night ? 0 : 0.35), hdDarken(feltDark, 0.9), clamp01((u + 1) / 2))
      if (night) col = hdMix(col, hdHex(c.glow), 0.04)
      if ((x - gxc + 10000) % Math.max(4, gr * 0.28) < 1) col = hdDarken(col, 0.9)
      hd.set(x, y, col)
    }
  }
  hd.rect(gxc - gr * 0.17, roofTop - S * 0.1, gxc + gr * 0.17, roofTop + S * 0.06, hdDarken(feltDark, 0.7))
  // Rope band and painted door.
  hd.rect(gx0, wallTop + S * 0.1, gx1, wallTop + S * 0.2, hdHex(night ? "#8a3a30" : "#c8503a"))
  const dx0 = hd.X(54.7)
  const dx1 = hd.X(56.5)
  const dTop = hd.Y(yurt.top + 2.35)
  hd.rect(dx0 - 2, dTop - 2, dx1 + 2, wallBot, hdMix(door, hdHex("#c8503a"), night ? 0.15 : 0.35))
  hd.rect(dx0, dTop, dx1, wallBot, night ? hdMix(door, hdHex(c.glow), 0.12) : door)
  hd.rect((dx0 + dx1) / 2 - 0.6, dTop, (dx0 + dx1) / 2 + 0.6, wallBot, hdDarken(door, 0.7))
  if (night) glow(hd, (dx0 + dx1) / 2, wallBot, hd.cw * 4, hdHex(c.glow), 0.25, 0.3)
  const wx = hd.X(58.3)
  const wy = hd.Y(yurt.top + 1.65)
  const wr = Math.max(1.6, hd.cw * (night ? 0.55 : 0.38))
  if (night) glow(hd, wx, wy, wr * 7, hdHex(c.glow), 0.55)
  hd.disk(wx, wy, wr, night ? hdHex(c.glow) : door)
  // Stove pipe and rising smoke puffs.
  hd.rect(
    hd.X(STEPPE_SMOKE_X) - 1.5,
    hd.Y(11.15),
    hd.X(STEPPE_SMOKE_X) + 1.5,
    roofTop + S * 0.6,
    hdDarken(feltDark, 0.5),
  )
  const smoke = hdHex(c.smoke)
  for (let i = 0; i < 6; i++) {
    const rise = ((tick + i * 2) % 12) / 12
    const px = hd.X(STEPPE_SMOKE_X + Math.sin(theta + i) * 0.35 + rise * 2.5)
    const py = hd.Y(11.15 - rise * 4.2)
    glow(
      hd,
      px,
      py,
      Math.max(2, hd.cw * (0.4 + rise * 1.1)),
      hdMix(smoke, around, rise * 0.5),
      0.55 * (1 - rise * 0.8),
      0.9,
    )
  }
  // Sheep dotting the slope behind the ger.
  for (let i = 0; i < 7; i++) {
    const sx = hd.X(40 + i * 1.7 + hash2(i, 5) * 1.5)
    const sy = hd.Y(14.9 + hash2(i, 6) * 0.7)
    hd.blob(sx, sy, hd.cw * 0.55, hd.ch * 0.2, night ? hdHex("#8a8a96") : hdHex("#f0ece0"))
    hd.disk(sx + hd.cw * 0.5, sy, hd.cw * 0.14, night ? hdHex("#2c2c34") : hdHex("#3a3028"))
  }

  // Herd: shaded silhouettes with neck, head, mane, tail, and four moving legs.
  const hide = hdHex(c.herd)
  const hideLit = hdMix(hide, night ? hdHex("#4a5a80") : hdHex("#a08060"), night ? 0.3 : 0.38)
  const herd = steppeHerd(elapsed)
  herd.forEach((horse, hi) => {
    const hx = hd.X(horse.x + 1.0)
    const y = hd.Y(STEPPE_GROUND_TOP - 1.4)
    const L = Math.max(4, hd.cw * 2.3)
    const gait = Math.sin(theta * 6 + hi * 1.3)
    const bob = gait * hd.ch * 0.05
    const body = hd.ch * 0.34
    glow(hd, hx, y + hd.ch * 0.95, L * 1.5, hdHex("#000000"), night ? 0.3 : 0.28, 0.1)
    // Legs first so the body overlaps their tops.
    for (const [lx, lph] of [
      [-0.62, 0],
      [-0.4, 2.1],
      [0.42, 1],
      [0.62, 3.1],
    ] as const) {
      const swing = Math.sin(theta * 6 + hi * 1.3 + lph) * L * 0.2
      const x0 = hx + lx * L
      const lw = Math.max(1.1, hd.cw * 0.14)
      const steps = 16
      for (let s = 0; s <= steps; s++) {
        const f = s / steps
        hd.disk(
          x0 + swing * f,
          y + bob + body * 0.6 + f * hd.ch * 0.9 - (f > 0.8 ? Math.abs(swing) * 0.1 : 0),
          lw,
          hdDarken(hide, 0.9),
        )
      }
    }
    hd.blob(hx, y + bob, L, body, hide)
    hd.blob(hx - L * 0.1, y + bob - body * 0.35, L * 0.85, body * 0.45, hideLit)
    // Neck and head reaching forward, mane and tail streaming.
    const nx = hx + L * 0.75
    for (let s = 0; s <= 6; s++) {
      const f = s / 6
      hd.disk(
        nx + f * L * 0.4,
        y + bob - body * 0.4 - f * body * 1.1,
        Math.max(1.3, hd.cw * 0.22 * (1 - f * 0.25)),
        hide,
      )
    }
    hd.blob(nx + L * 0.62, y + bob - body * 1.35, L * 0.34, body * 0.38, hide)
    hd.disk(nx + L * 0.44, y + bob - body * 1.65, Math.max(1, hd.cw * 0.1), hide)
    for (let s = 0; s < 5; s++) {
      hd.disk(
        nx + s * L * 0.07 - L * 0.1,
        y + bob - body * (0.55 + s * 0.22),
        Math.max(1, hd.cw * 0.1),
        hdDarken(hide, 0.65),
      )
    }
    for (let s = 0; s <= 6; s++) {
      const f = s / 6
      hd.disk(
        hx - L * 0.95 - f * L * 0.45,
        y + bob - body * 0.25 + f * body * 1.1 + gait * f * 2,
        Math.max(1, hd.cw * 0.13),
        hdDarken(hide, 0.7),
      )
    }
    // Dust puff behind the hooves.
    glow(hd, hx - L * 1.3, y + hd.ch * 0.95, L * 1.2, hdMix(ground, hdHex("#d0c090"), 0.5), night ? 0.12 : 0.28, 0.3)
  })

  const mote = hdMix(grass, hdHex(c.cloud), 0.5)
  for (let i = 0; i < 12; i++) {
    const x = (i * 11 + 4 + phase * STEPPE_COLUMNS) % STEPPE_COLUMNS
    const y = 7.2 + (i % 5) * 0.7 + Math.sin(theta * 2 + i) * 0.2
    if (night) blendPx(hd, Math.floor(hd.X(x)), Math.floor(hd.Y(y)), hdHex(c.glow), 0.6)
    else hd.disk(hd.X(x), hd.Y(y), Math.max(1, hd.cw * 0.12), mote)
  }
  return hd.pixels
}
