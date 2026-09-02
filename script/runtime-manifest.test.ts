import { afterEach, describe, expect, test } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { createRuntimeManifest, verifyRuntimeManifest, writeRuntimeManifest } = require("./runtime-manifest.cjs")
const tempDirs: string[] = []
const testSymlinks = process.platform === "win32" ? test.skip : test

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ax-runtime-manifest-"))
  tempDirs.push(root)
  fs.mkdirSync(path.join(root, "lib"), { recursive: true })
  fs.mkdirSync(path.join(root, "bin"), { recursive: true })
  fs.writeFileSync(path.join(root, "lib", "index-node-tui.js"), "console.log('AX Code')\n")
  fs.writeFileSync(path.join(root, "bin", "ax-code.cmd"), "@echo off\n")
  fs.writeFileSync(path.join(root, "node.exe"), "signed later")
  fs.writeFileSync(path.join(root, "node"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00]))
  return root
}

describe("runtime manifest", () => {
  test("records the JS runtime and excludes signed native binaries", () => {
    const root = makeRuntime()
    const manifest = createRuntimeManifest(root)

    expect(manifest.files.map((entry: { path: string }) => entry.path)).toEqual([
      "bin/ax-code.cmd",
      "lib/index-node-tui.js",
    ])
  })

  test("verifies unchanged runtime contents", () => {
    const root = makeRuntime()
    writeRuntimeManifest(root)

    expect(verifyRuntimeManifest(root).schema).toBe("ax-code.runtime-manifest.v1")
  })

  test("rejects modified JavaScript", () => {
    const root = makeRuntime()
    writeRuntimeManifest(root)
    fs.appendFileSync(path.join(root, "lib", "index-node-tui.js"), "modified\n")

    expect(() => verifyRuntimeManifest(root)).toThrow("Runtime manifest mismatch: lib/index-node-tui.js")
  })

  test("rejects an unlisted non-native file", () => {
    const root = makeRuntime()
    writeRuntimeManifest(root)
    fs.writeFileSync(path.join(root, "lib", "unexpected.js"), "unexpected\n")

    expect(() => verifyRuntimeManifest(root)).toThrow("Runtime file is not listed in manifest: lib/unexpected.js")
  })

  testSymlinks("records and verifies internal symlinks", () => {
    const root = makeRuntime()
    fs.mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true })
    fs.symlinkSync("../../lib/index-node-tui.js", path.join(root, "node_modules", ".bin", "ax-code"))

    const manifest = writeRuntimeManifest(root)
    expect(manifest.files).toContainEqual({
      path: "node_modules/.bin/ax-code",
      type: "symlink",
      target: "../../lib/index-node-tui.js",
    })
    expect(verifyRuntimeManifest(root).schema).toBe("ax-code.runtime-manifest.v1")

    fs.unlinkSync(path.join(root, "node_modules", ".bin", "ax-code"))
    fs.symlinkSync("../../bin/ax-code.cmd", path.join(root, "node_modules", ".bin", "ax-code"))
    expect(() => verifyRuntimeManifest(root)).toThrow("Runtime manifest mismatch: node_modules/.bin/ax-code")
  })

  testSymlinks("rejects symlinks outside the runtime", () => {
    const root = makeRuntime()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ax-runtime-manifest-outside-"))
    tempDirs.push(outside)
    fs.symlinkSync(outside, path.join(root, "external"))

    expect(() => createRuntimeManifest(root)).toThrow("Runtime manifest cannot include an external symlink: external")
  })
})
