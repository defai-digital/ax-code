import type { FujiRun } from "./fuji-view-model"

export type CityStyle = "city-night" | "city-dawn"
export function isCityStyle(style: string | undefined): style is CityStyle {
  return style === "city-night" || style === "city-dawn"
}

/** Reference composition size shared by both renderers. */
export const CITY_COLUMNS = 72
export const CITY_ROWS = 24
export const CITY_STREET_TOP = 22
export const CITY_LAMPS = [6, 20, 34, 48, 62] as const
export const CITY_MOON = { x: 60, y: 2 } as const
export const CITY_SUN = { x: 12, y: 3 } as const

/** Palette shared by the text and pixel renderers. */
export const CITY_COLORS = {
  "city-night": {
    sky: "#aab4e0",
    skyBottom: "#1b2451",
    building: "#141a38",
    edge: "#2a3560",
    windowLit: "#ffd166",
    windowDim: "#3a4668",
    orb: "#e8ecf8",
    lamp: "#ffca7a",
    street: "#0d1128",
  },
  "city-dawn": {
    sky: "#e8b48a",
    skyBottom: "#e08050",
    building: "#241a3a",
    edge: "#6a4a70",
    windowLit: "#ffe6a3",
    windowDim: "#5a4a68",
    orb: "#ffcf6e",
    lamp: "#ffca7a",
    street: "#2a1f3d",
  },
} as const satisfies Record<CityStyle, Record<string, string>>

export function cityBackground(style: CityStyle) {
  return style === "city-night" ? "#0a0e27" : "#2b1b4d"
}

/** Sample the vertical sky gradient. `t` is 0 at the top of the frame. */
export function citySkyRgb(style: CityStyle, t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const from = [1, 3, 5].map((offset) => parseInt(cityBackground(style).slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(CITY_COLORS[style].skyBottom.slice(offset, offset + 2), 16))
  return [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * x)) as [
    number,
    number,
    number,
  ]
}

export type CityBuilding = { x: number; w: number; top: number }
/** Fixed skyline: nine towers filling the reference exactly once. */
export function cityBuildings(): CityBuilding[] {
  const buildings: CityBuilding[] = []
  let cursor = 1
  for (let i = 0; i < 9; i++) {
    const w = 6 + ((i * 5) % 3)
    const top = CITY_STREET_TOP - 1 - (8 + (i % 9))
    buildings.push({ x: cursor, w, top })
    cursor += w + 1
  }
  return buildings
}

export type CityWindow = { x: number; y: number; wx: number; wy: number }
/** Window cells inside a tower, one cell wide with one-cell gaps. */
export function cityWindows(building: CityBuilding): CityWindow[] {
  const windows: CityWindow[] = []
  for (let wy = 0, y = building.top + 1; y < CITY_STREET_TOP - 1; wy++, y += 2) {
    for (let wx = 0, x = building.x + 1; x < building.x + building.w - 1; wx++, x += 2) {
      windows.push({ x, y, wx, wy })
    }
  }
  return windows
}

/** Lit windows from a fixed hash; every ninth window twinkles with elapsed time. */
export function cityWindowLit(style: CityStyle, i: number, wx: number, wy: number, elapsedMs: number): boolean {
  const base = (i * 13 + wx * 7 + wy * 3) % 10 < (style === "city-night" ? 6 : 3)
  if ((i + wx + wy) % 9 !== 0) return base
  return Math.floor(Math.max(0, elapsedMs) / 500) % 2 === 1 ? !base : base
}

export function cityRows(columns: number, rows: number, style: CityStyle, elapsedMs: number): FujiRun[][] {
  const width = Math.max(0, Math.floor(columns)),
    height = Math.max(0, Math.floor(rows))
  const night = style === "city-night"
  const colors = CITY_COLORS[style]
  const grid: FujiRun[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ text: " ", color: colors.sky })),
  )
  const left = Math.floor((width - CITY_COLUMNS) / 2),
    top = Math.floor((height - CITY_ROWS) / 2)
  const paint = (x: number, y: number, text: string, color: string, background?: string) => {
    const row = top + y
    if (row < 0 || row >= height) return
    for (let i = 0; i < text.length; i++) {
      const column = left + x + i
      if (x + i < 0 || x + i >= CITY_COLUMNS || column < 0 || column >= width) continue
      grid[row]![column] = { text: text[i]!, color, background }
    }
  }
  if (night) {
    paint(2, 0, ".    *      .       *      .", colors.sky)
    paint(6, 1, "*     .      *      .", colors.sky)
  }
  const orb = night ? CITY_MOON : CITY_SUN
  paint(orb.x - 1, orb.y - 1, ".-.", colors.orb)
  paint(orb.x - 2, orb.y, "(   )", colors.orb)
  cityBuildings().forEach((building, i) => {
    for (let y = building.top; y < CITY_STREET_TOP - 1; y++) {
      paint(building.x, y, " ".repeat(building.w), colors.building, colors.building)
    }
    paint(building.x, building.top, "_".repeat(building.w), colors.edge, colors.building)
    for (const window of cityWindows(building)) {
      const lit = cityWindowLit(style, i, window.wx, window.wy, elapsedMs)
      paint(window.x, window.y, lit ? "*" : ".", lit ? colors.windowLit : colors.windowDim, colors.building)
    }
  })
  paint(0, CITY_STREET_TOP, " ".repeat(CITY_COLUMNS), colors.street, colors.street)
  paint(0, CITY_STREET_TOP + 1, " ".repeat(CITY_COLUMNS), colors.street, colors.street)
  for (const lamp of CITY_LAMPS) paint(lamp, CITY_STREET_TOP, "*", colors.lamp, colors.street)
  return grid.map((row) => {
    const runs: FujiRun[] = []
    for (const cell of row) {
      const last = runs.at(-1)
      if (last?.color === cell.color && last.background === cell.background) last.text += cell.text
      else runs.push({ ...cell })
    }
    return runs
  })
}
