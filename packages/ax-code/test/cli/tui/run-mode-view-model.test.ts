import { describe, expect, test } from "bun:test"
import {
  runMode,
  nextRunMode,
  runModeFlags,
  runModeLabel,
  runModeTransition,
} from "@/cli/cmd/tui/component/prompt/run-mode-view-model"

describe("runMode", () => {
  test("maps the dependent boolean pair onto the three-mode ladder", () => {
    expect(runMode({ autonomous: false, superLong: false })).toBe("none")
    expect(runMode({ autonomous: true, superLong: false })).toBe("auto")
    expect(runMode({ autonomous: true, superLong: true })).toBe("super-long")
  })

  test("treats stale superLong without autonomous as none", () => {
    // Server-side, Super-Long is ineffective when autonomous is off.
    expect(runMode({ autonomous: false, superLong: true })).toBe("none")
  })
})

describe("nextRunMode", () => {
  test("cycles none → auto → super-long → none", () => {
    expect(nextRunMode("none")).toBe("auto")
    expect(nextRunMode("auto")).toBe("super-long")
    expect(nextRunMode("super-long")).toBe("none")
  })
})

describe("runModeLabel", () => {
  test("labels every mode", () => {
    expect(runModeLabel("none")).toBe("Manual")
    expect(runModeLabel("auto")).toBe("Autonomous")
    expect(runModeLabel("super-long")).toBe("Super-Long")
  })
})

describe("runModeTransition", () => {
  test("none → auto enables autonomous only", () => {
    expect(runModeTransition({ autonomous: false, superLong: false }, "auto")).toEqual([
      { endpoint: "/autonomous", key: "autonomous", enabled: true },
    ])
  })

  test("auto → super-long enables super-long only", () => {
    expect(runModeTransition({ autonomous: true, superLong: false }, "super-long")).toEqual([
      { endpoint: "/super-long", key: "superLong", enabled: true },
    ])
  })

  test("none → super-long enables autonomous before super-long", () => {
    expect(runModeTransition({ autonomous: false, superLong: false }, "super-long")).toEqual([
      { endpoint: "/autonomous", key: "autonomous", enabled: true },
      { endpoint: "/super-long", key: "superLong", enabled: true },
    ])
  })

  test("super-long → none disables super-long before autonomous", () => {
    expect(runModeTransition({ autonomous: true, superLong: true }, "none")).toEqual([
      { endpoint: "/super-long", key: "superLong", enabled: false },
      { endpoint: "/autonomous", key: "autonomous", enabled: false },
    ])
  })

  test("repairs the stale superLong-without-autonomous state on the way to auto", () => {
    expect(runModeTransition({ autonomous: false, superLong: true }, "auto")).toEqual([
      { endpoint: "/autonomous", key: "autonomous", enabled: true },
      { endpoint: "/super-long", key: "superLong", enabled: false },
    ])
  })

  test("no steps when already in the requested mode", () => {
    expect(runModeTransition({ autonomous: true, superLong: false }, "auto")).toEqual([])
    expect(runModeTransition({ autonomous: false, superLong: false }, "none")).toEqual([])
  })

  test("desired flags match each mode", () => {
    expect(runModeFlags("none")).toEqual({ autonomous: false, superLong: false })
    expect(runModeFlags("auto")).toEqual({ autonomous: true, superLong: false })
    expect(runModeFlags("super-long")).toEqual({ autonomous: true, superLong: true })
  })
})
