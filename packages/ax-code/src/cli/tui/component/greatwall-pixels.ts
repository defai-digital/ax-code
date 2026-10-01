import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  GREATWALL_BRAZIERS,
  GREATWALL_COLORS,
  GREATWALL_COLUMNS,
  GREATWALL_FAR_TOWER,
  GREATWALL_FLAG_X,
  GREATWALL_GROUND_TOP,
  GREATWALL_PINES,
  GREATWALL_ROWS,
  GREATWALL_SUN,
  GREATWALL_TOWER,
  greatwallBirds,
  greatwallClouds,
  greatwallEagle,
  greatwallFlag,
  greatwallRidgeY,
  greatwallSkyRgb,
  greatwallSmoke,
  greatwallTorch,
  type GreatwallStyle,
} from "./greatwall-view-model"

/** Ridge-following brick wall, watchtower, and a distant beacon. */
export function renderGreatwallPixels(width: number, height: number, style: GreatwallStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, GREATWALL_COLUMNS, GREATWALL_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const c = GREATWALL_COLORS[style]
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return greatwallSkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return greatwallSkyRgb(style, py / (hd.h - 1))
  }
  const brick = hdHex(c.brick)
  const brickDark = hdHex(c.brickDark)
  const brickLit = hdHex(c.brickLight)
  const roof = hdHex(c.roof)
  const ridge = hdHex(c.ridge)
  const far = hdHex(c.ridgeFar)
  const pine = hdHex(c.pine)
  const flag = hdHex(c.flag)
  const cloud = hdHex(c.cloud)
  const smoke = hdHex(c.smoke)
  const torch = hdHex(c.torch)
  const ground = hdHex(c.ground)
  const bird = hdHex(c.bird)
  const sun = hdHex(c.sun)
  const glow = hdHex(c.sunGlow)
  const edge = hdMix(brickLit, brickDark, 0.35)
  const tower = GREATWALL_TOWER
  const mid = (tower.x0 + tower.x1) / 2

  hd.sky((t) => greatwallSkyRgb(style, t))
  hd.halo(hd.X(GREATWALL_SUN.x), hd.Y(GREATWALL_SUN.y), coreR, sun, glow, skyAt(GREATWALL_SUN.y))
  for (const puff of greatwallClouds(elapsedMs)) hd.puff(puff.x, puff.y, 6, cloud)
  for (const flyer of greatwallBirds(elapsedMs)) {
    const wing = Math.floor(Math.max(0, elapsedMs) / 300) % 2 === 0 ? 0.7 : 0.35
    const bx = hd.X(flyer.x + 0.5)
    const by = hd.Y(flyer.y + 0.5)
    hd.disk(bx, by, dot * 0.45, bird)
    hd.disk(bx - dot * wing, by - dot * 0.1, dot * 0.28, bird)
    hd.disk(bx + dot * wing, by - dot * 0.1, dot * 0.28, bird)
  }

  hd.rect(0, hd.Y(8.7), hd.w, hd.Y(10.2), far)
  hd.rect(hd.X(40), hd.Y(8.7), hd.w, hd.Y(10.2), hdDarken(far, 0.82))
  for (const pineX of GREATWALL_PINES) {
    const top = greatwallRidgeY(pineX) - 2.4
    hd.blob(hd.X(pineX + 0.8), hd.Y(top), hd.cw * 1.7, hd.ch * 0.85, pine, hdDarken(pine, 0.7))
    hd.rect(hd.X(pineX + 0.5), hd.Y(top + 0.5), hd.X(pineX + 1.05), hd.Y(top + 1.8), hdDarken(pine, 0.55))
  }

  const groundY = Math.min(hd.h, Math.ceil(hd.Y(GREATWALL_GROUND_TOP + 0.4)))
  for (let x = 0; x < hd.w; x++) {
    const sceneX = (x + 0.5) / hd.cw
    if (sceneX >= tower.x0 && sceneX <= tower.x1) continue
    const ridgeY = greatwallRidgeY(sceneX)
    const top = Math.max(0, Math.floor(hd.Y(ridgeY)))
    const sunlit = sceneX > mid
    const crenel = Math.max(1, Math.round(hd.ch * 0.28))
    for (let y = top; y < groundY; y++) {
      const cap = y < top + crenel
      const color = cap ? (Math.floor(sceneX) % 2 === 0 ? brickDark : edge) : sunlit ? brickLit : brick
      hd.set(x, y, color)
    }
    hd.set(x, top, edge)
  }

  // mass() lights the left of its terminator. The sun sits on the right, so the bright color is the shade argument.
  hd.mass(mid, tower.top + 0.8, tower.base, 3.5, 4.7, brickDark, brickLit, edge)
  hd.rect(hd.X(tower.x0 - 0.8), hd.Y(tower.top), hd.X(tower.x1 + 1.8), hd.Y(tower.top + 0.7), roof)
  hd.disk(hd.X(mid), hd.Y(tower.top + 3.2), Math.max(1.8, hd.cw * 0.4), brickDark)
  const ripple = greatwallFlag(elapsedMs)
  hd.stroke(GREATWALL_FLAG_X, 1, GREATWALL_FLAG_X, 3.3, Math.max(1.2, hd.cw * 0.1), brickDark)
  hd.blob(
    hd.X(GREATWALL_FLAG_X + 1.8),
    hd.Y(1.55),
    hd.cw * (1.35 + ripple * 0.18),
    hd.ch * 0.48,
    flag,
    hdDarken(flag, 0.75),
  )
  const eagle = greatwallEagle(elapsedMs)
  hd.disk(hd.X(eagle.x + 0.2), hd.Y(eagle.y), dot * 0.7, bird)
  hd.disk(hd.X(eagle.x - 0.8), hd.Y(eagle.y - 0.05), dot * 0.4, bird)
  hd.disk(hd.X(eagle.x + 1.1), hd.Y(eagle.y - 0.05), dot * 0.4, bird)
  for (const puff of greatwallSmoke(elapsedMs)) {
    hd.disk(hd.X(puff.x + 0.5), hd.Y(puff.y + 0.4), dot * (0.45 + (3 - puff.y) * 0.08), smoke)
  }
  const brazierOn = greatwallTorch(elapsedMs)
  for (const brazier of GREATWALL_BRAZIERS) {
    const y = greatwallRidgeY(brazier)
    hd.disk(hd.X(brazier + 0.5), hd.Y(y - 0.3), brazierOn ? dot * 0.8 : dot * 0.4, torch)
  }

  hd.rect(0, hd.Y(GREATWALL_GROUND_TOP), hd.w, hd.h, ground)
  for (let x = 0; x < GREATWALL_COLUMNS; x += 4) {
    hd.blob(hd.X(x + 1), hd.Y(GREATWALL_GROUND_TOP - 0.2), hd.cw * 1.1, hd.ch * 0.4, ridge, hdDarken(ridge, 0.75))
  }
  for (let x = 3; x < GREATWALL_COLUMNS; x += 7) {
    hd.blob(hd.X(x + 0.8), hd.Y(GREATWALL_GROUND_TOP + 4.2), hd.cw * 1.2, hd.ch * 0.4, ridge, hdDarken(pine, 0.8))
  }

  const distant = GREATWALL_FAR_TOWER
  const farMid = (distant.x0 + distant.x1) / 2
  hd.mass(farMid, distant.top + 0.35, distant.base + 0.15, 2.15, 2.55, far, hdDarken(far, 0.72), hdMix(far, roof, 0.45))
  hd.rect(hd.X(distant.x0), hd.Y(distant.top), hd.X(distant.x1 + 1), hd.Y(distant.top + 0.32), roof)
  return hd.pixels
}
