import { describe, expect, test } from "bun:test"
import {
  clearTuiTerminalTitle,
  createTuiRenderOptionsFromProfile,
  resolveTuiRenderProfile,
  setTuiTerminalTitle,
} from "../../../src/cli/cmd/tui/renderer"

describe("tui renderer profile", () => {
  test("keeps the compatibility profile production-safe", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    const options = createTuiRenderOptionsFromProfile(profile)

    expect(profile.profile).toBe("compatible")
    expect(profile.testing).toBeFalse()
    expect(profile.exitOnCtrlC).toBeFalse()
    expect(profile.allowTerminalTitle).toBeFalse()
    expect(options.testing).toBeFalse()
    expect(options.exitOnCtrlC).toBeFalse()
    expect(options.useThread).toBeFalse()
    expect(options.useMouse).toBeFalse()
    expect(options.screenMode).toBe("main-screen")
    expect(options.useKittyKeyboard).toBeNull()
  })

  test("maps the advanced profile to the opt-in OpenTUI feature set", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: false,
    })
    const options = createTuiRenderOptionsFromProfile(profile)

    expect(profile.profile).toBe("advanced")
    expect(profile.testing).toBeFalse()
    expect(profile.exitOnCtrlC).toBeFalse()
    expect(profile.allowTerminalTitle).toBeTrue()
    expect(options.testing).toBeFalse()
    expect(options.exitOnCtrlC).toBeFalse()
    expect(options.useThread).toBeTrue()
    expect(options.useMouse).toBeTrue()
    expect(options.screenMode).toBe("alternate-screen")
    expect(options.useKittyKeyboard).toEqual({})
  })

  test("only writes terminal titles when the profile explicitly allows it", () => {
    const calls: string[] = []
    const renderer = {
      setTerminalTitle(title: string) {
        calls.push(title)
      },
    }

    const compatible = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    expect(setTuiTerminalTitle(renderer, "ax-code", compatible)).toBeFalse()
    expect(clearTuiTerminalTitle(renderer, compatible)).toBeFalse()

    const advancedDisabled = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: true,
    })
    expect(setTuiTerminalTitle(renderer, "ax-code", advancedDisabled)).toBeFalse()

    const advanced = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: false,
    })
    expect(setTuiTerminalTitle(renderer, "ax-code", advanced)).toBeTrue()
    expect(clearTuiTerminalTitle(renderer, advanced)).toBeTrue()
    expect(calls).toEqual(["ax-code", ""])
  })
})
