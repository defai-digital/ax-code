import { describe, expect, test } from "vitest"
import {
  DEFAULT_TUI_SCREEN,
  parseTuiScreenValue,
  resolveTuiScreen,
  tuiScreenModeFor,
  TUI_SCREENS,
  TUI_SCREEN_SOURCES,
} from "../../../src/cli/tui/inline/screen"

describe("resolveTuiScreen precedence", () => {
  test("defaults to auto from the default layer when nothing is set", () => {
    expect(resolveTuiScreen()).toEqual({ screen: "auto", source: "default" })
    expect(resolveTuiScreen({})).toEqual({ screen: "auto", source: "default" })
    expect(DEFAULT_TUI_SCREEN).toBe("auto")
  })

  test("flag wins over env and config", () => {
    expect(resolveTuiScreen({ flag: "full", env: "inline", config: "auto" })).toEqual({
      screen: "full",
      source: "flag",
    })
    expect(resolveTuiScreen({ flag: "inline", env: "full", config: "full" })).toEqual({
      screen: "inline",
      source: "flag",
    })
  })

  test("env wins over config but loses to flag", () => {
    expect(resolveTuiScreen({ env: "full", config: "inline" })).toEqual({ screen: "full", source: "env" })
    expect(resolveTuiScreen({ config: "inline" })).toEqual({ screen: "inline", source: "config" })
  })

  test("every screen value is reachable from every layer", () => {
    for (const screen of TUI_SCREENS) {
      expect(resolveTuiScreen({ flag: screen })).toEqual({ screen, source: "flag" })
      expect(resolveTuiScreen({ env: screen })).toEqual({ screen, source: "env" })
      expect(resolveTuiScreen({ config: screen })).toEqual({ screen, source: "config" })
    }
  })
})

describe("resolveTuiScreen trust table", () => {
  // Config is the lowest-priority layer: an untrusted project tui.json must
  // never be able to overrule an explicit env var or CLI flag.
  const configs = TUI_SCREENS
  const envs = [undefined, ...TUI_SCREENS]
  const flags = [undefined, ...TUI_SCREENS]

  test("config never overrides env or flag", () => {
    for (const config of configs) {
      for (const env of envs) {
        for (const flag of flags) {
          const result = resolveTuiScreen({ flag, env, config })
          if (flag) {
            expect(result).toEqual({ screen: flag, source: "flag" })
          } else if (env) {
            expect(result).toEqual({ screen: env, source: "env" })
          } else {
            expect(result).toEqual({ screen: config, source: "config" })
          }
        }
      }
    }
  })

  test("an untrusted config inline cannot force inline over env full", () => {
    expect(resolveTuiScreen({ env: "full", config: "inline" })).toEqual({ screen: "full", source: "env" })
  })

  test("an untrusted config full cannot force full over env inline", () => {
    expect(resolveTuiScreen({ env: "inline", config: "full" })).toEqual({ screen: "inline", source: "env" })
  })
})

describe("resolveTuiScreen invalid values", () => {
  const invalid = ["", "  ", "sideways", "FULL SCREEN", "Inline!", "0", "true", "auto extra"]

  test("invalid values never throw", () => {
    for (const value of invalid) {
      expect(() => resolveTuiScreen({ flag: value, env: value, config: value })).not.toThrow()
    }
  })

  test("an invalid flag falls through to env", () => {
    expect(resolveTuiScreen({ flag: "nope", env: "inline" })).toEqual({ screen: "inline", source: "env" })
  })

  test("an invalid env falls through to config", () => {
    expect(resolveTuiScreen({ env: "nope", config: "full" })).toEqual({ screen: "full", source: "config" })
  })

  test("invalid values in every layer fall through to the default", () => {
    for (const value of invalid) {
      expect(resolveTuiScreen({ flag: value, env: value, config: value })).toEqual({
        screen: "auto",
        source: "default",
      })
    }
  })

  test("parseTuiScreenValue ignores non-strings and normalizes case/whitespace", () => {
    expect(parseTuiScreenValue(undefined)).toBeUndefined()
    expect(parseTuiScreenValue(null)).toBeUndefined()
    expect(parseTuiScreenValue(1)).toBeUndefined()
    expect(parseTuiScreenValue(true)).toBeUndefined()
    expect(parseTuiScreenValue({})).toBeUndefined()
    expect(parseTuiScreenValue(" inline ")).toBe("inline")
    expect(parseTuiScreenValue("FULL")).toBe("full")
    expect(parseTuiScreenValue("bogus")).toBeUndefined()
  })

  test("exposes the stable source vocabulary", () => {
    expect([...TUI_SCREEN_SOURCES]).toEqual(["flag", "env", "config", "default"])
  })
})

describe("tuiScreenModeFor", () => {
  test("only inline selects the split-footer renderer", () => {
    expect(tuiScreenModeFor("inline", "main-screen")).toBe("split-footer")
    expect(tuiScreenModeFor("inline", "alternate-screen")).toBe("split-footer")
  })

  test("auto and full keep the legacy full-screen mapping unchanged", () => {
    for (const screen of ["auto", "full"] as const) {
      expect(tuiScreenModeFor(screen, "main-screen")).toBe("main-screen")
      expect(tuiScreenModeFor(screen, "alternate-screen")).toBe("alternate-screen")
    }
  })
})
