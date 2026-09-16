export const CHROME_WIDTHS = [26, 28, 30, 32, 34, 36, 38] as const
export const NAVIGATION_WIDTH_DEFAULT = 28
export const SIDEBAR_WIDTH_DEFAULT = 32

export type ChromeWidth = (typeof CHROME_WIDTHS)[number]

export function chromeWidth(value: unknown, fallback: ChromeWidth = NAVIGATION_WIDTH_DEFAULT): ChromeWidth {
  return CHROME_WIDTHS.find((width) => width === value) ?? fallback
}
