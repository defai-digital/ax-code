import { blendPx, fillPoly, glow, hash2, vrect } from "./atmos-paint"
import { createHdCanvas, hdDarken, hdHex, hdMix } from "./scene-hd"
import {
  SANGUOZHI_BANNERS,
  SANGUOZHI_CAMPFIRES,
  SANGUOZHI_COLORS,
  SANGUOZHI_COLUMNS,
  SANGUOZHI_GROUND_TOP,
  SANGUOZHI_LANTERNS,
  SANGUOZHI_MOON,
  SANGUOZHI_ROWS,
  SANGUOZHI_STARS,
  SANGUOZHI_SUN,
  SANGUOZHI_TOWER,
  SANGUOZHI_WALL,
  sanguozhiBannerSway,
  sanguozhiFlicker,
  sanguozhiRiders,
  sanguozhiSkyRgb,
  sanguozhiSunY,
  type SanguozhiStyle,
} from "./sanguozhi-view-model"

/**
 * Freeform HD renderer. An original walled-city campaign scene in the flat,
 * olive-and-ember register of 1990s historical strategy art: a tiered gate
 * tower over rammed-earth walls, three plain war banners, layered ridges in
 * mist, and a muster field in front. The opening raises the sun over cavalry
 * crossing at dawn; the ending settles the same walls under moonlight, lit
 * lanterns, and campfires. No portrait, map, or insignia is reproduced.
 */
export function renderSanguozhiPixels(
  width: number,
  height: number,
  style: SanguozhiStyle,
  elapsedMs: number,
): Buffer {
  const hd = createHdCanvas(width, height, SANGUOZHI_COLUMNS, SANGUOZHI_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const ending = style === "sanguozhi-dusk"
  const c = SANGUOZHI_COLORS[style]
  const t = Math.max(0, elapsedMs)
  const S = Math.min(hd.ch, hd.cw * 2)
  const coreR = Math.max(3, S * 0.55)
  const unit = Math.max(1.2, Math.min(hd.cw, hd.ch) * 0.32)
  const wall = SANGUOZHI_WALL
  const tower = SANGUOZHI_TOWER
  const flicker = sanguozhiFlicker(t)
  const sway = sanguozhiBannerSway(t)

  const mountain = hdHex(c.mountain)
  const mountainFar = hdHex(c.mountainFar)
  const wallC = hdHex(c.wall)
  const wallDark = hdHex(c.wallDark)
  const roof = hdHex(c.roof)
  const timber = hdHex(c.timber)
  const ground = hdHex(c.ground)
  const groundDark = hdHex(c.groundDark)
  const riderC = hdHex(c.rider)
  const flame = hdHex(c.flame)
  const mist = hdHex(c.mist)
  const tree = hdHex(c.tree)
  const bannerColors = [hdHex(c.bannerA), hdHex(c.bannerB), hdHex(c.bannerC)]

  hd.sky((v) => sanguozhiSkyRgb(style, v))
  if (ending) {
    hd.stars(SANGUOZHI_STARS, hdHex(c.sun), (i) => (Math.floor(t / 400) + i) % 3 === 0)
    for (let i = 0; i < 40; i++) {
      blendPx(hd, Math.floor(hash2(i, 7) * hd.w), Math.floor(hash2(i, 8) * hd.Y(8)), hdHex("#cdd6ff"), 0.35)
    }
    const mx = hd.X(SANGUOZHI_MOON.x)
    const my = hd.Y(SANGUOZHI_MOON.y)
    glow(hd, mx, my, coreR * 9, hdHex("#8fa0e0"), 0.35)
    hd.disk(mx, my, coreR, hdHex("#eef0ff"))
    hd.disk(mx - coreR * 0.25, my + coreR * 0.2, coreR * 0.22, hdHex("#c8cee6"))
  } else {
    const sx = hd.X(SANGUOZHI_SUN.x)
    const sy = hd.Y(sanguozhiSunY(t))
    glow(hd, sx, sy, coreR * 12, hdHex("#ffb060"), 0.5)
    hd.disk(sx, sy, coreR, hdHex("#ffd98a"))
  }

  // Layered ridges: far pale silhouettes, then the near slope carrying pines.
  for (const [apex, half] of [
    [10, 15],
    [34, 18],
    [58, 16],
    [74, 12],
  ] as const) {
    fillPoly(
      hd,
      [
        [hd.X(apex - half), hd.Y(12.5)],
        [hd.X(apex), hd.Y(6.4)],
        [hd.X(apex + half), hd.Y(12.5)],
      ],
      () => mountainFar,
    )
  }
  for (const [apex, half] of [
    [4, 13],
    [26, 15],
    [50, 14],
    [70, 13],
  ] as const) {
    fillPoly(
      hd,
      [
        [hd.X(apex - half), hd.Y(13.5)],
        [hd.X(apex), hd.Y(8.6)],
        [hd.X(apex + half), hd.Y(13.5)],
      ],
      (x, y) =>
        hdMix(
          mountain,
          hdDarken(mountain, 0.72),
          Math.max(0, Math.min(1, (y - hd.Y(8.6)) / Math.max(1, hd.Y(13.5) - hd.Y(8.6)))),
        ),
    )
  }
  for (const pine of [3, 17, 59, 72]) {
    hd.stroke(pine, 12.8, pine, 11.2, unit * 0.5, hdDarken(tree, 0.6))
    hd.blob(hd.X(pine), hd.Y(10.8), hd.cw * 1.5, hd.ch * 0.6, tree, hdDarken(tree, 0.65))
  }
  // Drifting mist bands between the ridges and the wall.
  const mistShift = ((t / 3600) % 1) * 6
  for (const [my, alpha] of [
    [10.6, 0.16],
    [12.2, 0.22],
  ] as const) {
    for (let i = 0; i < 7; i++) {
      const cx = hd.X(((i * 13 + mistShift) % (SANGUOZHI_COLUMNS + 8)) - 4)
      glow(hd, cx, hd.Y(my), hd.cw * 5, mist, alpha, 0.22)
    }
  }

  // Hillside the wall stands on, so no sky shows at the wall's flanks.
  vrect(hd, 0, hd.Y(12.4), hd.w, hd.Y(SANGUOZHI_GROUND_TOP), hdDarken(mountain, 0.8), groundDark)

  // Rammed-earth wall: battered face, crenellations, and a dark gate arch.
  const wallTopY = hd.Y(wall.top + 0.6)
  const wallBaseY = hd.Y(wall.base + 0.9)
  fillPoly(
    hd,
    [
      [hd.X(wall.x0 + 0.8), wallTopY],
      [hd.X(wall.x1 - 0.8), wallTopY],
      [hd.X(wall.x1), wallBaseY],
      [hd.X(wall.x0), wallBaseY],
    ],
    (x, y) => {
      const u = Math.max(0, Math.min(1, (y - wallTopY) / Math.max(1, wallBaseY - wallTopY)))
      const band = Math.floor((y - wallTopY) / Math.max(2, hd.ch * 0.45)) % 2 === 0 ? 1 : 0.92
      return hdDarken(hdMix(wallC, wallDark, u * 0.55), band)
    },
  )
  for (let x = wall.x0 + 1; x < wall.x1 - 1; x += 2.6) {
    hd.rect(hd.X(x), hd.Y(wall.top), hd.X(x + 1.3), wallTopY, wallDark)
  }
  hd.rect(hd.X(35.6), hd.Y(wall.base - 2.2), hd.X(40.4), wallBaseY, hdDarken(wallDark, 0.45))
  hd.disk(hd.X(38), hd.Y(wall.base - 2.2), hd.cw * 2.4, hdDarken(wallDark, 0.45))

  // Gate tower: timber body under two upswept roof tiers.
  const roofTier = (cx: number, yTop: number, halfW: number, drop: number) => {
    fillPoly(
      hd,
      [
        [hd.X(cx - halfW - 0.7), hd.Y(yTop + drop * 0.55)],
        [hd.X(cx - halfW), hd.Y(yTop + drop)],
        [hd.X(cx), hd.Y(yTop)],
        [hd.X(cx + halfW), hd.Y(yTop + drop)],
        [hd.X(cx + halfW + 0.7), hd.Y(yTop + drop * 0.55)],
        [hd.X(cx + halfW), hd.Y(yTop + drop + 0.35)],
        [hd.X(cx - halfW), hd.Y(yTop + drop + 0.35)],
      ],
      (x) => (x < hd.X(cx) ? roof : hdDarken(roof, 0.7)),
    )
    hd.stroke(cx - 1.2, yTop - 0.15, cx + 1.2, yTop - 0.15, unit * 0.6, hdDarken(roof, 0.55))
  }
  vrect(
    hd,
    hd.X(tower.x0 + 1),
    hd.Y(tower.bodyTop),
    hd.X(tower.x1 - 1),
    hd.Y(tower.bodyBase),
    timber,
    hdDarken(timber, 0.62),
  )
  for (let x = tower.x0 + 2; x < tower.x1 - 1; x += 2.4) {
    hd.rect(hd.X(x), hd.Y(tower.bodyTop + 0.4), hd.X(x + 0.5), hd.Y(tower.bodyBase - 0.3), hdDarken(timber, 0.5))
  }
  if (ending) {
    for (const wx of [34.5, 38, 41.5]) {
      hd.rect(hd.X(wx - 0.7), hd.Y(10.6), hd.X(wx + 0.7), hd.Y(12), flicker ? flame : hdDarken(flame, 0.55))
    }
  }
  roofTier(38, tower.roofTie - 0.4, 9.6, 0.9)
  vrect(
    hd,
    hd.X(tower.x0 + 2.4),
    hd.Y(tower.roofTop + 1),
    hd.X(tower.x1 - 2.4),
    hd.Y(tower.roofTie - 0.2),
    timber,
    hdDarken(timber, 0.7),
  )
  roofTier(38, tower.roofTop - 0.3, 7.6, 0.8)

  // War banners: tall plain cloth panels whose free edge ripples with the sway.
  SANGUOZHI_BANNERS.forEach((pole, i) => {
    const color = bannerColors[i]!
    const base = i === 1 ? tower.roofTop + 0.4 : wall.top + 0.4
    const topY = base - 4.8
    hd.stroke(pole, base, pole, topY - 0.3, unit * 0.55, hdDarken(timber, 0.55))
    hd.disk(hd.X(pole), hd.Y(topY - 0.45), unit * 0.9, ending ? hdDarken(flame, 0.7) : flame)
    const wave = sway * 0.5 + Math.sin(t / 300 + i * 1.7) * 0.22
    const clothW = 2.6
    for (let s = 0; s < 6; s++) {
      const u = s / 6
      const lean = Math.sin(u * Math.PI) * wave * 0.55
      const shade = 0.78 + 0.22 * Math.sin(u * Math.PI * 2 + t / 280 + i)
      hd.rect(
        hd.X(pole + 0.25 + lean),
        hd.Y(topY + u * 3.4),
        hd.X(pole + 0.25 + clothW + lean * 1.4),
        hd.Y(topY + (u + 1 / 6) * 3.4),
        hdDarken(color, Math.max(0.45, Math.min(1.05, shade))),
      )
    }
  })

  if (ending) {
    for (const lantern of SANGUOZHI_LANTERNS) {
      const lx = hd.X(lantern)
      const ly = hd.Y(wall.top + 1.5)
      glow(hd, lx, ly, coreR * 2.4, flame, flicker ? 0.5 : 0.3)
      hd.blob(lx, ly, unit * 1.5, unit * 1.9, flicker ? flame : hdDarken(flame, 0.6))
    }
  }

  // Muster field: trodden gradient with a palisade shadow at the wall foot.
  vrect(hd, 0, hd.Y(SANGUOZHI_GROUND_TOP), hd.w, hd.h, ground, groundDark)
  for (let i = 0; i < 90; i++) {
    blendPx(
      hd,
      Math.floor(hash2(i, 21) * hd.w),
      Math.floor(hd.Y(SANGUOZHI_GROUND_TOP) + hash2(i, 22) * Math.max(1, hd.h - hd.Y(SANGUOZHI_GROUND_TOP))),
      hash2(i, 23) > 0.5 ? groundDark : hdDarken(ground, 1.25),
      0.5,
    )
  }
  for (let x = 1; x < SANGUOZHI_COLUMNS; x += 2.2) {
    hd.stroke(
      x,
      SANGUOZHI_GROUND_TOP + 0.5,
      x + 0.35,
      SANGUOZHI_GROUND_TOP - 0.25,
      unit * 0.42,
      hdDarken(timber, 0.7),
    )
  }

  if (!ending) {
    // Cavalry silhouettes galloping across the field, dust at their heels.
    for (const rider of sanguozhiRiders(t)) {
      if (rider.x < -10 || rider.x > SANGUOZHI_COLUMNS + 4) continue
      const bx = rider.x
      const by = rider.y + Math.sin(t / 130 + bx) * 0.08
      for (let d = 0; d < 3; d++) {
        glow(hd, hd.X(bx - 3.6 - d * 1.4), hd.Y(by + 1.5), hd.cw * (1 + d * 0.5), mist, 0.13, 0.4)
      }
      const legA: readonly [number, number] = rider.gallop ? [2.1, 1.25] : [0.9, 1.35]
      const legB: readonly [number, number] = rider.gallop ? [-2.2, 1.25] : [-0.7, 1.35]
      hd.stroke(bx + 1.4, by + 0.45, bx + legA[0], by + legA[1], unit * 0.85, riderC)
      hd.stroke(bx - 1.5, by + 0.45, bx + legB[0], by + legB[1], unit * 0.85, riderC)
      hd.stroke(bx + 1, by + 0.5, bx + legB[0] * 0.55 + 1.2, by + legB[1], unit * 0.7, riderC)
      hd.stroke(bx - 1.1, by + 0.5, bx + legA[0] * 0.55 - 1.2, by + legA[1], unit * 0.7, riderC)
      hd.blob(hd.X(bx), hd.Y(by), hd.cw * 2.5, hd.ch * 0.72, riderC)
      hd.disk(hd.X(bx + 1.7), hd.Y(by - 0.1), unit * 2.1, riderC)
      hd.disk(hd.X(bx - 1.7), hd.Y(by - 0.05), unit * 2, riderC)
      hd.stroke(bx + 1.7, by - 0.45, bx + 3.2, by - 1.15, unit * 1.3, riderC)
      hd.blob(hd.X(bx + 3.7), hd.Y(by - 1.2), unit * 1.8, unit * 1, riderC)
      hd.stroke(bx - 2.3, by - 0.35, bx - 3.4, by + 0.65, unit * 0.65, riderC)
      // Rider: torso, helmet crest, and a couched spear.
      hd.stroke(bx - 0.2, by - 0.5, bx + 0.15, by - 1.9, unit * 0.95, riderC)
      hd.disk(hd.X(bx + 0.25), hd.Y(by - 2.25), unit * 0.95, riderC)
      hd.stroke(bx + 0.25, by - 2.6, bx - 0.5, by - 3.1, unit * 0.45, hdHex(c.bannerA))
      hd.stroke(bx + 0.5, by - 1.6, bx + 4.6, by - 2.3, unit * 0.38, hdDarken(timber, 0.8))
    }
    // Dawn birds over the ridges.
    const birdPhase = (t % 3600) / 3600
    for (let i = 0; i < 3; i++) {
      const bx = 12 + birdPhase * 30 + i * 4
      const by = 3.4 + Math.sin(t / 500 + i * 2) * 0.3
      const flap = Math.sin(t / 140 + i) > 0 ? 0.32 : -0.1
      hd.stroke(bx - 0.8, by - flap, bx, by, unit * 0.4, riderC)
      hd.stroke(bx, by, bx + 0.8, by - flap, unit * 0.4, riderC)
    }
  } else {
    for (const fire of SANGUOZHI_CAMPFIRES) {
      const fx = hd.X(fire)
      const fy = hd.Y(21.6)
      glow(hd, fx, fy, coreR * 3.2, flame, flicker ? 0.55 : 0.38, 0.7)
      hd.blob(fx, fy, unit * 1.6, unit * (flicker ? 2.4 : 1.9), flame, hdDarken(flame, 0.6))
      hd.stroke(fire - 1.2, 22.3, fire + 1.2, 21.9, unit * 0.55, hdDarken(timber, 0.5))
      hd.stroke(fire - 1.2, 21.9, fire + 1.2, 22.3, unit * 0.55, hdDarken(timber, 0.5))
      // Smoke column thinning into the night.
      for (let sDot = 0; sDot < 4; sDot++) {
        glow(
          hd,
          fx + Math.sin(t / 600 + sDot) * hd.cw * 0.4,
          fy - hd.ch * (1 + sDot * 0.8),
          hd.cw * (0.8 + sDot * 0.35),
          mist,
          0.1,
          0.8,
        )
      }
    }
  }
  return hd.pixels
}
