export const NAVIGATION_RAIL_WIDTH = 24
export const NAVIGATION_DOCK_MIN_WIDTH = 146

export function navigationLayout(terminalWidth: number, enabled: boolean) {
  const railWidth = enabled && terminalWidth >= NAVIGATION_DOCK_MIN_WIDTH ? NAVIGATION_RAIL_WIDTH : 0
  return { railWidth, contentWidth: Math.max(0, terminalWidth - railWidth) }
}
