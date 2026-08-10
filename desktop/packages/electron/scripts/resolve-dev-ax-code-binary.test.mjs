import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  monorepoRootFromElectronDir,
  resolveDevAxCodeBinary,
  searchPathFor,
} from "./resolve-dev-ax-code-binary.mjs"

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const monorepoRoot = monorepoRootFromElectronDir(electronDir)

const tempDirs = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("resolveDevAxCodeBinary", () => {
  it("prefers an executable AX_CODE_BINARY over PATH and monorepo launchers", () => {
    const dir = makeTempDir("ax-dev-cli-explicit-")
    const explicit = path.join(dir, "custom-ax-code")
    fs.writeFileSync(explicit, "#!/bin/sh\necho custom\n", { mode: 0o755 })
    fs.chmodSync(explicit, 0o755)

    const pathBinDir = path.join(dir, "path-bin")
    fs.mkdirSync(pathBinDir)
    const pathBin = path.join(pathBinDir, "ax-code")
    fs.writeFileSync(pathBin, "#!/bin/sh\necho path\n", { mode: 0o755 })
    fs.chmodSync(pathBin, 0o755)

    const resolved = resolveDevAxCodeBinary({
      electronDir: path.join(dir, "electron"),
      monorepoRoot,
      env: { AX_CODE_BINARY: explicit, PATH: pathBinDir },
      platform: "linux",
      warn: () => {},
    })
    expect(resolved).toBe(explicit)
  })

  it("falls back to PATH when AX_CODE_BINARY is missing", () => {
    const dir = makeTempDir("ax-dev-cli-path-")
    const pathBinDir = path.join(dir, "path-bin")
    fs.mkdirSync(pathBinDir)
    const pathBin = path.join(pathBinDir, "ax-code")
    fs.writeFileSync(pathBin, "#!/bin/sh\necho path\n", { mode: 0o755 })
    fs.chmodSync(pathBin, 0o755)

    const resolved = resolveDevAxCodeBinary({
      electronDir: path.join(dir, "electron"),
      monorepoRoot: path.join(dir, "missing-monorepo"),
      env: { PATH: pathBinDir },
      platform: "linux",
      warn: () => {},
    })
    expect(resolved).toBe(pathBin)
  })

  it("generates a monorepo source launcher when PATH has no ax-code", () => {
    const dir = makeTempDir("ax-dev-cli-source-")
    const fakeElectron = path.join(dir, "electron")
    fs.mkdirSync(fakeElectron, { recursive: true })

    // Empty PATH so we cannot accidentally pick up a host install.
    const resolved = resolveDevAxCodeBinary({
      electronDir: fakeElectron,
      monorepoRoot,
      env: { PATH: "" },
      platform: "linux",
      warn: () => {},
    })

    expect(resolved).toBe(path.join(fakeElectron, ".dev-bin", "ax-code"))
    expect(fs.existsSync(resolved)).toBe(true)
    const body = fs.readFileSync(resolved, "utf8")
    expect(body).toContain("#!/bin/sh")
    expect(body).toContain(path.join(monorepoRoot, "packages", "ax-code"))
    expect(body).toContain("index-node-tui.ts")
    expect(body).toContain("node-ffi-runner.mjs")
    // Executable bit required so Desktop can spawn without shell.
    expect(fs.accessSync(resolved, fs.constants.X_OK)).toBeUndefined()
  })

  it("returns null when neither PATH nor monorepo source entry exists", () => {
    const dir = makeTempDir("ax-dev-cli-missing-")
    const fakeElectron = path.join(dir, "electron")
    const emptyRoot = path.join(dir, "empty-root")
    fs.mkdirSync(fakeElectron, { recursive: true })
    fs.mkdirSync(emptyRoot, { recursive: true })

    const warnings = []
    const resolved = resolveDevAxCodeBinary({
      electronDir: fakeElectron,
      monorepoRoot: emptyRoot,
      env: { PATH: "" },
      platform: "linux",
      warn: (msg) => warnings.push(msg),
    })
    expect(resolved).toBeNull()
    expect(warnings.some((w) => w.includes("monorepo source CLI not found"))).toBe(true)
  })

  it("ignores non-executable AX_CODE_BINARY and continues resolution", () => {
    const dir = makeTempDir("ax-dev-cli-bad-explicit-")
    const bad = path.join(dir, "not-exec")
    fs.writeFileSync(bad, "not a binary\n", { mode: 0o644 })

    const pathBinDir = path.join(dir, "path-bin")
    fs.mkdirSync(pathBinDir)
    const pathBin = path.join(pathBinDir, "ax-code")
    fs.writeFileSync(pathBin, "#!/bin/sh\necho path\n", { mode: 0o755 })
    fs.chmodSync(pathBin, 0o755)

    const warnings = []
    const resolved = resolveDevAxCodeBinary({
      electronDir: path.join(dir, "electron"),
      monorepoRoot: path.join(dir, "missing"),
      env: { AX_CODE_BINARY: bad, PATH: pathBinDir },
      platform: "linux",
      warn: (msg) => warnings.push(msg),
    })
    expect(resolved).toBe(pathBin)
    expect(warnings.some((w) => w.includes("not executable"))).toBe(true)
  })
})

describe("searchPathFor", () => {
  it("finds an executable on PATH", () => {
    const dir = makeTempDir("ax-dev-cli-search-")
    const bin = path.join(dir, "tool")
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 })
    fs.chmodSync(bin, 0o755)
    expect(searchPathFor("tool", { PATH: dir }, "linux")).toBe(bin)
  })
})
