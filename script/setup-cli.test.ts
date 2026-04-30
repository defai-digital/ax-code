import { describe, expect, test } from "bun:test"
import path from "path"
import {
  buildChannelForVersion,
  bundledBinaryPath,
  bundledBuildMarkerPath,
  bundledLauncherScript,
  preferredBundledTarget,
  setupCli,
  sourceLauncherScript,
} from "./setup-cli"

describe("setup-cli helpers", () => {
  test("reuses npm wrapper target selection for supported platforms", () => {
    expect(preferredBundledTarget({ platform: "darwin", arch: "arm64" })).toEqual({
      binary: "ax-code",
      packageName: "@defai.digital/ax-code-darwin-arm64",
      legacyName: "ax-code-darwin-arm64",
    })
    expect(preferredBundledTarget({ platform: "linux", arch: "x64", avx2: false, musl: true })).toEqual({
      binary: "ax-code",
      packageName: "@defai.digital/ax-code-linux-x64-baseline-musl",
      legacyName: "ax-code-linux-x64-baseline-musl",
    })
  })

  test("builds bundled binary paths", () => {
    expect(bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })).toBe(
      "/repo/packages/ax-code/dist/ax-code-darwin-arm64/bin/ax-code",
    )
    expect(bundledBinaryPath({ root: "/repo", platform: "win32", arch: "x64" })).toBe(
      path.join("/repo", "packages", "ax-code", "dist", "ax-code-windows-x64", "bin", "ax-code.exe"),
    )
  })

  test("derives release channels from versions", () => {
    expect(buildChannelForVersion("4.0.12")).toBe("latest")
    expect(buildChannelForVersion("4.1.0-beta.2")).toBe("beta")
  })

  test("creates bundled launchers that preserve the original cwd", () => {
    expect(bundledLauncherScript({ binaryPath: "/repo/dist/ax-code", windows: false })).toBe(
      '#!/bin/sh\nAX_CODE_ORIGINAL_CWD="$(pwd)" exec "/repo/dist/ax-code" "$@"\n',
    )
    expect(bundledLauncherScript({ binaryPath: "C:\\\\ax-code.exe", windows: true })).toBe(
      '@echo off\nset AX_CODE_ORIGINAL_CWD=%CD%\n"C:\\\\ax-code.exe" %*\n',
    )
  })

  test("creates source launchers for source mode", () => {
    const unix = sourceLauncherScript({ root: "/repo", windows: false })
    const windows = sourceLauncherScript({ root: "/repo", windows: true })
    expect(unix).toContain('AX_CODE_SOURCE_CWD="/repo/packages/ax-code"')
    expect(unix).toContain('AX_CODE_SOURCE_ENTRY="/repo/packages/ax-code/src/index.ts"')
    expect(unix).toContain('exec bun run --cwd "$AX_CODE_SOURCE_CWD"')
    expect(windows).toContain('set "AX_CODE_SOURCE_CWD=\\repo\\packages\\ax-code"')
    expect(windows).toContain('set "AX_CODE_SOURCE_ENTRY=\\repo\\packages\\ax-code\\src\\index.ts"')
    expect(windows).toContain('bun run --cwd "%AX_CODE_SOURCE_CWD%"')
    expect(windows).toContain("%*")
  })

  test("setupCli installs the bundled launcher by default and reuses an existing binary", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })
    const marker = bundledBuildMarkerPath(binary)
    const spawns: Array<{ cmd: string; args: string[] }> = []
    setupCli({
      root: "/repo",
      env: { BUN_INSTALL: "/tmp/ax-code-test-bundled-default" },
      platform: "darwin",
      arch: "arm64",
      exists: (target) =>
        target === "/tmp/ax-code-test-bundled-default/bin" || target === binary || target === marker,
      mkdirSync: () => undefined,
      readFileSync: (p) => (p === marker ? "/repo\n" : ""),
      writeFileSync: (target, content) => {
        writes.push([target, String(content)])
      },
      spawnSync: (cmd, args) => {
        spawns.push({ cmd: String(cmd), args: (args ?? []).map(String) })
        return { status: 0, stdout: null, stderr: null, pid: 1, output: null, signal: null } as any
      },
      which: () => undefined,
      log: () => undefined,
    })

    expect(spawns).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toBe("/tmp/ax-code-test-bundled-default/bin/ax-code")
    expect(writes[0][1]).toContain(`exec "${binary}" "$@"`)
    expect(writes[0][1]).not.toContain("bun run --cwd")
  })

  test("setupCli rebuilds the bundled binary when the build marker is missing", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })
    const marker = bundledBuildMarkerPath(binary)
    const spawns: Array<{ cmd: string; args: string[] }> = []
    setupCli({
      root: "/repo",
      env: { BUN_INSTALL: "/tmp/ax-code-test-bundled-no-marker" },
      platform: "darwin",
      arch: "arm64",
      version: "4.0.12",
      exists: (target) => target === "/tmp/ax-code-test-bundled-no-marker/bin" || target === binary,
      mkdirSync: () => undefined,
      writeFileSync: (target, content) => {
        writes.push([target, String(content)])
      },
      spawnSync: (cmd, args) => {
        spawns.push({ cmd: String(cmd), args: (args ?? []).map(String) })
        return { status: 0, stdout: null, stderr: null, pid: 1, output: null, signal: null } as any
      },
      which: () => undefined,
      log: () => undefined,
    })

    expect(spawns).toHaveLength(1)
    const markerWrite = writes.find(([target]) => target === marker)
    expect(markerWrite).toBeDefined()
    expect(markerWrite?.[1]).toContain("/repo")
  })

  test("setupCli rebuilds the bundled binary when the build marker points at a different checkout", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })
    const marker = bundledBuildMarkerPath(binary)
    const spawns: Array<{ cmd: string; args: string[] }> = []
    setupCli({
      root: "/repo",
      env: { BUN_INSTALL: "/tmp/ax-code-test-bundled-stale" },
      platform: "darwin",
      arch: "arm64",
      version: "4.0.12",
      exists: (target) =>
        target === "/tmp/ax-code-test-bundled-stale/bin" || target === binary || target === marker,
      mkdirSync: () => undefined,
      readFileSync: (p) => (p === marker ? "/old-checkout\n" : ""),
      writeFileSync: (target, content) => {
        writes.push([target, String(content)])
      },
      spawnSync: (cmd, args) => {
        spawns.push({ cmd: String(cmd), args: (args ?? []).map(String) })
        return { status: 0, stdout: null, stderr: null, pid: 1, output: null, signal: null } as any
      },
      which: () => undefined,
      log: () => undefined,
    })

    expect(spawns).toHaveLength(1)
    const markerWrite = writes.find(([target]) => target === marker)
    expect(markerWrite?.[1]).toContain("/repo")
  })

  test("setupCli installs the source launcher when --source is explicit", () => {
    const writes: Array<[string, string]> = []
    setupCli({
      args: ["--source"],
      root: "/repo",
      env: { BUN_INSTALL: "/tmp/ax-code-test-source" },
      platform: "darwin",
      arch: "arm64",
      exists: (target) => target === "/tmp/ax-code-test-source/bin",
      mkdirSync: () => undefined,
      writeFileSync: (target, content) => {
        writes.push([target, String(content)])
      },
      which: () => undefined,
      log: () => undefined,
    })

    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toBe("/tmp/ax-code-test-source/bin/ax-code")
    expect(writes[0][1]).toContain('AX_CODE_SOURCE_CWD="/repo/packages/ax-code"')
    expect(writes[0][1]).toContain('exec bun run --cwd "$AX_CODE_SOURCE_CWD"')
  })

  test("setupCli installs the bundled launcher when --bundled is explicit and reuses an existing binary", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })
    const marker = bundledBuildMarkerPath(binary)
    const spawns: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = []
    setupCli({
      args: ["--bundled"],
      root: "/repo",
      env: { BUN_INSTALL: "/tmp/ax-code-test-bundled" },
      platform: "darwin",
      arch: "arm64",
      version: "4.0.12",
      exists: (target) => target === "/tmp/ax-code-test-bundled/bin" || target === binary || target === marker,
      mkdirSync: () => undefined,
      readFileSync: (p) => (p === marker ? "/repo\n" : ""),
      writeFileSync: (target, content) => {
        writes.push([target, String(content)])
      },
      spawnSync: (cmd, args, options) => {
        spawns.push({
          cmd: String(cmd),
          args: (args ?? []).map(String),
          env: options?.env as NodeJS.ProcessEnv | undefined,
        })
        return { status: 0, stdout: null, stderr: null, pid: 1, output: null, signal: null } as any
      },
      which: () => undefined,
      log: () => undefined,
    })

    expect(spawns).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toBe("/tmp/ax-code-test-bundled/bin/ax-code")
    expect(writes[0][1]).toContain(`exec "${binary}" "$@"`)
    expect(writes[0][1]).not.toContain("bun run --cwd")
  })

  test("setupCli builds the same preferred variant chosen by the npm wrapper", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "linux", arch: "x64", avx2: false, musl: true })
    const spawns: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = []
    let built = false
    setupCli({
      args: ["--bundled"],
      root: "/repo",
      env: { BUN_INSTALL: "/tmp/ax-code-test-linux" },
      platform: "linux",
      arch: "x64",
      avx2: false,
      musl: true,
      version: "4.0.12",
      exists: (target) => target === "/tmp/ax-code-test-linux/bin" || (target === binary && built),
      mkdirSync: () => undefined,
      writeFileSync: (target, content) => {
        writes.push([target, String(content)])
      },
      spawnSync: (cmd, args, options) => {
        built = true
        spawns.push({
          cmd: String(cmd),
          args: (args ?? []).map(String),
          env: options?.env as NodeJS.ProcessEnv | undefined,
        })
        return { status: 0, stdout: null, stderr: null, pid: 1, output: null, signal: null } as any
      },
      which: () => undefined,
      log: () => undefined,
    })

    expect(spawns).toEqual([
      {
        cmd: "pnpm",
        args: ["--dir", "packages/ax-code", "run", "build", "--", "--single", "--baseline", "--include-abi"],
        env: expect.objectContaining({
          AX_CODE_VERSION: "v4.0.12",
          AX_CODE_CHANNEL: "latest",
        }),
      },
    ])
    const launcherWrite = writes.find(([target]) => target === "/tmp/ax-code-test-linux/bin/ax-code")
    expect(launcherWrite?.[1]).toContain(`exec "${binary}" "$@"`)
    const markerWrite = writes.find(([target]) => target === bundledBuildMarkerPath(binary))
    expect(markerWrite?.[1]).toContain("/repo")
  })
})
