import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type { NativeLibraryPaths, NativeLibraryOptions, NativeTarget } from "ax-tui/native"

type Prepare = (target: NativeTarget, options: NativeLibraryOptions) => Promise<NativeLibraryPaths>
const DOWNLOAD_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const

export function nativeTarget(): NativeTarget {
  const platform = process.platform
  const arch = process.arch
  if (!["darwin", "linux", "win32"].includes(platform) || !["arm64", "x64"].includes(arch)) {
    throw new Error(`Unsupported test native target: ${platform}-${arch}`)
  }
  const musl =
    platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime
  return `${platform}-${arch}${musl ? "-musl" : ""}` as NativeTarget
}

export function transientNativeDownload(error: unknown) {
  if (!(error instanceof Error)) return false
  return (
    /^Cannot download ax-tui native artifact \((?:408|429|5\d\d)\): /.test(error.message) ||
    error.name === "TimeoutError" ||
    (error instanceof TypeError && error.message === "fetch failed")
  )
}

export async function prepareTestNative(input: {
  cacheDir: string
  target?: NativeTarget
  prepare?: Prepare
  delay?: (ms: number) => Promise<unknown>
}) {
  const cacheDir = path.resolve(input.cacheDir)
  const target = input.target ?? nativeTarget()
  const prepare = input.prepare ?? (await import("ax-tui/native")).prepareNativeLibrary
  const delay = input.delay ?? sleep
  for (let attempt = 1; ; attempt++) {
    try {
      await prepare(target, { cacheDir })
      // Confirm the immutable, manifest-verified cache is sufficient before
      // any test worker runs with isolated XDG paths and offline delivery.
      await prepare(target, { cacheDir, offline: true })
      return cacheDir
    } catch (error) {
      const waitMs = DOWNLOAD_RETRY_DELAYS_MS[attempt - 1]
      if (waitMs === undefined || !transientNativeDownload(error)) throw error
      console.warn(
        `TUI native dependency download failed transiently; retry ${attempt}/${DOWNLOAD_RETRY_DELAYS_MS.length} in ${waitMs}ms`,
      )
      await delay(waitMs)
    }
  }
}
