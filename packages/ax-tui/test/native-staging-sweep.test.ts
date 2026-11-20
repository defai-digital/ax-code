import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { prepareNativeLibraryFrom } from "../native/resolve.js"

const roots: string[] = []
const target = "darwin-arm64"
const library = Buffer.from("native-library-fixture")
const license = Buffer.from("MIT license fixture")
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-staging-sweep-"))
  roots.push(root)
  const packageRoot = path.join(root, "package")
  const cacheDir = path.join(root, "cache")
  const entry = {
    lib: { file: "libaxtui.dylib", size: library.length, sha256: hash(library) },
    licenseSha256: hash(license),
  }
  await mkdir(path.join(packageRoot, "vendor"), { recursive: true })
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ version: "0.1.1" }))
  await writeFile(path.join(packageRoot, "vendor/manifest.json"), JSON.stringify({ targets: { [target]: entry } }))
  return { root, packageRoot, cacheDir }
}

describe("native staging sweep", () => {
  test("removes stale orphaned staging dirs for the target before downloading, keeps fresh and unrelated ones", async () => {
    const f = await fixture()
    await mkdir(f.cacheDir, { recursive: true })
    const stale = path.join(f.cacheDir, `.download-${target}-stale`)
    const fresh = path.join(f.cacheDir, `.download-${target}-fresh`)
    const unrelated = path.join(f.cacheDir, ".download-other-x")
    await mkdir(stale)
    await writeFile(path.join(stale, "partial.bin"), "half a download")
    await mkdir(fresh)
    await mkdir(unrelated)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await utimes(stale, twoHoursAgo, twoHoursAgo)
    await utimes(unrelated, twoHoursAgo, twoHoursAgo)

    const fetcher = vi.fn(async () => {
      throw new Error("network down")
    })
    await expect(prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, fetcher)).rejects.toThrow()

    const entries = await readdir(f.cacheDir)
    expect(entries).not.toContain(`.download-${target}-stale`)
    expect(entries).toContain(`.download-${target}-fresh`)
    expect(entries).toContain(".download-other-x")
    expect(entries.filter((entry) => entry.startsWith(`.download-${target}-`))).toEqual([`.download-${target}-fresh`])
  })
})