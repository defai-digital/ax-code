import { afterEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assetNameForTarget,
  bundledLauncherRelativePath,
  isStageRequired,
  placeholderReadme,
  readPinnedAxCodeVersion,
  releaseAssetUrls,
  resolveStageTarget,
} from "./stage-ax-code.mjs"

describe("readPinnedAxCodeVersion", () => {
  it("reads the Desktop app version as the runtime pin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-stage-pin-"))
    try {
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "7.9.12" }))
      expect(readPinnedAxCodeVersion(dir)).toBe("7.9.12")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("fails when the manifest has no version", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-stage-pin-missing-"))
    try {
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({}))
      expect(() => readPinnedAxCodeVersion(dir)).toThrow("Cannot derive the pinned ax-code version")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("resolveStageTarget", () => {
  it("derives the target from electron-builder CLI flags", () => {
    expect(resolveStageTarget({ argv: ["--mac", "--arm64"], env: {} })).toEqual({
      platform: "darwin",
      arch: "arm64",
    })
    expect(resolveStageTarget({ argv: ["--win", "--x64"], env: {} })).toEqual({
      platform: "win32",
      arch: "x64",
    })
    expect(resolveStageTarget({ argv: ["--linux", "--arm64", "--publish=never"], env: {} })).toEqual({
      platform: "linux",
      arch: "arm64",
    })
  })

  it("falls back to ELECTRON_BUILDER_ARCH then the host", () => {
    expect(
      resolveStageTarget({ argv: ["--linux"], env: { ELECTRON_BUILDER_ARCH: "x64" }, platform: "darwin" }),
    ).toEqual({ platform: "linux", arch: "x64" })
    expect(resolveStageTarget({ argv: [], env: {}, platform: "darwin", arch: "arm64" })).toEqual({
      platform: "darwin",
      arch: "arm64",
    })
  })

  it("prefers explicit arch flags over ELECTRON_BUILDER_ARCH", () => {
    expect(resolveStageTarget({ argv: ["--win", "--arm64"], env: { ELECTRON_BUILDER_ARCH: "x64" } })).toEqual({
      platform: "win32",
      arch: "arm64",
    })
  })
})

describe("assetNameForTarget", () => {
  it("maps every supported packaging target to a CLI release asset", () => {
    expect(assetNameForTarget({ platform: "darwin", arch: "arm64" })).toBe("ax-code-darwin-arm64.zip")
    expect(assetNameForTarget({ platform: "win32", arch: "x64" })).toBe("ax-code-windows-x64.zip")
    expect(assetNameForTarget({ platform: "win32", arch: "arm64" })).toBe("ax-code-windows-arm64.zip")
    expect(assetNameForTarget({ platform: "linux", arch: "x64" })).toBe("ax-code-linux-x64.tar.gz")
    expect(assetNameForTarget({ platform: "linux", arch: "arm64" })).toBe("ax-code-linux-arm64.tar.gz")
  })

  it("rejects unsupported targets", () => {
    expect(assetNameForTarget({ platform: "darwin", arch: "x64" })).toBeNull()
    expect(assetNameForTarget({ platform: "linux", arch: "armv7l" })).toBeNull()
    expect(assetNameForTarget({ platform: "freebsd", arch: "x64" })).toBeNull()
  })
})

describe("releaseAssetUrls", () => {
  it("points at the sibling v<version> CLI release", () => {
    expect(releaseAssetUrls({ version: "7.9.12", assetName: "ax-code-darwin-arm64.zip" })).toEqual({
      archiveUrl: "https://github.com/defai-digital/ax-code/releases/download/v7.9.12/ax-code-darwin-arm64.zip",
      signatureUrl:
        "https://github.com/defai-digital/ax-code/releases/download/v7.9.12/ax-code-darwin-arm64.zip.minisig",
    })
  })
})

describe("isStageRequired", () => {
  it("fails closed only when explicitly requested", () => {
    expect(isStageRequired({ AX_CODE_STAGE_REQUIRED: "true" })).toBe(true)
    expect(isStageRequired({ AX_CODE_STAGE_REQUIRED: "1" })).toBe(true)
    expect(isStageRequired({ AX_CODE_STAGE_REQUIRED: " TRUE " })).toBe(true)
    expect(isStageRequired({ AX_CODE_STAGE_REQUIRED: "false" })).toBe(false)
    expect(isStageRequired({})).toBe(false)
  })
})

describe("bundledLauncherRelativePath", () => {
  it("uses the unix launcher except on Windows", () => {
    expect(bundledLauncherRelativePath("darwin")).toBe("bin/ax-code")
    expect(bundledLauncherRelativePath("linux")).toBe("bin/ax-code")
    expect(bundledLauncherRelativePath("win32")).toBe("bin/ax-code.cmd")
  })
})

describe("placeholderReadme", () => {
  it("documents the pin and the developer override", () => {
    const text = placeholderReadme("7.9.12")
    expect(text).toContain("v7.9.12")
    expect(text).toContain("AX_CODE_DIST")
    expect(text).toContain("AX_CODE_STAGE_REQUIRED")
  })
})

// ── Shell-level policy tests ────────────────────────────────────────────────
// These drive the real stage-ax-code.sh so the fail-closed and placeholder
// policies are pinned end to end. They never reach the network: the
// AX_CODE_DIST branches exit before any download. Requires bash (skip on
// Windows hosts).
const stageScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "stage-ax-code.sh")
const stagedTreeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "resources", "ax-code")
const describeBash = process.platform === "win32" ? describe.skip : describe

const shellTempDirs = []

const makeShellTempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  shellTempDirs.push(dir)
  return dir
}

const runStage = (env) =>
  spawnSync("bash", [stageScript, "--mac", "--arm64"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  })

// The staging script always rewrites resources/ax-code; leave the dev-machine
// placeholder behind after each policy test.
const resetStagedTree = () => {
  fs.rmSync(stagedTreeDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(stagedTreeDir, "node_modules"), { recursive: true })
  fs.writeFileSync(path.join(stagedTreeDir, "README.txt"), placeholderReadme("dev"))
}

describeBash("stage-ax-code.sh policy", () => {
  afterEach(() => {
    resetStagedTree()
    for (const dir of shellTempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("refuses AX_CODE_DIST when AX_CODE_STAGE_REQUIRED=true", () => {
    const dist = makeShellTempDir("ax-stage-dist-")
    const result = runStage({ AX_CODE_STAGE_REQUIRED: "true", AX_CODE_DIST: dist })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("release builds must stage the verified release archive")
    expect(result.stderr).toContain("unset AX_CODE_DIST for local builds")
  })

  it("stages an AX_CODE_DIST tree with an executable launcher when not required", () => {
    const dist = makeShellTempDir("ax-stage-dist-")
    fs.mkdirSync(path.join(dist, "bin"), { recursive: true })
    fs.writeFileSync(path.join(dist, "bin", "ax-code"), "#!/bin/sh\necho fake\n", { mode: 0o755 })
    fs.chmodSync(path.join(dist, "bin", "ax-code"), 0o755)

    const result = runStage({ AX_CODE_DIST: dist, AX_CODE_STAGE_REQUIRED: "false" })

    expect(result.status).toBe(0)
    expect(fs.existsSync(path.join(stagedTreeDir, "bin", "ax-code"))).toBe(true)
  })

  it("falls back to the placeholder when the AX_CODE_DIST tree has no launcher", () => {
    const dist = makeShellTempDir("ax-stage-dist-")

    const result = runStage({ AX_CODE_DIST: dist, AX_CODE_STAGE_REQUIRED: "false" })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("no usable launcher")
    expect(fs.existsSync(path.join(stagedTreeDir, "README.txt"))).toBe(true)
  })

  it("falls back to the placeholder when the AX_CODE_DIST launcher is not executable", () => {
    const dist = makeShellTempDir("ax-stage-dist-")
    fs.mkdirSync(path.join(dist, "bin"), { recursive: true })
    fs.writeFileSync(path.join(dist, "bin", "ax-code"), "not a binary\n", { mode: 0o644 })

    const result = runStage({ AX_CODE_DIST: dist, AX_CODE_STAGE_REQUIRED: "false" })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("no usable launcher")
    expect(fs.existsSync(path.join(stagedTreeDir, "README.txt"))).toBe(true)
  })

  it("fails closed when the AX_CODE_DIST tree has no launcher and staging is required", () => {
    const dist = makeShellTempDir("ax-stage-dist-")

    // required + AX_CODE_DIST refuses before inspecting the tree at all.
    const result = runStage({ AX_CODE_DIST: dist, AX_CODE_STAGE_REQUIRED: "true" })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("release builds must stage the verified release archive")
  })
})
