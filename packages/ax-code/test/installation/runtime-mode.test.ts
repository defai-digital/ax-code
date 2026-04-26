import { describe, expect, test } from "bun:test"
import { detectRuntimeMode } from "../../src/installation/runtime-mode"

describe("installation.runtime-mode", () => {
  test("compiled binary: process.execPath is ax-code, AX_CODE_VERSION defined", () => {
    expect(
      detectRuntimeMode({
        execPath: "/usr/local/bin/ax-code",
        versionDefined: true,
        channel: "latest",
      }),
    ).toBe("compiled")
  })

  test("compiled Windows binary", () => {
    expect(
      detectRuntimeMode({
        execPath: "C:\\Program Files\\ax-code\\ax-code.exe",
        versionDefined: true,
        channel: "latest",
      }),
    ).toBe("compiled")
  })

  test("source/dev: bun execPath, no version global", () => {
    expect(
      detectRuntimeMode({
        execPath: "/usr/local/bin/bun",
        versionDefined: false,
      }),
    ).toBe("source")
  })

  test("source: bun execPath with explicit local channel marker", () => {
    expect(
      detectRuntimeMode({
        execPath: "/Users/me/.bun/bin/bun",
        versionDefined: true,
        channel: "local",
      }),
    ).toBe("source")
  })

  test("bun-bundled: bun execPath but a real release channel — packaged source distribution", () => {
    expect(
      detectRuntimeMode({
        execPath: "/usr/local/bin/bun",
        versionDefined: true,
        channel: "latest",
      }),
    ).toBe("bun-bundled")
  })

  test("bun-bundled Windows", () => {
    expect(
      detectRuntimeMode({
        execPath: "C:\\Program Files\\bun\\bun.exe",
        versionDefined: true,
        channel: "latest",
      }),
    ).toBe("bun-bundled")
  })

  test("unknown: not bun and no version global — fallback for unusual environments", () => {
    expect(
      detectRuntimeMode({
        execPath: "/some/wrapper/script",
        versionDefined: false,
      }),
    ).toBe("unknown")
  })

  test("execPath case-insensitive", () => {
    expect(
      detectRuntimeMode({
        execPath: "C:\\Program Files\\Bun\\BUN.EXE",
        versionDefined: true,
        channel: "latest",
      }),
    ).toBe("bun-bundled")
  })
})
