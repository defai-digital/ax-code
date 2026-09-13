export const CHROME_WIDTHS = [20, 24, 30, 36, 40] as const
export const NAVIGATION_WIDTH_DEFAULT = 30
export const SIDEBAR_WIDTH_DEFAULT = 36

export type ChromeWidth = (typeof CHROME_WIDTHS)[number]

export function chromeWidth(value: unknown, fallback: ChromeWidth = NAVIGATION_WIDTH_DEFAULT): ChromeWidth {
  return CHROME_WIDTHS.find((width) => width === value) ?? fallback
}
