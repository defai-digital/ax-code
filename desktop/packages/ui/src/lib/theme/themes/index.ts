import type { Theme } from "@/types/theme"
import { presetThemes } from "./presets"
import { withPrColors } from "./prColors"
import flexokiLightRaw from "./flexoki-light.json"
import flexokiDarkRaw from "./flexoki-dark.json"
import automatosxLightRaw from "./automatosx-light.json"
import automatosxDarkRaw from "./automatosx-dark.json"
import openchamberLightRaw from "./fields-of-the-shire-light.json"
import openchamberDarkRaw from "./fields-of-the-shire-dark.json"

export const flexokiLightTheme = withPrColors(flexokiLightRaw as Theme)
export const flexokiDarkTheme = withPrColors(flexokiDarkRaw as Theme)
export const automatosxLightTheme = withPrColors(automatosxLightRaw as Theme)
export const automatosxDarkTheme = withPrColors(automatosxDarkRaw as Theme)
export const openchamberLightTheme = withPrColors(openchamberLightRaw as Theme)
export const openchamberDarkTheme = withPrColors(openchamberDarkRaw as Theme)

export const DEFAULT_LIGHT_THEME_ID = "automatosx-light" as const
export const DEFAULT_DARK_THEME_ID = "automatosx-dark" as const

export const themes: Theme[] = [
  automatosxDarkTheme,
  automatosxLightTheme,
  openchamberLightTheme,
  openchamberDarkTheme,
  flexokiLightTheme,
  flexokiDarkTheme,
  ...presetThemes.filter(
    (theme) => theme.metadata.id !== "openchamber-light" && theme.metadata.id !== "openchamber-dark",
  ),
]

export function getThemeById(id: string): Theme | undefined {
  // Back-compat for a short-lived rename — now points at the AutomatosX default.
  const resolvedId = id === "app-light" ? "automatosx-light" : id === "app-dark" ? "automatosx-dark" : id

  return themes.find((theme) => theme.metadata.id === resolvedId)
}

export function getDefaultTheme(prefersDark: boolean): Theme {
  const variant: Theme["metadata"]["variant"] = prefersDark ? "dark" : "light"

  const defaultId = prefersDark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID
  const defaultTheme = getThemeById(defaultId)
  if (defaultTheme && defaultTheme.metadata.variant === variant) {
    return defaultTheme
  }

  return themes.find((theme) => theme.metadata.variant === variant) ?? themes[0] ?? flexokiLightTheme
}
