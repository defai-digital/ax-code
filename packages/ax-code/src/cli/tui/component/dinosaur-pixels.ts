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
  const dino = hdHex(c.dinoBg)
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
  hd.mass(
    DINOSAUR_VOLCANO.x + 1,
    DINOSAUR_VOLCANO.top,
    DINOSAUR_VOLCANO.base + 2,
    1.6,
    7.5,
    hdHex(c.volcano),
    hdDarken(hdHex(c.volcano), 0.75),
    hdHex(c.lava),
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

  // Sauropod: barrel body, four pillar legs, tapering tail, long neck.
  const bob = Math.sin(theta * 2) * 0.08
  const bodyCx = hd.X(23)
  const bodyCy = hd.Y(14.6 + bob)
  hd.blob(bodyCx, hd.Y(17.9), cw * 13, ch * 0.5, hdDarken(groundDark, 0.8))
  for (const lx of [15.5, 20, 27, 31.5]) {
    hd.rect(hd.X(lx), hd.Y(15.4 + bob), hd.X(lx + 2.1), hd.Y(18.1), hdDarken(dino, 0.88))
    hd.blob(hd.X(lx + 1), hd.Y(18.1), cw * 1.15, ch * 0.22, hdDarken(dino, 0.8))
  }
  hd.blob(bodyCx, bodyCy, cw * 12.5, ch * 2.5, dino)
  hd.blob(bodyCx, hd.Y(15.6 + bob), cw * 10.5, ch * 1.5, hdHex(c.belly))
  hd.blob(bodyCx - cw * 3, hd.Y(13.6 + bob), cw * 7, ch * 1.1, hdMix(dino, hdHex("#ffffff"), night ? 0.05 : 0.16))
  // Back spots.
  for (let i = 0; i < 5; i++) {
    hd.blob(
      hd.X(15 + i * 3.6),
      hd.Y(13.9 + bob + hash(i, 4) * 0.7),
      cw * (0.7 + hash(i, 5) * 0.6),
      ch * 0.32,
      hdDarken(dino, 0.78),
    )
  }
  // Tail sweeping right and down in tapering segments.
  const tailWag = Math.sin(theta * 2 + 1) * 0.5
  let tailX = 34.5
  let tailY = 14.2 + bob
  for (let seg = 0; seg < 5; seg++) {
    const nextX = tailX + 2.6
    const nextY = tailY + 0.75 + seg * 0.1 + tailWag * 0.12 * seg
    hd.stroke(tailX, tailY, nextX, nextY, Math.max(0.9, cw * (0.85 - seg * 0.16)), dino)
    tailX = nextX
    tailY = nextY
  }
  // Neck rising left with a small head that dips as it grazes.
  const graze = (Math.sin(theta) * 0.5 + 0.5) * 1.1
  const headX = 10.5 - graze * 0.4
  const headY = 7.6 + graze
  hd.stroke(13.5, 13.6 + bob, headX + 0.8, headY + 0.5, Math.max(1.2, cw * 0.85), dino)
  hd.stroke(14.5, 14.4 + bob, headX + 1.4, headY + 0.9, Math.max(1, cw * 0.7), hdHex(c.belly))
  hd.blob(hd.X(headX), hd.Y(headY), cw * 1.7, ch * 0.55, dino)
  hd.blob(hd.X(headX - 1.2), hd.Y(headY + 0.25), cw * 0.8, ch * 0.3, hdDarken(dino, 0.9))
  hd.disk(hd.X(headX + 0.4), hd.Y(headY - 0.2), Math.max(1.2, cw * 0.22), hdHex(c.eye))
  if (night) glow(hd.X(headX + 0.4), hd.Y(headY - 0.2), cw * 0.9, ch * 0.45, hdHex(c.eye), 0.6)

  // Baby dinosaur toddling west through the foreground.
  const walker = dinosaurWalker(elapsed)
  const smoothWalkerX = DINOSAUR_COLUMNS - 8 - phase * (DINOSAUR_COLUMNS - 16)
  const step = Math.sin(theta * 12) * 0.18
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
