import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  CASTLE_BANNER,
  CASTLE_BEACON,
  CASTLE_BIRD_ROW,
  CASTLE_BIRDS,
  CASTLE_CLOUDS,
  CASTLE_COLORS,
  CASTLE_COLUMNS,
  CASTLE_CYCLE_MS,
  CASTLE_GATE,
  CASTLE_KEEP,
  CASTLE_MOON,
  CASTLE_POLE_TOP,
  CASTLE_POLE_X,
  CASTLE_ROWS,
  CASTLE_SLOPE_ROW,
  CASTLE_STARS,
  CASTLE_SUN,
  CASTLE_TOWERS,
  CASTLE_TOWER_BASE,
  CASTLE_TOWER_TOP,
  CASTLE_TREES,
  CASTLE_WINDOWS,
  castleBeaconBright,
  castleSkyRgb,
  castleTwinkle,
  type CastleStyle,
} from "./castle-view-model"

/** Deterministic hash in [0, 1). */
function hash(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/**
 * Freeform HD renderer. The castle comes from the shared scene model and is
 * painted as real masonry: coursed stone blocks, round towers shaded as
 * cylinders, conical tiled roofs, a crenellated keep with arched windows, a
 * portcullis gate between torches, a streaming banner, and a mound with a
 * winding path. Day lights it from the sun; night lights it from the moon,
 * lights the windows, and flickers the torches. Pure and deterministic:
 * everything derives from `elapsedMs` and loops at 2400ms.
 */
export function renderCastlePixels(width: number, height: number, style: CastleStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, CASTLE_COLUMNS, CASTLE_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const day = style === "castle-day"
  const c = CASTLE_COLORS[style]
  const { w, h, cw, ch, X, Y } = hd
  const px = hd.pixels
  const t = Math.max(0, elapsedMs)
  const phase = (t % CASTLE_CYCLE_MS) / CASTLE_CYCLE_MS
  const theta = phase * Math.PI * 2
  const blend = (x: number, y: number, color: RGB, alpha: number) => {
    if (alpha <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const a = Math.min(1, alpha)
    const i = (y * w + x) * 3
    px[i] = Math.round(px[i]! + (color[0] - px[i]!) * a)
    px[i + 1] = Math.round(px[i + 1]! + (color[1] - px[i + 1]!) * a)
    px[i + 2] = Math.round(px[i + 2]! + (color[2] - px[i + 2]!) * a)
  }
  const glow = (cx: number, cy: number, rx: number, ry: number, color: RGB, strength: number) => {
    const xa = Math.max(0, Math.floor(cx - rx))
    const xb = Math.min(w - 1, Math.ceil(cx + rx))
    const ya = Math.max(0, Math.floor(cy - ry))
    const yb = Math.min(h - 1, Math.ceil(cy + ry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d < 1) blend(x, y, color, strength * (1 - d) * (1 - d))
      }
    }
  }
  const wall = hdHex(c.wall)
  const wallDark = hdHex(c.wallDark)
  const roof = hdHex(c.roof)
  const tree = hdHex(c.tree)
  const hill = hdHex(c.hill)
  const hillDark = hdHex(c.hillDark)
  const gate = hdHex(c.gate)
  const lit = hdHex(c.lit)
  const coreR = Math.max(3, Math.min(cw, ch) * 0.9)
  const around = castleSkyRgb(style, 0.12)
  const orb = day ? CASTLE_SUN : CASTLE_MOON
  const orbX = X(orb.x)
  const orbY = Y(orb.y)
  /** Direction the light comes from: sun on the left by day, moon on the right at night. */
  const lightDir = day ? -1 : 1
  const rimTint = day ? hdHex("#fff0c8") : hdHex("#aebfe8")
  const base = CASTLE_TOWER_BASE + 1
  const ground = Y(base + 0.9)

  // Sky, orb, stars, birds.
  hd.sky((v) => castleSkyRgb(style, v))
  glow(orbX, orbY, cw * 15, ch * 7, day ? hdHex("#fff2c0") : hdHex("#a8bce8"), day ? 0.45 : 0.25)
  if (day) {
    hd.halo(orbX, orbY, coreR, hdHex("#fffbe0"), hdHex(c.sun), around)
  } else {
    hd.stars(CASTLE_STARS, hdHex(c.star), (index) => castleTwinkle(t, index))
    hd.disk(orbX, orbY, coreR * 1.5, hdMix(hdHex(c.moon), around, 0.55))
    hd.disk(orbX, orbY, coreR, hdHex("#f2f5ff"))
    hd.disk(orbX - coreR * 0.3, orbY - coreR * 0.2, coreR * 0.28, hdHex("#cfd7ec"))
    hd.disk(orbX + coreR * 0.3, orbY + coreR * 0.3, coreR * 0.2, hdHex("#cfd7ec"))
    for (let i = 0; i < 40; i++) {
      const sx = Math.floor(hash(i, 1) * w)
      const sy = Math.floor(hash(i, 2) * Y(7))
      if (Math.hypot(sx - orbX, sy - orbY) < cw * 4) continue
      blend(sx, sy, hdHex(c.star), (Math.floor(t / 400) + i) % 3 === 0 ? 0.8 : 0.35)
    }
  }
  if (day) {
    const bird = hdHex(c.bird)
    const wing = Math.max(1.2, cw * 0.13)
    for (const [i, baseX] of CASTLE_BIRDS.entries()) {
      const bx = X((baseX + phase * 24) % CASTLE_COLUMNS) + cw * 0.5
      const by = Y(CASTLE_BIRD_ROW + 0.55) + Math.sin(theta * 3 + i) * ch * 0.1
      const flap = Math.sin(theta * 12 + i * 2) * ch * 0.18
      for (const dir of [-1, 1]) {
        hd.stroke(bx / cw, by / ch, (bx + dir * cw * 0.55) / cw, (by - ch * 0.12 + flap) / ch, wing, bird)
        hd.stroke(
          (bx + dir * cw * 0.55) / cw,
          (by - ch * 0.12 + flap) / ch,
          (bx + dir * cw) / cw,
          (by + ch * 0.05 + flap) / ch,
          wing * 0.8,
          bird,
        )
      }
    }
  }
  // Soft shaded clouds drifting on the loop.
  const cloud = hdHex(c.cloud)
  for (const puff of CASTLE_CLOUDS) {
    const nx = (((puff.x - phase * 16) % CASTLE_COLUMNS) + CASTLE_COLUMNS) % CASTLE_COLUMNS
    const cy = Y(puff.y + 0.4)
    for (let k = 0; k < 5; k++) {
      const bx = X(nx + 0.5 + k * 1.2)
      const lift = Math.sin(k * 1.7) * ch * 0.25
      hd.blob(bx, cy + ch * 0.12, cw * 1.6, ch * 0.5, hdDarken(cloud, day ? 0.9 : 0.8))
      hd.blob(bx, cy - lift * 0.3, cw * 1.5, ch * 0.5 + lift * 0.4, cloud)
      if (day) hd.blob(bx - cw * 0.2, cy - ch * 0.2 - lift * 0.3, cw * 0.9, ch * 0.22, hdHex("#ffffff"))
    }
  }

  // Layered distant mountains and rolling hills.
  const farMountain = hdMix(hdMix(hillDark, around, day ? 0.62 : 0.55), hdHex(day ? "#8fa8c8" : "#1c2a58"), 0.35)
  const nearMountain = hdMix(hill, around, day ? 0.42 : 0.35)
  for (let x = 0; x < w; x++) {
    const sx = x / cw
    const far =
      16.2 -
      Math.abs(((sx * 0.18) % 2) - 1) * 1.8 -
      Math.sin(sx * 0.43) * 0.5 -
      Math.max(0, 1 - Math.abs(sx - 58) / 9) * 1.4
    const near = 17.6 - Math.sin(sx * 0.21 + 1) * 0.7 - Math.sin(sx * 0.5) * 0.2
    for (let y = Math.max(0, Math.floor(Y(far))); y < Math.min(h, Math.ceil(Y(far + 4))); y++) {
      const u = (y - Y(far)) / (ch * 4)
      px[(y * w + x) * 3] = hdMix(farMountain, around, Math.min(0.5, u * 0.5))[0]
      px[(y * w + x) * 3 + 1] = hdMix(farMountain, around, Math.min(0.5, u * 0.5))[1]
      px[(y * w + x) * 3 + 2] = hdMix(farMountain, around, Math.min(0.5, u * 0.5))[2]
    }
    for (let y = Math.max(0, Math.floor(Y(near))); y < h; y++) {
      const u = Math.min(1, (y - Y(near)) / (ch * 3))
      const colour = hdMix(nearMountain, hdDarken(hill, 0.9), u)
      px[(y * w + x) * 3] = colour[0]
      px[(y * w + x) * 3 + 1] = colour[1]
      px[(y * w + x) * 3 + 2] = colour[2]
    }
  }

  // Castle mound: flat under the walls, falling away toward the edges.
  const terrain = (sx: number) =>
    base + 0.9 + Math.pow(Math.max(0, Math.min(1, (Math.abs(sx - 38) - 14) / 34)), 1.3) * 1.5
  const drawGround = () => {
    for (let x = 0; x < w; x++) {
      const sx = x / cw
      const top = Y(terrain(sx))
      for (let y = Math.max(0, Math.floor(top)); y < h; y++) {
        const u = Math.min(1, (y - top) / (h - top || 1))
        let color = hdMix(
          hdMix(hillDark, hill, 0.55 + Math.min(0.45, u * 1.4)),
          hdDarken(hillDark, 0.75),
          Math.max(0, u - 0.6),
        )
        // Sunward slopes catch light.
        const slope = (Math.abs(sx - 38) - 14) / 34
        if (slope > 0 && (sx - 38) * lightDir > 0) color = hdMix(color, rimTint, 0.1 * Math.min(1, slope * 2))
        color = hdDarken(color, 0.94 + hash(x >> 1, y >> 1) * 0.12)
        px[(y * w + x) * 3] = color[0]
        px[(y * w + x) * 3 + 1] = color[1]
        px[(y * w + x) * 3 + 2] = color[2]
      }
    }
  }
  drawGround()

  /** Coursed stone: block courses with mortar and per-block variation. */
  const masonry = (x: number, y: number, tone: RGB, seed: number): RGB => {
    const course = Math.floor(y / 7)
    const off = (course % 2) * 7 + hash(course, seed) * 14
    const bx = Math.floor((x + off) / 15)
    const mortar = y % 7 === 0 || Math.floor(x + off) % 15 === 0
    const variation = 0.9 + hash(bx, course + seed * 31) * 0.2
    return hdDarken(tone, mortar ? 0.8 * variation : variation)
  }
  const shadeTone = (tone: RGB, factor: number, rim: number): RGB => {
    const shaded = hdDarken(tone, factor)
    return rim > 0 ? hdMix(shaded, rimTint, rim) : shaded
  }

  // Round towers shaded as cylinders, with arrow slits and corbelled tops.
  const keep = CASTLE_KEEP
  const towerWidth = 4
  const slitsLit = !day
  const towerRoofTop = CASTLE_TOWER_TOP - 2.6
  CASTLE_TOWERS.forEach((tower, index) => {
    const cx = X(tower + towerWidth / 2)
    const half = X(towerWidth / 2) * 1.04
    const y0 = Y(CASTLE_TOWER_TOP)
    const y1 = Y(base)
    for (let y = Math.floor(y0); y < y1; y++) {
      for (let x = Math.floor(cx - half); x < cx + half; x++) {
        const u = (x + 0.5 - cx) / half
        const nz = Math.sqrt(Math.max(0, 1 - u * u))
        const lambert = Math.max(0, (u * lightDir * 0.55 + nz * 0.83) * 0.95)
        const factor = 0.52 + lambert * 0.62
        const rim = Math.max(0, 1 - Math.abs(u * lightDir - 0.82) * 6) * 0.2
        let color = masonry(x, y, shadeTone(wall, factor, rim), index + 3)
        // Base shadow near the ground.
        color = hdDarken(color, 1 - Math.max(0, (y - Y(base - 1.2)) / (Y(1.2) || 1)) * 0.25)
        hd.set(x, y, color)
      }
    }
    // Corbelled ring under the roof and a darker machicolation band.
    hd.rect(
      cx - half - cw * 0.35,
      Y(CASTLE_TOWER_TOP - 0.45),
      cx + half + cw * 0.35,
      Y(CASTLE_TOWER_TOP + 0.3),
      hdDarken(wall, 0.82),
    )
    hd.rect(
      cx - half - cw * 0.35,
      Y(CASTLE_TOWER_TOP - 0.45),
      cx + half + cw * 0.35,
      Y(CASTLE_TOWER_TOP - 0.45) + 2,
      hdMix(wall, rimTint, 0.25),
    )
    hd.rect(
      cx - half - cw * 0.35,
      Y(CASTLE_TOWER_TOP + 0.3),
      cx + half + cw * 0.35,
      Y(CASTLE_TOWER_TOP + 0.3) + 3,
      hdDarken(wallDark, 0.7),
    )
    // Arrow slits.
    for (const sy of [CASTLE_TOWER_TOP + 2.2, CASTLE_TOWER_TOP + 5.6]) {
      const sw = Math.max(2, cw * 0.28)
      hd.rect(cx - sw / 2, Y(sy), cx + sw / 2, Y(sy + 1.5), slitsLit ? lit : hdDarken(wallDark, 0.35))
      if (slitsLit) glow(cx, Y(sy + 0.75), cw * 1.4, ch * 1.2, lit, 0.4)
    }
    // Conical roof: tiled rows, lit and shadowed flanks, a spire.
    const roofBase = Y(CASTLE_TOWER_BASE === base ? CASTLE_TOWER_TOP - 0.45 : CASTLE_TOWER_TOP)
    const roofTop = Y(towerRoofTop)
    const overhang = half + cw * 0.5
    for (let y = Math.floor(roofTop); y < roofBase; y++) {
      const v = (y - roofTop) / (roofBase - roofTop || 1)
      const rowHalf = overhang * Math.pow(v, 0.9)
      for (let x = Math.floor(cx - rowHalf); x < cx + rowHalf; x++) {
        const u = rowHalf ? (x + 0.5 - cx) / rowHalf : 0
        const nz = Math.sqrt(Math.max(0, 1 - u * u))
        const factor = 0.45 + Math.max(0, u * lightDir * 0.5 + nz * 0.8) * 0.75
        const tileRow = Math.floor(y / 5)
        const tile = (Math.floor((x + (tileRow % 2) * 4) / 8) + tileRow * 3) % 5
        const tileEdge = y % 5 === 0 ? 0.78 : 1
        hd.set(x, y, hdDarken(roof, factor * tileEdge * (0.92 + tile * 0.03)))
      }
    }
    hd.rect(cx - overhang, roofBase - 2, cx + overhang, roofBase, hdDarken(roof, 0.5))
    hd.stroke(
      tower + towerWidth / 2,
      towerRoofTop - 0.1,
      tower + towerWidth / 2,
      towerRoofTop - 1.1,
      Math.max(1, cw * 0.07),
      hdDarken(wallDark, 0.7),
    )
  })

  // Keep: planar wall in coursed stone with crenellations.
  const kx0 = X(keep.x0)
  const kx1 = X(keep.x1 + 1)
  const ky0 = Y(keep.top)
  const ky1 = Y(base)
  for (let y = Math.floor(ky0); y < ky1; y++) {
    for (let x = Math.floor(kx0); x < kx1; x++) {
      const u = (x - kx0) / (kx1 - kx0)
      const across = lightDir < 0 ? u : 1 - u
      let factor = 1.02 - across * 0.22
      // Towers throw soft shade on the keep flanks.
      factor *= 1 - Math.max(0, 1 - Math.min(x - kx0, kx1 - x) / (cw * 2.2)) * 0.28
      factor *= 1 - Math.max(0, (y - Y(base - 1)) / (Y(1) || 1)) * 0.12
      hd.set(x, y, masonry(x, y, hdDarken(wall, factor * (day ? 1 : 0.88)), 9))
    }
  }
  // Moon or sun catches the top ledge.
  hd.rect(kx0, ky0, kx1, ky0 + 2, hdMix(wall, rimTint, 0.4))
  hd.rect(kx0, ky0 + 2, kx1, ky0 + 5, hdDarken(wallDark, 0.8))
  // Merlons: lit tops, shadowed right sides, and crenel gaps.
  for (let x = keep.x0; x < keep.x1 + 1; x += 2) {
    const mx0 = X(x)
    const mx1 = X(Math.min(keep.x1 + 1, x + 1))
    const my0 = Y(keep.top - 0.85)
    hd.rect(mx0, my0, mx1, ky0, masonry(Math.round(mx0), Math.round(my0), hdDarken(wall, 0.95), 4))
    hd.rect(mx0, my0, mx1, my0 + 2, hdMix(wall, rimTint, 0.45))
    hd.rect(mx1 - 2, my0, mx1, ky0, hdDarken(wallDark, 0.8))
  }
  // Gap shadow behind the merlons.
  for (let x = keep.x0 + 1; x < keep.x1 + 1; x += 2) {
    hd.rect(X(x), Y(keep.top - 0.4), X(x + 1), ky0, hdDarken(wallDark, 0.6))
  }
  // Foundation plinth.
  hd.rect(
    X(CASTLE_TOWERS[0]! - 0.4),
    Y(base - 0.1),
    X(CASTLE_TOWERS[1]! + towerWidth + 0.4),
    Y(base + 0.9),
    hdDarken(wallDark, 0.78),
  )
  hd.rect(
    X(CASTLE_TOWERS[0]! - 0.4),
    Y(base - 0.1),
    X(CASTLE_TOWERS[1]! + towerWidth + 0.4),
    Y(base - 0.1) + 2,
    hdMix(wallDark, rimTint, 0.25),
  )

  // Arched windows: dark glass by day, a warm glow at night.
  for (const win of CASTLE_WINDOWS) {
    const wx = X(win.x + 1.5)
    const half = cw * 0.8
    const top = Y(win.y - 0.2)
    const bottom = Y(win.y + 1.7)
    for (let y = Math.floor(top); y < bottom; y++) {
      const v = (y - top) / (bottom - top)
      const reach = v < 0.3 ? half * Math.sqrt(Math.max(0, 1 - Math.pow(1 - v / 0.3, 2))) : half
      for (let x = Math.floor(wx - reach); x < wx + reach; x++) {
        const glass = day ? hdMix(hdHex("#5a7690"), hdHex("#2a384a"), v) : hdMix(hdHex("#ffe9a8"), hdHex("#ff9a3c"), v)
        const sparkle = day && v < 0.5 && x - wx < -half * 0.2 ? 0.12 : 0
        hd.set(x, y, hdMix(glass, hdHex("#ffffff"), sparkle))
      }
    }
    hd.rect(wx - 0.5, top + (bottom - top) * 0.25, wx + 0.5, bottom, hdDarken(wallDark, 0.7))
    hd.rect(wx - half, top + (bottom - top) * 0.55, wx + half, top + (bottom - top) * 0.55 + 1, hdDarken(wallDark, 0.7))
    if (!day) glow(wx, (top + bottom) / 2, cw * 3.2, ch * 2, lit, 0.35)
    hd.rect(wx - half - 2, bottom, wx + half + 2, bottom + 2, hdMix(wall, rimTint, 0.2))
  }

  // Gate: arch with voussoirs, portcullis, and an inner glow, flanked by torches.
  const gcx = X(CASTLE_GATE.x + 2)
  const gr = cw * 1.85
  const gTop = Y(CASTLE_GATE.y + 0.35)
  const archCy = gTop + gr
  const gBottom = Y(base)
  const flick = 0.5 + 0.5 * Math.cos(theta * 6)
  for (let y = Math.floor(gTop - 4); y < gBottom; y++) {
    for (let x = Math.floor(gcx - gr - 5); x < gcx + gr + 5; x++) {
      const dx = x + 0.5 - gcx
      const inArch = y >= archCy ? Math.abs(dx) <= gr : dx * dx + (y + 0.5 - archCy) * (y + 0.5 - archCy) <= gr * gr
      const ring =
        y >= archCy ? Math.abs(dx) <= gr + 5 : dx * dx + (y + 0.5 - archCy) * (y + 0.5 - archCy) <= (gr + 5) * (gr + 5)
      if (inArch) {
        const v = Math.max(0, Math.min(1, (y - gTop) / (gBottom - gTop)))
        let door = hdMix(hdDarken(gate, 0.4), hdDarken(gate, 0.8), v)
        if (!day) door = hdMix(door, hdHex("#ff9a3c"), 0.25 * v * (0.8 + 0.2 * flick))
        // Portcullis bars.
        if (Math.floor(x - gcx + 1000) % 6 === 0 || Math.floor(y) % 8 === 0) door = hdMix(door, hdHex("#2a2420"), 0.8)
        hd.set(x, y, door)
      } else if (ring) {
        const angle = Math.atan2(y + 0.5 - archCy, dx)
        const stone = Math.floor((angle + Math.PI) * 6) % 2 === 0 ? 1 : 0.86
        hd.set(x, y, hdDarken(hdMix(wall, rimTint, 0.12), stone))
      }
    }
  }
  // Torches on either side of the gate.
  for (const side of [-1, 1]) {
    const tx = gcx + side * (gr + cw * 1.1)
    const ty = Y(CASTLE_GATE.y + 1.1)
    hd.rect(tx - 1, ty, tx + 1, ty + ch * 0.8, hdHex(c.wood))
    hd.rect(tx - 3, ty - 1, tx + 3, ty + 2, hdDarken(hdHex(c.wood), 0.7))
    const flameH = ch * (0.55 + 0.2 * Math.cos(theta * 6 + (side > 0 ? 1.4 : 0)))
    if (!day) glow(tx, ty - flameH * 0.5, cw * 4, ch * 2.4, hdHex("#ff9a3c"), 0.45)
    hd.blob(tx, ty - flameH * 0.5, cw * 0.28, flameH * 0.6, hdHex("#ff8a28"))
    hd.blob(tx, ty - flameH * 0.4, cw * 0.15, flameH * 0.4, hdHex("#ffe19a"))
  }

  // Banner pole with a streaming banner; beacon on the left tower's spire.
  hd.stroke(
    CASTLE_POLE_X + 0.5,
    CASTLE_POLE_TOP - 0.3,
    CASTLE_POLE_X + 0.5,
    keep.top - 0.8,
    Math.max(1, cw * 0.08),
    hdHex(c.wood),
  )
  hd.disk(X(CASTLE_POLE_X + 0.5), Y(CASTLE_POLE_TOP - 0.3), Math.max(1.5, cw * 0.14), hdHex("#e8c35a"))
  const banner = hdHex(c.banner)
  const flagLen = cw * 3.4
  const flagH = ch * 1.5
  const fx0 = X(CASTLE_POLE_X + 0.5)
  const fy0 = Y(CASTLE_BANNER.y)
  for (let i = 0; i < flagLen; i++) {
    const v = i / flagLen
    const sway = Math.sin(theta * 3 - v * 5) * ch * 0.22 * v
    const tailCut = v > 0.78 ? (v - 0.78) * flagH * 1.9 : 0
    const top = fy0 + sway
    const bottom = fy0 + flagH * (1 - v * 0.22) + sway - tailCut
    for (let y = Math.floor(top); y < bottom; y++) {
      const fold = 0.82 + 0.22 * Math.sin(v * 12 - theta * 3)
      let color = hdDarken(banner, fold)
      if (y - top < 2 || bottom - y < 2) color = hdHex("#e8c35a")
      hd.set(Math.round(fx0 + i), y, color)
    }
    // A pale emblem stripe.
    const sy = Math.round(fy0 + flagH * 0.5 + sway)
    if (v > 0.12 && v < 0.62) hd.set(Math.round(fx0 + i), sy, hdMix(banner, hdHex("#ffe9a8"), 0.7))
  }
  if (!day) {
    const bx = X(CASTLE_TOWERS[0]! + towerWidth / 2)
    const by = Y(CASTLE_BEACON.y + 0.5)
    if (castleBeaconBright(t)) glow(bx, by, cw * 3, ch * 1.6, hdHex(c.beacon), 0.6)
    hd.disk(
      bx,
      by,
      Math.max(2, cw * 0.2),
      castleBeaconBright(t) ? hdHex(c.beacon) : hdMix(wallDark, hdHex(c.beacon), 0.15),
    )
  }

  // Winding path from the gate.
  const path = hdHex(c.path)
  for (let y = Math.floor(Y(base + 0.9)); y < h; y++) {
    const v = (y - Y(base + 0.9)) / (h - Y(base + 0.9) || 1)
    const centre = X(CASTLE_GATE.x + 2 + Math.sin(v * 3.2) * 1.8 * v)
    const half = X(1.4 + v * 4.6)
    for (let x = Math.floor(centre - half); x < centre + half; x++) {
      const e = Math.abs(x + 0.5 - centre) / half
      let color = hdMix(path, hdDarken(path, 0.8), v * 0.3)
      color = hdDarken(color, 0.92 + hash(x >> 1, y >> 1) * 0.14)
      if (e > 0.88) color = hdDarken(color, 0.8)
      if (!day) color = hdDarken(color, 0.75)
      hd.set(x, y, color)
    }
  }

  // Trees: trunk, clustered shaded crowns, and a lit upper edge.
  for (const trunk of CASTLE_TREES) {
    const tx = X(trunk + 1)
    const treeBase = Y(CASTLE_SLOPE_ROW + 1.6)
    hd.rect(tx - cw * 0.28, Y(CASTLE_TOWER_BASE + 0.2), tx + cw * 0.28, treeBase, hdDarken(hdHex(c.wood), 0.9))
    hd.rect(tx + cw * 0.05, Y(CASTLE_TOWER_BASE + 0.2), tx + cw * 0.28, treeBase, hdDarken(hdHex(c.wood), 0.65))
    const crown = [
      [0, 0, 1.0],
      [-1.5, 0.5, 0.8],
      [1.5, 0.5, 0.8],
      [-0.7, -0.7, 0.8],
      [0.8, -0.65, 0.78],
    ] as const
    for (const [dx, dy, scale] of crown) {
      hd.blob(
        tx + dx * cw * 1.2,
        Y(CASTLE_TOWER_BASE - 0.15 + dy) + ch * 0.18,
        cw * 2.2 * scale,
        ch * 1.0 * scale,
        hdDarken(tree, 0.66),
      )
    }
    for (const [dx, dy, scale] of crown) {
      hd.blob(
        tx + dx * cw * 1.2 - cw * 0.15 * lightDir * -1,
        Y(CASTLE_TOWER_BASE - 0.15 + dy),
        cw * 2.0 * scale,
        ch * 0.9 * scale,
        tree,
        hdDarken(tree, 0.85),
      )
    }
    hd.blob(tx - lightDir * cw * -0.6, Y(CASTLE_TOWER_BASE - 0.75), cw * 1.1, ch * 0.4, hdMix(tree, rimTint, 0.22))
  }
  // Flowers and grass tufts on the slope.
  for (let i = 0; i < 40; i++) {
    const sx = hash(i, 11) * CASTLE_COLUMNS
    const sy = terrain(sx) + 0.4 + hash(i, 12) * (CASTLE_ROWS - terrain(sx) - 0.6)
    if (Math.abs(sx - 38) < 4 + (sy - base) * 0.4) continue
    const sway = Math.sin(theta + i) * cw * 0.1
    const blade = hdDarken(hill, 0.7 + hash(i, 13) * 0.5)
    hd.stroke(sx, sy, sx + sway / cw, sy - 0.35, Math.max(0.8, cw * 0.05), blade)
    if (i % 4 === 0)
      hd.disk(
        X(sx) + sway,
        Y(sy - 0.38),
        Math.max(1, cw * 0.09),
        day ? hdHex(i % 8 === 0 ? "#fff2a0" : "#f2a0c0") : hdHex("#7f8fc0"),
      )
  }
  // Fireflies at night, bright on the shared twinkle beat.
  if (!day) {
    for (let i = 0; i < 9; i++) {
      const fxp = X(4 + hash(i, 20) * 68) + Math.sin(theta * 2 + i * 1.3) * cw * 0.8
      const fyp = Y(18.6 + hash(i, 21) * 4.4) + Math.cos(theta + i) * ch * 0.2
      const on = castleTwinkle(t, i) ? 1 : 0.5
      glow(fxp, fyp, cw * 1.2, ch * 0.6, hdHex("#d8f070"), 0.5 * on)
      blend(Math.round(fxp), Math.round(fyp), hdHex("#f4ffb0"), on)
    }
  }
  void ground
  return hd.pixels
}
