import { describe, expect, test } from "bun:test"
import { sourceLauncherScript } from "../../script/source-launcher"

describe("script.source-launcher", () => {
  test("unix launcher captures original cwd and execs bun run against the source tree", () => {
    const out = sourceLauncherScript({ root: "/repo", windows: false })
    expect(out).toBe(
      `#!/bin/sh\nAX_CODE_ORIGINAL_CWD="$(pwd)" exec bun run --cwd "/repo/packages/ax-code" --conditions=browser "/repo/packages/ax-code/src/index.ts" "$@"\n`,
    )
  })

  test("windows launcher uses the .cmd shape and captures CD", () => {
    const out = sourceLauncherScript({ root: "C:\\repo", windows: true })
    expect(out).toContain("@echo off")
    expect(out).toContain("set AX_CODE_ORIGINAL_CWD=%CD%")
    expect(out).toContain('--cwd "C:\\repo\\packages\\ax-code"')
    expect(out).toContain('"C:\\repo\\packages\\ax-code\\src\\index.ts" %*')
  })

  test("unix launcher normalizes Windows-style separators in the root path", () => {
    const out = sourceLauncherScript({ root: "C:\\opt\\ax-code", windows: false })
    // The unix shim must use POSIX separators even if the caller passed
    // a Windows-style root, so the script stays valid under sh.
    expect(out).toContain('--cwd "C:/opt/ax-code/packages/ax-code"')
    expect(out).not.toContain("\\")
  })

  test("preserves AX_CODE_ORIGINAL_CWD propagation contract", () => {
    // setup:cli and packaged distributions both rely on AX_CODE_ORIGINAL_CWD
    // so the CLI can resolve --project paths from the user's actual cwd
    // rather than the package install dir.
    const unix = sourceLauncherScript({ root: "/repo", windows: false })
    const windows = sourceLauncherScript({ root: "/repo", windows: true })
    expect(unix).toContain("AX_CODE_ORIGINAL_CWD")
    expect(windows).toContain("AX_CODE_ORIGINAL_CWD")
  })
})
