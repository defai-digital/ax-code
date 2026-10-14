/**
 * Geography for the Sanguozhi campaign map: an original, stylized relief of
 * the late Han heartland drawn from public geography. Positions are degrees
 * of longitude and latitude; the painter projects them onto the frame.
 * Cities, rivers, and coast are approximate and simplified for a small screen.
 */

export type MapPoint = readonly [lon: number, lat: number]

export const SANGUOZHI_BOUNDS = { west: 101, east: 122.5, north: 41.2, south: 27 } as const

/** Faction banner colors. The last entry is the unified realm of the ending. */
export const SANGUOZHI_FACTIONS = [
  "#3a6fd0",
  "#d0402e",
  "#3f9a48",
  "#e0709c",
  "#8a4fc0",
  "#ececec",
  "#2fa3a0",
  "#e07a28",
] as const
export const SANGUOZHI_UNIFIED = "#e8c24a"

/** `label: "left"` sets the name beside the city where the default spot below would collide. */
export type SanguozhiCity = Readonly<{ name: string; lon: number; lat: number; faction: number; label?: "left" }>

export const SANGUOZHI_CITIES: readonly SanguozhiCity[] = [
  { name: "北平", lon: 116.4, lat: 39.9, faction: 5 },
  { name: "平原", lon: 116.4, lat: 37.3, faction: 0 },
  { name: "鄴", lon: 114.4, lat: 36.3, faction: 0 },
  { name: "濮陽", lon: 115.4, lat: 35.6, faction: 3 },
  { name: "洛陽", lon: 112.4, lat: 34.7, faction: 4 },
  { name: "長安", lon: 108.9, lat: 34.3, faction: 4 },
  { name: "天水", lon: 105.7, lat: 34.6, faction: 4 },
  { name: "漢中", lon: 107.0, lat: 33.1, faction: 5 },
  { name: "成都", lon: 104.1, lat: 30.7, faction: 2 },
  { name: "永安", lon: 109.5, lat: 31.0, faction: 2 },
  { name: "宛", lon: 112.5, lat: 33.0, faction: 3, label: "left" },
  { name: "許昌", lon: 113.8, lat: 34.0, faction: 3 },
  { name: "襄陽", lon: 112.1, lat: 32.0, faction: 6 },
  { name: "江陵", lon: 112.2, lat: 30.3, faction: 6 },
  { name: "長沙", lon: 113.0, lat: 28.2, faction: 6 },
  { name: "柴桑", lon: 116.0, lat: 29.7, faction: 1 },
  { name: "建業", lon: 118.8, lat: 32.0, faction: 1 },
  { name: "下邳", lon: 118.0, lat: 34.3, faction: 7 },
]

/** Every character the map letters: city names, the date panel's marks, and digits. */
export const SANGUOZHI_GLYPH_CHARS: readonly string[] = [
  ...new Set([...SANGUOZHI_CITIES.flatMap((entry) => [...entry.name]), "年", "月", ..."0123456789"]),
]

const city = (name: string) => SANGUOZHI_CITIES.findIndex((entry) => entry.name === name)

export const SANGUOZHI_ROADS: readonly (readonly [number, number])[] = [
  ["北平", "平原"],
  ["平原", "鄴"],
  ["鄴", "濮陽"],
  ["鄴", "洛陽"],
  ["濮陽", "許昌"],
  ["洛陽", "許昌"],
  ["洛陽", "長安"],
  ["長安", "天水"],
  ["長安", "漢中"],
  ["漢中", "成都"],
  ["洛陽", "宛"],
  ["許昌", "宛"],
  ["宛", "襄陽"],
  ["襄陽", "江陵"],
  ["江陵", "永安"],
  ["永安", "成都"],
  ["江陵", "長沙"],
  ["江陵", "柴桑"],
  ["柴桑", "建業"],
  ["建業", "下邳"],
  ["下邳", "濮陽"],
  ["許昌", "下邳"],
  ["平原", "下邳"],
].map(([a, b]) => [city(a!), city(b!)] as const)

/** Armies marching in the opening: road index, direction, faction, and phase offset. */
export const SANGUOZHI_ARMIES: readonly Readonly<{
  road: number
  reverse: boolean
  faction: number
  offset: number
}>[] = [
  { road: 2, reverse: false, faction: 0, offset: 0 },
  { road: 6, reverse: true, faction: 4, offset: 0.35 },
  { road: 18, reverse: true, faction: 1, offset: 0.6 },
  { road: 9, reverse: true, faction: 2, offset: 0.15 },
  { road: 12, reverse: true, faction: 6, offset: 0.8 },
  { road: 21, reverse: false, faction: 3, offset: 0.45 },
]

export type SanguozhiRiver = Readonly<{ width: number; points: readonly MapPoint[] }>

export const SANGUOZHI_RIVERS: readonly SanguozhiRiver[] = [
  // Yellow River: down from the west, north around the Ordos loop, east to the Bohai.
  {
    width: 1.25,
    points: [
      [101, 35.9],
      [102.6, 36.1],
      [103.8, 36.1],
      [105.2, 37.4],
      [106.3, 38.6],
      [106.8, 39.9],
      [108.2, 40.7],
      [110.3, 40.6],
      [111.0, 39.6],
      [110.6, 38.0],
      [110.4, 36.2],
      [110.3, 34.7],
      [111.5, 34.8],
      [113.0, 34.9],
      [114.6, 35.0],
      [115.6, 35.8],
      [116.8, 36.8],
      [118.0, 37.6],
      [118.7, 37.8],
    ],
  },
  // Yangtze: through the Sichuan basin and the gorges, past the lakes to the sea.
  {
    width: 1.45,
    points: [
      [101, 27.6],
      [102.6, 28.3],
      [104.6, 28.8],
      [106.5, 29.6],
      [108.2, 30.4],
      [109.6, 31.0],
      [111.2, 30.7],
      [112.4, 30.0],
      [113.2, 29.5],
      [114.3, 30.6],
      [115.4, 29.9],
      [116.2, 29.8],
      [117.3, 30.6],
      [118.4, 31.6],
      [119.4, 32.2],
      [120.5, 31.9],
      [121.8, 31.4],
    ],
  },
  // Han River, joining the Yangtze at Xiakou.
  {
    width: 0.85,
    points: [
      [106.8, 33.1],
      [108.6, 32.8],
      [110.4, 32.6],
      [111.4, 32.4],
      [112.2, 31.9],
      [112.6, 31.0],
      [113.6, 30.7],
      [114.3, 30.6],
    ],
  },
  // Wei River into the Yellow River.
  {
    width: 0.75,
    points: [
      [104.2, 34.9],
      [105.8, 34.6],
      [107.4, 34.4],
      [108.9, 34.4],
      [110.3, 34.65],
    ],
  },
  // Huai River to the coast.
  {
    width: 0.8,
    points: [
      [112.8, 32.5],
      [114.5, 32.4],
      [116.2, 32.6],
      [117.6, 33.1],
      [118.8, 33.6],
      [119.8, 34.0],
    ],
  },
  // Min River down the Sichuan basin.
  {
    width: 0.6,
    points: [
      [103.4, 31.8],
      [103.9, 30.9],
      [104.0, 29.9],
      [104.6, 28.8],
    ],
  },
]

export const SANGUOZHI_LAKES: readonly Readonly<{ lon: number; lat: number; rx: number; ry: number }>[] = [
  { lon: 112.8, lat: 29.2, rx: 0.65, ry: 0.42 },
  { lon: 116.3, lat: 29.0, rx: 0.4, ry: 0.55 },
  { lon: 120.2, lat: 31.2, rx: 0.32, ry: 0.28 },
]

/** The sea, as a closed polygon of the coast with the frame's east edge. */
export const SANGUOZHI_SEA: readonly MapPoint[] = [
  [122.6, 41.3],
  [121.3, 41.3],
  [121.0, 40.6],
  [119.6, 39.9],
  [118.4, 39.1],
  [117.7, 38.6],
  [118.0, 37.9],
  [118.9, 37.3],
  [119.9, 37.2],
  [120.8, 37.7],
  [121.6, 37.5],
  [122.6, 37.3],
  [122.6, 36.9],
  [122.0, 36.9],
  [121.0, 36.5],
  [120.2, 36.0],
  [119.5, 35.3],
  [119.3, 34.7],
  [120.3, 34.0],
  [120.9, 32.8],
  [121.8, 32.0],
  [121.9, 31.2],
  [121.0, 30.8],
  [121.9, 30.0],
  [121.9, 29.2],
  [121.4, 28.2],
  [120.8, 27.3],
  [120.5, 26.9],
  [122.6, 26.9],
]

export function insideSea(lon: number, lat: number): boolean {
  let inside = false
  for (let i = 0, j = SANGUOZHI_SEA.length - 1; i < SANGUOZHI_SEA.length; j = i++) {
    const [xi, yi] = SANGUOZHI_SEA[i]!
    const [xj, yj] = SANGUOZHI_SEA[j]!
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const ridgeAlong = (lon: number, lat: number, a: MapPoint, b: MapPoint, width: number) => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const u = Math.max(0, Math.min(1, ((lon - a[0]) * dx + (lat - a[1]) * dy) / (dx * dx + dy * dy)))
  const d = Math.hypot(lon - (a[0] + dx * u), lat - (a[1] + dy * u)) / width
  return Math.exp(-d * d)
}

/**
 * Large-scale relief, 0 (plain) to about 1 (high plateau), before the painter
 * adds ridged detail: the plateau edge in the west, the Qinling and Daba
 * ranges, the Taihang and Yan ranges, the Shandong hills, and the southern
 * uplands, with the Sichuan basin and the North China Plain left low.
 */
export function sanguozhiRelief(lon: number, lat: number): number {
  let h = 0.08
  h += smooth(105.2, 101.4, lon) * 0.62
  h += smooth(104.5, 101.5, lon) * smooth(32, 36, lat) * 0.15
  h += ridgeAlong(lon, lat, [103.6, 34.0], [112.0, 33.7], 0.55) * 0.58
  h += ridgeAlong(lon, lat, [106.0, 32.2], [110.8, 31.6], 0.5) * 0.42
  h += ridgeAlong(lon, lat, [113.2, 35.0], [115.2, 40.2], 0.45) * 0.5
  h += ridgeAlong(lon, lat, [114.0, 40.8], [119.4, 40.4], 0.5) * 0.42
  h += ridgeAlong(lon, lat, [110.2, 35.0], [111.6, 39.0], 0.6) * 0.3
  h += smooth(106, 108, lon) * smooth(112, 110, lon) * smooth(36, 37.5, lat) * smooth(41, 39.6, lat) * 0.24
  h += Math.exp(-((lon - 117.6) ** 2 + (lat - 36.2) ** 2) / 0.9) * 0.32
  h += smooth(30.2, 28.5, lat) * smooth(108.5, 110.5, lon) * 0.28
  h += ridgeAlong(lon, lat, [113.8, 31.6], [116.4, 31.0], 0.45) * 0.3
  h += ridgeAlong(lon, lat, [117.4, 28.2], [120.2, 30.0], 0.7) * 0.26
  h -= Math.exp(-((lon - 105.0) ** 2 / 2.2 + (lat - 30.3) ** 2 / 1.2)) * 0.22
  h -= Math.exp(-((lon - 115.5) ** 2 / 4 + (lat - 35.6) ** 2 / 5)) * 0.06
  return Math.max(0, h)
}
