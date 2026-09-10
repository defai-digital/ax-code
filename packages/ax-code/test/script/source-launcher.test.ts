import { describe, expect, test } from "vitest"
import { sourceLauncherScript } from "../../script/source-launcher"
import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { tmpdir } from "../fixture/fixture"

const execFileAsync = promisify(execFile)

describe("script.source-launcher", () => {
  test("executes from literal checkout paths and preserves the caller directory", async () => {
    await using tmp = await tmpdir()
    const windows = process.platform === "win32"
    const root = path.join(
      tmp.path,
      windows
        ? "%AX_SOURCE_EXPANSION% & checkout! (literal)"
        : "checkout-'quoted'-$AX_SOURCE_EXPANSION-`printf expanded`-$(printf changed)",
    )
    const project = path.join(tmp.path, "caller & project! (literal)")
    const packageDir = path.join(root, "packages", "ax-code")
    const runner = path.join(root, "script", "node-ffi-runner.mjs")
    const output = path.join(tmp.path, "result.json")
    const launcher = path.join(tmp.path, windows ? "source.cmd" : "source")
    await Promise.all([
      mkdir(packageDir, { recursive: true }),
      mkdir(path.dirname(runner), { recursive: true }),
      mkdir(project),
    ])
    await writeFile(
      runner,
      'import fs from "node:fs"; fs.writeFileSync(process.env.AX_SOURCE_TEST_OUTPUT, JSON.stringify({cwd:process.cwd(), original:process.env.AX_CODE_ORIGINAL_CWD, args:process.argv.slice(2)})); process.exitCode = 37;\n',
    )
    await writeFile(launcher, sourceLauncherScript({ root, windows }), { mode: 0o755 })
    const env = {
      ...process.env,
      PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
      AX_SOURCE_EXPANSION: "unexpected",
      AX_SOURCE_TEST_OUTPUT: output,
      ERRORLEVEL: "0",
    }
    const failure = await execFileAsync(
      windows ? "cmd.exe" : launcher,
      windows ? ["/d", "/v:on", "/s", "/c", `""${launcher}" "literal argument""`] : ["literal argument"],
      { cwd: project, env, timeout: 10_000, ...(windows ? { windowsVerbatimArguments: true } : {}) },
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 37 })
    const result = JSON.parse(await readFile(output, "utf8"))
    expect(result.cwd).toBe(packageDir)
    expect(result.original).toBe(project)
    expect(result.args).toEqual([
      "--import",
      "tsx",
      "--import",
      path.join(root, "script", "solid-loader.mjs"),
      "--conditions=node",
      path.join(root, "packages", "ax-code", "src", "index-node-tui.ts"),
      "literal argument",
    ])
  })

  test("unix launcher delegates verified process branding to the Node FFI runner", () => {
    const out = sourceLauncherScript({ root: "/repo", windows: false })
    expect(out).toContain('AX_CODE_SOURCE_CWD="/repo/packages/ax-code"')
    expect(out).toContain('AX_CODE_SOURCE_ENTRY="/repo/packages/ax-code/src/index-node-tui.ts"')
    expect(out).toContain('AX_CODE_SOURCE_NODE_FFI_RUNNER="/repo/script/node-ffi-runner.mjs"')
    expect(out).toContain('export AX_CODE_ORIGINAL_CWD="$(pwd)"')
    expect(out).toContain('exec node "$AX_CODE_SOURCE_NODE_FFI_RUNNER"')
    expect(out).toContain('--conditions=node "$AX_CODE_SOURCE_ENTRY"')
    expect(out).not.toContain("AX_CODE_BRANDED_NODE")
    expect(out).not.toContain("ln -f")
    expect(out).not.toContain("libnode")
  })

  test("windows launcher uses the .cmd shape and captures CD", () => {
    const out = sourceLauncherScript({ root: "C:\\repo", windows: true })
    expect(out).toContain("@echo off")
    expect(out).toContain('set "AX_CODE_ORIGINAL_CWD=%CD%"')
    expect(out).toContain('set "AX_CODE_SOURCE_CWD=C:\\repo\\packages\\ax-code"')
    expect(out).toContain('set "AX_CODE_SOURCE_ENTRY=C:\\repo\\packages\\ax-code\\src\\index-node-tui.ts"')
    expect(out).toContain('set "AX_CODE_SOURCE_NODE_FFI_RUNNER=C:\\repo\\script\\node-ffi-runner.mjs"')
    expect(out).toContain("chcp")
    expect(out).toContain("chcp 65001 >nul")
    expect(out).toContain("switched terminal code page")
    // The stderr redirect must be a real redirect, not caret-escaped text —
    // `1^>^&2` printed a literal "1>&2" at the end of the warning (#315).
    expect(out).toContain("for TUI rendering. 1>&2")
    expect(out).not.toContain("1^>^&2")
    expect(out).toContain('node "%AX_CODE_SOURCE_NODE_FFI_RUNNER%"')
  })

  test("unix launcher normalizes Windows-style separators in the root path", () => {
    const out = sourceLauncherScript({ root: "C:\\opt\\ax-code", windows: false })
    // The unix shim must use POSIX separators even if the caller passed
    // a Windows-style root, so the script stays valid under sh.
    expect(out).toContain('AX_CODE_SOURCE_CWD="C:/opt/ax-code/packages/ax-code"')
    expect(out).not.toContain("\\")
  })

  test("guards stale source launchers before exec", () => {
    const unix = sourceLauncherScript({ root: "/missing/repo", windows: false })
    const windows = sourceLauncherScript({ root: "C:\\missing\\repo", windows: true })
    expect(unix).toContain('if [ ! -d "$AX_CODE_SOURCE_CWD" ]; then')
    expect(unix).toContain('if [ ! -f "$AX_CODE_SOURCE_NODE_FFI_RUNNER" ]; then')
    expect(unix).toContain("source launcher points at a missing checkout")
    expect(unix).toContain("source launcher points at a missing node:ffi runner")
    expect(windows).toContain('if not exist "%AX_CODE_SOURCE_CWD%\\"')
    expect(windows).toContain('if not exist "%AX_CODE_SOURCE_NODE_FFI_RUNNER%"')
    expect(windows).toContain("source launcher points at a missing checkout")
    expect(windows).toContain("source launcher points at a missing node:ffi runner")
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
