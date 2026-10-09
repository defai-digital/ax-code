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
  hd.sky((v) => singaporeSkyRgb(style, v))
  hd.halo(X(64), Y(2.8), Math.min(cw, ch) * 0.9, light, hdMix(light, glass, 0.5), singaporeSkyRgb(style, 0.12))
  if (night) hd.stars(SINGAPORE_STARS, light, (i) => Math.sin(phase * 2 + i) > 0)
  else {
    hd.puff(8 + Math.sin(phase), 3, 8, hdMix(stone, glass, 0.15))
    hd.puff(37 + Math.sin(phase), 2, 10, hdMix(stone, glass, 0.15))
  }
  hd.water(SINGAPORE_BAY_TOP, SINGAPORE_ROWS, hdHex(colors.water), hdHex(colors.waterDeep), phase)
  for (const building of SINGAPORE_SKYLINE) {
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
  // The long boat-shaped SkyPark joins all three towers; a green roof crowns it.
  const park = SINGAPORE_SKYPARK,
    mid = (park.x0 + park.x1) / 2
  hd.blob(X(mid), Y(park.y), X((park.x1 - park.x0) / 2), Y(0.6), shade)
  hd.blob(X(mid), Y(park.y - 0.24), X((park.x1 - park.x0) / 2), Y(0.32), tower)
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
  // Foreground Merlion: curling fish tail, scale arcs, upright body and lion mane.
  const lion = SINGAPORE_MERLION
  hd.blob(X(lion.x), Y(lion.base + 0.1), X(5.8), Y(0.55), shade)
  hd.rect(X(lion.x - 5.6), Y(lion.base - 0.15), X(lion.x + 2.6), Y(lion.base + 0.2), stoneShade)
  hd.blob(X(11.3), Y(19.3), X(3.3), Y(0.52), stoneShade)
  hd.blob(X(lion.x), Y(16.6), X(2.5), Y(3.2), stoneShade)
  hd.blob(X(lion.x + 0.35), Y(16.3), X(1.85), Y(3), stone)
  hd.stroke(8.4, 18.3, 9.6, 19.4, line * 2, stone)
  hd.stroke(8.4, 20, 9.6, 19.4, line * 2, stone)
  for (let row = 0; row < 6; row++) {
    for (let column = 0; column < 3; column++) {
      const x = 12.6 + column * 0.85 + (row % 2) * 0.3,
        y = 15.7 + row * 0.5
      hd.stroke(x - 0.3, y - 0.08, x, y + 0.1, line, stoneShade)
      hd.stroke(x, y + 0.1, x + 0.3, y - 0.08, line, stoneShade)
    }
  }
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    hd.blob(
      X(13.7 + Math.cos(angle) * 1.65),
      Y(12.7 + Math.sin(angle) * 1.6),
      cw * 0.7,
      ch * 0.5,
      i % 2 === 0 ? stone : stoneShade,
    )
  }
  hd.blob(X(14.4), Y(12.5), X(1.7), Y(1.2), stone)
  hd.blob(X(16), Y(13), X(1.3), Y(0.5), stone)
  hd.blob(X(14.5), Y(11.5), X(0.6), Y(0.55), stoneShade)
  hd.blob(X(14.55), Y(11.5), X(0.34), Y(0.32), stone)
  hd.disk(X(15.45), Y(12.35), line * 1.8, shade)
  hd.blob(X(17), Y(12.85), X(0.18), Y(0.18), shade)
  hd.stroke(15.8, 13.35, 16.9, 13.35, line, stoneShade)
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
