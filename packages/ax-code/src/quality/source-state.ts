import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { git } from "../util/git"
import { Log } from "../util/log"
import type { SourceState } from "./verification-envelope"

const UNAVAILABLE: SourceState = { available: false, commit: null, dirtyDigest: null }
const MAX_FILES = 20_000
const MAX_BYTES = 128 * 1024 * 1024
const log = Log.create({ service: "verification.source-state" })

// Hash actual source bytes: porcelain alone cannot distinguish two edits to
// the same dirty file. The prefix prevents old status-only digests from being
// mistaken for fresh content evidence. Never modify the index or snapshot store.
export async function currentSourceState(
  worktreeRoot: string,
  vcs: string,
  sourcePaths?: readonly string[],
): Promise<SourceState> {
  if (vcs !== "git" && !sourcePaths?.length) return UNAVAILABLE
  try {
    const root = await fs.realpath(worktreeRoot)
    let commit: string | null = null
    let entries: string[]
    if (vcs === "git") {
      const files = await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root })
      if (files.exitCode !== 0) throw new Error("Cannot enumerate Git source files")
      entries = [
        ...new Set(
          files
            .text()
            .split("\0")
            .filter((file) => file && !file.startsWith(".ax-code/goals/")),
        ),
      ].sort()
      if (sourcePaths?.length) {
        const scopes = sourcePaths.map((scope) => {
          const absolute = path.resolve(root, scope)
          if (absolute !== root && !absolute.startsWith(root + path.sep))
            throw new Error("Source path escapes workspace")
          return path.relative(root, absolute).split(path.sep).join("/")
        })
        entries = entries.filter((file) =>
          scopes.some((scope) => !scope || file === scope || file.startsWith(`${scope}/`)),
        )
        // Explicit file inputs include ignored configuration and missing files.
        // Directory inputs retain Git's ignore semantics to avoid hashing build
        // outputs and dependencies. Name environment-sensitive ignored files
        // explicitly or assert them inside the project check.
        for (const scope of scopes) {
          try {
            if (!(await fs.lstat(path.join(root, scope))).isDirectory()) entries.push(scope)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            entries.push(scope)
          }
        }
        entries = [...new Set(entries)].sort()
      }
      const head = await git(["rev-parse", "--verify", "HEAD"], { cwd: root })
      commit = head.exitCode === 0 ? head.text().trim() || null : null
    } else {
      entries = [...new Set(sourcePaths)].sort()
    }
    const hash = createHash("sha256")
    let count = 0
    let bytes = 0
    const seen = new Set<string>()
    const visit = async (relative: string, depth = 0): Promise<void> => {
      if (depth > 64) throw new Error("Source directory depth exceeds fingerprint limit")
      const absolute = path.resolve(root, relative)
      if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new Error("Source path escapes workspace")
      if (seen.has(absolute)) return
      seen.add(absolute)
      if (++count > MAX_FILES) throw new Error("Source file count exceeds fingerprint limit")
      const normalized = path.relative(root, absolute).split(path.sep).join("/")
      let stat
      try {
        stat = await fs.lstat(absolute)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        hash.update(JSON.stringify([normalized, "missing"]))
        return
      }
      // Do not follow source symlinks or parent-directory symlinks into external
      // files. Such a checkout needs explicit project verification of that data.
      if (stat.isSymbolicLink() || (await fs.realpath(absolute)) !== absolute) {
        throw new Error("Linked source cannot be fingerprinted within the workspace")
      }
      if (stat.isDirectory()) {
        if (vcs === "git") throw new Error("Nested Git source requires an explicit verification scope")
        hash.update(JSON.stringify([normalized, "directory"]))
        const children = (await fs.readdir(absolute)).sort()
        for (const child of children) {
          if (child === ".git" || path.join(relative, child) === path.join(".ax-code", "goals")) continue
          await visit(path.join(relative, child), depth + 1)
        }
        return
      }
      if (!stat.isFile()) throw new Error("Special source files cannot be fingerprinted")
      bytes += stat.size
      if (bytes > MAX_BYTES) throw new Error("Source bytes exceed fingerprint limit")
      hash.update(JSON.stringify([normalized, stat.mode & 0o111, stat.size]))
      const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const opened = await handle.stat()
        if (opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("Source changed before fingerprinting")
        const buffer = Buffer.alloc(64 * 1024)
        let read = 0
        while (true) {
          const result = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - read + 1), null)
          if (!result.bytesRead) break
          read += result.bytesRead
          if (read > stat.size) throw new Error("Source changed during fingerprinting")
          hash.update(buffer.subarray(0, result.bytesRead))
        }
        const after = await handle.stat()
        if (read !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
          throw new Error("Source changed during fingerprinting")
        }
      } finally {
        await handle.close()
      }
    }
    for (const entry of entries) await visit(entry)
    return { available: true, commit, dirtyDigest: `content-v1:${hash.digest("hex")}` }
  } catch (error) {
    log.warn("source fingerprint unavailable", {
      reason: error instanceof Error ? error.message : "source read failed",
    })
    return UNAVAILABLE
  }
}
