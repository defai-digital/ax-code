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

/** Vermilion gate, shrine hall, and petals on a 2400ms loop. */
export function renderToriiPixels(width: number, height: number, style: ToriiStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, TORII_COLUMNS, TORII_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "torii-night"
  const c = TORII_COLORS[style]
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const coreR = Math.max(3, Math.min(hd.cw, hd.ch) * 0.9)
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
  const cloud = hdHex(c.cloud)
  const robe = hdHex(c.robe)
  const orb = night ? TORII_MOON : { x: 14, y: 1.7 }
  const leftPillar = night ? vermilionDark : vermilion
  const rightPillar = night ? vermilion : vermilionDark
  const pillars = TORII_PILLARS
  const shrine = TORII_SHRINE

  hd.sky((t) => toriiSkyRgb(style, t))
  if (night) {
    hd.stars(TORII_STARS, hdHex(c.sky), (i) => (Math.floor(Math.max(0, elapsedMs) / 400) + i) % 3 === 0)
  }
  hd.halo(hd.X(orb.x), hd.Y(orb.y), coreR, night ? stone : cloud, night ? hdHex(c.sky) : flame, skyAt(orb.y))

  hd.mass(14, 7.4, 10.8, 1.1, 8, mountain, hdDarken(mountain, 0.76), hdMix(mountain, tree, 0.4))
  hd.mass(38, 6.8, 10.9, 1.3, 12, mountain, hdDarken(mountain, 0.7), hdMix(mountain, tree, 0.3))
  hd.mass(64, 7.5, 10.8, 1.1, 8.5, hdDarken(mountain, 0.82), mountain, hdMix(mountain, tree, 0.4))
  for (const treeX of [6, 10, 66, 70]) {
    hd.blob(hd.X(treeX + 0.7), hd.Y(12.2), hd.cw * 1.6, hd.ch * 0.7, tree, hdDarken(tree, 0.68))
    hd.rect(hd.X(treeX + 0.45), hd.Y(12.7), hd.X(treeX + 0.95), hd.Y(14.1), hdDarken(tree, 0.55))
  }
  for (const stalk of [2, 73]) {
    hd.stroke(stalk, 14, stalk, 17.2, Math.max(1.2, hd.cw * 0.1), tree)
  }

  const span = (pillars.left + pillars.right) / 2
  hd.blob(hd.X(span + 0.6), hd.Y(TORII_LINTEL_TOP + 0.15), hd.cw * 14.5, hd.ch * 0.55, vermilion, vermilionDark)
  hd.rect(
    hd.X(pillars.left - 4),
    hd.Y(TORII_LINTEL_TOP + 0.55),
    hd.X(pillars.right + 6),
    hd.Y(TORII_LINTEL_TOP + 1.35),
    vermilion,
  )
  hd.rect(
    hd.X(pillars.left - 3.2),
    hd.Y(TORII_LINTEL_TOP + 0.95),
    hd.X(pillars.right + 5.2),
    hd.Y(TORII_LINTEL_TOP + 1.45),
    cap,
  )
  const post = Math.max(2.1, hd.cw * 0.42)
  hd.stroke(pillars.left + 0.4, pillars.top, pillars.left + 0.4, pillars.base, post, leftPillar)
  hd.stroke(pillars.right + 0.9, pillars.top, pillars.right + 0.9, pillars.base, post, rightPillar)
  hd.stroke(
    pillars.left + 1.25,
    pillars.top,
    pillars.left + 1.25,
    pillars.base,
    Math.max(1.3, hd.cw * 0.16),
    vermilionDark,
  )
  hd.stroke(
    pillars.right + 1.7,
    pillars.top,
    pillars.right + 1.7,
    pillars.base,
    Math.max(1.3, hd.cw * 0.16),
    vermilionDark,
  )
  hd.stroke(
    pillars.left - 1,
    TORII_LINTEL_TIE,
    pillars.right + 3,
    TORII_LINTEL_TIE,
    Math.max(1.7, hd.ch * 0.12),
    vermilionDark,
  )
  hd.rect(hd.X(pillars.left - 2), hd.Y(pillars.base + 0.7), hd.X(pillars.left + 4), hd.Y(pillars.base + 1.15), stone)
  hd.rect(
    hd.X(pillars.right - 2),
    hd.Y(pillars.base + 0.7),
    hd.X(pillars.right + 4),
    hd.Y(pillars.base + 1.15),
    stoneDark,
  )

  for (const chochin of TORII_CHOCHIN) {
    hd.disk(hd.X(chochin + 0.5), hd.Y(pillars.top + 0.35), dot * 0.7, flame)
  }
  const flicker = toriiFlicker(elapsedMs)
  for (const lanternX of TORII_LANTERNS) {
    hd.rect(hd.X(lanternX - 1), hd.Y(14.05), hd.X(lanternX + 4), hd.Y(14.4), stoneDark)
    hd.rect(hd.X(lanternX), hd.Y(15), hd.X(lanternX + 3), hd.Y(16.1), lantern)
    hd.disk(hd.X(lanternX + 1.5), hd.Y(15.45), flicker ? dot * 0.55 : dot * 0.28, flicker ? flame : stone)
    hd.rect(hd.X(lanternX + 1.15), hd.Y(16.1), hd.X(lanternX + 1.55), hd.Y(17.3), stoneDark)
  }
  for (const fox of TORII_FOXES) {
    hd.blob(hd.X(fox + 0.6), hd.Y(17.2), hd.cw * 0.9, hd.ch * 0.4, stone, stoneDark)
    hd.rect(hd.X(fox + 0.35), hd.Y(17.5), hd.X(fox + 0.7), hd.Y(18.4), stoneDark)
    hd.rect(hd.X(fox + 1.05), hd.Y(17.5), hd.X(fox + 1.4), hd.Y(18.4), stoneDark)
  }
  for (const figure of TORII_FIGURES) {
    hd.disk(hd.X(figure + 0.4), hd.Y(17.2), dot * 0.4, robe)
    hd.rect(hd.X(figure + 0.22), hd.Y(17.55), hd.X(figure + 0.58), hd.Y(18.5), robe)
  }

  for (const flake of toriiPetals(elapsedMs)) {
    hd.disk(hd.X(flake.x + 0.5), hd.Y(flake.y + 0.5), dot * (0.45 + (flake.x % 3) * 0.12), petal)
  }

  hd.rect(0, hd.Y(TORII_GROUND_TOP), hd.w, hd.h, ground)
  for (const slab of TORII_PATH_SLABS) {
    hd.rect(hd.X(slab), hd.Y(TORII_GROUND_TOP + 1.05), hd.X(slab + 3), hd.Y(TORII_GROUND_TOP + 1.55), path)
  }
  for (let x = 1; x < TORII_COLUMNS; x += 6) {
    hd.disk(hd.X(x + 0.3), hd.Y(TORII_GROUND_TOP + 3.2), dot * 0.35, tree)
  }

  // Shrine wall seen through the gate. Painted last so petals cannot recolor the sample.
  hd.rect(hd.X(shrine.x0), hd.Y(shrine.top), hd.X(shrine.x1 + 1), hd.Y(shrine.top + 0.28), cap)
  hd.rect(hd.X(shrine.x0 + 0.4), hd.Y(shrine.top + 0.35), hd.X(shrine.x1 + 0.6), hd.Y(shrine.base + 0.2), vermilion)
  hd.rect(
    hd.X(shrine.x0 + 0.4),
    hd.Y(shrine.top + 0.35),
    hd.X(shrine.x0 + 0.85),
    hd.Y(shrine.base + 0.2),
    vermilionDark,
  )
  hd.disk(hd.X((shrine.x0 + shrine.x1) / 2), hd.Y(shrine.top + 1.15), Math.max(1.4, hd.cw * 0.28), flame)
  return hd.pixels
}
