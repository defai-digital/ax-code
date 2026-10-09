import {
  SINGAPORE_BAY_TOP,
  SINGAPORE_COLORS,
  SINGAPORE_COLUMNS,
  SINGAPORE_MERLION,
  SINGAPORE_ROWS,
  SINGAPORE_SKYLINE,
  SINGAPORE_SKYPARK,
  SINGAPORE_STARS,
  SINGAPORE_TOWERS,
  SINGAPORE_TREES,
  singaporeBoat,
  singaporeJet,
  singaporePhase,
  singaporeSkyRgb,
  type SingaporeStyle,
} from "./singapore-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import { blitGlyphText } from "./text-scene-glyphs"

/** Paints the existing RGB scene transport; never writes to the terminal itself. */
export function renderSingaporePixels(width: number, height: number, style: SingaporeStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, SINGAPORE_COLUMNS, SINGAPORE_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const { X, Y, cw, ch } = hd
  const colors = SINGAPORE_COLORS[style]
  const night = style === "singapore-night"
  const phase = singaporePhase(elapsedMs)
  const tower = hdHex(colors.tower),
    shade = hdHex(colors.shade),
    glass = hdHex(colors.glass)
  const light = hdHex(colors.light),
    stone = hdHex(colors.stone),
    stoneShade = hdHex(colors.stoneShade)
  const accent = hdHex(colors.accent),
    green = hdHex(colors.green),
    canopy = hdHex(colors.canopy)
  const fountain = hdHex(colors.fountain)
  const line = Math.max(0.5, Math.min(cw, ch) * 0.07)
  // Broken horizontal glints taper into the bay instead of solid light columns.
  const reflection = (center: number, color: RGB, offset: number, span: number) => {
    for (let row = 0; row < 32; row++) {
      const depth = row / 32,
        y = 18.35 + depth * 4.6
      const shimmer = Math.sin(row * 2.3 + phase * 3 + offset)
      const half = span * (0.3 + depth * 0.55) * (0.65 + shimmer * 0.3)
      const x = center + Math.sin(row * 0.9 + phase * 2 + offset) * 0.55
      const base = hdMix(hdHex(colors.water), hdHex(colors.waterDeep), (y - 18) / 6)
      hd.rect(
        X(x - half),
        Y(y),
        X(x + half),
        Y(y + 0.035),
        hdMix(base, color, (night ? 0.55 : 0.25) * (1 - depth * 0.7)),
      )
    }
  }
  // Alpha blend over what is already painted; the HD canvas only has opaque writes.
  const blend = (px: number, py: number, color: RGB, alpha: number) => {
    if (px < 0 || py < 0 || px >= hd.w || py >= hd.h || alpha <= 0) return
    const i = (py * hd.w + px) * 3
    for (let c = 0; c < 3; c++) hd.pixels[i + c] = Math.round(hd.pixels[i + c]! * (1 - alpha) + color[c]! * alpha)
  }
  const haze = (y0: number, y1: number, color: RGB, peak: number) => {
    for (let py = Math.max(0, Math.floor(Y(y0))); py < Math.min(hd.h, Math.ceil(Y(y1))); py++) {
      const u = (py - Y(y0)) / (Y(y1) - Y(y0))
      for (let px = 0; px < hd.w; px++) blend(px, py, color, peak * u * u)
    }
  }
  hd.sky((v) => singaporeSkyRgb(style, v))
  hd.halo(X(64), Y(2.8), Math.min(cw, ch) * 0.9, light, hdMix(light, glass, 0.5), singaporeSkyRgb(style, 0.12))
  if (night) {
    hd.stars(SINGAPORE_STARS, light, (i) => Math.sin(phase * 2 + i) > 0)
    // Light-show beams sweep out of the SkyPark ends and fade into the sky.
    for (const [index, end] of [30, 40, 53, 63].entries()) {
      const sweep = Math.sin(phase + index * 1.7) * 7
      const tip = { x: end + (index < 2 ? -9 : 9) + sweep, y: -2 }
      for (let step = 0; step <= 120; step++) {
        const u = step / 120,
          bx = X(end + (tip.x - end) * u),
          by = Y(SINGAPORE_SKYPARK.y - 0.4 + (tip.y - SINGAPORE_SKYPARK.y) * u)
        const color = hdMix(hdHex(colors.accent), hdHex(colors.canopy), index / 3)
        for (let dx = -1; dx <= 1; dx++)
          blend(Math.round(bx) + dx, Math.round(by), color, (dx === 0 ? 0.55 : 0.18) * (1 - u))
        blend(Math.round(bx), Math.round(by) + 1, color, 0.3 * (1 - u))
      }
    }
    // One firework bursts and fades every loop.
    const burst = phase / (Math.PI * 2)
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2,
        reach = 3.4 * Math.min(1, burst * 1.6)
      const bx = X(22 + Math.cos(angle) * reach),
        by = Y(5.2 + Math.sin(angle) * reach * 0.8 + burst * burst * 1.2)
      hd.disk(bx, by, Math.max(0.8, line * 1.6 * (1 - burst * 0.6)), hdMix(light, hdHex(colors.accent), (i % 3) / 2))
    }
  } else {
    hd.puff(8 + Math.sin(phase), 3, 8, hdMix(stone, glass, 0.15))
    hd.puff(37 + Math.sin(phase), 2, 10, hdMix(stone, glass, 0.15))
    // Two gulls glide across; wings flap with the loop.
    for (const [index, bird] of [
      { x: 22, y: 5 },
      { x: 25.5, y: 6.2 },
    ].entries()) {
      const bx = bird.x + (phase / (Math.PI * 2)) * 6,
        by = bird.y + Math.sin(phase * 2 + index) * 0.25
      const flap = Math.sin(phase * 6 + index * 2) * 0.25
      hd.stroke(bx - 0.7, by + flap, bx, by, line * 0.7, shade)
      hd.stroke(bx, by, bx + 0.7, by + flap, line * 0.7, shade)
    }
  }
  hd.water(SINGAPORE_BAY_TOP, SINGAPORE_ROWS, hdHex(colors.water), hdHex(colors.waterDeep), phase)
  // Hazy far layer gives the bay depth behind the hero skyline.
  const far = hdMix(hdHex(colors.skyline), singaporeSkyRgb(style, 0.75), 0.55)
  for (const [x, top, width] of [
    [0, 14, 3],
    [3, 13, 2],
    [7, 15, 3],
    [13, 14, 2],
    [19, 13, 3],
    [21, 15, 4],
    [26, 14, 2],
    [64, 14, 3],
    [67, 13, 2],
    [70, 15, 3],
    [73, 12, 3],
    [66, 16, 5],
  ] as const) {
    hd.rect(X(x), Y(top), X(x + width), Y(SINGAPORE_BAY_TOP), far)
    for (let y = top + 0.7; y < SINGAPORE_BAY_TOP - 0.4; y += 1.1)
      hd.rect(
        X(x + 0.4),
        Y(y),
        X(x + width - 0.4),
        Y(y + 0.14),
        night ? hdMix(far, light, 0.18) : hdMix(far, glass, 0.3),
      )
  }
  for (const building of SINGAPORE_SKYLINE) {
    for (let py = Math.floor(Y(SINGAPORE_BAY_TOP)); py < Math.ceil(Y(SINGAPORE_BAY_TOP + 2.8)); py++) {
      const fade = 1 - (py - Y(SINGAPORE_BAY_TOP)) / (Y(2.8) || 1)
      for (let px = Math.floor(X(building.x)); px < Math.ceil(X(building.x + building.width)); px++)
        if ((px + py) % 3 !== 0) blend(px, py, hdHex(colors.skyline), 0.4 * Math.max(0, fade))
    }
    hd.rect(X(building.x), Y(building.top), X(building.x + building.width), Y(SINGAPORE_BAY_TOP), hdHex(colors.skyline))
    hd.stroke(
      building.x + building.width / 2,
      building.top - 0.6,
      building.x + building.width / 2,
      building.top,
      line,
      shade,
    )
    for (let y = building.top + 0.6; y < SINGAPORE_BAY_TOP - 0.4; y += 0.8)
      for (let x = building.x + 0.4; x < building.x + building.width - 0.3; x += 0.8)
        hd.rect(X(x), Y(y), X(x + 0.23), Y(y + 0.18), night && Math.floor(x * 3 + y * 7) % 4 !== 0 ? light : glass)
  }
  // Three gently bowed hotel towers, with shaded sides and stacked glass bays.
  for (const [index, center] of SINGAPORE_TOWERS.entries()) {
    for (let py = Math.floor(Y(7.3)); py < Math.ceil(Y(SINGAPORE_BAY_TOP)); py++) {
      const sy = py / ch,
        depth = Math.max(0, Math.min(1, (sy - 7.3) / 10.7))
      const bow = Math.sin(depth * Math.PI) * (index === 0 ? -0.7 : 0.4)
      const x = center + bow,
        half = 2.4 + depth * 0.7
      hd.rect(X(x - half), py, X(x + half), py + 1, tower)
      hd.rect(X(x + half - 0.9), py, X(x + half), py + 1, shade)
    }
    for (let y = 8; y < 17.8; y += 0.42) {
      const depth = (y - 7.3) / 10.7,
        bow = Math.sin(depth * Math.PI) * (index === 0 ? -0.7 : 0.4)
      for (let x = -1.9; x < 1.9; x += 0.58) {
        const lit = night && Math.floor(y * 17 + x * 9 + index * 5) % 5 !== 0
        hd.rect(
          X(center + bow + x),
          Y(y),
          X(center + bow + x + 0.32),
          Y(y + 0.14),
          lit ? hdMix(light, glass, 0.2) : glass,
        )
      }
    }
    hd.stroke(center - 2.5, 17.8, center + 2.6, 17.8, line, light)
    reflection(center, night ? light : glass, index, 1.7)
  }
  haze(15, SINGAPORE_BAY_TOP, night ? hdMix(hdHex(colors.skyBottom), accent, 0.25) : hdHex(colors.skyBottom), 0.4)
  // The long boat-shaped SkyPark joins all three towers; a green roof crowns it.
  const park = SINGAPORE_SKYPARK,
    mid = (park.x0 + park.x1) / 2
  // Ship-shaped deck: flat top, curved belly, and a pointed bow that overhangs the east tower.
  const hullA = park.x0 - 2.5,
    hullB = park.x1 + 4
  for (let px = Math.floor(X(hullA)); px < Math.ceil(X(hullB)); px++) {
    const u = (px / cw - hullA) / (hullB - hullA)
    const belly = 0.2 + 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.55)
    hd.rect(px, Y(park.y - 0.45), px + 1, Y(park.y - 0.45 + belly), u > 0.5 ? shade : hdMix(shade, tower, 0.4))
    hd.rect(px, Y(park.y - 0.45), px + 1, Y(park.y - 0.45 + Math.min(0.22, belly)), tower)
  }
  hd.stroke(
    park.x1 - 8,
    park.y - 0.2,
    park.x1 - 1,
    park.y - 0.2,
    line * 1.1,
    night ? hdMix(accent, light, 0.3) : hdMix(glass, light, 0.6),
  )
  hd.stroke(park.x0 + 1, park.y - 0.32, park.x1 - 1, park.y - 0.32, line * 1.8, night ? light : stone)
  for (let x = park.x0 + 2; x < park.x1 - 2; x += 1.1) {
    hd.blob(X(x), Y(park.y - 0.65), cw * 0.42, ch * 0.25, green)
    hd.stroke(x, park.y - 0.65, x, park.y - 0.35, line, shade)
  }
  // Open lattice Supertree crowns with foliage, radial ribs, and night LEDs.
  for (const [index, tree] of SINGAPORE_TREES.entries()) {
    const branch = hdHex(colors.tree)
    hd.mass(tree.x, tree.top, 18, 0.26, 0.7, green, branch, shade)
    hd.blob(X(tree.x), Y(tree.top), X(tree.radius), Y(0.5), night ? hdMix(canopy, branch, 0.5) : green)
    for (let i = 0; i <= 12; i++) {
      const u = (i / 12) * 2 - 1,
        tipX = tree.x + tree.radius * u
      const tipY = tree.top - 0.6 + u * u * 0.4
      hd.stroke(tree.x, tree.top + 2.8, tipX, tipY, line, night ? canopy : branch)
      hd.disk(
        X(tipX),
        Y(tipY),
        line * 2.2,
        night ? hdMix(canopy, accent, (Math.sin(phase * 2 + i * 0.4 + index) + 1) / 2) : hdMix(canopy, green, 0.3),
      )
    }
    hd.blob(X(tree.x), Y(18), X(tree.radius * 0.6), Y(0.24), green)
    if (night) reflection(tree.x, canopy, index, 1.1)
  }
  // Foreground Merlion: lion head with a curled mane, scaled fish body, and a tail that flicks up.
  const lion = SINGAPORE_MERLION
  hd.blob(X(lion.x - 1), Y(lion.base + 0.35), X(7), Y(0.6), hdMix(hdHex(colors.waterDeep), shade, 0.6))
  hd.rect(X(lion.x - 5.6), Y(lion.base - 0.15), X(lion.x + 2.6), Y(lion.base + 0.2), stoneShade)
  for (let i = 0; i < 9; i++) {
    const foam = Math.sin(phase * 2 + i * 1.3)
    hd.disk(
      X(lion.x - 6 + i * 1.1),
      Y(lion.base + 0.3 + foam * 0.05),
      line * (1.3 + foam * 0.3),
      hdMix(fountain, hdHex(colors.water), 0.25),
    )
  }
  const spine = (t: number) => ({ x: 14.1 - Math.sin(t * Math.PI) * 0.7, y: 13.8 + t * 5.4, r: 2.15 - t * 0.95 })
  for (let i = 0; i <= 36; i++) {
    const p = spine(i / 36)
    hd.blob(X(p.x + p.r * 0.3), Y(p.y), X(p.r), Y(0.5), stoneShade)
  }
  for (let i = 0; i <= 36; i++) {
    const p = spine(i / 36)
    hd.blob(X(p.x - 0.1), Y(p.y), X(p.r * 0.82), Y(0.5), stone)
  }
  // Tail sweeps left from the base, curls up, and ends in a two-lobed fin.
  for (let i = 0; i <= 40; i++) {
    const t = i / 40,
      tx = 13.2 - t * 6.4,
      ty = 19.1 - t * t * 3.6
    hd.blob(X(tx), Y(ty), X(1.05 - t * 0.6), Y(0.55 - t * 0.2), t < 0.5 ? stone : hdMix(stone, stoneShade, 0.3))
  }
  hd.stroke(6.9, 15.7, 5.6, 14.6, line * 1.6, stone)
  hd.stroke(6.9, 15.7, 7.9, 14.3, line * 1.6, stoneShade)
  hd.stroke(6.9, 15.7, 5.5, 16.2, line * 1.4, stoneShade)
  for (let row = 0; row < 7; row++) {
    for (let column = 0; column < 3; column++) {
      const x = 12.7 + column * 0.8 + (row % 2) * 0.4,
        y = 15.3 + row * 0.55
      hd.stroke(x - 0.3, y - 0.08, x, y + 0.1, line * 0.8, stoneShade)
      hd.stroke(x, y + 0.1, x + 0.3, y - 0.08, line * 0.8, stoneShade)
    }
  }
  // Mane: two rings of curled tufts behind the face, then face, muzzle and open mouth.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    hd.blob(
      X(14.3 + Math.cos(angle) * 1.7),
      Y(12.5 + Math.sin(angle) * 1.5),
      cw * 0.8,
      ch * 0.62,
      i % 2 === 0 ? stoneShade : stone,
    )
  }
  hd.blob(X(14.9), Y(12.6), X(1.45), Y(1.15), stone)
  hd.blob(X(16.1), Y(12.95), X(1.2), Y(0.62), stone)
  hd.blob(X(15.9), Y(13.55), X(0.8), Y(0.3), stoneShade)
  hd.blob(X(16.85), Y(12.55), X(0.32), Y(0.22), shade)
  hd.disk(X(16.55), Y(13.05), line * 1.2, shade)
  hd.disk(X(15.35), Y(11.95), line * 1.9, shade)
  hd.disk(X(15.4), Y(11.9), line * 0.7, light)
  hd.stroke(14.2, 11.35, 15.2, 11.15, line * 0.9, stoneShade)
  // The fountain and splash use the same parabolic path as the text fallback.
  let previous = singaporeJet(0, elapsedMs)
  for (let i = 1; i <= 90; i++) {
    const next = singaporeJet(i / 90, elapsedMs)
    hd.stroke(previous.x, previous.y, next.x, next.y, line * (1.3 - i / 180), hdMix(fountain, stoneShade, 0.18))
    if (i % 3 === 0) hd.disk(X(next.x), Y(next.y), line * (1 + Math.sin(phase * 5 - i) * 0.25), fountain)
    previous = next
  }
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + phase * 3
    hd.disk(X(32 + Math.cos(angle) * 1.4), Y(20 + Math.sin(angle) * 0.24), line * 1.3, fountain)
  }
  const boat = singaporeBoat(elapsedMs)
  hd.blob(X(boat.x + 1.7), Y(boat.y + 0.6), X(2.8), Y(0.3), shade)
  hd.blob(X(boat.x + 1.7), Y(boat.y + 0.45), X(2.5), Y(0.3), hdDarken(accent, 0.8))
  hd.rect(X(boat.x + 0.4), Y(boat.y - 0.15), X(boat.x + 3), Y(boat.y + 0.4), light)
  hd.rect(X(boat.x + 0.7), Y(boat.y), X(boat.x + 2.7), Y(boat.y + 0.2), glass)
  for (let i = 0; i < 4; i++)
    hd.stroke(boat.x - 1 - i, boat.y + 0.65, boat.x - 0.4 - i, boat.y + 0.65, line, hdHex(colors.water))
  blitGlyphText(
    hd.pixels,
    hd.w,
    hd.h,
    Math.round(X(33)),
    Math.round(Y(23)),
    Math.max(1, Math.round(cw)),
    Math.max(1, Math.round(ch)),
    "SINGAPORE",
    light,
  )
  return hd.pixels
}
