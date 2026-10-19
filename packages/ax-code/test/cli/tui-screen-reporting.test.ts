import { afterEach, describe, expect, test, vi } from "vitest"
import { DOCTOR_CHECK_IDS, getTuiScreenCheck } from "../../src/cli/cmd/doctor"
import { describeRendererScreen, latestRendererScreen, parseProcessEventLines } from "../../src/cli/cmd/debug/explain"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("doctor TUI screen check", () => {
  test("reports the default when nothing is set", () => {
    vi.stubEnv("AX_CODE_TUI_SCREEN", "")
    const check = getTuiScreenCheck()
    expect(check.name).toBe("TUI screen")
    expect(check.status).toBe("ok")
    expect(check.detail).toContain("screen auto (from default)")
    expect(check.detail).toContain("renderer full-screen")
  })

  test("reports an inline env selection and its source", () => {
    const check = getTuiScreenCheck({ env: "inline" })
    expect(check.detail).toContain("screen inline (from env)")
    expect(check.detail).toContain("renderer split-footer")
  })

  test("a --screen value beats env and config", () => {
    const check = getTuiScreenCheck({ flag: "full", env: "inline", config: "inline" })
    expect(check.detail).toContain("screen full (from flag)")
    expect(check.detail).toContain("renderer full-screen")
  })

  test("config can never override env", () => {
    const check = getTuiScreenCheck({ env: "full", config: "inline" })
    expect(check.detail).toContain("screen full (from env)")
  })

  test("invalid values fall back to the default", () => {
    const check = getTuiScreenCheck({ flag: "bogus", env: "sideways", config: "nope" })
    expect(check.detail).toContain("screen auto (from default)")
  })

  test("the check id is registered", () => {
    expect(DOCTOR_CHECK_IDS).toContain("tui-screen")
  })
})

describe("debug explain renderer screen record", () => {
  test("describes a recorded screen and source", () => {
    expect(describeRendererScreen({ screen: "inline", screenSource: "env", screenMode: "split-footer" })).toEqual({
      screen: "inline",
      source: "env",
      screenMode: "split-footer",
    })
  })

  test("older logs without the field report unknown instead of a guess", () => {
    expect(describeRendererScreen({ screenMode: "main-screen" })).toEqual({
      screen: "unknown",
      source: "unknown",
      screenMode: "main-screen",
    })
    expect(describeRendererScreen({})).toEqual({ screen: "unknown", source: "unknown", screenMode: "unknown" })
  })

  test("picks the latest recorded renderer profile", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-10-19T12:00:00.000Z",
        eventType: "tui.startup.rendererProfile",
        data: { profile: "advanced", screen: "auto", screenSource: "default", screenMode: "alternate-screen" },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-10-19T12:00:01.000Z",
        eventType: "tui.startup.rendererProfile",
        data: { profile: "compatible", screen: "inline", screenSource: "flag", screenMode: "split-footer" },
      }),
    ]
    const records = parseProcessEventLines(lines)
    expect(latestRendererScreen(records)).toEqual({
      screen: "inline",
      source: "flag",
      screenMode: "split-footer",
    })
  })

  test("reports unknown when no profile was recorded", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-10-19T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
    ]
    expect(latestRendererScreen(parseProcessEventLines(lines))).toEqual({
      screen: "unknown",
      source: "unknown",
      screenMode: "unknown",
    })
    expect(latestRendererScreen([])).toEqual({ screen: "unknown", source: "unknown", screenMode: "unknown" })
  })
})
