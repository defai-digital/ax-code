import { chmod, mkdir, readFile, rename, unlink, writeFile } from "fs/promises"
import { createWriteStream, existsSync, statSync } from "fs"
import { lookup } from "mime-types"
import { realpathSync } from "fs"
import { dirname, join, relative, resolve as pathResolve } from "path"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import { Glob } from "./glob"

export namespace Filesystem {
  // Fast sync version for metadata checks
  export async function exists(p: string): Promise<boolean> {
    return existsSync(p)
  }

  export async function isDir(p: string): Promise<boolean> {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  }

  export function stat(p: string): ReturnType<typeof statSync> | undefined {
    return statSync(p, { throwIfNoEntry: false }) ?? undefined
  }

  export async function size(p: string): Promise<number> {
    const s = stat(p)?.size ?? 0
    return typeof s === "bigint" ? Number(s) : s
  }

  export async function readText(p: string): Promise<string> {
    return readFile(p, "utf-8")
  }

  export async function readJson<T = any>(p: string): Promise<T> {
    return JSON.parse(await readFile(p, "utf-8"))
  }

  export async function readBytes(p: string): Promise<Buffer> {
    return readFile(p)
  }

  export async function readArrayBuffer(p: string): Promise<ArrayBuffer> {
    const buf = await readFile(p)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }

  function isEnoent(e: unknown): e is { code: "ENOENT" } {
    return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT"
  }

  function temp(dir: string) {
    return join(dir, `.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
  }

  async function drop(p: string) {
    await unlink(p).catch(() => undefined)
  }

  export async function write(p: string, content: string | Buffer | Uint8Array, mode?: number): Promise<void> {
    const dir = dirname(p)
    const tmp = temp(dir)
    const opts = mode ? { mode } : undefined
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(tmp, content, opts)
      await rename(tmp, p)
    } catch (e) {
      if (!isEnoent(e)) {
        await drop(tmp)
        throw e
      }
      try {
        await mkdir(dir, { recursive: true })
        await writeFile(tmp, content, opts)
        await rename(tmp, p)
      } finally {
        await drop(tmp)
      }
    }
  }

  export async function writeJson(p: string, data: unknown, mode?: number): Promise<void> {
    return write(p, JSON.stringify(data, null, 2), mode)
  }

  export async function writeStream(
    p: string,
    stream: ReadableStream<Uint8Array> | Readable,
    mode?: number,
  ): Promise<void> {
    const dir = dirname(p)
    const tmp = temp(dir)
    await mkdir(dir, { recursive: true })

    const nodeStream = stream instanceof ReadableStream ? Readable.fromWeb(stream as any) : stream
    const sink = createWriteStream(tmp)
    try {
      await pipeline(nodeStream, sink)
      await rename(tmp, p)
    } finally {
      await drop(tmp)
    }

    if (mode) {
      await chmod(p, mode)
    }
  }

  export function mimeType(p: string): string {
    return lookup(p) || "application/octet-stream"
  }

  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    if (process.platform !== "win32") return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }

  // We cannot rely on path.resolve() here because git.exe may come from Git Bash, Cygwin, or MSYS2, so we need to translate these paths at the boundary.
  // Also resolves symlinks so that callers using the result as a cache key
  // always get the same canonical path for a given physical directory.
  export function resolve(p: string): string {
    const resolved = pathResolve(windowsPath(p))
    try {
      return normalizePath(realpathSync(resolved))
    } catch (e) {
      if (isEnoent(e)) return normalizePath(resolved)
      throw e
    }
  }

  /**
   * Returns the caller's original working directory, even when the process
   * was launched with --cwd pointing to the ax-code package root.
   * The global CLI wrapper sets AX_CODE_ORIGINAL_CWD before --cwd takes effect.
   */
  export function callerCwd(): string {
    return process.env.AX_CODE_ORIGINAL_CWD || process.env.PWD || process.cwd()
  }

  export function windowsPath(p: string): string {
    if (process.platform !== "win32") return p
    return (
      p
        .replace(/^\/([a-zA-Z]):(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
        // Git Bash for Windows paths are typically /<drive>/...
        .replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
        // Cygwin git paths are typically /cygdrive/<drive>/...
        .replace(/^\/cygdrive\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
        // WSL paths are typically /mnt/<drive>/...
        .replace(/^\/mnt\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
    )
  }
  export function overlaps(a: string, b: string) {
    const relA = relative(a, b)
    const relB = relative(b, a)
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    // Resolve both paths before comparison so redundant segments
    // (`//`, `./`, `../` anywhere in the input) don't cause false
    // positives/negatives. `path.relative` on unnormalized inputs
    // can return a path that starts with something other than `..`
    // yet still escape the parent. Note: this stays synchronous and
    // does NOT resolve symlinks — callers that need the stronger
    // guarantee must realpath() first.
    const rel = relative(pathResolve(parent), pathResolve(child))
    return !rel.startsWith("..") && !rel.startsWith("/")
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search)) result.push(search)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(search)) yield search
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      try {
        const matches = await Glob.scan(pattern, {
          cwd: current,
          absolute: true,
          include: "file",
          dot: true,
        })
        result.push(...matches)
      } catch {
        // Skip invalid glob patterns
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
