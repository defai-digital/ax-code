export const NAVIGATION_RAIL_WIDTH = 24
export const NAVIGATION_DOCK_MIN_WIDTH = 146
export const NAVIGATION_WIDTHS = [24, 30, 36] as const

export function navigationWidth(value: unknown): number {
  return typeof value === "number" && NAVIGATION_WIDTHS.some((width) => width === value) ? value : NAVIGATION_RAIL_WIDTH
}

export function navigationLayout(
  terminalWidth: number,
  enabled: boolean,
  preferredWidth: unknown = NAVIGATION_RAIL_WIDTH,
) {
  const railWidth =
    enabled && terminalWidth >= NAVIGATION_DOCK_MIN_WIDTH
      ? Math.min(navigationWidth(preferredWidth), terminalWidth - 122)
      : 0
  return { railWidth, contentWidth: Math.max(0, terminalWidth - railWidth) }
}
