import { CliRenderEvents, SyntaxStyle, RGBA, type TerminalColors } from "@opentui/core"
import path from "path"
import { createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { Glob } from "../../../../util/glob"
import { DEFAULT_THEMES, type ThemeColors, type ThemeJson, type ColorValue } from "./theme-defaults"
import { useKV } from "./kv"
import { useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { useTuiConfig } from "./tui-config"
import { scheduleDeferredStartupTask } from "../util/startup-task"

type Theme = ThemeColors & {
  _hasSelectedListItemText: boolean
  thinkingOpacity: number
}

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  // If theme explicitly defines selectedListItemText, use it
  if (theme._hasSelectedListItemText) {
    return theme.selectedListItemText
  }

  // For transparent backgrounds, calculate contrast based on the actual bg (or fallback to primary)
  if (theme.background.a === 0) {
    const targetColor = bg ?? theme.primary
    const { r, g, b } = targetColor
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }

  // Fall back to background color
  return theme.background
}

export { DEFAULT_THEMES, type ThemeJson }

function colorModeFromRgba(color?: RGBA | null): "dark" | "light" | undefined {
  if (!color) return undefined
  const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
  return luminance > 0.5 ? "light" : "dark"
}

function colorModeFromHex(value?: string | null): "dark" | "light" | undefined {
  if (!value) return undefined
  try {
    return colorModeFromRgba(RGBA.fromHex(value))
  } catch {
    return undefined
  }
}

function detectTerminalMode(colors: TerminalColors): "dark" | "light" | undefined {
  return colorModeFromHex(colors.defaultBackground) ?? colorModeFromHex(colors.palette[0])
}

function resolveTheme(theme: ThemeJson, mode: "dark" | "light") {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue, visiting = new Set<string>()): RGBA {
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)

      if (c.startsWith("#")) return RGBA.fromHex(c)

      if (visiting.has(c)) {
        throw new Error(`Circular color reference "${c}"`)
      }
      const nextVisiting = new Set(visiting)
      nextVisiting.add(c)

      if (defs[c] != null) {
        return resolveColor(defs[c], nextVisiting)
      } else {
        const referenced = theme.theme[c as keyof ThemeColors]
        if (referenced !== undefined) return resolveColor(referenced, nextVisiting)
        throw new Error(`Color reference "${c}" not found in defs or theme`)
      }
    }
    if (typeof c === "number") {
      return ansiToRgba(c)
    }
    return resolveColor(c[mode], visiting)
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => {
        return [key, resolveColor(value as ColorValue)]
      }),
  ) as Partial<ThemeColors>

  // Handle selectedListItemText separately since it's optional
  const selectedListItemText = theme.theme.selectedListItemText
  if (selectedListItemText !== undefined) {
    resolved.selectedListItemText = resolveColor(selectedListItemText)
  } else {
    // Backward compatibility: if selectedListItemText is not defined, use background color
    // This preserves the current behavior for all existing themes
    resolved.selectedListItemText = resolved.background
  }

  // Handle backgroundMenu - optional with fallback to backgroundElement
  if (theme.theme.backgroundMenu !== undefined) {
    resolved.backgroundMenu = resolveColor(theme.theme.backgroundMenu)
  } else {
    resolved.backgroundMenu = resolved.backgroundElement
  }

  // Handle thinkingOpacity - optional with default of 0.6
  const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6

  return {
    ...resolved,
    _hasSelectedListItemText: selectedListItemText !== undefined,
    thinkingOpacity,
  } as Theme
}

function ansiToRgba(code: number): RGBA {
  // Standard ANSI colors (0-15)
  if (code < 16) {
    const ansiColors = [
      "#000000", // Black
      "#800000", // Red
      "#008000", // Green
      "#808000", // Yellow
      "#000080", // Blue
      "#800080", // Magenta
      "#008080", // Cyan
      "#c0c0c0", // White
      "#808080", // Bright Black
      "#ff0000", // Bright Red
      "#00ff00", // Bright Green
      "#ffff00", // Bright Yellow
      "#0000ff", // Bright Blue
      "#ff00ff", // Bright Magenta
      "#00ffff", // Bright Cyan
      "#ffffff", // Bright White
    ]
    return RGBA.fromHex(ansiColors[code] ?? "#000000")
  }

  // 6x6x6 Color Cube (16-231)
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)

    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(val(r), val(g), val(b))
  }

  // Grayscale Ramp (232-255)
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }

  // Fallback for invalid codes
  return RGBA.fromInts(0, 0, 0)
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const THEME_DISCOVERY_DELAY_MS = 25
    const renderer = useRenderer()
    const config = useTuiConfig()
    const kv = useKV()
    const pick = (value: unknown) => {
      if (value === "dark" || value === "light") return value
      return
    }
    const lock = pick(kv.get("theme_mode_lock"))
    const [store, setStore] = createStore({
      themes: DEFAULT_THEMES,
      mode: lock ?? pick(kv.get("theme_mode", props.mode)) ?? props.mode,
      lock,
      active: (config.theme ?? kv.get("theme", "github")) as string,
      ready: false,
    })

    createEffect(() => {
      const theme = config.theme
      if (theme) setStore("active", theme)
    })

    let customThemesLoaded = false
    let customThemesPromise: Promise<void> | undefined
    function ensureCustomThemesLoaded() {
      if (customThemesLoaded) return Promise.resolve()
      if (customThemesPromise) return customThemesPromise
      customThemesPromise = getCustomThemes()
        .then((custom) => {
          customThemesLoaded = true
          setStore(
            produce((draft) => {
              Object.assign(draft.themes, custom)
            }),
          )
        })
        .catch(() => {
          setStore("active", "github")
        })
        .finally(() => {
          customThemesPromise = undefined
          if (store.active !== "system") {
            setStore("ready", true)
          }
        })
      return customThemesPromise
    }

    createEffect(
      on(
        () => store.active,
        (active) => {
          if (active !== "system") return
          setStore("ready", false)
          const cancel = scheduleDeferredStartupTask(() => resolveSystemTheme(store.mode), {
            delayMs: THEME_DISCOVERY_DELAY_MS,
          })
          onCleanup(cancel)
        },
      ),
    )

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(() => ensureCustomThemesLoaded(), {
        delayMs: THEME_DISCOVERY_DELAY_MS,
      })
      onCleanup(cancel)
    })

    function resolveSystemTheme(mode: "dark" | "light" = store.mode) {
      renderer
        .getPalette({
          size: 16,
        })
        .then((colors) => {
          const detectedMode = detectTerminalMode(colors)
          const nextMode = store.lock ? store.mode : (detectedMode ?? mode)
          if (!store.lock && detectedMode && store.mode !== detectedMode) {
            kv.set("theme_mode", detectedMode)
          }
          if (!colors.palette[0]) {
            setStore(
              produce((draft) => {
                draft.mode = nextMode
                if (draft.active === "system") {
                  draft.active = "github"
                  draft.ready = true
                }
              }),
            )
            return
          }
          setStore(
            produce((draft) => {
              draft.mode = nextMode
              draft.themes.system = generateSystem(colors, nextMode)
              if (draft.active === "system") {
                draft.ready = true
              }
            }),
          )
        })
    }

    function apply(mode: "dark" | "light") {
      kv.set("theme_mode", mode)
      if (store.mode === mode) return
      setStore("mode", mode)
      renderer.clearPaletteCache()
      resolveSystemTheme(mode)
    }

    function pin(mode: "dark" | "light" = store.mode) {
      setStore("lock", mode)
      kv.set("theme_mode_lock", mode)
      apply(mode)
    }

    function free() {
      setStore("lock", undefined)
      kv.set("theme_mode_lock", undefined)
      const mode = renderer.themeMode
      if (mode) apply(mode)
    }

    const handle = (mode: "dark" | "light") => {
      if (store.lock) return
      apply(mode)
    }
    renderer.on(CliRenderEvents.THEME_MODE, handle)
    onCleanup(() => {
      renderer.off(CliRenderEvents.THEME_MODE, handle)
    })

    const values = createMemo(() => {
      return resolveTheme(store.themes[store.active] ?? store.themes.github, store.mode)
    })

    createEffect(() => {
      renderer.setBackgroundColor(values().background)
    })

    const syntax = createMemo(() => generateSyntax(values()))
    const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))
    const themeProxy = new Proxy({} as Theme, {
      get(_target, prop) {
        return values()[prop as keyof Theme]
      },
      has(_target, prop) {
        return prop in values()
      },
      ownKeys() {
        return Reflect.ownKeys(values())
      },
      getOwnPropertyDescriptor(_target, prop) {
        const value = values()[prop as keyof Theme]
        if (value === undefined) return undefined
        return {
          configurable: true,
          enumerable: true,
          value,
        }
      },
    })

    return {
      theme: themeProxy,
      get selected() {
        return store.active
      },
      all() {
        return store.themes
      },
      ensureCustomThemesLoaded,
      syntax,
      subtleSyntax,
      mode() {
        return store.mode
      },
      locked() {
        return store.lock !== undefined
      },
      lock() {
        pin(store.mode)
      },
      unlock() {
        free()
      },
      setMode(mode: "dark" | "light") {
        pin(mode)
      },
      set(theme: string) {
        if (theme !== "system" && !store.themes[theme]) {
          void ensureCustomThemesLoaded()
        }
        setStore("active", theme)
        kv.set("theme", theme)
      },
      get ready() {
        return store.ready
      },
    }
  },
})

async function getCustomThemes() {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".ax-code"],
        start: process.cwd(),
      }),
    )),
  ]

  const result: Record<string, ThemeJson> = {}
  for (const dir of directories) {
    for (const item of await Glob.scan("themes/*.json", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const name = path.basename(item, ".json")
      result[name] = await Filesystem.readJson(item)
    }
  }
  return result
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}

function generateSystem(colors: TerminalColors, mode: "dark" | "light"): ThemeJson {
  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0] ?? (mode === "dark" ? "#000000" : "#ffffff"))
  const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7] ?? (mode === "dark" ? "#ffffff" : "#000000"))
  const transparent = RGBA.fromValues(bg.r, bg.g, bg.b, 0)
  const isDark = mode == "dark"

  const col = (i: number) => {
    const value = colors.palette[i]
    if (value) return RGBA.fromHex(value)
    return ansiToRgba(i)
  }

  // Generate gray scale based on terminal background
  const grays = generateGrayScale(bg, isDark)
  const textMuted = generateMutedTextColor(bg, isDark)

  // ANSI color references
  const ansiColors = {
    black: col(0),
    red: col(1),
    green: col(2),
    yellow: col(3),
    blue: col(4),
    magenta: col(5),
    cyan: col(6),
    white: col(7),
    redBright: col(9),
    greenBright: col(10),
  }

  const diffAlpha = isDark ? 0.22 : 0.14
  const diffAddedBg = tint(bg, ansiColors.green, diffAlpha)
  const diffRemovedBg = tint(bg, ansiColors.red, diffAlpha)
  const diffAddedLineNumberBg = tint(grays[3], ansiColors.green, diffAlpha)
  const diffRemovedLineNumberBg = tint(grays[3], ansiColors.red, diffAlpha)

  return {
    theme: {
      // Primary colors using ANSI
      primary: ansiColors.cyan,
      secondary: ansiColors.magenta,
      accent: ansiColors.cyan,

      // Status colors using ANSI
      error: ansiColors.red,
      warning: ansiColors.yellow,
      success: ansiColors.green,
      info: ansiColors.cyan,

      // Text colors
      text: fg,
      textMuted,
      selectedListItemText: bg,

      // Background colors - use transparent to respect terminal transparency
      background: transparent,
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],

      // Border colors
      borderSubtle: grays[6],
      border: grays[7],
      borderActive: grays[8],

      // Diff colors
      diffAdded: ansiColors.green,
      diffRemoved: ansiColors.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansiColors.greenBright,
      diffHighlightRemoved: ansiColors.redBright,
      diffAddedBg,
      diffRemovedBg,
      diffContextBg: grays[1],
      diffLineNumber: grays[6],
      diffAddedLineNumberBg,
      diffRemovedLineNumberBg,

      // Markdown colors
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansiColors.blue,
      markdownLinkText: ansiColors.cyan,
      markdownCode: ansiColors.green,
      markdownBlockQuote: ansiColors.yellow,
      markdownEmph: ansiColors.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansiColors.blue,
      markdownListEnumeration: ansiColors.cyan,
      markdownImage: ansiColors.blue,
      markdownImageText: ansiColors.cyan,
      markdownCodeBlock: fg,

      // Syntax colors
      syntaxComment: textMuted,
      syntaxKeyword: ansiColors.magenta,
      syntaxFunction: ansiColors.blue,
      syntaxVariable: fg,
      syntaxString: ansiColors.green,
      syntaxNumber: ansiColors.yellow,
      syntaxType: ansiColors.cyan,
      syntaxOperator: ansiColors.cyan,
      syntaxPunctuation: fg,
    },
  }
}

function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
  const grays: Record<number, RGBA> = {}

  // RGBA stores floats in range 0-1, convert to 0-255
  const bgR = bg.r * 255
  const bgG = bg.g * 255
  const bgB = bg.b * 255

  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  for (let i = 1; i <= 12; i++) {
    const factor = i / 12.0

    let grayValue: number
    let newR: number
    let newG: number
    let newB: number

    if (isDark) {
      if (luminance < 10) {
        grayValue = Math.floor(factor * 0.4 * 255)
        newR = grayValue
        newG = grayValue
        newB = grayValue
      } else {
        const newLum = luminance + (255 - luminance) * factor * 0.4

        const ratio = newLum / luminance
        newR = Math.min(bgR * ratio, 255)
        newG = Math.min(bgG * ratio, 255)
        newB = Math.min(bgB * ratio, 255)
      }
    } else {
      if (luminance > 245) {
        grayValue = Math.floor(255 - factor * 0.4 * 255)
        newR = grayValue
        newG = grayValue
        newB = grayValue
      } else {
        const newLum = luminance * (1 - factor * 0.4)

        const ratio = newLum / luminance
        newR = Math.max(bgR * ratio, 0)
        newG = Math.max(bgG * ratio, 0)
        newB = Math.max(bgB * ratio, 0)
      }
    }

    grays[i] = RGBA.fromInts(Math.floor(newR), Math.floor(newG), Math.floor(newB))
  }

  return grays
}

function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
  // RGBA stores floats in range 0-1, convert to 0-255
  const bgR = bg.r * 255
  const bgG = bg.g * 255
  const bgB = bg.b * 255

  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  let grayValue: number

  if (isDark) {
    if (bgLum < 10) {
      // Very dark/black background
      grayValue = 180 // #b4b4b4
    } else {
      // Scale up for lighter dark backgrounds
      grayValue = Math.min(Math.floor(160 + bgLum * 0.3), 200)
    }
  } else {
    if (bgLum > 245) {
      // Very light/white background
      grayValue = 75 // #4b4b4b
    } else {
      // Scale down for darker light backgrounds
      grayValue = Math.max(Math.floor(100 - (255 - bgLum) * 0.2), 60)
    }
  }

  return RGBA.fromInts(grayValue, grayValue, grayValue)
}

function generateSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme(getSyntaxRules(theme))
}

function generateSubtleSyntax(theme: Theme) {
  const rules = getSyntaxRules(theme)
  return SyntaxStyle.fromTheme(
    rules.map((rule) => {
      if (rule.style.foreground) {
        const fg = rule.style.foreground
        return {
          ...rule,
          style: {
            ...rule.style,
            foreground: RGBA.fromInts(
              Math.round(fg.r * 255),
              Math.round(fg.g * 255),
              Math.round(fg.b * 255),
              Math.round(theme.thinkingOpacity * 255),
            ),
          },
        }
      }
      return rule
    }),
  )
}

function getSyntaxRules(theme: Theme) {
  return [
    {
      scope: ["default"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["prompt"],
      style: {
        foreground: theme.accent,
      },
    },
    {
      scope: ["extmark.file"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["extmark.agent"],
      style: {
        foreground: theme.secondary,
        bold: true,
      },
    },
    {
      scope: ["extmark.paste"],
      style: {
        foreground: theme.background,
        background: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["comment"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["comment.documentation"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["string", "symbol"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["number", "boolean"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["character.special"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.type"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
        italic: true,
      },
    },
    {
      scope: ["keyword.function", "function.method"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["keyword"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.import"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["operator", "keyword.operator", "punctuation.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.conditional.ternary"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["variable", "variable.parameter", "function.method.call", "function.call"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["variable.member", "function", "constructor"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["type", "module"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["constant"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["property"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["class"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["parameter"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["punctuation", "punctuation.bracket"],
      style: {
        foreground: theme.syntaxPunctuation,
      },
    },
    {
      scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["variable.super"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["string.escape", "string.regexp"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["keyword.directive"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["punctuation.special"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.modifier"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.exception"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    // Markdown specific styles
    {
      scope: ["markup.heading"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.1"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.2"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.3"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.4"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.5"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.6"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.bold", "markup.strong"],
      style: {
        foreground: theme.markdownStrong,
        bold: true,
      },
    },
    {
      scope: ["markup.italic"],
      style: {
        foreground: theme.markdownEmph,
        italic: true,
      },
    },
    {
      scope: ["markup.list"],
      style: {
        foreground: theme.markdownListItem,
      },
    },
    {
      scope: ["markup.quote"],
      style: {
        foreground: theme.markdownBlockQuote,
        italic: true,
      },
    },
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: {
        foreground: theme.markdownCode,
      },
    },
    {
      scope: ["markup.raw.inline"],
      style: {
        foreground: theme.markdownCode,
        background: theme.background,
      },
    },
    {
      scope: ["markup.link"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["markup.link.label"],
      style: {
        foreground: theme.markdownLinkText,
        underline: true,
      },
    },
    {
      scope: ["markup.link.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["label"],
      style: {
        foreground: theme.markdownLinkText,
      },
    },
    {
      scope: ["spell", "nospell"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["conceal"],
      style: {
        foreground: theme.textMuted,
      },
    },
    // Additional common highlight groups
    {
      scope: ["string.special", "string.special.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["character"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["float"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["comment.error"],
      style: {
        foreground: theme.error,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.warning"],
      style: {
        foreground: theme.warning,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.todo", "comment.note"],
      style: {
        foreground: theme.info,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["namespace"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["field"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["type.definition"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
      },
    },
    {
      scope: ["keyword.export"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["attribute", "annotation"],
      style: {
        foreground: theme.warning,
      },
    },
    {
      scope: ["tag"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["tag.attribute"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["tag.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["markup.strikethrough"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["markup.underline"],
      style: {
        foreground: theme.text,
        underline: true,
      },
    },
    {
      scope: ["markup.list.checked"],
      style: {
        foreground: theme.success,
      },
    },
    {
      scope: ["markup.list.unchecked"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["diff.plus"],
      style: {
        foreground: theme.diffAdded,
        background: theme.diffAddedBg,
      },
    },
    {
      scope: ["diff.minus"],
      style: {
        foreground: theme.diffRemoved,
        background: theme.diffRemovedBg,
      },
    },
    {
      scope: ["diff.delta"],
      style: {
        foreground: theme.diffContext,
        background: theme.diffContextBg,
      },
    },
    {
      scope: ["error"],
      style: {
        foreground: theme.error,
        bold: true,
      },
    },
    {
      scope: ["warning"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["info"],
      style: {
        foreground: theme.info,
      },
    },
    {
      scope: ["debug"],
      style: {
        foreground: theme.textMuted,
      },
    },
  ]
}
