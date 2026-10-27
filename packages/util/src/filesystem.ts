import * as fs from "fs/promises"
import { createWriteStream, statSync } from "fs"
import { lookup } from "mime-types"
import { realpathSync } from "fs"
import { basename, dirname, isAbsolute, join, relative, resolve as pathResolve, sep } from "path"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import { toErrorMessage } from "./error-message"
import { Glob } from "./glob"
import { parseJsonResult } from "./json-value"
import { isRecord } from "./record"

export namespace Filesystem {
  export async function exists(p: string): Promise<boolean> {
    return fs
      .access(p)
      .then(() => true)
      .catch((err: NodeJS.ErrnoException) => {
        if (isMissingPathError(err)) return false
        throw err
      })
  }

  /** Executable access (X_OK); any failure, including a missing path, is false. */
  export async function isExecutable(p: string): Promise<boolean> {
    return fs
      .access(p, fs.constants.X_OK)
      .then(() => true)
      .catch(() => false)
  }

  export async function isDir(p: string): Promise<boolean> {
    return fs
      .stat(p)
      .then((stat) => stat.isDirectory())
      .catch((err) => {
        if (isMissingPathError(err)) return false
        throw err
      })
  }

  export function stat(p: string): ReturnType<typeof statSync> | undefined {
    return statSync(p, { throwIfNoEntry: false }) ?? undefined
  }

  export async function size(p: string): Promise<number> {
    const s = stat(p)?.size ?? 0
    return typeof s === "bigint" ? Number(s) : s
  }

  export async function readText(p: string): Promise<string> {
    return fs.readFile(p, "utf-8")
  }

  export async function readJson<T = any>(p: string): Promise<T> {
    const text = await fs.readFile(p, "utf-8")
    const parsed = parseJsonResult(text)
    if (!parsed.ok) {
      const { error } = parsed
      throw new Error(`Failed to parse JSON in ${p}: ${toErrorMessage(error)}`, {
        cause: error instanceof Error ? error : undefined,
      })
    }
    return parsed.value as T
  }

  export async function readBytes(p: string): Promise<Buffer> {
    return fs.readFile(p)
  }

  export async function readArrayBuffer(p: string): Promise<ArrayBuffer> {
    const buf = await fs.readFile(p)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }

  export function isEnoent(e: unknown): e is { code: "ENOENT" } {
    return isRecord(e) && e.code === "ENOENT"
  }

  export function isMissingPathError(e: unknown): e is { code: "ENOENT" | "ENOTDIR" } {
    return isRecord(e) && (e.code === "ENOENT" || e.code === "ENOTDIR")
  }

  export function errnoCode(error: unknown): string | undefined {
    if (!isRecord(error)) return undefined
    const code = error.code
    return typeof code === "string" ? code : undefined
  }

  export interface WriteOptions {
    /**
     * Publish through a symlink onto its final target instead of replacing the
     * link with a regular file (e.g. CLAUDE.md -> AGENTS.md). Opt-in: only a
     * caller that has already verified the link target is in bounds may set
     * it, or a repository-controlled link could redirect the write anywhere.
     * A dangling link has no target to preserve and is replaced.
     */
    followSymlink?: boolean
  }

  async function publishTarget(p: string, options?: WriteOptions) {
    if (!options?.followSymlink) return p
    const stat = await fs.lstat(p).catch(() => undefined)
    if (!stat?.isSymbolicLink()) return p
    return fs.realpath(p).catch((error: NodeJS.ErrnoException) => {
      // Only a dangling link falls back to replacing the link itself; any
      // other resolution failure (EACCES, ELOOP) must not silently do so.
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return p
      throw error
    })
  }

  export async function write(
    target: string,
    content: string | Buffer | Uint8Array,
    mode?: number,
    options?: WriteOptions,
  ): Promise<void> {
    const p = await publishTarget(target, options)
    const dir = dirname(p)
    const tmp = join(dir, `.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
    // Preserve the target's existing permissions on overwrite (e.g. a script's
    // executable bit, or a restrictive 0600) when the caller didn't request a
    // specific mode. Writing to a fresh temp file and renaming would otherwise
    // reset every edited file to the default umask mode.
    const resolvedMode =
      mode ??
      (await fs
        .stat(p)
        .then((s) => s.mode & 0o777)
        .catch(() => undefined))
    const writeOptions = resolvedMode !== undefined ? { mode: resolvedMode } : undefined
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(tmp, content, writeOptions)
      // Creation modes are filtered by umask; set the exact mode before publication.
      if (resolvedMode !== undefined) await fs.chmod(tmp, resolvedMode)
      await fs.rename(tmp, p)
    } catch (error) {
      if (isEnoent(error)) {
        try {
          await fs.mkdir(dir, { recursive: true })
          await fs.writeFile(tmp, content, writeOptions)
          if (resolvedMode !== undefined) await fs.chmod(tmp, resolvedMode)
          await fs.rename(tmp, p)
        } catch (retryError) {
          await fs.unlink(tmp).catch(() => {})
          throw retryError
        }
        return
      }
      await fs.unlink(tmp).catch(() => {})
      throw error
    }
  }

  export async function writeJson(p: string, data: unknown, mode?: number): Promise<void> {
    return write(p, JSON.stringify(data, null, 2), mode)
  }

  export async function writeStream(
    target: string,
    stream: ReadableStream<Uint8Array> | Readable,
    mode?: number,
    options?: WriteOptions,
  ): Promise<void> {
    const p = await publishTarget(target, options)
    const dir = dirname(p)
    const tmp = join(dir, `.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
    const resolvedMode =
      mode ??
      (await fs
        .stat(p)
        .then((s) => s.mode & 0o777)
        .catch(() => undefined))
    await fs.mkdir(dir, { recursive: true })

    const nodeStream = stream instanceof ReadableStream ? Readable.fromWeb(stream as any) : stream
    try {
      const writeStream = createWriteStream(tmp, resolvedMode !== undefined ? { mode: resolvedMode } : undefined)
      await pipeline(nodeStream, writeStream)
      // Preserve inherited permissions and explicit zero modes, including bits
      // masked off while creating the temporary file under a restrictive umask.
      if (resolvedMode !== undefined) await fs.chmod(tmp, resolvedMode)
      await fs.rename(tmp, p)
    } catch (error) {
      await fs.unlink(tmp).catch(() => {})
      throw error
    }
  }

  export function mimeType(p: string): string {
    return lookup(p) || "application/octet-stream"
  }

  /**
   * Normalize a path to its on-disk casing on case-insensitive platforms
   * (Windows and macOS). LSP servers, shells and users may spell a path with a
   * different casing than what is stored, and a case variant must not become a
   * second identity for the same directory (two instances, two `dir-<sha1>`
   * project ids). Linux filesystems are case-sensitive, so the input is
   * returned unchanged there.
   */
  export function normalizePath(p: string): string {
    if (process.platform !== "win32" && process.platform !== "darwin") return p
    return canonicalCase(p)
  }

  function canonicalCase(p: string): string {
    try {
      return realpathSync.native(p)
    } catch (error) {
      // A missing path has no casing of its own, but its deepest existing
      // ancestor does: a not-yet-created file under a miscased directory must
      // normalize the same way the directory does. Segments that do not exist
      // are appended as typed.
      if (!isEnoent(error) || !isAbsolute(p)) return p
      const parent = dirname(p)
      // A root has no ancestor left to canonicalize.
      if (parent === p) return p
      return join(canonicalCase(parent), basename(p))
    }
  }

  // We cannot rely on path.resolve() here because git.exe may come from Git Bash, Cygwin, or MSYS2, so we need to translate these paths at the boundary.
  // Also resolves symlinks and, on case-insensitive platforms, the on-disk
  // casing, so that callers using the result as a cache key always get the
  // same canonical path for a given physical directory.
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
    const origin = process.env.AX_CODE_ORIGINAL_CWD
    if (origin) return origin
    const current = process.cwd()
    const logical = process.env.PWD
    if (!logical || !isAbsolute(logical)) return current
    // Subprocess cwd does not update inherited PWD. Only preserve a logical
    // symlink spelling when it identifies the actual working directory.
    try {
      if (realpathSync(logical) === realpathSync(current)) return logical
    } catch {
      // PWD is an optional shell hint; unavailable paths cannot select a project.
    }
    return current
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
    return contains(a, b) || contains(b, a)
  }

  /**
   * True when a `path.relative` result escapes its base: an absolute path
   * (e.g. a different Windows drive), the parent itself, or a `..` hop. The
   * separator is required, so a sibling directory whose *name* merely starts
   * with dots (for example `..cache`) is treated as inside.
   */
  export function isOutsideRelative(rel: string): boolean {
    return isAbsolute(rel) || rel.startsWith("/") || rel === ".." || rel.startsWith(`..${sep}`)
  }

  export function contains(parent: string, child: string) {
    // Resolve both paths before comparison so redundant segments
    // (`//`, `./`, `../` anywhere in the input) don't cause false
    // positives/negatives. `path.relative` on unnormalized inputs
    // can return a path that starts with something other than `..`
    // yet still escape the parent. Note: this stays synchronous and
    // does NOT resolve symlinks — callers that need the stronger
    // guarantee must realpath() first.
    return !isOutsideRelative(relative(pathResolve(parent), pathResolve(child)))
  }

  /** Replace a containing home-directory prefix with `~` for display. */
  export function shortenHome(p: string, home: string) {
    if (!home) return p
    const resolvedHome = pathResolve(home)
    const resolvedPath = pathResolve(p)
    if (!contains(resolvedHome, resolvedPath)) return p
    const rel = relative(resolvedHome, resolvedPath)
    return rel ? join("~", rel) : "~"
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
      const matches = await Glob.scan(pattern, {
        cwd: current,
        absolute: true,
        include: "file",
        dot: true,
      })
      result.push(...matches)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
