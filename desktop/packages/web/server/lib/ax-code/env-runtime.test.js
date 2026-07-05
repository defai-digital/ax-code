import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createAxCodeEnvRuntime } from "./env-runtime.js"

const originalAxCodeBinary = process.env.AX_CODE_BINARY
const originalComSpec = process.env.ComSpec
const originalPath = process.env.PATH
const originalSystemRoot = process.env.SystemRoot
const originalWslBinary = process.env.WSL_BINARY
const originalOpenChamberWslBinary = process.env.AX_CODE_DESKTOP_WSL_BINARY
const originalPlatform = process.platform
const tempDirs = []
const itIf = (condition) => (condition ? it : it.skip)

const createTempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const setPlatform = (platform) => {
  Object.defineProperty(process, "platform", {
    value: platform,
  })
}

afterEach(() => {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
  })

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  if (typeof originalAxCodeBinary === "string") {
    process.env.AX_CODE_BINARY = originalAxCodeBinary
  } else {
    delete process.env.AX_CODE_BINARY
  }

  if (typeof originalComSpec === "string") {
    process.env.ComSpec = originalComSpec
  } else {
    delete process.env.ComSpec
  }

  if (typeof originalPath === "string") {
    process.env.PATH = originalPath
  } else {
    delete process.env.PATH
  }

  if (typeof originalSystemRoot === "string") {
    process.env.SystemRoot = originalSystemRoot
  } else {
    delete process.env.SystemRoot
  }

  if (typeof originalWslBinary === "string") {
    process.env.WSL_BINARY = originalWslBinary
  } else {
    delete process.env.WSL_BINARY
  }

  if (typeof originalOpenChamberWslBinary === "string") {
    process.env.AX_CODE_DESKTOP_WSL_BINARY = originalOpenChamberWslBinary
  } else {
    delete process.env.AX_CODE_DESKTOP_WSL_BINARY
  }
})

const createRuntime = (settings) => {
  const state = {
    cachedLoginShellEnvSnapshot: null,
    resolvedAxCodeBinary: null,
    resolvedAxCodeBinarySource: null,
    useWslForAxCode: false,
    resolvedWslBinary: null,
    resolvedWslAxCodePath: null,
    resolvedWslDistro: null,
    resolvedNodeBinary: null,
    resolvedBunBinary: null,
    managedAxCodeShellEnvSnapshot: null,
  }

  const runtime = createAxCodeEnvRuntime({
    state,
    normalizeDirectoryPath: (value) => value,
    readSettingsFromDiskMigrated: async () => settings,
    ENV_CONFIGURED_AX_CODE_WSL_DISTRO: null,
  })

  return { runtime, state }
}

describe("AX Code env runtime", () => {
  it("throws a specific error for a missing configured AX Code binary in strict mode", async () => {
    const { runtime } = createRuntime({ axCodeBinary: "/missing/ax-code" })

    await expect(runtime.applyAxCodeBinaryFromSettings({ strict: true })).rejects.toMatchObject({
      code: "AX_CODE_BINARY_INVALID",
      message: expect.stringContaining("Configured ax-code binary not found: /missing/ax-code"),
    })
  })

  it("throws a specific error for a configured directory without an executable CLI in strict mode", async () => {
    const dir = createTempDir("openchamber-ax-code-dir-")
    const { runtime } = createRuntime({ axCodeBinary: dir })

    await expect(runtime.applyAxCodeBinaryFromSettings({ strict: true })).rejects.toMatchObject({
      code: "AX_CODE_BINARY_INVALID",
      message: expect.stringContaining("Configured AX Code binary directory does not contain an executable"),
    })
  })

  it("applies a valid configured executable AX Code binary", async () => {
    const dir = createTempDir("openchamber-ax-code-bin-")
    const binary = path.join(dir, "ax-code")
    fs.writeFileSync(binary, "#!/bin/sh\nexit 0\n")
    fs.chmodSync(binary, 0o755)
    const { runtime, state } = createRuntime({ axCodeBinary: binary })

    await expect(runtime.applyAxCodeBinaryFromSettings({ strict: true })).resolves.toBe(binary)
    expect(process.env.AX_CODE_BINARY).toBe(binary)
    expect(state.resolvedAxCodeBinary).toBe(binary)
    expect(state.resolvedAxCodeBinarySource).toBe("settings")
  })

  it("trims configured executable AX Code binary settings", async () => {
    const dir = createTempDir("openchamber-ax-code-trimmed-bin-")
    const binary = path.join(dir, "ax-code")
    fs.writeFileSync(binary, "#!/bin/sh\nexit 0\n")
    fs.chmodSync(binary, 0o755)
    const { runtime, state } = createRuntime({ axCodeBinary: ` ${binary} ` })

    await expect(runtime.applyAxCodeBinaryFromSettings({ strict: true })).resolves.toBe(binary)
    expect(process.env.AX_CODE_BINARY).toBe(binary)
    expect(state.resolvedAxCodeBinary).toBe(binary)
    expect(state.resolvedAxCodeBinarySource).toBe("settings")
  })

  itIf(process.platform === "darwin")("rejects known macOS AX Code app bundle executable paths", async () => {
    const { runtime } = createRuntime({ axCodeBinary: "/Applications/AX Code.app/Contents/MacOS/AX Code" })

    await expect(runtime.applyAxCodeBinaryFromSettings({ strict: true })).rejects.toMatchObject({
      code: "AX_CODE_BINARY_INVALID",
      message: expect.stringContaining("macOS desktop app bundle"),
    })
  })

  it("does not classify WSL settings as a native invalid configured binary in strict mode", async () => {
    setPlatform("win32")
    const dir = createTempDir("openchamber-no-wsl-")
    process.env.PATH = dir
    process.env.SystemRoot = dir
    process.env.WSL_BINARY = path.join(dir, "missing-wsl.exe")
    process.env.AX_CODE_DESKTOP_WSL_BINARY = path.join(dir, "missing-openchamber-wsl.exe")
    const { runtime } = createRuntime({ axCodeBinary: "wsl:/usr/local/bin/ax-code" })

    const rejection = runtime.applyAxCodeBinaryFromSettings({ strict: true })

    try {
      await rejection
      expect(runtime.resolveManagedAxCodeLaunchSpec("ax-code").wrapperType).not.toBe("cmd-wrapper")
    } catch (error) {
      expect(error.message).toContain("uses WSL")
      expect(error.code).toBeUndefined()
    }
  })

  it("launches Windows cmd shims through cmd call without embedded quotes", () => {
    setPlatform("win32")
    process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe"
    const dir = createTempDir("openchamber-ax-code-cmd-")
    const shim = path.join(dir, "ax-code.cmd")
    fs.writeFileSync(shim, "@echo off\r\nexit /b 0\r\n")
    const { runtime } = createRuntime({})

    expect(runtime.resolveManagedAxCodeLaunchSpec(shim)).toEqual({
      binary: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "call", shim],
      wrapperType: "cmd-wrapper",
    })
  })

  it("resolves npm AX Code cmd shims to the packaged Windows executable", () => {
    setPlatform("win32")
    const npmDir = createTempDir("openchamber-ax-code-npm-")
    const shim = path.join(npmDir, "ax-code.cmd")
    const nativeBinary = path.join(npmDir, "node_modules", "ax-code-ai", "bin", "ax-code.exe")
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true })
    fs.writeFileSync(nativeBinary, "")
    fs.writeFileSync(shim, '@ECHO off\r\n"%dp0%\\node_modules\\ax-code-ai\\bin\\ax-code.exe" %*\r\n')
    const { runtime } = createRuntime({})

    expect(runtime.resolveManagedAxCodeLaunchSpec(shim)).toEqual({
      binary: nativeBinary,
      args: [],
      wrapperType: "native-wrapper",
    })
  })
})
