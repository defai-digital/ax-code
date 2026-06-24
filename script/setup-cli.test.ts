import { describe, expect, test } from "vitest"
import path from "path"
import {
  buildChannelForVersion,
  bundledBinaryPath,
  bundledBuildMarkerPath,
  bundledLauncherScript,
  getInstallBinDir,
  preferredBundledTarget,
  setupCli,
  sourceLauncherScript,
} from "./setup-cli"

describe("setup-cli helpers", () => {
  test("selects supported local release binary targets", () => {
    expect(preferredBundledTarget({ platform: "darwin", arch: "arm64" })).toEqual({
      binary: "ax-code",
      legacyName: "ax-code-darwin-arm64",
    })
    expect(preferredBundledTarget({ platform: "linux", arch: "x64", avx2: false, musl: true })).toEqual({
      binary: "ax-code",
      legacyName: "ax-code-linux-x64-baseline-musl",
    })
    expect(preferredBundledTarget({ platform: "win32", arch: "x64" })).toEqual({
      binary: "ax-code.cmd",
      legacyName: "ax-code-windows-x64",
    })
  })

  test("builds bundled binary paths", () => {
    expect(bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })).toBe(
      "/repo/packages/ax-code/dist/ax-code-darwin-arm64/bin/ax-code",
    )
    expect(bundledBinaryPath({ root: "/repo", platform: "win32", arch: "x64" })).toBe(
      path.join("/repo", "packages", "ax-code", "dist", "ax-code-windows-x64", "bin", "ax-code.cmd"),
    )
  })

  test("chooses a Node-era install bin directory without depending on Bun", () => {
    expect(getInstallBinDir({}, (command) => (command === "ax-code" ? "/usr/local/bin/ax-code" : undefined))).toBe(
      "/usr/local/bin",
    )
    expect(getInstallBinDir({ AX_CODE_BIN_DIR: "/custom/bin" }, () => undefined)).toBe("/custom/bin")
    expect(getInstallBinDir({ PNPM_HOME: "/pnpm/home" }, () => undefined)).toBe("/pnpm/home")
  })

  test("derives release channels from versions", () => {
    expect(buildChannelForVersion("4.0.12")).toBe("latest")
    expect(buildChannelForVersion("4.1.0-beta.2")).toBe("beta")
  })

  test("creates bundled launchers that preserve the original cwd", () => {
    expect(bundledLauncherScript({ binaryPath: "/repo/dist/ax-code", windows: false })).toBe(
      '#!/bin/sh\nAX_CODE_ORIGINAL_CWD="$(pwd)" exec "/repo/dist/ax-code" "$@"\n',
    )
    expect(bundledLauncherScript({ binaryPath: "C:\\\\ax-code.cmd", windows: true })).toBe(
      '@echo off\nset AX_CODE_ORIGINAL_CWD=%CD%\n"C:\\\\ax-code.cmd" %*\n',
    )
  })

  test("creates source launchers for source mode", () => {
    const unix = sourceLauncherScript({ root: "/repo", windows: false })
    const windows = sourceLauncherScript({ root: "/repo", windows: true })
    expect(unix).toContain('AX_CODE_SOURCE_CWD="/repo/packages/ax-code"')
    expect(unix).toContain('AX_CODE_SOURCE_ENTRY="/repo/packages/ax-code/src/index-node-tui.ts"')
    expect(unix).toContain("exec node --experimental-ffi")
    expect(unix).toContain('--conditions=node "$AX_CODE_SOURCE_ENTRY"')
    expect(windows).toContain('set "AX_CODE_SOURCE_CWD=\\repo\\packages\\ax-code"')
    expect(windows).toContain('set "AX_CODE_SOURCE_ENTRY=\\repo\\packages\\ax-code\\src\\index-node-tui.ts"')
    expect(windows).toContain("chcp")
    expect(windows).toContain("not UTF-8")
    expect(windows).toContain("node --experimental-ffi")
    expect(windows).toContain("%*")
  })

  test("setupCli installs the bundled launcher by default and reuses an existing binary", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })
    const marker = bundledBuildMarkerPath(binary)
    const spawns: Array<{ cmd: string; args: string[] }> = []
    setupCli({
      root: "/repo",
      env: { AX_CODE_BIN_DIR: "/tmp/ax-code-test-bundled-default/bin" },
      platform: "darwin",
      arch: "arm64",
      exists: (target) => target === "/tmp/ax-code-test-bundled-default/bin" || target === binary || target === marker,
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
    expect(writes[0][1]).not.toContain("node --experimental-ffi")
  })

  test("setupCli rebuilds the bundled binary when the build marker is missing", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })
    const marker = bundledBuildMarkerPath(binary)
    const spawns: Array<{ cmd: string; args: string[] }> = []
    setupCli({
      root: "/repo",
      env: { AX_CODE_BIN_DIR: "/tmp/ax-code-test-bundled-no-marker/bin" },
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
      env: { AX_CODE_BIN_DIR: "/tmp/ax-code-test-bundled-stale/bin" },
      platform: "darwin",
      arch: "arm64",
      version: "4.0.12",
      exists: (target) => target === "/tmp/ax-code-test-bundled-stale/bin" || target === binary || target === marker,
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
      env: { AX_CODE_BIN_DIR: "/tmp/ax-code-test-source/bin" },
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
    expect(writes[0][1]).toContain("exec node --experimental-ffi")
  })

  test("setupCli installs the bundled launcher when --bundled is explicit and reuses an existing binary", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "darwin", arch: "arm64" })
    const marker = bundledBuildMarkerPath(binary)
    const spawns: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = []
    setupCli({
      args: ["--bundled"],
      root: "/repo",
      env: { AX_CODE_BIN_DIR: "/tmp/ax-code-test-bundled/bin" },
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
    expect(writes[0][1]).not.toContain("node --experimental-ffi")
  })

  test("setupCli builds the preferred local release binary variant", () => {
    const writes: Array<[string, string]> = []
    const binary = bundledBinaryPath({ root: "/repo", platform: "linux", arch: "x64", avx2: false, musl: true })
    const spawns: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = []
    let built = false
    setupCli({
      args: ["--bundled"],
      root: "/repo",
      env: { AX_CODE_BIN_DIR: "/tmp/ax-code-test-linux/bin" },
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
