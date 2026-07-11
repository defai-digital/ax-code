export const DEFAULT_CORNER_RADIUS = 18
export const MIN_CORNER_RADIUS = 0
export const MAX_CORNER_RADIUS = 32

export type CornerRadiusTokens = {
  base: number
  sm: number
  md: number
  lg: number
  xl: number
}

export const normalizeCornerRadius = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_CORNER_RADIUS
  return Math.max(MIN_CORNER_RADIUS, Math.min(MAX_CORNER_RADIUS, Math.round(value)))
}

export const resolveCornerRadiusTokens = (value: number): CornerRadiusTokens => {
  const normalized = normalizeCornerRadius(value)
  const scale = normalized / DEFAULT_CORNER_RADIUS
  const scaled = (base: number) => Math.round(base * scale * 100) / 100

  return {
    base: scaled(10),
    sm: scaled(4),
    md: scaled(8),
    lg: scaled(10),
    xl: scaled(12),
  }
}

export const applyCornerRadius = (value: number, root: HTMLElement = document.documentElement): void => {
  const tokens = resolveCornerRadiusTokens(value)
  root.style.setProperty("--radius", `${tokens.base}px`)
  root.style.setProperty("--radius-sm", `${tokens.sm}px`)
  root.style.setProperty("--radius-md", `${tokens.md}px`)
  root.style.setProperty("--radius-lg", `${tokens.lg}px`)
  root.style.setProperty("--radius-xl", `${tokens.xl}px`)
}
