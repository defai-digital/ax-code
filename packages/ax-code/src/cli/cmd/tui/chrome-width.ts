export const CHROME_WIDTHS = [20, 24, 30, 36, 40] as const
export const CHROME_WIDTH_DEFAULT = 30

export type ChromeWidth = (typeof CHROME_WIDTHS)[number]

export function chromeWidth(value: unknown, fallback: ChromeWidth = CHROME_WIDTH_DEFAULT): ChromeWidth {
  return CHROME_WIDTHS.find((width) => width === value) ?? fallback
}
