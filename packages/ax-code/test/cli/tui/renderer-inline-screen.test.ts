import { afterEach, describe, expect, test } from "vitest"
import {
  createTuiRenderOptionsFromProfile,
  destroyTuiRenderer,
  resolveTuiScreenFor,
  resolveTuiRenderProfile,
} from "../../../src/cli/tui/renderer"
import { TUI_MAIN_SCREEN_CLEAR_SEQUENCE } from "../../../src/cli/tui/terminal-cleanup"

const EXAMPLES = [
  { advancedTerminal: false, terminalTitleDisabled: false },
  { advancedTerminal: true, terminalTitleDisabled: false },
  { advancedTerminal: false, terminalTitleDisabled: true },
  { advancedTerminal: true, terminalTitleDisabled: true, kittyKeyboard: false, modifyOtherKeys: false },
  { advancedTerminal: false, terminalTitleDisabled: false, mouse: false },
  { advancedTerminal: true, terminalTitleDisabled: false, disableMouse: true },
]

// The pre-ADR-261 profile, verbatim. auto/full must stay deep-equal to it
// except for the two new reporting fields.
function legacyProfile(input: {
  advancedTerminal: boolean
  terminalTitleDisabled: boolean
  kittyKeyboard?: boolean
  modifyOtherKeys?: boolean
  mouse?: boolean
  disableMouse?: boolean
}) {
  const { advancedTerminal, terminalTitleDisabled } = input
  return {
    advancedTerminal,
    profile: advancedTerminal ? "advanced" : "compatible",
    exitOnCtrlC: false,
    useThread: advancedTerminal,
    useMouse: !input.disableMouse && (input.mouse ?? true),
    useKittyKeyboard: input.kittyKeyboard ?? true,
    useModifyOtherKeys: input.modifyOtherKeys ?? true,
    screenMode: advancedTerminal ? "alternate-screen" : "main-screen",
    allowTerminalTitle: !terminalTitleDisabled,
  }
}

describe("resolveTuiRenderProfile screen selection", () => {
  test.each(EXAMPLES)("auto resolves to today's profile exactly: %j", (input) => {
    const profile = resolveTuiRenderProfile({ ...input, screen: resolveTuiScreenFor({}) })
    const { screen, screenSource, ...rest } = profile
    expect(rest).toEqual(legacyProfile(input))
    expect(screen).toBe("auto")
    expect(screenSource).toBe("default")
  })

  test.each(EXAMPLES)("full resolves to today's profile exactly: %j", (input) => {
    const profile = resolveTuiRenderProfile({ ...input, screen: resolveTuiScreenFor({ flag: "full" }) })
    const { screen, screenSource, ...rest } = profile
    expect(rest).toEqual(legacyProfile(input))
    expect(screen).toBe("full")
    expect(screenSource).toBe("flag")
  })

  test.each(EXAMPLES)("omitting the screen input behaves like auto: %j", (input) => {
    const profile = resolveTuiRenderProfile(input)
    const { screen, screenSource, ...rest } = profile
    expect(rest).toEqual(legacyProfile(input))
    expect(screen).toBe("auto")
    expect(screenSource).toBe("default")
  })

  test("an inline request is recorded but still mounts the full-screen renderer until slice 2", () => {
    for (const input of EXAMPLES) {
      const profile = resolveTuiRenderProfile({ ...input, screen: resolveTuiScreenFor({ flag: "inline" }) })
      const { screen, screenSource, ...rest } = profile
      expect(screen).toBe("inline")
      expect(screenSource).toBe("flag")
      expect(rest).toEqual(legacyProfile(input))
    }
  })

  test("raw screen layers resolve with flag > env > config precedence", () => {
    const base = { advancedTerminal: false, terminalTitleDisabled: false }
    expect(
      resolveTuiRenderProfile({ ...base, screenFlag: "inline", screenEnv: "full", screenConfig: "full" }),
    ).toMatchObject({ screen: "inline", screenSource: "flag" })
    // Config can never win over env.
    expect(resolveTuiRenderProfile({ ...base, screenEnv: "full", screenConfig: "inline" })).toMatchObject({
      screen: "full",
      screenSource: "env",
      screenMode: "main-screen",
    })
    expect(resolveTuiRenderProfile({ ...base, screenConfig: "inline" })).toMatchObject({
      screen: "inline",
      screenSource: "config",
      screenMode: "main-screen",
    })
  })

  test("an explicit resolved screen beats the raw layers", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
      screen: resolveTuiScreenFor({ env: "full" }),
      screenFlag: "inline",
    })
    expect(profile).toMatchObject({ screen: "full", screenSource: "env", screenMode: "main-screen" })
  })

  test("invalid raw values are ignored rather than failing the profile", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: false,
      screenFlag: "bogus",
      screenEnv: "sideways",
      screenConfig: "nope",
    })
    expect(profile).toMatchObject({ screen: "auto", screenSource: "default", screenMode: "alternate-screen" })
  })
})

describe("createTuiRenderOptionsFromProfile screen mapping", () => {
  // consoleOptions.onCopySelection is a fresh closure per call, so compare the
  // stable option fields and check the copies separately.
  function stableOptions(options: ReturnType<typeof createTuiRenderOptionsFromProfile>) {
    const { consoleOptions, ...rest } = options
    const { onCopySelection: _copy, ...consoleRest } = consoleOptions ?? {}
    return { rest, consoleRest }
  }

  test("auto and full keep the legacy renderer options", () => {
    for (const input of EXAMPLES) {
      const legacy = createTuiRenderOptionsFromProfile(
        resolveTuiRenderProfile({ ...input, screen: resolveTuiScreenFor({}) }),
      )
      for (const screen of ["auto", "full"] as const) {
        const options = createTuiRenderOptionsFromProfile(
          resolveTuiRenderProfile({ ...input, screen: resolveTuiScreenFor({ flag: screen }) }),
        )
        expect(stableOptions(options)).toEqual(stableOptions(legacy))
        expect(options.screenMode).toBe(input.advancedTerminal ? "alternate-screen" : "main-screen")
      }
    }
  })

  test("an inline request still mounts the existing full-screen renderer in slice 1", () => {
    const legacy = createTuiRenderOptionsFromProfile(
      resolveTuiRenderProfile({ advancedTerminal: true, terminalTitleDisabled: false }),
    )
    const inline = createTuiRenderOptionsFromProfile(
      resolveTuiRenderProfile({
        advancedTerminal: true,
        terminalTitleDisabled: false,
        screen: resolveTuiScreenFor({ flag: "inline" }),
      }),
    )
    // The inline frontend lands in slice 2; until then the renderer options
    // are identical, including the screen mode every teardown path resets.
    expect(inline.screenMode).toBe("alternate-screen")
    expect(stableOptions(inline)).toEqual(stableOptions(legacy))
  })
})

describe("destroyTuiRenderer split-footer teardown", () => {
  const originalWrite = process.stdout.write

  afterEach(() => {
    process.stdout.write = originalWrite
  })

  function capture() {
    const writes: string[] = []
    process.stdout.write = ((chunk: string, callback?: () => void) => {
      writes.push(chunk)
      if (callback) queueMicrotask(callback)
      return true
    }) as typeof process.stdout.write
    return writes
  }

  test("split-footer never clears the display on clean teardown", async () => {
    const writes = capture()
    const profile = {
      ...resolveTuiRenderProfile({
        advancedTerminal: false,
        terminalTitleDisabled: false,
        screen: resolveTuiScreenFor({ flag: "inline" }),
      }),
      screenMode: "split-footer" as const,
    }
    await destroyTuiRenderer({ destroy() {} }, profile)
    expect(writes).not.toContain(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })

  test("main-screen teardown is unchanged", async () => {
    const writes = capture()
    const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: false })
    expect(profile.screenMode).toBe("main-screen")
    await destroyTuiRenderer({ destroy() {} }, profile)
    expect(writes).toContain(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })

  test("alternate-screen teardown is unchanged", async () => {
    const writes = capture()
    const profile = resolveTuiRenderProfile({ advancedTerminal: true, terminalTitleDisabled: false })
    expect(profile.screenMode).toBe("alternate-screen")
    await destroyTuiRenderer({ destroy() {} }, profile)
    expect(writes).not.toContain(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })
})
