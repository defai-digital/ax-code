/**
 * Pure screen-mode selection for the opt-in inline TUI (ADR-261).
 *
 * Precedence is flag > env > tui.json `screen` > default "auto". Every layer is
 * validated before it is accepted: an unrecognized value is ignored and the
 * next layer is consulted, so a typo can never take the terminal offline or
 * throw during startup.
 *
 * Trust rule: config is the lowest-priority layer. A value coming from
 * `tui.json` can never override env or flag — e.g. env "full" + config
 * "inline" resolves to full from env.
 */

export const TUI_SCREENS = ["auto", "full", "inline"] as const
export const TUI_SCREEN_SOURCES = ["flag", "env", "config", "default"] as const

export type TuiScreen = (typeof TUI_SCREENS)[number]
export type TuiScreenSource = (typeof TUI_SCREEN_SOURCES)[number]

export type TuiScreenResolution = {
  screen: TuiScreen
  source: TuiScreenSource
}

export const DEFAULT_TUI_SCREEN: TuiScreen = "auto"

export function parseTuiScreenValue(value: unknown): TuiScreen | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  return (TUI_SCREENS as readonly string[]).includes(normalized) ? (normalized as TuiScreen) : undefined
}

export function resolveTuiScreen(input: { flag?: string; env?: string; config?: string } = {}): TuiScreenResolution {
  const flag = parseTuiScreenValue(input.flag)
  if (flag) return { screen: flag, source: "flag" }

  const env = parseTuiScreenValue(input.env)
  if (env) return { screen: env, source: "env" }

  const config = parseTuiScreenValue(input.config)
  if (config) return { screen: config, source: "config" }

  return { screen: DEFAULT_TUI_SCREEN, source: "default" }
}

/**
 * The screen mode the renderer actually mounts with. Only an explicit inline
 * selection changes it; auto and full both keep the full-screen renderer so the
 * default startup path stays byte-identical until the inline frontend lands.
 * `fullScreenScreenMode` is exactly today's advanced/compatible mapping; it is
 * passed in so this module stays free of terminal capability probing.
 */
export function tuiScreenModeFor(
  screen: TuiScreen,
  fullScreenScreenMode: "alternate-screen" | "main-screen",
): "alternate-screen" | "main-screen" | "split-footer" {
  return screen === "inline" ? "split-footer" : fullScreenScreenMode
}
