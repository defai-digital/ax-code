import { paintContour, paintVolume } from "./scene-volume"
import { blendPixel } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  DINOSAUR_COLORS,
  DINOSAUR_COLUMNS,
  DINOSAUR_CYCLE_MS,
  DINOSAUR_GROUND_TOP,
  DINOSAUR_MOON,
  DINOSAUR_NEST,
  DINOSAUR_ROWS,
  DINOSAUR_STARS,
  DINOSAUR_SUN,
  DINOSAUR_VOLCANO,
  dinosaurPtero,
  dinosaurSkyRgb,
  dinosaurWalker,
  type DinosaurStyle,
} from "./dinosaur-view-model"
import { hash } from "./atmos-paint"
import { actionProgress } from "./scene-cinema"

/** Smooth 1D value noise. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u
}

/**
 * Freeform HD prehistoric valley. A long-necked sauropod grazes center-stage
 * under fern trees, a volcano smokes in the distance, pterosaurs ride the
 * sky, a baby dinosaur toddles through the foreground past a footprint
 * trail, and an egg nest waits at the edge: grazed by day (opening),
 * firefly-lit at night (ending). Pure and deterministic: everything derives
 * from `elapsedMs` and loops at 3600ms.
 */
export function renderDinosaurPixels(width: number, height: number, style: DinosaurStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, DINOSAUR_COLUMNS, DINOSAUR_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "dinosaur-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % DINOSAUR_CYCLE_MS) / DINOSAUR_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = DINOSAUR_COLORS[style]
  const { w, h, cw, ch } = hd
  const px = hd.pixels
  const blend = (x: number, y: number, color: RGB, alpha: number) => blendPixel(hd, x, y, color, alpha)
  const glow = (cx: number, cy: number, rx: number, ry: number, color: RGB, strength: number) => {
    const xa = Math.max(0, Math.floor(cx - rx))
    const xb = Math.min(w - 1, Math.ceil(cx + rx))
    const ya = Math.max(0, Math.floor(cy - ry))
    const yb = Math.min(h - 1, Math.ceil(cy + ry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d >= 1) continue
        blend(x, y, color, strength * (1 - d) * (1 - d))
      }
    }
  }
  const ground = hdHex(c.ground)
  const groundDark = hdHex(c.groundDark)
  const dino = hdHex(night ? "#718e92" : "#829676")
  const orb = night ? DINOSAUR_MOON : DINOSAUR_SUN
  const orbX = hd.X(orb.x)
  const orbY = hd.Y(orb.y)
  const coreR = Math.max(3, Math.min(cw, ch) * 0.9)
  const skyAt = (sceneY: number) => dinosaurSkyRgb(style, sceneY / DINOSAUR_ROWS)

  // Sky, sun or moon bloom, stars.
  hd.sky((t) => dinosaurSkyRgb(style, t))
  glow(orbX, orbY, cw * 16, ch * 7, night ? hdHex("#9fb4e0") : hdHex("#fff0c0"), night ? 0.22 : 0.42)
  if (night) hd.stars(DINOSAUR_STARS, hdHex("#e8f0ff"), (index) => (Math.floor(elapsed / 600) + index) % 3 === 0)
  if (night) {
    hd.disk(orbX, orbY, coreR * 1.55, hdMix(hdHex("#c8d6f5"), skyAt(orb.y), 0.55))
    hd.disk(orbX, orbY, coreR, hdHex("#eef4ff"))
    hd.disk(orbX - coreR * 0.3, orbY - coreR * 0.2, coreR * 0.28, hdHex("#c9d4ee"))
  } else {
    hd.halo(orbX, orbY, coreR, hdHex("#fffbe0"), hdHex(c.sun), skyAt(orb.y))
  }

  // Distant hills: static layered ridges above the ground line.
  const hill = hdHex(c.hill)
  const hillFar = hdHex(c.hillFar)
  const groundPx = Math.floor(hd.Y(DINOSAUR_GROUND_TOP))
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    const ridge = 13.5 - noise1(sx * 0.22, 7) * 2.6 - Math.max(0, 1 - Math.abs(sx - 26) / 14) * 1.4
    const top = hd.Y(ridge)
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(h, groundPx); y++) {
      const u = (y - top) / (groundPx - top || 1)
      const color = hdDarken(hdMix(hillFar, hill, Math.max(0, Math.min(1, u * 1.5))), 0.94 + hash(x >> 1, y >> 1) * 0.1)
      const i = (y * w + x) * 3
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
    }
  }

  // Volcano cone with a lava cap and drifting smoke.
  paintContour(
    hd,
    [
      [55.5, 14],
      [58, 11.5],
      [60.1, 8.4],
      [61.5, 6],
      [64.4, 6.1],
      [66, 8.8],
      [68, 11.7],
      [71, 14],
    ],
    (x, y) => {
      const sx = x / cw,
        sy = y / ch
      const ridge = 0.7 + noise1(sx * 1.2 - sy * 0.25, 32) * 0.3
      return hdDarken(hdHex(night ? "#4a4646" : "#8e8276"), ridge * (0.85 + (64 - sx) * 0.025))
    },
  )
  hd.blob(hd.X(DINOSAUR_VOLCANO.x + 1), hd.Y(DINOSAUR_VOLCANO.top + 0.2), cw * 1.2, ch * 0.3, hdHex(c.lava))
  if (night) glow(hd.X(DINOSAUR_VOLCANO.x + 1), hd.Y(DINOSAUR_VOLCANO.top), cw * 4, ch * 1.6, hdHex(c.lava), 0.5)
  for (let k = 0; k < 5; k++) {
    const rise = (((phase + k / 5) % 1) + 1) % 1
    const sx = DINOSAUR_VOLCANO.x + 1 + rise * 3 + Math.sin(rise * 6 + k) * 0.5
    const sy = DINOSAUR_VOLCANO.top - 0.6 - rise * 4
    const r = (0.5 + rise * 1.3) * Math.min(cw, ch)
    const puff = hd.Y(sy)
    for (let y = Math.max(0, Math.floor(puff - r)); y <= Math.min(h - 1, Math.ceil(puff + r)); y++) {
      for (let x = Math.max(0, Math.floor(hd.X(sx) - r)); x <= Math.min(w - 1, Math.ceil(hd.X(sx) + r)); x++) {
        const d = Math.hypot(x + 0.5 - hd.X(sx), y + 0.5 - puff) / r
        if (d < 1) blend(x, y, hdHex(c.smoke), 0.4 * (1 - rise) * (1 - d))
      }
    }
  }

  // Ground: grass gradient with grain, then the footprint trail.
  for (let y = groundPx; y < h; y++) {
    const u = (y - groundPx) / Math.max(1, h - groundPx)
    for (let x = 0; x < w; x++) {
      const color = hdDarken(hdMix(ground, groundDark, u), 0.95 + hash(x >> 1, y >> 1) * 0.09)
      const i = (y * w + x) * 3
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
    }
  }
  const footprint = hdHex(c.footprint)
  for (let i = 0; i < 6; i++) {
    hd.blob(hd.X(7 + i * 11), hd.Y(22.4 + (i % 2) * 0.8), cw * 0.85, ch * 0.3, footprint)
    hd.disk(hd.X(6.4 + i * 11), hd.Y(22.1 + (i % 2) * 0.8), Math.max(1, cw * 0.16), footprint)
    hd.disk(hd.X(7.6 + i * 11), hd.Y(22.1 + (i % 2) * 0.8), Math.max(1, cw * 0.16), footprint)
  }

  // Fern trees framing the valley, fronds swaying with the cycle.
  const fern = hdHex(c.fern)
  const trunk = hdHex(c.trunk)
  const fernTree = (sx: number, scale: number, seed: number) => {
    const sway = Math.sin(theta + seed) * 0.35
    hd.stroke(
      sx,
      DINOSAUR_GROUND_TOP + 0.6,
      sx + sway * 0.4,
      DINOSAUR_GROUND_TOP - 4.6 * scale,
      Math.max(1, cw * 0.22 * scale),
      trunk,
    )
    const topX = sx + sway * 0.4
    const topY = DINOSAUR_GROUND_TOP - 4.6 * scale
    for (let k = -3; k <= 3; k++) {
      hd.stroke(
        topX,
        topY,
        topX + k * 0.85 * scale + sway,
        topY - (1.5 - Math.abs(k) * 0.28) * scale + Math.abs(k) * 0.35 * scale,
        Math.max(0.8, cw * 0.12 * scale),
        hdDarken(fern, 0.85 + hash(k, seed) * 0.3),
      )
      for (let leaf = 1; leaf <= 5; leaf++) {
        const t = leaf / 6
        const lx = topX + (k * 0.85 * scale + sway) * t
        const ly = topY + (-(1.5 - Math.abs(k) * 0.28) * scale + Math.abs(k) * 0.35 * scale) * t
        for (const side of [-1, 1])
          hd.stroke(
            lx,
            ly,
            lx + side * 0.45 * scale,
            ly - 0.32 * scale,
            Math.max(0.7, cw * 0.07 * scale),
            hdMix(fern, night ? [74, 107, 94] : [98, 148, 62], 0.4),
          )
      }
    }
  }
  fernTree(3.5, 1.15, 3)
  fernTree(72, 1.3, 9)
  fernTree(52, 0.7, 5)
  // Low fern tufts scattered over the ground.
  for (let i = 0; i < 14; i++) {
    const sx = 4 + hash(i, 21) * 68
    const sy = DINOSAUR_GROUND_TOP + 0.8 + hash(i, 22) * 4.4
    const sway = Math.sin(theta + i) * 0.15
    for (let k = -2; k <= 2; k++) {
      hd.stroke(
        sx,
        sy,
        sx + k * 0.22 + sway,
        sy - 0.55 - hash(i, k + 30) * 0.4,
        Math.max(0.7, cw * 0.06),
        hdDarken(fern, 0.8 + hash(k, i) * 0.35),
      )
    }
  }

  // Sculpted sauropod: overlapping depth planes, muscular shoulder, curved
  // neck and a long tapering tail. The moon is a key light, not a glowing eye.
  const bob = Math.sin(theta * 2) * 0.06
  const graze = (Math.sin(theta) * 0.5 + 0.5) * 0.65
  const skin = (x: number, y: number): RGB => {
    const sy = y / ch
    const gain = 0.62 + Math.max(0, 1 - (sy - 10) / 8) * 0.4
    const mottling = 0.94 + noise1((x / cw) * 1.6 + sy * 0.7, 83) * 0.1
    return hdDarken(dino, gain * mottling * (0.98 + hash(x >> 1, y >> 1) * 0.04))
  }
  glow(hd.X(25), hd.Y(18.5), cw * 15, ch * 0.75, hdHex("#050e0d"), 0.7)
  // Far legs are darker and end higher to establish ground-plane depth.
  for (const x of [19.2, 30]) {
    paintContour(
      hd,
      [
        [x, 14.8],
        [x + 2, 14.7],
        [x + 1.5, 16.8],
        [x + 1.8, 18.1],
        [x - 0.1, 18.1],
        [x + 0.2, 16.4],
      ],
      () => hdDarken(dino, 0.48),
    )
  }
  const wag = Math.sin(theta * 2 + 1) * 0.45
  paintContour(
    hd,
    [
      [30, 13.9],
      [35, 14],
      [41, 15.2],
      [48, 16.5 + wag],
      [53, 16.7 + wag],
      [48, 17 + wag],
      [40, 16.5],
      [34, 16.1],
      [30, 15.8],
    ],
    skin,
  )
  paintVolume(hd, 25, 14.7 + bob, 11.2, 2.65, dino, night)
  // Neck sweeps upward from the shoulder, widening smoothly at its root.
  const hx = 10.8 - graze * 0.4,
    hy = 7.1 + graze
  paintContour(
    hd,
    [
      [15, 15],
      [12.7, 12.2],
      [11.5, 9.6],
      [hx - 0.1, hy + 0.25],
      [hx + 1.2, hy + 0.1],
      [13.5, 9.6],
      [15.4, 11.7],
      [19.5, 14.5],
    ],
    skin,
  )
  // A continuous key-light strip along the neck describes its round section.
  paintContour(
    hd,
    [
      [hx + 0.3, hy + 0.4],
      [12.2, 10],
      [14.1, 12.5],
      [16.8, 14.1],
      [16.1, 14.3],
      [13.5, 12.7],
      [11.7, 10],
      [hx, hy + 0.6],
    ],
    () => hdMix(dino, night ? [151, 187, 204] : [198, 207, 167], night ? 0.52 : 0.35),
  )
  paintVolume(hd, hx, hy, 1.65, 0.58, dino, night)
  paintVolume(hd, hx - 1.1, hy + 0.16, 0.9, 0.32, hdDarken(dino, 0.86), night)
  hd.stroke(hx - 1.6, hy + 0.35, hx - 0.5, hy + 0.36, Math.max(0.5, cw * 0.035), hdHex("#283a34"))
  hd.disk(hd.X(hx + 0.25), hd.Y(hy - 0.13), Math.max(0.65, cw * 0.095), hdHex("#101c1b"))
  blend(Math.round(hd.X(hx + 0.23)), Math.round(hd.Y(hy - 0.16)), [205, 220, 195], 0.85)
  // Forelegs carry weight: wider at the joint, toes planted in contact shade.
  for (const x of [17, 29]) {
    paintContour(
      hd,
      [
        [x - 0.5, 14.4],
        [x + 2.2, 14.3],
        [x + 2, 16.4],
        [x + 1.7, 18.2],
        [x + 2.2, 18.5],
        [x - 0.2, 18.5],
        [x - 0.5, 17.9],
        [x, 16.2],
      ],
      skin,
    )
    for (let toe = 0; toe < 3; toe++)
      paintVolume(hd, x + toe * 0.62, 18.36, 0.27, 0.16, hdMix(dino, [168, 166, 137], 0.45), night)
  }
  // Sparse folds and dorsal ridges follow the form instead of polka dots.
  for (let i = 0; i < 14; i++) {
    const x = 17 + i * 1.15,
      y = 12.4 + Math.pow((x - 25) / 11, 2) * 1.1 + bob
    paintVolume(hd, x, y, 0.22, 0.16, hdDarken(dino, 0.82), night)
  }
  for (let i = 0; i < 5; i++)
    hd.stroke(20 + i * 0.42, 15.8, 20.4 + i * 0.42, 16.3, Math.max(0.5, cw * 0.035), hdDarken(dino, 0.63))

  // Baby dinosaur toddling west through the foreground, once per playback.
  const walker = dinosaurWalker(elapsed)
  const walk = actionProgress(elapsed)
  const smoothWalkerX = DINOSAUR_COLUMNS - 8 - walk * (DINOSAUR_COLUMNS - 16)
  // The gait bob settles as the walker arrives, so the end pose stands still.
  const step = Math.sin(theta * 12) * 0.18 * (1 - walk)
  const baby = hdMix(dino, hdHex(c.belly), 0.25)
  hd.blob(hd.X(smoothWalkerX + 1.5), hd.Y(walker.y + 2.6), cw * 2, ch * 0.28, hdDarken(groundDark, 0.8))
  hd.blob(hd.X(smoothWalkerX + 1.5), hd.Y(walker.y + 1.5), cw * 1.9, ch * 0.75, baby)
  hd.blob(hd.X(smoothWalkerX + 0.2), hd.Y(walker.y + 0.7), cw * 0.85, ch * 0.5, baby)
  hd.disk(hd.X(smoothWalkerX - 0.1), hd.Y(walker.y + 0.55), Math.max(1, cw * 0.16), hdHex(c.eye))
  hd.stroke(smoothWalkerX + 3.1, walker.y + 1.3, smoothWalkerX + 4.6, walker.y + 1.8, Math.max(0.8, cw * 0.18), baby)
  hd.stroke(
    smoothWalkerX + 0.8,
    walker.y + 2.1,
    smoothWalkerX + 0.6 + step,
    walker.y + 2.9,
    Math.max(0.8, cw * 0.2),
    hdDarken(baby, 0.85),
  )
  hd.stroke(
    smoothWalkerX + 2.2,
    walker.y + 2.1,
    smoothWalkerX + 2.4 - step,
    walker.y + 2.9,
    Math.max(0.8, cw * 0.2),
    hdDarken(baby, 0.85),
  )

  // Egg nest at the right edge: three eggs in a twig bowl.
  const nestX = hd.X(DINOSAUR_NEST.x + 3)
  const nestY = hd.Y(DINOSAUR_NEST.y + 1.2)
  hd.blob(nestX, nestY, cw * 3.6, ch * 0.55, hdHex(c.trunk))
  const rockEgg = night ? Math.sin(theta * 6) * 0.12 : 0
  for (let i = 0; i < 3; i++) {
    hd.blob(
      nestX + (i - 1) * cw * 1.7 + (i === 1 ? rockEgg * cw : 0),
      nestY - ch * 0.55,
      cw * 0.85,
      ch * 0.62,
      hdHex(c.egg),
    )
  }
  if (night) glow(nestX, nestY - ch, cw * 2, ch * 0.9, hdHex(c.firefly), 0.3 + 0.2 * Math.cos(theta * 6))

  // Pterosaurs overhead: bent wings flapping slowly.
  const ptero = dinosaurPtero(elapsed)
  const smoothPteroX = phase * DINOSAUR_COLUMNS
  const smoothPteroY = 3 + Math.sin(theta) * 1.5
  const feather = hdHex(c.ptero)
  const flap = Math.sin(theta * 6) * 0.35
  for (const flock of [
    { x: smoothPteroX, y: smoothPteroY, span: 2.1 },
    { x: (smoothPteroX + 9) % DINOSAUR_COLUMNS, y: smoothPteroY + 1.2, span: 1.4 },
  ]) {
    for (const dir of [-1, 1]) {
      hd.stroke(
        flock.x,
        flock.y,
        flock.x + dir * flock.span * 0.55,
        flock.y - 0.15 + flap,
        Math.max(0.9, cw * 0.14),
        feather,
      )
      hd.stroke(
        flock.x + dir * flock.span * 0.55,
        flock.y - 0.15 + flap,
        flock.x + dir * flock.span,
        flock.y + 0.1 + flap * 1.5,
        Math.max(0.8, cw * 0.09),
        feather,
      )
    }
    hd.blob(hd.X(flock.x), hd.Y(flock.y + 0.1), cw * 0.35, ch * 0.18, feather)
    hd.disk(hd.X(flock.x + 0.35), hd.Y(flock.y), Math.max(1, cw * 0.14), feather)
  }

  // Close fern silhouettes anchor the bottom corners and establish foreground scale.
  for (const side of [-1, 1]) {
    const rootX = side < 0 ? 1.5 : 74.5,
      rootY = 23.8
    for (let frond = 0; frond < 5; frond++) {
      const reach = 3.4 + frond * 1.05,
        lift = 2.1 + (4 - frond) * 0.4
      let lastX = rootX,
        lastY = rootY
      for (let segment = 1; segment <= 9; segment++) {
        const t = segment / 9
        const x = rootX - side * reach * t,
          y = rootY - lift * Math.sin(t * Math.PI * 0.65)
        hd.stroke(lastX, lastY, x, y, Math.max(0.6, cw * 0.055), hdHex(night ? "#214c40" : "#315e39"))
        for (const leafSide of [-1, 1])
          hd.stroke(
            x,
            y,
            x - side * 0.5 + leafSide * 0.4,
            y - 0.32 * (1 - t) + leafSide * 0.22,
            Math.max(0.8, cw * 0.13 * (1 - t)),
            hdHex(night ? "#315b4b" : "#4a7946"),
          )
        lastX = x
        lastY = y
      }
    }
  }

  // Fireflies after dark, dust motes by day.
  const mote = hdHex(c.firefly)
  for (let i = 0; i < (night ? 14 : 8); i++) {
    const x = 6 + hash(i, 41) * 64 + Math.sin(theta * 2 + i * 1.7) * 1.6
    const y = 13 + hash(i, 42) * 7 + Math.cos(theta * 3 + i) * 0.6
    const twinkle = 0.5 + 0.5 * Math.sin(theta * 6 + i * 2.3)
    if (night) glow(hd.X(x), hd.Y(y), cw * 0.7, ch * 0.4, mote, 0.25 + twinkle * 0.4)
    blend(Math.round(hd.X(x)), Math.round(hd.Y(y)), mote, night ? 0.4 + twinkle * 0.6 : 0.35)
  }
  return hd.pixels
}
