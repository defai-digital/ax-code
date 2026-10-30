import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { nativeMetadata, prepareNativeLibraryFrom, verifyNativeArtifacts } from "../native/resolve.js"

const roots: string[] = []
const target = "darwin-arm64"
const library = Buffer.from("native-library-fixture")
const license = Buffer.from("MIT license fixture")
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-tui-native-test-"))
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
  const fetcher = vi.fn(async (url: string) => new Response(url.endsWith("-LICENSE") ? license : library))
  return { root, packageRoot, cacheDir, entry, fetcher }
}

describe("native delivery", () => {
  test("downloads version-pinned assets, verifies both, and reuses the cache offline", async () => {
    const f = await fixture()
    const result = await prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, f.fetcher)
    expect(await readFile(result.libraryPath)).toEqual(library)
    expect(await readFile(result.licensePath)).toEqual(license)
    expect(f.fetcher.mock.calls.map(([url]) => url).sort()).toEqual([
      "https://github.com/defai-digital/ax-tui/releases/download/v0.1.1/ax-tui-native-darwin-arm64-LICENSE",
      "https://github.com/defai-digital/ax-tui/releases/download/v0.1.1/ax-tui-native-darwin-arm64-libaxtui.dylib",
    ])
    expect(
      await prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir, offline: true }, f.fetcher),
    ).toEqual(result)
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    expect(await readdir(f.cacheDir)).toHaveLength(1)
  })

  test("keeps signed bundled libraries usable without comparing unsigned hashes", async () => {
    const f = await fixture()
    const dir = path.join(f.packageRoot, "vendor", target)
    await mkdir(dir)
    await writeFile(path.join(dir, f.entry.lib.file), "signed bytes differ")
    await writeFile(path.join(dir, "LICENSE"), license)
    const result = await prepareNativeLibraryFrom(f.packageRoot, target, { offline: true }, f.fetcher)
    expect(result.libraryPath).toBe(path.join(dir, f.entry.lib.file))
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(() => verifyNativeArtifacts(dir, f.entry)).toThrow()
  })

  test.each(["library", "license", "oversize", "truncated", "http"])(
    "rejects %s failures without committing cache data",
    async (failure) => {
      const f = await fixture()
      const fetcher = vi.fn(async (url: string) => {
        if (failure === "http") return new Response("missing", { status: 404 })
        const isLicense = url.endsWith("-LICENSE")
        let body = isLicense ? license : library
        if (failure === "license" && isLicense) body = Buffer.alloc(license.length, 33)
        if (failure === "library" && !isLicense) body = Buffer.alloc(library.length, 33)
        if (failure === "oversize" && !isLicense) body = Buffer.alloc(library.length + 1)
        if (failure === "truncated" && !isLicense) body = library.subarray(0, -1)
        return new Response(body)
      })
      await expect(prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, fetcher)).rejects.toThrow()
      expect(await readdir(f.cacheDir)).toEqual([])
    },
  )

  test("detects corrupted cache files before reuse without downloading over them", async () => {
    const f = await fixture()
    const result = await prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, f.fetcher)
    await writeFile(result.libraryPath, Buffer.alloc(library.length))
    await expect(prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, f.fetcher)).rejects.toThrow(
      "SHA-256 mismatch",
    )
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })

  test("concurrent downloads converge on one fully verified cache entry", async () => {
    const f = await fixture()
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, f.fetcher),
      ),
    )
    expect(new Set(results.map((result) => result.libraryPath)).size).toBe(1)
    expect(await readdir(f.cacheDir)).toHaveLength(1)
    expect(await readFile(results[0].libraryPath)).toEqual(library)
  })

  test("offline mode and pre-aborted calls never fetch", async () => {
    const f = await fixture()
    await expect(
      prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir, offline: true }, f.fetcher),
    ).rejects.toThrow("offline")
    vi.stubEnv("AX_CODE_TUI_NATIVE_OFFLINE", "true")
    await expect(prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, f.fetcher)).rejects.toThrow(
      "offline",
    )
    await expect(
      prepareNativeLibraryFrom(f.packageRoot, target, { signal: AbortSignal.abort() }, f.fetcher),
    ).rejects.toThrow()
    expect(f.fetcher).not.toHaveBeenCalled()
  })

  test("cancellation aborts pending downloads and removes staging data", async () => {
    const f = await fixture()
    const controller = new AbortController()
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })
          if (init.signal!.aborted) reject(init.signal!.reason)
          controller.abort(new Error("cancelled"))
        }),
    )
    await expect(
      prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir, signal: controller.signal }, fetcher),
    ).rejects.toThrow("cancelled")
    expect(await readdir(f.cacheDir)).toEqual([])
  })

  test("rejects malformed target metadata before network or path construction", async () => {
    const f = await fixture()
    expect(() => nativeMetadata(f.packageRoot, "../../outside")).toThrow("Unsupported")
    f.entry.lib.file = "../../outside"
    await writeFile(
      path.join(f.packageRoot, "vendor/manifest.json"),
      JSON.stringify({ targets: { [target]: f.entry } }),
    )
    await expect(prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, f.fetcher)).rejects.toThrow(
      "Invalid",
    )
    expect(f.fetcher).not.toHaveBeenCalled()
  })

  test("does not load a symlink substituted into the native cache", async () => {
    const f = await fixture()
    const result = await prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, f.fetcher)
    const external = path.join(f.root, "external-library")
    await writeFile(external, library)
    await rm(result.libraryPath)
    await symlink(external, result.libraryPath)
    await expect(prepareNativeLibraryFrom(f.packageRoot, target, { cacheDir: f.cacheDir }, f.fetcher)).rejects.toThrow(
      "Invalid",
    )
  })
})
