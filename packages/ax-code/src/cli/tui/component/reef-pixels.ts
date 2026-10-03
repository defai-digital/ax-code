import { artHash, artLine, blendPixel, glow, polyFill, softDisk, vignette } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  REEF_COLORS,
  REEF_COLUMNS,
  REEF_CORALS,
  REEF_CYCLE_MS,
  REEF_KELP,
  REEF_RAYS,
  REEF_ROWS,
  REEF_SAND_TOP,
  reefBubbles,
  reefFish,
  reefPlankton,
  reefRipple,
  reefSkyRgb,
  reefSway,
  type ReefStyle,
} from "./reef-view-model"

/**
 * Freeform HD renderer. Graded water with a rippling surface, soft god rays,
 * branching, brain, and fan corals with polyps, swaying kelp and sea grass,
 * a fish school and a gliding turtle by day, glowing jellyfish and plankton
 * by night, rising bubbles, and caustic light on the sand come from the
 * shared scene model. Pure: every pixel derives from `elapsedMs`.
 */
export function renderReefPixels(width: number, height: number, style: ReefStyle, elapsedMs: number): Buffer {
  let w = Math.max(0, Math.floor(width))
  let h = Math.max(0, Math.floor(height))
  if (w > 0 && h > 0) {
    const scale = Math.min(1, 1920 / w, 1080 / h)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  const hd = createHdCanvas(w, h, REEF_COLUMNS, REEF_ROWS)
  if (w === 0 || h === 0) return hd.pixels
  const night = style === "reef-night"
  const c = REEF_COLORS[style]
  const elapsed = Math.max(0, elapsedMs)
  const cycle = (elapsed % REEF_CYCLE_MS) / REEF_CYCLE_MS
  const phase = cycle * Math.PI * 2
  const u = Math.min(hd.cw, hd.ch / 2)
  const water = hdHex(c.water)
  const coral = hdHex(c.coral)
  const polyp = hdHex(c.polyp)
  const bubble = hdHex(c.bubble)
  const ray = hdHex(c.ray)
  const kelp = hdHex(c.kelp)
  const sand = hdHex(c.sand)
  const shell = hdHex(c.shell)
  const sandY = hd.Y(REEF_SAND_TOP)
  const glide = reefRipple(elapsed)
  const fogColor = hdMix(reefSkyRgb(style, 0.55), [10, 30, 60], night ? 0.2 : 0)

  // Water column: bright near the surface, deepening toward the sand, with a
  // lighter midwater haze for depth.
  hd.sky((t) => {
    const v = Math.min(1, (t * hd.h) / (sandY || 1))
    return hdMix(hdMix(reefSkyRgb(style, 0), water, Math.min(1, v * 1.6)), reefSkyRgb(style, 1), Math.pow(v, 1.4) * 0.9)
  })
  // Surface band: rippling bright ceiling.
  const surfaceH = hd.Y(0.9)
  for (let y = 0; y < Math.min(h, Math.ceil(surfaceH + hd.ch)); y++) {
    for (let x = 0; x < w; x++) {
      const px = x / hd.cw
      const wave = Math.sin(px * 1.3 + phase + glide) + Math.sin(px * 0.5 - phase * 2) * 0.6
      const edge = surfaceH + wave * hd.ch * 0.12
      const k = Math.max(0, 1 - Math.max(0, y - edge) / (hd.ch * 1.2))
      blendPixel(hd, x, y, night ? [60, 90, 150] : [190, 236, 250], k * (night ? 0.3 : 0.55))
    }
  }

  // Distant reef silhouettes and a rock arch in the haze.
  for (let layer = 0; layer < 2; layer++) {
    const baseCol = hdMix(hdDarken(water, night ? 0.55 : 0.8), fogColor, layer === 0 ? 0.7 : 0.45)
    for (let x = 0; x < w; x++) {
      const px = x / hd.cw
      const top =
        sandY -
        hd.ch * (3.4 - layer * 1.1) -
        Math.sin(px * 0.19 + layer * 2) * hd.ch * 1.1 -
        Math.abs(Math.sin(px * 0.07 + layer)) * hd.ch * 1.6 -
        artHash(Math.floor(px * 1.5), layer) * hd.ch * 0.4
      for (let y = Math.max(0, Math.floor(top)); y < sandY; y++) blendPixel(hd, x, y, baseCol, 0.9)
    }
  }

  // God rays: soft slanted shafts that sway on the cycle.
  if (!night) {
    for (const shaft of REEF_RAYS) {
      const sway = Math.sin(phase + shaft) * hd.cw * 0.8
      const x0 = hd.X(shaft) + sway
      const width0 = hd.cw * 2.2
      const slant = hd.cw * 5
      for (let y = Math.floor(surfaceH); y < sandY; y++) {
        const v = (y - surfaceH) / (sandY - surfaceH)
        const cx = x0 + slant * v
        const half = width0 * (0.8 + v * 1.9)
        for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(w, Math.ceil(cx + half)); x++) {
          const d = Math.abs(x - cx) / half
          blendPixel(hd, x, y, ray, (1 - d) * (1 - d) * 0.22 * (1 - v * 0.7))
        }
      }
    }
  }
  // Floating motes and the beat of the surface light.
  for (let i = 0; i < 8; i++) {
    const x = (i * 9 + glide * 4) % REEF_COLUMNS
    softDisk(hd, hd.X(x + 0.5), hd.Y(2.4 + (i % 3) * 1.5), Math.max(1, u * 0.1), hdMix(ray, bubble, 0.35), 0.5)
  }

  // Sand bed with ripples, lit by animated caustics by day.
  for (let y = Math.max(0, Math.floor(sandY)); y < h; y++) {
    const v = (y - sandY) / (h - sandY || 1)
    for (let x = 0; x < w; x++) {
      const px = x / hd.cw
      const rip = Math.sin(px * 1.7 + y * 0.12 + Math.sin(px * 0.3) * 2)
      let col = hdMix(hdMix(sand, fogColor, 0.28 - v * 0.2), hdDarken(sand, 0.7), v * 0.5)
      col = hdDarken(col, 1 + rip * 0.04 + (artHash(x, y) - 0.5) * 0.05)
      if (!night) {
        const a = Math.sin(px * 2.3 + phase + Math.sin(y * 0.09 + phase) * 1.4)
        const b = Math.sin(px * 1.4 - phase + y * 0.13)
        const caustic = Math.max(0, 1 - Math.abs(a + b) * 1.5)
        col = hdMix(col, [255, 255, 235], caustic * 0.28)
      }
      hd.set(x, y, col)
    }
  }
  // Rim of the sand where it meets the water.
  for (let x = 0; x < w; x++) blendPixel(hd, x, Math.floor(sandY), hdDarken(sand, 0.6), 0.5)

  // Kelp ribbons and sea grass.
  const blade = (bx: number, by: number, hgt: number, seed: number, thick: number, color: RGB) => {
    let px = bx
    let py = by
    const seg = 12
    for (let i = 1; i <= seg; i++) {
      const t = i / seg
      const nx = bx + Math.sin(phase + seed + t * 2.4) * hd.cw * 1.4 * t + reefSway(elapsed, seed) * hd.cw * 0.25 * t
      const ny = by - hgt * t
      artLine(hd, px, py, nx, ny, thick * (1 - t * 0.7), thick * (1 - t * 0.8), hdMix(hdDarken(color, 0.7), color, t))
      px = nx
      py = ny
    }
    return [px, py] as const
  }
  for (const frond of REEF_KELP) {
    for (let k = 0; k < 4; k++) {
      blade(hd.X(frond + 0.5 + k * 0.5), sandY + hd.ch * 0.5, hd.ch * (6 + k), frond + k, u * 0.22, kelp)
    }
  }
  for (let i = 0; i < 26; i++) {
    const gx = hd.X(4 + i * 2.8 + artHash(i, 1) * 1.8)
    blade(gx, sandY + hd.ch * 0.6, hd.ch * (1.1 + artHash(i, 2) * 1.3), i, u * 0.1, hdMix(kelp, polyp, 0.12))
  }

  // Coral: branching staghorn, ridged brain domes, and sea fans.
  const palette: RGB[] = night ? [coral, [190, 70, 220], [80, 150, 255]] : [coral, [235, 120, 190], [248, 190, 70]]
  const glowTip = (x: number, y: number, color: RGB, r: number) => {
    if (night) glow(hd, x, y, r * 4, color, 0.45)
    softDisk(hd, x, y, r, color)
  }
  const branch = (
    x: number,
    y: number,
    ang: number,
    len: number,
    depth: number,
    thick: number,
    seed: number,
    color: RGB,
  ) => {
    const sway = Math.sin(phase + seed * 0.9 + depth) * 0.04
    const a = ang + sway
    const nx = x + Math.cos(a) * len
    const ny = y - Math.sin(a) * len
    artLine(hd, x, y, nx, ny, thick, thick * 0.78, hdMix(hdDarken(color, 0.65), color, 1 - depth * 0.18))
    if (depth >= 3) {
      glowTip(nx, ny, hdMix(color, polyp, 0.7), Math.max(1, thick * 0.9))
      return
    }
    const spread = 0.42 + artHash(seed, depth) * 0.3
    branch(nx, ny, a + spread, len * 0.74, depth + 1, thick * 0.8, seed * 3 + 1, color)
    branch(nx, ny, a - spread, len * 0.74, depth + 1, thick * 0.8, seed * 3 + 2, color)
    if (depth === 1)
      branch(nx, ny, a + (artHash(seed, 9) - 0.5) * 0.2, len * 0.6, depth + 2, thick * 0.6, seed * 3 + 3, color)
  }
  const placeCoral = (head: number, i: number, scale: number, offset: number) => {
    const cx = hd.X(head + 0.5 + offset)
    const by = sandY + hd.ch * 0.3
    const color = palette[(i + (offset === 0 ? 0 : 1)) % palette.length]!
    const kind = i % 3
    const s = scale
    if (kind === 0) {
      for (let b = -2; b <= 2; b++) {
        branch(cx + b * u * 0.5 * s, by, Math.PI / 2 + b * 0.3, hd.ch * 1.6 * s, 0, u * 0.5 * s, i * 7 + b + 5, color)
      }
      softDisk(hd, cx, by, u * 1.6 * s, hdDarken(color, 0.5))
    } else if (kind === 1) {
      const r = hd.ch * 2.1 * s
      const rx = r * 1.15
      for (let y = Math.floor(by - r); y <= by; y++) {
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          const dx = (x - cx) / rx
          const dy = (y - by) / r
          const d = dx * dx + dy * dy
          if (d > 1) continue
          const lit = Math.max(0, -dx * 0.5 - dy * 0.6)
          let col = hdMix(hdDarken(color, 0.55), hdMix(color, polyp, 0.3), 0.35 + lit * 0.7)
          const grooves = Math.sin(Math.atan2(dy, dx) * 6 + Math.sqrt(d) * 14 + i)
          if (grooves > 0.55) col = hdDarken(col, 0.78)
          if (d > 0.86) col = hdDarken(col, 0.85)
          hd.set(x, y, col)
        }
      }
      if (night) glow(hd, cx, by - r * 0.5, r * 2.2, color, 0.25)
    } else {
      const radius = hd.ch * 3.4 * s
      for (let k = -8; k <= 8; k++) {
        const a = Math.PI / 2 + k * 0.17 + Math.sin(phase + i) * 0.03
        artLine(
          hd,
          cx,
          by,
          cx + Math.cos(a) * radius,
          by - Math.sin(a) * radius,
          u * 0.1,
          u * 0.07,
          hdMix(color, polyp, 0.25),
        )
      }
      for (let ring = 1; ring <= 3; ring++) {
        const rr = (radius * ring) / 3.2
        for (let k = -8; k < 8; k++) {
          const a0 = Math.PI / 2 + k * 0.17
          const a1 = a0 + 0.17
          artLine(
            hd,
            cx + Math.cos(a0) * rr,
            by - Math.sin(a0) * rr,
            cx + Math.cos(a1) * rr,
            by - Math.sin(a1) * rr,
            u * 0.06,
            u * 0.06,
            hdMix(color, polyp, 0.4),
            0.8,
          )
        }
      }
      if (night) glow(hd, cx, by - radius * 0.55, radius * 1.1, color, 0.22)
    }
  }
  REEF_CORALS.forEach((head, i) => {
    placeCoral(head, i, 1, 0)
    placeCoral(head, i + 1, 0.55, i % 2 === 0 ? 4.2 : -4.2)
    // Small rock base grounds each cluster.
    hd.blob(hd.X(head + 0.5), sandY + hd.ch * 0.5, u * 3.4, u * 0.55, hdDarken(sand, 0.55))
  })

  // Day: school of fish with fanning tails and a gliding sea turtle.
  if (!night) {
    const fish = hdHex(c.fish)
    for (const [i, swimmer] of reefFish(elapsed).entries()) {
      const fx = hd.X(swimmer.x + 1.5)
      const fy = hd.Y(swimmer.y + 0.5) + Math.sin(phase * 2 + i) * u * 0.25
      const fl = u * 1.25
      const flick = Math.sin(phase * 6 + i) * u * 0.28
      polyFill(
        hd,
        [
          [fx - fl * 1.1, fy - fl * 0.55 + flick],
          [fx - fl * 0.55, fy],
          [fx - fl * 1.1, fy + fl * 0.55 + flick],
        ],
        () => hdMix(fish, coral, 0.35),
      )
      for (let k = -1; k <= 1; k++)
        softDisk(hd, fx + k * fl * 0.35, fy, fl * 0.55, hdMix(fish, [255, 255, 255], k * -0.08 + 0.06))
      softDisk(hd, fx + fl * 0.1, fy + fl * 0.3, fl * 0.38, hdMix(fish, [255, 255, 255], 0.4), 0.6)
      artLine(hd, fx - fl * 0.2, fy - fl * 0.5, fx + fl * 0.1, fy - fl * 0.2, 1, 1, hdDarken(fish, 0.7))
      softDisk(hd, fx + fl * 0.95, fy - fl * 0.12, Math.max(0.9, fl * 0.12), [20, 30, 50])
    }
    const tx = hd.X(-12 + cycle * (REEF_COLUMNS + 24))
    const ty = hd.Y(5.5) + Math.sin(phase) * u * 0.6
    const shellCol = hdMix(hdHex("#5b8a4a"), water, 0.2)
    softDisk(hd, tx, ty, u * 2.3, hdDarken(shellCol, 0.8))
    softDisk(hd, tx - u * 0.1, ty - u * 0.1, u * 2.0, shellCol)
    for (const [dx, dy] of [
      [-0.8, -0.4],
      [0.5, -0.5],
      [0.1, 0.5],
      [-0.4, 0.4],
    ] as const) {
      softDisk(hd, tx + dx * u, ty + dy * u, u * 0.55, hdMix(shellCol, [200, 220, 120], 0.3), 0.7)
    }
    const flip = Math.sin(phase * 2) * u * 0.5
    artLine(
      hd,
      tx + u * 0.6,
      ty + u * 1.2,
      tx + u * 2.2,
      ty + u * 2.3 + flip,
      u * 0.4,
      u * 0.18,
      hdDarken(shellCol, 0.9),
    )
    artLine(
      hd,
      tx + u * 0.6,
      ty - u * 1.2,
      tx + u * 2.2,
      ty - u * 2.3 - flip,
      u * 0.4,
      u * 0.18,
      hdDarken(shellCol, 0.9),
    )
    artLine(
      hd,
      tx - u * 0.9,
      ty + u * 1.2,
      tx - u * 2.1,
      ty + u * 1.9 - flip,
      u * 0.3,
      u * 0.14,
      hdDarken(shellCol, 0.9),
    )
    artLine(hd, tx + u * 2.1, ty, tx + u * 3.5, ty - u * 0.2, u * 0.55, u * 0.4, hdDarken(shellCol, 0.95))
    softDisk(hd, tx + u * 3.6, ty - u * 0.2, u * 0.55, hdDarken(shellCol, 1.1))
  } else {
    // Night: pulsing jellyfish drift up and loop back down.
    for (let i = 0; i < 3; i++) {
      const jx = hd.X(14 + i * 22) + Math.sin(phase + i * 2) * hd.cw * 1.5
      const jy = hd.Y(5 + ((i * 5 + cycle * 8) % 9)) + Math.sin(phase * 2 + i) * u * 0.3
      const pulse = 1 + Math.sin(phase * 4 + i) * 0.1
      const col: RGB = [150, 120, 255]
      glow(hd, jx, jy, u * 7, col, 0.4)
      for (let y = -Math.round(u * 1.6); y <= 0; y++) {
        const span = Math.sqrt(Math.max(0, 1 - (y / (u * 1.6)) ** 2)) * u * 2 * pulse
        for (let x = -Math.round(span); x <= Math.round(span); x++) {
          blendPixel(
            hd,
            Math.round(jx + x),
            Math.round(jy + y),
            hdMix(col, polyp, 0.3),
            0.55 + (y / (u * 1.6) + 1) * 0.2,
          )
        }
      }
      for (let t = -3; t <= 3; t++) {
        artLine(
          hd,
          jx + t * u * 0.5,
          jy,
          jx + t * u * 0.5 + Math.sin(phase * 2 + t) * u * 0.4,
          jy + u * 3.4,
          u * 0.08,
          u * 0.04,
          hdMix(col, polyp, 0.5),
          0.7,
        )
      }
    }
    const plankton = hdHex(c.plankton)
    for (const mote of reefPlankton(elapsed)) {
      const mx = hd.X(mote.x + 0.5)
      const my = hd.Y(mote.y + 0.5)
      glow(hd, mx, my, u * 1.6, plankton, 0.5)
      softDisk(hd, mx, my, Math.max(0.9, u * 0.1), plankton)
    }
    // Moonlight dapples on the surface.
    glow(hd, hd.X(58), hd.Y(0.6), hd.cw * 12, [140, 170, 255], 0.28)
  }

  // Bubbles rise with a bright rim.
  for (const risen of reefBubbles(elapsed)) {
    const bx = hd.X(risen.x + 0.5)
    const by = hd.Y(risen.y + 0.5)
    const r = Math.max(1.8, u * 0.2)
    softDisk(hd, bx, by, r, bubble, 0.22)
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2
      blendPixel(hd, Math.round(bx + Math.cos(ang) * r), Math.round(by + Math.sin(ang) * r), [255, 255, 255], 0.65)
    }
    softDisk(hd, bx - r * 0.35, by - r * 0.35, Math.max(0.7, r * 0.28), [255, 255, 255], 0.9)
  }

  // Shells and a starfish on the sand.
  for (const clam of [12, 34, 58]) {
    const cx = hd.X(clam + 0.5)
    const cy = hd.Y(REEF_SAND_TOP + 0.9)
    softDisk(hd, cx, cy + u * 0.15, u * 0.7, hdDarken(sand, 0.6), 0.5)
    for (let k = -3; k <= 3; k++)
      artLine(
        hd,
        cx,
        cy + u * 0.3,
        cx + k * u * 0.22,
        cy - u * 0.4,
        u * 0.1,
        u * 0.1,
        hdMix(shell, [255, 240, 230], 0.2 + Math.abs(k) * 0.05),
      )
  }
  {
    const sx = hd.X(46.5)
    const sy = hd.Y(REEF_SAND_TOP + 1.7)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2
      artLine(
        hd,
        sx,
        sy,
        sx + Math.cos(a) * u * 0.9,
        sy + Math.sin(a) * u * 0.5,
        u * 0.2,
        u * 0.05,
        hdMix(shell, coral, 0.4),
      )
    }
  }

  vignette(hd, night ? 0.45 : 0.22)
  return hd.pixels
}
