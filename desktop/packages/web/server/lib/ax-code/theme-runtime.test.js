import { describe, expect, it, vi } from "vitest"

import { createThemeRuntime } from "./theme-runtime.js"

const createRuntime = () =>
  createThemeRuntime({
    fsPromises: {},
    path: {},
    themesDir: "/themes",
    maxThemeJsonBytes: 1024,
    logger: {
      warn: vi.fn(),
    },
  })

const createValidTheme = (overrides = {}) => ({
  metadata: {
    id: "example-theme",
    name: "Example Theme",
    variant: "dark",
    ...overrides.metadata,
  },
  colors: {
    primary: {
      base: "#111111",
      foreground: "#ffffff",
    },
    surface: {
      background: "#000000",
      foreground: "#ffffff",
      muted: "#222222",
      mutedForeground: "#dddddd",
      elevated: "#111111",
      elevatedForeground: "#ffffff",
      subtle: "#191919",
    },
    interactive: {
      border: "#333333",
      selection: "#444444",
      selectionForeground: "#ffffff",
      focusRing: "#555555",
      hover: "#222222",
    },
    status: {
      error: "#ff0000",
      errorForeground: "#ffffff",
      errorBackground: "#330000",
      errorBorder: "#aa0000",
      warning: "#ffaa00",
      warningForeground: "#000000",
      warningBackground: "#332200",
      warningBorder: "#aa7700",
      success: "#00aa55",
      successForeground: "#ffffff",
      successBackground: "#003322",
      successBorder: "#007744",
      info: "#0088ff",
      infoForeground: "#ffffff",
      infoBackground: "#001f33",
      infoBorder: "#0066aa",
    },
    syntax: {
      base: {
        background: "#000000",
        foreground: "#ffffff",
        keyword: "#ff77aa",
        string: "#99dd99",
        number: "#ffaa55",
        function: "#77aaff",
        variable: "#ffffff",
        type: "#cc99ff",
        comment: "#888888",
        operator: "#dddddd",
      },
      highlights: {
        diffAdded: "#003300",
        diffRemoved: "#330000",
        lineNumber: "#777777",
      },
    },
    ...overrides.colors,
  },
})

describe("theme runtime", () => {
  it("trims normalized metadata fields and filters blank tags", () => {
    const runtime = createRuntime()

    const normalized = runtime.normalizeThemeJson(
      createValidTheme({
        metadata: {
          id: " example-theme ",
          name: " Example Theme ",
          version: " 2.0.0 ",
          tags: ["  dark  ", " ", "editor"],
        },
      }),
    )

    expect(normalized?.metadata).toMatchObject({
      id: "example-theme",
      name: "Example Theme",
      version: "2.0.0",
      tags: ["dark", "editor"],
    })
  })

  it("defaults blank theme versions", () => {
    const runtime = createRuntime()

    const normalized = runtime.normalizeThemeJson(
      createValidTheme({
        metadata: {
          version: "   ",
        },
      }),
    )

    expect(normalized?.metadata.version).toBe("1.0.0")
  })

  it("rejects themes with blank required colors", () => {
    const runtime = createRuntime()

    expect(
      runtime.normalizeThemeJson(
        createValidTheme({
          colors: {
            primary: {
              base: "   ",
              foreground: "#ffffff",
            },
          },
        }),
      ),
    ).toBeNull()
  })
})
