import type { NativeTarget, NativeLibraryOptions, NativeLibraryPaths } from "./types.js"

export interface NativeManifestEntry {
  lib: { file: string; size: number; sha256: string }
  licenseSha256: string
}

import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const RELEASES = "https://github.com/defai-digital/ax-tui/releases/download"
const MAX_LIBRARY_BYTES = 32 * 1024 * 1024
const MAX_LICENSE_BYTES = 64 * 1024
const SHA256 = /^[a-f0-9]{64}$/
const TARGET = /^(?:darwin-(?:arm64|x64)|win32-(?:arm64|x64)|linux-(?:arm64|x64)(?:-musl)?)$/

export function isNativeTarget(value: string): value is NativeTarget {
  return TARGET.test(value)
}

function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function nativeMetadata(packageRoot: string, target: NativeTarget): NativeManifestEntry {
  if (!isNativeTarget(target)) throw new Error(`Unsupported ax-tui native target: ${target}`)
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "vendor/manifest.json"), "utf8"))
  const entry = manifest.targets?.[target]
  const filename = target.startsWith("darwin-")
    ? "libaxtui.dylib"
    : target.startsWith("win32-")
      ? "axtui.dll"
      : "libaxtui.so"
  if (
    !entry ||
    entry.lib?.file !== filename ||
    !Number.isSafeInteger(entry.lib.size) ||
    entry.lib.size <= 0 ||
    entry.lib.size > MAX_LIBRARY_BYTES ||
    !SHA256.test(entry.lib.sha256) ||
    !SHA256.test(entry.licenseSha256)
  ) {
    throw new Error(`Invalid ax-tui native manifest entry: ${target}`)
  }
  return entry
}

export function nativeAssetNames(target: NativeTarget, entry: NativeManifestEntry) {
  return {
    library: `ax-tui-native-${target}-${entry.lib.file}`,
    license: `ax-tui-native-${target}-LICENSE`,
  }
}

function artifactPaths(directory: string, entry: NativeManifestEntry): NativeLibraryPaths {
  return { libraryPath: path.join(directory, entry.lib.file), licensePath: path.join(directory, "LICENSE") }
}

function verifyBytes(
  bytes: Buffer,
  expectedHash: string,
  maxSize: number,
  exactSize: number | undefined,
  label: string,
): void {
  if (bytes.length > maxSize || (exactSize !== undefined && bytes.length !== exactSize)) {
    throw new Error(`ax-tui native artifact size mismatch: ${label}`)
  }
  if (digest(bytes) !== expectedHash) throw new Error(`ax-tui native artifact SHA-256 mismatch: ${label}`)
}

function readArtifact(file: string, maxSize: number): Buffer {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.size > maxSize) throw new Error(`Invalid ax-tui native artifact: ${file}`)
  return readFileSync(file)
}

export function verifyNativeArtifacts(directory: string, entry: NativeManifestEntry): NativeLibraryPaths {
  if (!lstatSync(directory).isDirectory()) throw new Error(`Invalid ax-tui native directory: ${directory}`)
  const paths = artifactPaths(directory, entry)
  verifyBytes(
    readArtifact(paths.libraryPath, entry.lib.size),
    entry.lib.sha256,
    entry.lib.size,
    entry.lib.size,
    "library",
  )
  verifyBytes(
    readArtifact(paths.licensePath, MAX_LICENSE_BYTES),
    entry.licenseSha256,
    MAX_LICENSE_BYTES,
    undefined,
    "LICENSE",
  )
  return paths
}

function defaultCacheDir(): string {
  if (process.env.AX_CODE_TUI_NATIVE_CACHE_DIR) return path.resolve(process.env.AX_CODE_TUI_NATIVE_CACHE_DIR)
  const base =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Caches")
      : process.platform === "win32"
        ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local")
        : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
  return path.join(base, "ax-tui", "native")
}

async function download(
  url: string,
  maxSize: number,
  signal: AbortSignal,
  fetchImpl: typeof globalThis.fetch,
): Promise<Buffer> {
  const response = await fetchImpl(url, { signal })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(`Cannot download ax-tui native artifact (${response.status}): ${url}`)
  }
  const advertisedSize = response.headers.get("content-length")
  if (advertisedSize !== null && (!/^\d+$/.test(advertisedSize) || Number(advertisedSize) > maxSize)) {
    await response.body.cancel()
    throw new Error(`ax-tui native download exceeds size limit: ${url}`)
  }
  const chunks: Buffer[] = []
  const reader = response.body.getReader()
  let size = 0
  let complete = false
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) {
        complete = true
        return Buffer.concat(chunks, size)
      }
      size += value.byteLength
      if (size > maxSize) throw new Error(`ax-tui native download exceeds size limit: ${url}`)
      chunks.push(Buffer.from(value))
    }
  } finally {
    if (!complete) await reader.cancel()
    reader.releaseLock()
  }
}

/** Internal injectable boundary; public callers use native/index.js. */
export async function prepareNativeLibraryFrom(
  packageRoot: string,
  target: NativeTarget,
  options: NativeLibraryOptions = {},
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<NativeLibraryPaths> {
  options.signal?.throwIfAborted()
  const entry = nativeMetadata(packageRoot, target)
  const vendored = artifactPaths(path.join(packageRoot, "vendor", target), entry)
  if (existsSync(vendored.libraryPath)) {
    // Release builders verify before signing. Signatures rewrite native bytes,
    // so already bundled libraries must not be compared with unsigned hashes.
    for (const file of Object.values(vendored)) {
      if (!lstatSync(file).isFile()) throw new Error(`Invalid bundled ax-tui native artifact: ${file}`)
    }
    return vendored
  }

  const cacheRoot = path.resolve(options.cacheDir ?? defaultCacheDir())
  const cacheKey = digest(`${target}:${entry.lib.sha256}:${entry.licenseSha256}`)
  const directory = path.join(cacheRoot, `${target}-${cacheKey}`)
  if (existsSync(directory)) return verifyNativeArtifacts(directory, entry)
  if (options.offline || /^(1|true)$/.test(process.env.AX_CODE_TUI_NATIVE_OFFLINE ?? "")) {
    throw new Error(`ax-tui native library is unavailable offline for ${target}; prepare its verified cache first`)
  }
  const { version } = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"))
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Invalid ax-tui package version for native download")
  }
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(path.join(cacheRoot, `.download-${target}-`))
  const cancel = new AbortController()
  const signal = AbortSignal.any([
    cancel.signal,
    AbortSignal.timeout(30_000),
    ...(options.signal ? [options.signal] : []),
  ])
  try {
    const names = nativeAssetNames(target, entry)
    const base = `${RELEASES}/v${version}`
    const [library, license] = await Promise.all([
      download(`${base}/${names.library}`, entry.lib.size, signal, fetchImpl),
      download(`${base}/${names.license}`, MAX_LICENSE_BYTES, signal, fetchImpl),
    ])
    signal.throwIfAborted()
    verifyBytes(library, entry.lib.sha256, entry.lib.size, entry.lib.size, "library")
    verifyBytes(license, entry.licenseSha256, MAX_LICENSE_BYTES, undefined, "LICENSE")
    await writeFile(path.join(staging, entry.lib.file), library, { mode: 0o600, flag: "wx" })
    await writeFile(path.join(staging, "LICENSE"), license, { mode: 0o600, flag: "wx" })
    signal.throwIfAborted()
    try {
      await rename(staging, directory)
    } catch (error) {
      // A concurrent caller may have committed the same immutable target.
      if (!existsSync(directory)) throw error
      return verifyNativeArtifacts(directory, entry)
    }
    return verifyNativeArtifacts(directory, entry)
  } finally {
    cancel.abort()
    await rm(staging, { recursive: true, force: true })
  }
}
