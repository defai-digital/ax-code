import { CHROME_WIDTH_DEFAULT, CHROME_WIDTHS, chromeWidth } from "../chrome-width"

export const NAVIGATION_RAIL_WIDTH = CHROME_WIDTH_DEFAULT
export const NAVIGATION_DOCK_MIN_WIDTH = 146
export const NAVIGATION_CONTENT_MIN_WIDTH = 122
export const NAVIGATION_WIDTHS = CHROME_WIDTHS

export function navigationWidth(value: unknown): number {
  return chromeWidth(value, NAVIGATION_RAIL_WIDTH)
}

/** Content columns after the rail's left padding and right split border. */
export function navigationRailInnerWidth(width: number) {
  return Math.max(0, width - 2)
}

/** Labels inside a 1+1 padded section card, still fitting the 24-column rail. */
export function navigationPanelInnerWidth(width: number) {
  return Math.max(0, navigationRailInnerWidth(width) - 2)
}

export function navigationLayout(
  terminalWidth: number,
  enabled: boolean,
  preferredWidth: unknown = NAVIGATION_RAIL_WIDTH,
) {
  const railWidth =
    enabled && terminalWidth >= NAVIGATION_DOCK_MIN_WIDTH
      ? Math.min(navigationWidth(preferredWidth), terminalWidth - NAVIGATION_CONTENT_MIN_WIDTH)
      : 0
  return { railWidth, contentWidth: Math.max(0, terminalWidth - railWidth) }
}
