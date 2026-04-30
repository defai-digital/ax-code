import { describe, expect, test } from "bun:test"
import { sourceLauncherScript } from "../../script/source-launcher"

describe("script.source-launcher", () => {
  test("unix launcher captures original cwd and execs bun run against the source tree", () => {
    const out = sourceLauncherScript({ root: "/repo", windows: false })
    expect(out).toContain('AX_CODE_SOURCE_CWD="/repo/packages/ax-code"')
    expect(out).toContain('AX_CODE_SOURCE_ENTRY="/repo/packages/ax-code/src/index.ts"')
    expect(out).toContain('AX_CODE_ORIGINAL_CWD="$(pwd)" exec bun run --cwd "$AX_CODE_SOURCE_CWD"')
  })

  test("windows launcher uses the .cmd shape and captures CD", () => {
    const out = sourceLauncherScript({ root: "C:\\repo", windows: true })
    expect(out).toContain("@echo off")
    expect(out).toContain("set AX_CODE_ORIGINAL_CWD=%CD%")
    expect(out).toContain('set "AX_CODE_SOURCE_CWD=C:\\repo\\packages\\ax-code"')
    expect(out).toContain('set "AX_CODE_SOURCE_ENTRY=C:\\repo\\packages\\ax-code\\src\\index.ts"')
    expect(out).toContain('bun run --cwd "%AX_CODE_SOURCE_CWD%"')
  })

  test("unix launcher normalizes Windows-style separators in the root path", () => {
    const out = sourceLauncherScript({ root: "C:\\opt\\ax-code", windows: false })
    // The unix shim must use POSIX separators even if the caller passed
    // a Windows-style root, so the script stays valid under sh.
    expect(out).toContain('AX_CODE_SOURCE_CWD="C:/opt/ax-code/packages/ax-code"')
    expect(out).not.toContain("\\")
  })

  test("guards stale source launchers before bun sees --cwd", () => {
    const unix = sourceLauncherScript({ root: "/missing/repo", windows: false })
    const windows = sourceLauncherScript({ root: "C:\\missing\\repo", windows: true })
    expect(unix).toContain('if [ ! -d "$AX_CODE_SOURCE_CWD" ]; then')
    expect(unix).toContain("source launcher points at a missing checkout")
    expect(windows).toContain('if not exist "%AX_CODE_SOURCE_CWD%\\"')
    expect(windows).toContain("source launcher points at a missing checkout")
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
