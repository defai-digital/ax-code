import { afterEach, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const require = createRequire(import.meta.url)
const { findUnsafeRuntimeSymlinks, removeUnsafeRuntimeSymlinks } = require("./runtime-symlinks.cjs")

const tempDirs = []

const makeTempDir = (prefix) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

const describeSymlinks = process.platform === "win32" ? describe.skip : describe

describeSymlinks("runtime symlink sanitation", () => {
  test("keeps internal links and removes external or broken links", () => {
    const runtimeRoot = makeTempDir("ax-runtime-links-")
    const outside = makeTempDir("ax-runtime-links-outside-")
    const binDirectory = path.join(runtimeRoot, "node_modules", ".bin")
    const packageDirectory = path.join(runtimeRoot, "node_modules", "tool")
    fs.mkdirSync(binDirectory, { recursive: true })
    fs.mkdirSync(packageDirectory, { recursive: true })
    fs.writeFileSync(path.join(packageDirectory, "bin.js"), "export {}\n")

    const safeLink = path.join(binDirectory, "tool")
    const externalLink = path.join(runtimeRoot, "node_modules", "workspace-only")
    const brokenLink = path.join(runtimeRoot, "node_modules", "missing")
    fs.symlinkSync("../tool/bin.js", safeLink)
    fs.symlinkSync(outside, externalLink)
    fs.symlinkSync("../not-packaged", brokenLink)

    expect(findUnsafeRuntimeSymlinks(runtimeRoot)).toEqual([
      path.join("node_modules", "missing"),
      path.join("node_modules", "workspace-only"),
    ])
    expect(removeUnsafeRuntimeSymlinks(runtimeRoot)).toHaveLength(2)
    expect(fs.lstatSync(safeLink).isSymbolicLink()).toBe(true)
    expect(fs.existsSync(externalLink)).toBe(false)
    expect(fs.existsSync(brokenLink)).toBe(false)
    expect(findUnsafeRuntimeSymlinks(runtimeRoot)).toEqual([])
  })
})
