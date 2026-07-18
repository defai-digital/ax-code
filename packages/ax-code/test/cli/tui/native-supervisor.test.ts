import { chmod, mkdir, writeFile } from "fs/promises"
import path from "path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import { tmpdir } from "../../fixture/fixture"
import {
  NATIVE_TUI_BINARY_ENV,
  buildNativeTuiArgs,
  nativeTuiBinaryCandidates,
  nativeTuiBinaryName,
  resolveNativeTuiBinary,
} from "../../../src/cli/cmd/tui/native-supervisor"

describe("native TUI supervisor", () => {
  test("builds the complete Rust client argument vector", () => {
    expect(
      buildNativeTuiArgs({
        serverUrl: "http://127.0.0.1:43210",
        cwd: "/workspace",
        session: "ses_1",
        prompt: "hello",
        continue: true,
        fork: true,
        model: "openai/gpt-test",
        agent: "build",
      }),
    ).toEqual([
      "--server-url",
      "http://127.0.0.1:43210",
      "--directory",
      "/workspace",
      "--session",
      "ses_1",
      "--prompt",
      "hello",
      "--continue",
      "--fork",
      "--model",
      "openai/gpt-test",
      "--agent",
      "build",
    ])
  })

  test("removes yoga from executable selection and honors an explicit binary", async () => {
    await using tmp = await tmpdir()
    const binary = path.join(tmp.path, nativeTuiBinaryName())
    await writeFile(binary, "#!/bin/sh\nexit 0\n")
    if (process.platform !== "win32") await chmod(binary, 0o755)

    const env = { [NATIVE_TUI_BINARY_ENV]: binary }
    expect(nativeTuiBinaryCandidates({ env })).toEqual([binary])
    expect(resolveNativeTuiBinary({ env })).toBe(binary)
  })

  test("reports an explicit missing binary without silently falling back", () => {
    const missing = path.resolve("/definitely/missing/ax-code-tui")
    expect(() => resolveNativeTuiBinary({ env: { [NATIVE_TUI_BINARY_ENV]: missing } })).toThrow(NATIVE_TUI_BINARY_ENV)
  })

  test("resolves the packaged libexec sidecar beside a bundled lib entrypoint", async () => {
    await using tmp = await tmpdir()
    const distRoot = tmp.path
    const libDir = path.join(distRoot, "lib")
    const libexecDir = path.join(distRoot, "libexec")
    await mkdir(libDir, { recursive: true })
    await mkdir(libexecDir, { recursive: true })

    const entry = path.join(libDir, "index-node-tui.js")
    await writeFile(entry, "export {}\n")
    const binary = path.join(libexecDir, nativeTuiBinaryName())
    await writeFile(binary, "#!/bin/sh\nexit 0\n")
    if (process.platform !== "win32") await chmod(binary, 0o755)

    const resolved = resolveNativeTuiBinary({
      env: {},
      moduleUrl: pathToFileURL(entry).href,
      pathValue: "",
    })
    expect(resolved).toBe(binary)

    const candidates = nativeTuiBinaryCandidates({
      env: {},
      moduleUrl: pathToFileURL(entry).href,
      pathValue: "",
    })
    expect(candidates[0]).toBe(binary)
  })

  test("discovers crates/target builds by walking up from a source module path", async () => {
    await using tmp = await tmpdir()
    const repoRoot = tmp.path
    const moduleDir = path.join(repoRoot, "packages", "ax-code", "src", "cli", "cmd", "tui")
    const releaseDir = path.join(repoRoot, "crates", "target", "release")
    await mkdir(moduleDir, { recursive: true })
    await mkdir(releaseDir, { recursive: true })

    const moduleFile = path.join(moduleDir, "native-supervisor.ts")
    await writeFile(moduleFile, "export {}\n")
    const binary = path.join(releaseDir, nativeTuiBinaryName())
    await writeFile(binary, "#!/bin/sh\nexit 0\n")
    if (process.platform !== "win32") await chmod(binary, 0o755)

    expect(
      resolveNativeTuiBinary({
        env: {},
        moduleUrl: pathToFileURL(moduleFile).href,
        pathValue: "",
      }),
    ).toBe(binary)
  })

  test("prefers a fresh debug sidecar over a stale source release build", async () => {
    await using tmp = await tmpdir()
    const moduleDir = path.join(tmp.path, "packages", "ax-code", "src", "cli", "cmd", "tui")
    const debugDir = path.join(tmp.path, "crates", "target", "debug")
    const releaseDir = path.join(tmp.path, "crates", "target", "release")
    await mkdir(moduleDir, { recursive: true })
    await mkdir(debugDir, { recursive: true })
    await mkdir(releaseDir, { recursive: true })

    const moduleFile = path.join(moduleDir, "native-supervisor.ts")
    const debugBinary = path.join(debugDir, nativeTuiBinaryName())
    const releaseBinary = path.join(releaseDir, nativeTuiBinaryName())
    await writeFile(moduleFile, "export {}\n")
    await writeFile(debugBinary, "#!/bin/sh\nexit 0\n")
    await writeFile(releaseBinary, "#!/bin/sh\nexit 0\n")
    if (process.platform !== "win32") {
      await chmod(debugBinary, 0o755)
      await chmod(releaseBinary, 0o755)
    }

    expect(
      resolveNativeTuiBinary({
        env: {},
        moduleUrl: pathToFileURL(moduleFile).href,
        pathValue: "",
      }),
    ).toBe(debugBinary)
  })
})
