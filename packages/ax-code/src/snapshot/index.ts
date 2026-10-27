import fs from "fs/promises"
import { createHash } from "node:crypto"
import path from "path"
import z from "zod"
import { Config } from "../config/config"
import { DirectoryScope } from "../file/directory-scope"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import type { Shape } from "../project/instance"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { FileLock } from "../util/filelock"
import { git } from "../util/git"
import {
  parseLsTreePath,
  parseLsTreeSize,
  parseNameStatusLine,
  parseNumstatLine,
  type NumstatEntry,
} from "../util/git-output"
import { parseJsonFromText } from "../util/json-value"
import { Log } from "../util/log"
import { KeyedSerialQueue, work } from "../util/queue"
import { NamedError } from "@ax-code/util/error"
import { Bus } from "../bus"
import { NotificationEvent } from "../notification/events"
import { WindowsSnapshotPaths } from "./windows-paths"
import { retainedSnapshotHashes } from "./retention"
import {
  CapturePacker,
  PACK_TIMEOUT_MS,
  captureFailure,
  clearStaleSnapshotLocks,
  isCaptureCollision,
  recoverInterruptedCapture,
  removeCaptureMarker,
  withCaptureRetry,
  writeCaptureMarker,
} from "./capture-guards"

export namespace Snapshot {
  export const UnsupportedPathError = NamedError.create(
    "SnapshotUnsupportedWindowsPathError",
    z.object({ message: z.string(), paths: z.array(z.string()), snapshotStore: z.string() }),
  )
  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>

  const log = Log.create({ service: "snapshot" })
  const prune = "7.days"
  const pruneMs = 7 * 24 * 60 * 60 * 1000
  const maxFileSize = 1024 * 1024
  // Files above this size are left out of staging. Git streams anything past
  // core.bigFileThreshold (512 MB) into objects/pack/tmp_pack_*, and an
  // interrupted add strands that file at full size in the store.
  const defaultMaxStageBytes = 32 * 1024 * 1024
  // The per-file cap does not bound a directory of many mid-size files, so one
  // staging pass also stops admitting new content past this total.
  const defaultMaxAddBytes = 512 * 1024 * 1024
  // Snapshot stores are small, so repack long before git's 6700-loose default.
  const gcAutoThreshold = "gc.auto=1000"
  // Snapshot git subprocesses sit on the per-turn critical path; a hung git
  // (stalled mount, credential prompt, lock not matched by LOCK_CONTENTION)
  // must surface as a bounded error instead of freezing the whole session.
  // Process.run escalates SIGTERM -> SIGKILL and reports exit code 124.
  const gitTimeoutMs = 300_000
  // `git gc` is the one legitimately long-running snapshot command.
  const gcTimeoutMs = 30 * 60 * 1000
  // Bound checkout argv size. One git checkout per hash/chunk, not per file.
  const revertPathBatch = 32
  const core = ["-c", "core.longpaths=true", "-c", "core.symlinks=true"]
  const cfg = ["-c", "core.autocrlf=false", ...core]
  const quote = [...cfg, "-c", "core.quotepath=false"]
  // Directory instances in one project share a Git index. Serialize the entire
  // transaction by repository, not just individual Git commands or instances.
  const operations = new KeyedSerialQueue()
  const coverageNotice = new Set<string>()
  // Per-store packing counters and in-process capture markers (ADR-248).
  const packers = new Map<string, CapturePacker>()
  const capturing = new Set<string>()

  function packerFor(current: State) {
    const key = process.platform === "win32" ? current.gitdir.toLowerCase() : current.gitdir
    let packer = packers.get(key)
    if (!packer) {
      packer = new CapturePacker()
      packers.set(key, packer)
    }
    return { key, packer }
  }

  function warnCoverageOff(directory: string, kind: string, message: string) {
    const key = `${directory}\0${kind}`
    if (coverageNotice.has(key)) return
    coverageNotice.add(key)
    log.warn("snapshot coverage off", { directory, kind })
    Bus.publishDetached(NotificationEvent.ToastShow, {
      title: "Undo coverage off",
      message,
      variant: "warning",
      duration: 12_000,
    })
  }

  interface State {
    directory: string
    worktree: string
    gitdir: string
    vcs: Shape["project"]["vcs"]
    prevHash?: string
    projectID: Shape["project"]["id"]
    cleanupDelay?: ReturnType<typeof setTimeout>
    cleanupInterval?: ReturnType<typeof setInterval>
    disposed?: boolean
    warnedWindowsPaths?: string
    warnedOversized?: string
    /** Absolute path of the worktree's info/exclude; constant per worktree, so resolved with git once. */
    excludePath?: string
  }

  function maxStageBytes() {
    const mb = Flag.AX_CODE_SNAPSHOT_MAX_FILE_MB
    return mb === undefined ? defaultMaxStageBytes : Math.floor(mb * 1024 * 1024)
  }

  function maxAddBytes() {
    const mb = Flag.AX_CODE_SNAPSHOT_MAX_ADD_MB
    return mb === undefined ? defaultMaxAddBytes : Math.floor(mb * 1024 * 1024)
  }

  function valid(hash: string) {
    return /^[0-9a-f]{40}$/.test(hash)
  }

  function snapshotRef(hash: string) {
    return `refs/snapshots/${hash}`
  }

  function snapshotRefPath(current: State, ref: string) {
    if (!ref.startsWith("refs/snapshots/")) return
    return path.join(current.gitdir, ...ref.split("/"))
  }

  function snapshotMetaPath(current: State, hash: string) {
    return path.join(current.gitdir, "ax-code", "snapshots", hash)
  }

  async function runGit(args: string[], options?: { cwd?: string; env?: Record<string, string>; timeout?: number }) {
    const result = await git(args, {
      cwd: options?.cwd ?? Instance.directory,
      timeout: options?.timeout ?? gitTimeoutMs,
      ...(options?.env ? { env: options.env } : {}),
    })
    return {
      code: result.exitCode,
      text: result.text(),
      stderr: result.stderr.toString(),
    }
  }

  const state = Instance.state(
    async () => {
      const current = Instance.current
      const next: State = {
        directory: current.directory,
        worktree: current.worktree,
        gitdir: path.join(Filesystem.resolve(Global.Path.data), "snapshot", current.project.id),
        vcs: current.project.vcs,
        projectID: current.project.id,
      }

      const scheduleCleanup = () => {
        const cleanup = () =>
          withOperationLock(next, () => cleanupFor(next, { auto: true })).catch((error) => {
            log.warn("scheduled snapshot cleanup failed", { error })
          })
        next.cleanupDelay = setTimeout(() => {
          next.cleanupDelay = undefined
          if (next.disposed) return
          void cleanup()
          next.cleanupInterval = setInterval(
            () => {
              if (next.disposed) return
              void cleanup()
            },
            60 * 60 * 1000,
          )
          next.cleanupInterval.unref?.()
        }, 60 * 1000)
        next.cleanupDelay.unref?.()
      }

      scheduleCleanup()
      return next
    },
    async (entry) => {
      entry.disposed = true
      if (entry.cleanupDelay) {
        clearTimeout(entry.cleanupDelay)
        entry.cleanupDelay = undefined
      }
      if (entry.cleanupInterval) {
        clearInterval(entry.cleanupInterval)
        entry.cleanupInterval = undefined
      }
    },
  )

  function args(current: State, cmd: string[]) {
    return ["--git-dir", current.gitdir, "--work-tree", current.worktree, ...cmd]
  }

  async function exists(file: string) {
    return Filesystem.exists(file)
  }

  async function read(file: string) {
    return Filesystem.readText(file).catch((error) => {
      if (Filesystem.isEnoent(error)) return ""
      throw error
    })
  }

  async function remove(file: string) {
    await fs.rm(file, { force: true })
  }

  async function revertPath(current: State, file: string, realWorktree?: string) {
    const worktree = path.resolve(current.worktree)
    const resolved = path.resolve(worktree, file)
    if (resolved === worktree || !Filesystem.contains(worktree, resolved)) {
      throw new Error(`Snapshot revert path escapes the worktree: ${file}`)
    }

    const resolvedWorktree = realWorktree ?? (await fs.realpath(worktree))
    let parent = path.dirname(resolved)
    while (Filesystem.contains(worktree, parent)) {
      const realParent = await fs.realpath(parent).catch((error) => {
        if (Filesystem.isMissingPathError(error)) return undefined
        throw error
      })
      if (realParent) {
        if (!Filesystem.contains(resolvedWorktree, realParent)) {
          throw new Error(`Snapshot revert path escapes the worktree through a symlink: ${file}`)
        }
        break
      }
      if (parent === worktree) break
      parent = path.dirname(parent)
    }
    return resolved
  }

  async function writeSnapshotMeta(current: State, hash: string, timestamp = Date.now()) {
    const file = snapshotMetaPath(current, hash)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Filesystem.write(file, `${timestamp}\n`)
  }

  async function removeSnapshotMeta(current: State, hash: string) {
    await fs.rm(snapshotMetaPath(current, hash), { force: true }).catch(() => undefined)
  }

  function exclusionRecordPath(current: State, hash: string) {
    return path.join(current.gitdir, "ax-code", "excluded", hash)
  }

  /**
   * A captured tree records only what its staging pass admitted: a path left
   * out for size or budget keeps its last staged content, so the tree is not a
   * faithful baseline for it. Persist the excluded set per hash so
   * patch()/revert() can leave those paths alone instead of reverting them to
   * stale content. Records exist only for captures that excluded something; a
   * missing record (older captures) filters nothing.
   */
  async function writeExclusionRecord(current: State, hash: string, files: Skipped[]) {
    if (files.length === 0) return
    const file = exclusionRecordPath(current, hash)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Filesystem.write(file, JSON.stringify(files.map((skipped) => skipped.path)))
  }

  async function removeExclusionRecord(current: State, hash: string) {
    await fs.rm(exclusionRecordPath(current, hash), { force: true }).catch(() => undefined)
  }

  async function snapshotExclusions(current: State, hash: string): Promise<Set<string>> {
    const text = await Filesystem.readText(exclusionRecordPath(current, hash)).catch(() => undefined)
    if (!text) return new Set<string>()
    const parsed = z.array(z.string()).safeParse(parseJsonFromText(text))
    if (parsed.success) return new Set(parsed.data)
    // An unreadable record degrades to the pre-recording behavior instead of
    // blocking undo entirely.
    log.warn("failed to read snapshot exclusion record", { hash })
    return new Set<string>()
  }

  async function snapshotTimestamp(current: State, ref: string, hash: string) {
    const metaPath = snapshotMetaPath(current, hash)
    const metaValue = await Filesystem.readText(metaPath).catch(() => undefined)
    if (metaValue) {
      const timestamp = Number(metaValue.trim())
      if (Number.isFinite(timestamp) && timestamp > 0) return timestamp
      const meta = await fs.stat(metaPath).catch(() => undefined)
      if (meta) return meta.mtimeMs
    }
    const looseRef = snapshotRefPath(current, ref)
    const loose = looseRef ? await fs.stat(looseRef).catch(() => undefined) : undefined
    if (loose) {
      await writeSnapshotMeta(current, hash, loose.mtimeMs)
      return loose.mtimeMs
    }
    const packed = await fs.stat(path.join(current.gitdir, "packed-refs")).catch(() => undefined)
    if (!packed) return
    // Older installs have no per-snapshot metadata. Persist the one-time
    // packed-ref fallback so a later `git gc` cannot refresh every snapshot's
    // apparent age indefinitely.
    await writeSnapshotMeta(current, hash, packed.mtimeMs)
    return packed.mtimeMs
  }

  async function withOperationLock<T>(current: State, fn: () => Promise<T>): Promise<T> {
    const key = process.platform === "win32" ? current.gitdir.toLowerCase() : current.gitdir
    return operations.run(key, async () => {
      // Recovery, captures, restore and GC share an on-disk index across
      // processes. Never steal this lock from a live owner just due to age;
      // FileLock can reclaim it when the owning process has exited.
      // @scan-suppress security_scan - The operation lock uses fixed leaves within the managed snapshot store.
      using lock = await FileLock.acquire(path.join(current.gitdir, "ax-code", "operation"), {
        staleMs: Number.POSITIVE_INFINITY,
      })
      return await fn()
    })
  }

  async function blob(current: State, hash: string, file: string) {
    const tree = await runGit([...core, "--literal-pathspecs", ...args(current, ["ls-tree", "-l", hash, "--", file])], {
      cwd: current.worktree,
    })
    if (tree.code !== 0) throw new Error(`Snapshot content failed: ls-tree exited with code ${tree.code}`)
    const line = tree.text.trim()
    if (!line) return
    const size = parseLsTreeSize(line)
    if (size === undefined) return
    const separator = line.indexOf("\t")
    const object = line
      .slice(0, separator < 0 ? line.length : separator)
      .trim()
      .split(/\s+/)[2]
    if (!object || !/^[0-9a-f]{40,64}$/i.test(object)) {
      throw new Error("Snapshot content failed: ls-tree returned an invalid blob id")
    }
    return { object, size }
  }

  async function show(current: State, hash: string, file: string) {
    const entry = await blob(current, hash, file)
    if (entry === undefined || entry.size > maxFileSize) return ""
    // Do not pass a filename through Git's <tree-ish>:<path> revision syntax:
    // control characters are accepted by the filesystem but are parsed
    // differently by some Git versions. The object id is path-independent.
    const result = await runGit([...cfg, ...args(current, ["cat-file", "blob", entry.object])], {
      cwd: current.worktree,
    })
    if (result.code !== 0) throw new Error(`Snapshot content failed: cat-file exited with code ${result.code}`)
    return result.text
  }

  async function enabled() {
    // The home directory is not a real workspace: staging `git add .` over
    // $HOME routinely walks into unrelated, incomplete nested git repos
    // (e.g. tool caches with an unresolvable HEAD) and aborts the whole
    // prompt with a snapshot error the user never sees (#466). Skip it
    // entirely, like the matching guards in auto-index
    // (src/code-intelligence/auto-index.ts) and File.scan (src/file/index.ts).
    // Honor an explicit off switch before any filesystem walk or toast.
    if ((await Config.get()).snapshot === false) return false
    if (Instance.directory === Filesystem.resolve(Global.Path.home)) return false
    // Classify the snapshot worktree, not the session cwd. A git checkout
    // opened from a subdirectory that happens to contain nested clones
    // (examples/{a,b}, .internal/reference) is still a real project.
    if (await DirectoryScope.isMultiRepoParent(Instance.worktree)) {
      warnCoverageOff(
        Instance.worktree,
        "multi-repo-parent",
        "Undo coverage is off: this directory is a parent of multiple git repositories, not a repository itself. Open a specific repository for full undo coverage.",
      )
      return false
    }
    // Snapshots use their own Git store outside the worktree, so an ordinary
    // project directory does not need a .git directory to support undo/redo.
    return true
  }

  async function excludes(current: State) {
    if (current.vcs !== "git") return
    // Every capture and patch syncs the exclude file; the path itself never changes for a worktree,
    // so only a successful lookup is remembered (a failed one is retried on the next call).
    let file = current.excludePath
    if (!file) {
      const result = await runGit(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], {
        cwd: current.worktree,
      })
      file = result.code === 0 ? result.text.trim() : ""
      if (file) current.excludePath = file
    }
    if (!file) return
    if (!(await exists(file))) return
    return file
  }

  async function syncExclude(current: State) {
    const file = await excludes(current)
    const target = path.join(current.gitdir, "info", "exclude")
    await fs.mkdir(path.join(current.gitdir, "info"), { recursive: true })
    if (!file) {
      await Filesystem.write(target, "")
      return
    }
    await Filesystem.write(target, await read(file))
  }

  async function checkWindowsHistory(current: State, tree?: string) {
    if (!WindowsSnapshotPaths.enabled()) return
    const command = tree ? ["ls-tree", "-r", "--name-only", "-z", tree] : ["ls-files", "--cached", "-z"]
    const result = await runGit([...cfg, ...args(current, command)], { cwd: current.worktree })
    if (result.code !== 0) {
      throw new Error(`Snapshot Windows path check failed: ${command[0]} exited with code ${result.code}`)
    }
    const paths = WindowsSnapshotPaths.select(result.text)
    if (!paths.length) return
    throw new UnsupportedPathError({
      paths,
      snapshotStore: current.gitdir,
      message: `Unsupported Windows paths already exist in the ${tree ? "requested snapshot tree" : "snapshot index"}: ${paths.map((file) => JSON.stringify(file)).join(", ")}. No historical entries were removed. Back up the snapshot store at ${current.gitdir}, rename the affected project paths, and rebuild the snapshot index before retrying. An unsupported historical tree cannot be restored on Windows.`,
    })
  }

  /** Paths to leave out for Windows, plus the untracked listing when it was already scanned. */
  async function windowsExclusions(current: State): Promise<{ paths: string[]; untracked?: string[] }> {
    if (!WindowsSnapshotPaths.enabled()) return { paths: [] }
    // Inspect indexed and untracked paths together without discarding historical entries.
    const result = await runGit(
      [...cfg, ...args(current, ["ls-files", "--cached", "--others", "--exclude-standard", "-t", "-z"])],
      { cwd: current.worktree },
    )
    if (result.code !== 0) {
      throw new Error(`Snapshot Windows path check failed: git ls-files exited with code ${result.code}`)
    }
    const indexed: string[] = []
    const untracked: string[] = []
    for (const record of result.text.split("\0")) {
      if (!record) continue
      if (!/^[HSMRCK?] /.test(record) || record.length < 3) throw new Error("Invalid snapshot path inspection output")
      ;(record[0] === "?" ? untracked : indexed).push(record.slice(2))
    }
    const historicalPaths = WindowsSnapshotPaths.select(indexed.join("\0"))
    if (historicalPaths.length) {
      throw new UnsupportedPathError({
        paths: historicalPaths,
        snapshotStore: current.gitdir,
        message: `Unsupported Windows paths already exist in the snapshot index: ${historicalPaths.map((file) => JSON.stringify(file)).join(", ")}. No historical entries were removed. Back up the snapshot store at ${current.gitdir}, rename the affected project paths, and rebuild the snapshot index before retrying. An unsupported historical tree cannot be restored on Windows.`,
      })
    }
    const paths = WindowsSnapshotPaths.select(untracked.join("\0"))
    const signature = JSON.stringify(paths)
    if (paths.length && signature !== current.warnedWindowsPaths) {
      log.warn("unsupported Windows paths excluded from snapshot; rollback cannot restore these files", { paths })
      const names = paths.map((file) => JSON.stringify(file)).join(", ")
      Bus.publishDetached(NotificationEvent.ToastShow, {
        title: "Partial snapshot coverage",
        message: `Snapshot excludes ${paths.length} unsupported Windows path(s): ${names.length > 2000 ? `${names.slice(0, 2000)}… (full list in logs)` : names}. These files cannot be restored by rollback. Rename them to supported filenames to include them in future snapshots.`,
        variant: "warning",
        duration: 20_000,
      })
    }
    current.warnedWindowsPaths = signature
    return { paths, untracked }
  }

  type Skipped = { path: string; size: number; reason: "size" | "budget" }

  /**
   * Files that `git add` would stage (untracked, or tracked and modified) but
   * that must be left out: above the per-file cap, or past the total budget for
   * one pass (smallest files are admitted first, so source wins over artifacts;
   * the rest are retried by the next pass). Paths are worktree-relative.
   * Symlinks are measured with lstat because Git stores the link, not its target.
   */
  async function oversizedFiles(current: State, scanned?: string[]): Promise<Skipped[]> {
    const limit = maxStageBytes()
    const budget = maxAddBytes()
    // Reuse the untracked listing when the Windows path check already made it:
    // a snapshot pass performs a single `--others` scan of the worktree.
    const [untracked, modified] = await Promise.all([
      scanned
        ? undefined
        : runGit([...cfg, ...args(current, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."])], {
            cwd: current.worktree,
          }),
      runGit([...cfg, ...args(current, ["diff-files", "--name-only", "-z", "--", "."])], { cwd: current.worktree }),
    ])
    if ((untracked && untracked.code !== 0) || modified.code !== 0) {
      log.error("failed to list snapshot candidates", {
        cwd: current.worktree,
        untrackedCode: untracked?.code,
        modifiedCode: modified.code,
        stderr: untracked?.stderr || modified.stderr,
      })
      throw new Error("Snapshot staging failed: could not list files for the size check")
    }
    const names = [
      ...new Set([...(scanned ?? untracked!.text.split("\0")), ...modified.text.split("\0")].filter(Boolean)),
    ]
    const found: Skipped[] = []
    const admitted: { path: string; size: number }[] = []
    for (let offset = 0; offset < names.length; offset += 64) {
      const stats = await Promise.all(
        names.slice(offset, offset + 64).map((name) =>
          // A file deleted between listing and stat is not a staging candidate.
          fs.lstat(path.join(current.worktree, name)).then(
            (stat) => ({ name, size: stat.isFile() ? stat.size : 0 }),
            () => ({ name, size: 0 }),
          ),
        ),
      )
      for (const stat of stats) {
        if (stat.size > limit) found.push({ path: stat.name, size: stat.size, reason: "size" })
        else if (stat.size > 0) admitted.push({ path: stat.name, size: stat.size })
      }
    }
    let total = 0
    for (const file of admitted.sort((a, b) => a.size - b.size)) {
      total += file.size
      if (total > budget) found.push({ ...file, reason: "budget" })
    }
    return found
  }

  function reportOversized(current: State, files: Skipped[]) {
    const signature = JSON.stringify(files.map((file) => file.path))
    if (signature === current.warnedOversized) return
    current.warnedOversized = signature
    if (!files.length) return
    const limitMb = Math.round(maxStageBytes() / (1024 * 1024))
    const budgetMb = Math.round(maxAddBytes() / (1024 * 1024))
    const large = files.filter((file) => file.reason === "size")
    const deferred = files.length - large.length
    log.warn("files excluded from snapshot; rollback cannot restore these files", {
      limitMb,
      budgetMb,
      files: files.slice(0, 50),
      count: files.length,
    })
    const names = files
      .slice(0, 3)
      .map((file) => `${file.path} (${Math.round(file.size / (1024 * 1024))} MB)`)
      .join(", ")
    const why = [
      large.length ? `${large.length} file(s) larger than ${limitMb} MB` : "",
      deferred ? `${deferred} file(s) past the ${budgetMb} MB per-pass budget` : "",
    ]
      .filter(Boolean)
      .join(" and ")
    Bus.publishDetached(NotificationEvent.ToastShow, {
      title: "Partial snapshot coverage",
      message: `Snapshot skips ${why}: ${names}${files.length > 3 ? ", …" : ""}. Rollback cannot restore these files. Set AX_CODE_SNAPSHOT_MAX_FILE_MB or AX_CODE_SNAPSHOT_MAX_ADD_MB to raise the limits.`,
      variant: "warning",
      duration: 20_000,
    })
  }

  async function add(current: State, options?: { excludesSynced: boolean }): Promise<Skipped[]> {
    if (!options?.excludesSynced) await syncExclude(current)
    const windows = await windowsExclusions(current)
    const oversized = await oversizedFiles(current, windows.untracked)
    reportOversized(current, oversized)
    const nested = await DirectoryScope.nestedGitChildren(current.worktree, { includeDotDirs: true })
    const ignored = new Set<string>()
    // Git rejects even a negative pathspec that names an ignored, untracked
    // directory. Let ignore rules exclude those repositories; retain explicit
    // exclusions for all others, including already-indexed repositories.
    await work(8, nested, async (name) => {
      const result = await runGit([...cfg, ...args(current, ["check-ignore", "--quiet", "--", name])], {
        cwd: current.worktree,
      })
      if (result.code === 0) ignored.add(name)
      else if (result.code !== 1) {
        log.error("failed to inspect nested repository ignore rules", {
          cwd: current.worktree,
          exitCode: result.code,
          stderr: result.stderr,
        })
        throw new Error(`Snapshot staging failed: git check-ignore exited with code ${result.code}`)
      }
    })
    const excluded = [
      ...windows.paths,
      ...nested.filter((name) => !ignored.has(name)),
      ...oversized.map((file) => file.path),
    ]
    // Stage the whole worktree, not just `current.directory` — a session's
    // working directory can be a subdirectory of the git worktree (e.g. a
    // monorepo package), and edits outside it are explicitly permitted (see
    // Instance.isPathInProject). Scoping this to `current.directory` would
    // silently drop those files from every snapshot: `write-tree` never sees
    // them, so track()/patch()/diff() miss them and restore()/revert() can
    // never roll them back.
    // Keep potentially large exclusion sets out of Windows argv. NUL-separated
    // literal pathspecs preserve whitespace, newlines, and wildcard characters.
    let temporary: string | undefined
    let result: Awaited<ReturnType<typeof runGit>>
    try {
      const command = ["add", "."]
      if (excluded.length) {
        // @scan-suppress security_scan - gitdir is the managed snapshot directory; mkdtemp uses a fixed prefix and a random suffix.
        temporary = await fs.mkdtemp(path.join(current.gitdir, "pathspec-"))
        // @scan-suppress security_scan - temporary is the mkdtemp result above; paths is a fixed leaf, and excluded names only enter file contents.
        const file = path.join(temporary, "paths")
        await fs.writeFile(file, [".", ...excluded.map((name) => `:(top,exclude,literal)${name}`), ""].join("\0"))
        command.splice(1, 1, `--pathspec-from-file=${file}`, "--pathspec-file-nul")
      }
      result = await runGit([...cfg, ...args(current, command)], { cwd: current.worktree })
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true })
    }
    if (result.code === 0) return oversized
    log.error("failed to stage snapshot files", {
      cwd: current.worktree,
      exitCode: result.code,
      stderr: result.stderr,
    })
    throw captureFailure("Snapshot staging failed: git add", result.code, result.stderr)
  }

  async function checkoutIndex(current: State) {
    return runGit([...core, ...args(current, ["checkout-index", "-a", "-f"])], {
      cwd: current.worktree,
    })
  }

  // Stores created before `--template=` carry about 64 KB of sample hooks that
  // Git never runs. Only a hooks directory made of `*.sample` files is removed.
  async function dropSampleHooks(current: State) {
    const dir = path.join(current.gitdir, "hooks")
    const names = await fs.readdir(dir).catch(() => undefined)
    if (!names?.length || !names.every((name) => name.endsWith(".sample"))) return
    await fs.rm(dir, { recursive: true, force: true }).catch((error) => {
      log.warn("failed to remove sample hooks from snapshot store", { error })
    })
  }

  async function cleanupFor(current: State, options?: { auto?: boolean }) {
    if (!(await enabled())) return
    if (!(await exists(current.gitdir))) return
    await dropSampleHooks(current)
    const cutoff = Date.now() - pruneMs
    let deletedRefs = 0
    const refs = await runGit(
      [...core, ...args(current, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/snapshots"])],
      {
        cwd: current.directory,
      },
    )
    if (refs.code !== 0) {
      log.warn("failed to list snapshot refs", {
        exitCode: refs.code,
        stderr: refs.stderr,
      })
      return
    } else {
      let retained: Set<string>
      try {
        retained = retainedSnapshotHashes(current.projectID)
      } catch (error) {
        // Never interpret an unreadable registry/shard as no live references.
        log.warn("snapshot cleanup skipped: retained references could not be read", { error })
        return
      }
      const existing = new Set(
        refs.text
          .trim()
          .split("\n")
          .map((line) => line.trim().split(/\s+/, 2)[1]),
      )
      // Older cleanup versions may have removed refs while objects still exist.
      // Pin those objects again before GC; a failed pin must not permit pruning.
      for (const hash of retained) {
        if (existing.has(hash)) continue
        // A retained hash whose object is already gone (never written, or
        // pruned by an earlier gc) can never be pinned, and leaving it unpinned
        // cannot lose anything. Skip it and keep going: returning here would
        // let one stale reference disable pruning for every other ref, so the
        // snapshot store would grow without bound.
        const object = await runGit([...core, ...args(current, ["cat-file", "-e", hash])], {
          cwd: current.directory,
        })
        if (object.code !== 0) {
          log.warn("retained snapshot object is missing; skipping pin", { hash })
          continue
        }
        const pin = await runGit([...core, ...args(current, ["update-ref", snapshotRef(hash), hash])], {
          cwd: current.directory,
        })
        if (pin.code !== 0) {
          log.warn("snapshot cleanup skipped: retained snapshot could not be pinned", { hash, stderr: pin.stderr })
          return
        }
        await writeSnapshotMeta(current, hash)
      }
      for (const line of refs.text.trim().split("\n")) {
        if (!line) continue
        const [ref, hash] = line.trim().split(/\s+/, 2)
        if (!ref || !hash) continue
        if (hash === current.prevHash || retained.has(hash)) continue
        const timestamp = await snapshotTimestamp(current, ref, hash)
        if (!timestamp || timestamp >= cutoff) continue
        const deleted = await runGit([...core, ...args(current, ["update-ref", "-d", ref])], { cwd: current.directory })
        if (deleted.code !== 0) {
          log.warn("failed to delete expired snapshot ref", {
            ref,
            exitCode: deleted.code,
            stderr: deleted.stderr,
          })
          continue
        }
        await removeSnapshotMeta(current, hash)
        await removeExclusionRecord(current, hash)
        deletedRefs++
      }
      if (deletedRefs > 0) log.info("deleted expired snapshot refs", { deletedRefs, prune })
    }
    // `gc --auto` returns without pruning while git's loose-object and pack
    // thresholds are unmet, so it alone never removes stranded tmp_pack_* files
    // or expired unreachable objects. Prune explicitly; it neither repacks nor
    // touches anything newer than the retention window.
    const pruned = await runGit(args(current, ["prune", `--expire=${prune}`]), {
      cwd: current.directory,
      timeout: gcTimeoutMs,
    })
    if (pruned.code !== 0) {
      log.warn("snapshot prune failed", { exitCode: pruned.code, stderr: pruned.stderr })
    }
    // The scheduled path uses `gc --auto` so the hourly timer only repacks
    // when git's own thresholds are exceeded; an unconditional full repack
    // can hold the shared serial operation queue (and therefore the next
    // turn's track()/patch()) for seconds to minutes on large stores. Expiring
    // refs is the one event that makes a full repack worthwhile, because the
    // objects they pinned become reclaimable.
    const full = !options?.auto || deletedRefs > 0
    const result = await runGit(
      ["-c", gcAutoThreshold, ...args(current, ["gc", ...(full ? [] : ["--auto"]), `--prune=${prune}`])],
      {
        cwd: current.directory,
        timeout: gcTimeoutMs,
      },
    )
    if (result.code !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.code,
        stderr: result.stderr,
      })
      return
    }
    log.info("cleanup", { prune })
  }

  async function ensureRepo(current: State) {
    // mkdir can survive a failed or interrupted init; the directory alone is
    // not evidence that Git has initialized the snapshot store.
    // @scan-suppress security_scan - gitdir is the managed snapshot directory and HEAD is a fixed leaf.
    const existed = await exists(path.join(current.gitdir, "HEAD"))
    await fs.mkdir(current.gitdir, { recursive: true })
    if (existed) return

    // Snapshot identifiers have a persisted 40-character SHA-1 contract,
    // independent of the user's default object format for new repositories.
    // An empty template skips the ~64 KB of sample hooks Git copies into
    // every new store; a user's init.templateDir would otherwise do the same.
    const initialized = await runGit(["init", "--object-format=sha1", "--template="], {
      cwd: current.worktree,
      env: { GIT_DIR: current.gitdir, GIT_WORK_TREE: current.worktree },
    })
    if (initialized.code !== 0) {
      log.error("failed to initialize snapshot store", {
        gitdir: current.gitdir,
        exitCode: initialized.code,
        stderr: initialized.stderr,
      })
      throw new Error(`Snapshot initialization failed: git init exited with code ${initialized.code}`)
    }
    await runGit(["--git-dir", current.gitdir, "config", "core.autocrlf", "false"], { cwd: current.worktree })
    await runGit(["--git-dir", current.gitdir, "config", "core.longpaths", "true"], { cwd: current.worktree })
    await runGit(["--git-dir", current.gitdir, "config", "core.symlinks", "true"], { cwd: current.worktree })
    await runGit(["--git-dir", current.gitdir, "config", "core.fsmonitor", "false"], { cwd: current.worktree })
    log.info("initialized")
  }

  export async function init() {
    await state()
  }

  export async function cleanup() {
    const current = await state()
    await withOperationLock(current, () => cleanupFor(current))
  }

  /**
   * Scheduled variant of cleanup(): runs `git gc --auto` so the periodic
   * timer skips the repack unless git's thresholds are exceeded. Exported
   * for tests; the in-process timer calls cleanupFor with the same options.
   */
  export async function cleanupScheduled() {
    const current = await state()
    await withOperationLock(current, () => cleanupFor(current, { auto: true }))
  }

  /**
   * Pack the store with a bounded `gc --auto`. Skipped while a capture runs and
   * while another pack is in flight; failures are logged, never thrown.
   */
  async function maybePack(current: State) {
    const { key, packer } = packerFor(current)
    await packer.maybePack(
      async () => {
        const result = await runGit(["-c", gcAutoThreshold, ...args(current, ["gc", "--auto"])], {
          cwd: current.directory,
          timeout: PACK_TIMEOUT_MS,
        })
        if (result.code !== 0) log.warn("snapshot packing failed", { exitCode: result.code, stderr: result.stderr })
        else log.info("packed snapshot store", { captures: packer.captures })
      },
      { capturing: capturing.has(key) },
    )
  }

  async function captureOnce(current: State, options?: { requireFresh?: boolean }) {
    if (!(await enabled())) return

    await ensureRepo(current)

    if (current.prevHash) {
      await checkWindowsHistory(current)
      // HEAD stays unborn in this tree-only repository. Compare against the
      // recorded tree, including work outside a session's subdirectory and
      // files newly admitted by ignore rules. patch/restore may change the
      // index independently of prevHash, so index cleanliness is insufficient.
      await syncExclude(current)
      const diff = await runGit(
        [...cfg, ...args(current, ["diff", "--no-ext-diff", "--quiet", current.prevHash, "--", "."])],
        { cwd: current.worktree },
      )
      if (diff.code !== 0 && diff.code !== 1) {
        log.error("failed to inspect snapshot diff", {
          cwd: current.worktree,
          exitCode: diff.code,
          stderr: diff.stderr,
        })
        throw new Error(`Snapshot diff failed: git diff exited with code ${diff.code}`)
      }
      if (diff.code === 0) {
        const untracked = await runGit(
          [...cfg, ...args(current, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."])],
          { cwd: current.worktree },
        )
        if (untracked.code !== 0) {
          log.error("failed to inspect snapshot untracked files", {
            cwd: current.worktree,
            exitCode: untracked.code,
            stderr: untracked.stderr,
          })
          throw new Error(`Snapshot untracked check failed: git ls-files exited with code ${untracked.code}`)
        }
        if (untracked.text.length === 0 && (await snapshotExclusions(current, current.prevHash)).size === 0) {
          log.info("tracking (unchanged)", { hash: current.prevHash })
          return current.prevHash
        }
      }
    }

    let staged: Skipped[] = []
    try {
      staged = await add(current, { excludesSynced: Boolean(current.prevHash) })
    } catch (error) {
      // A lock collision is transient: rethrow so withCaptureRetry in
      // track() retries it (ADR-248). Only genuine staging failures degrade
      // to "no new baseline" (eb17f9804).
      if (isCaptureCollision(error)) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (!message.startsWith("Snapshot staging failed")) throw error
      if (options?.requireFresh) throw error
      warnCoverageOff(
        current.worktree,
        "staging-failed",
        "Undo coverage is off this turn: snapshot staging failed. The session continues without a new rollback baseline.",
      )
      log.warn("snapshot staging failed; continuing without a new baseline", {
        cwd: current.worktree,
        error,
      })
      return current.prevHash
    }
    const result = await runGit(args(current, ["write-tree"]), { cwd: current.directory })
    if (result.code !== 0) {
      log.error("failed to write snapshot tree", {
        cwd: current.directory,
        exitCode: result.code,
        stderr: result.stderr,
      })
      throw captureFailure("Snapshot tracking failed: write-tree", result.code, result.stderr)
    }
    let hash = result.text.trim()
    if (!valid(hash)) {
      log.error("failed to validate snapshot tree hash", { hash })
      throw new Error("Snapshot tracking failed: write-tree returned an invalid hash")
    }
    // Tree content alone cannot identify capture coverage. Preserve older
    // exclusion records and give each excluded set a stable Git object identity.
    // Git accepts these parentless commits anywhere it accepts a tree-ish.
    if (staged.length > 0 || (await snapshotExclusions(current, hash)).size > 0) {
      const coverage = createHash("sha256")
        .update(JSON.stringify(staged.map((file) => file.path).sort()))
        .digest("hex")
      const identity = await runGit(
        args(current, ["commit-tree", hash, "-m", `AX Code snapshot coverage ${coverage}`]),
        {
          cwd: current.worktree,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
            GIT_AUTHOR_NAME: "AX Code",
            GIT_AUTHOR_EMAIL: "snapshot@ax-code.local",
            GIT_COMMITTER_NAME: "AX Code",
            GIT_COMMITTER_EMAIL: "snapshot@ax-code.local",
            GIT_AUTHOR_DATE: "@0 +0000",
            GIT_COMMITTER_DATE: "@0 +0000",
          },
        },
      )
      if (identity.code !== 0)
        throw captureFailure("Snapshot tracking failed: commit-tree", identity.code, identity.stderr)
      hash = identity.text.trim()
      if (!valid(hash)) throw new Error("Snapshot tracking failed: commit-tree returned an invalid hash")
    }
    const updateRef = await runGit([...core, ...args(current, ["update-ref", snapshotRef(hash), hash])], {
      cwd: current.directory,
    })
    if (updateRef.code !== 0) {
      log.error("failed to update snapshot ref", {
        hash,
        gitdir: current.gitdir,
        exitCode: updateRef.code,
        stderr: updateRef.stderr,
      })
      throw captureFailure("Snapshot tracking failed: update-ref", updateRef.code, updateRef.stderr)
    }
    await writeSnapshotMeta(current, hash)
    await writeExclusionRecord(current, hash, staged)
    current.prevHash = hash
    log.info("tracking", { hash, cwd: current.directory, git: current.gitdir })
    return hash
  }

  /**
   * Capture the worktree as a rollback baseline. Normal turns fail open: a
   * staging failure keeps the previous baseline so chat continues. Destructive
   * callers pass `requireFresh` because restoring from a stale baseline would
   * overwrite edits made after that baseline.
   */
  export async function track(options?: { requireFresh?: boolean }) {
    // A disabled snapshot must not create even the operation-lock directory.
    if (!(await enabled())) return
    const current = await state()
    return withOperationLock(current, async () => {
      if (!(await enabled())) return
      const { key, packer } = packerFor(current)
      capturing.add(key)
      try {
        // ADR-248: a leftover marker means a previous capture was interrupted;
        // its partial index is discarded before this attempt stages anything.
        if (await recoverInterruptedCapture({ gitdir: current.gitdir })) {
          log.warn("discarded interrupted snapshot capture", { gitdir: current.gitdir })
        }
        await clearStaleSnapshotLocks({ gitdir: current.gitdir })
        await writeCaptureMarker(current.gitdir, { pid: process.pid, startedAt: Date.now() })
        // A failed attempt leaves the marker in place on purpose: if the
        // process dies next, the following run discards its partial state.
        const hash = await withCaptureRetry(() => captureOnce(current, options))
        await removeCaptureMarker(current.gitdir)
        if (packer.recordSuccess()) {
          capturing.delete(key)
          await maybePack(current)
        }
        return hash
      } finally {
        capturing.delete(key)
      }
    })
  }

  export async function patch(hash: string) {
    const current = await state()
    return withOperationLock(current, async () => {
      if (!valid(hash)) {
        log.warn("failed to get diff", { hash, error: "invalid snapshot hash" })
        return { hash, files: [] }
      }
      if (hash === current.prevHash) {
        await checkWindowsHistory(current)
        // Unchanged short-circuit mirroring track(): when the requested
        // baseline is the last tracked tree and the worktree is clean against
        // it, staging and diffing can only produce an empty file list. Any
        // check failure falls through to the full path below, preserving the
        // existing error behavior.
        await syncExclude(current)
        const quiet = await runGit([...cfg, ...args(current, ["diff", "--no-ext-diff", "--quiet", hash, "--", "."])], {
          cwd: current.worktree,
        })
        if (quiet.code === 0) {
          const untracked = await runGit(
            [...cfg, ...args(current, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."])],
            { cwd: current.worktree },
          )
          if (untracked.code === 0 && untracked.text.length === 0) {
            log.info("patch (unchanged)", { hash })
            return { hash, files: [] }
          }
        }
      }
      await add(current)
      // Diff the whole worktree (see add() above) — a "." pathspec scoped to
      // current.directory would silently exclude files changed outside the
      // session's working directory from the returned patch.
      const result = await runGit(
        [...quote, ...args(current, ["diff", "--no-ext-diff", "--name-only", "-z", hash, "--", "."])],
        {
          cwd: current.worktree,
        },
      )
      if (result.code !== 0) {
        log.warn("failed to get diff", { hash, exitCode: result.code })
        return { hash, files: [] }
      }
      // Paths the baseline's staging pass excluded are not faithfully recorded
      // in it; diffing the worktree against such a tree reports drift the turn
      // never made, and reverting it would overwrite current content with the
      // stale last-staged bytes. Leave them out of the patch.
      const excluded = await snapshotExclusions(current, hash)
      return {
        hash,
        files: result.text
          .split("\0")
          .filter(Boolean)
          .filter((item) => {
            if (!excluded.has(item)) return true
            log.warn("skipped file excluded from the snapshot baseline in patch", { hash, file: item })
            return false
          })
          .map((item) => path.join(current.worktree, item).split(path.sep).join("/")),
      }
    })
  }

  export async function restore(snapshot: string) {
    const current = await state()
    return withOperationLock(current, async () => {
      if (!valid(snapshot)) {
        log.error("failed to restore snapshot", {
          snapshot,
          stderr: "invalid snapshot hash",
        })
        return
      }
      log.info("restore", { commit: snapshot })
      await checkWindowsHistory(current, snapshot)
      await add(current)
      const savedTree = await runGit([...core, ...args(current, ["write-tree"])], { cwd: current.worktree })
      if (savedTree.code !== 0) {
        log.error("failed to prepare snapshot restore rollback", {
          snapshot,
          exitCode: savedTree.code,
          stderr: savedTree.stderr,
        })
        throw new Error(`Snapshot restore failed: write-tree exited with code ${savedTree.code}`)
      }
      const rollbackTree = savedTree.text.trim()
      const introduced = await runGit(
        [
          ...quote,
          ...args(current, [
            "diff",
            "--no-ext-diff",
            "--no-renames",
            "--name-only",
            "-z",
            "--diff-filter=A",
            rollbackTree,
            snapshot,
            "--",
            ".",
          ]),
        ],
        { cwd: current.worktree },
      )
      if (introduced.code !== 0) {
        log.error("failed to identify files introduced by snapshot restore", {
          snapshot,
          rollbackTree,
          exitCode: introduced.code,
          stderr: introduced.stderr,
        })
        throw new Error(`Snapshot restore failed: rollback diff exited with code ${introduced.code}`)
      }
      const introducedFiles = await Promise.all(
        introduced.text
          .split("\0")
          .filter(Boolean)
          .map((file) => revertPath(current, file)),
      )
      const result = await runGit([...core, ...args(current, ["read-tree", snapshot])], { cwd: current.worktree })
      if (result.code === 0) {
        const checkout = await checkoutIndex(current)
        if (checkout.code === 0) return
        const rollback = await runGit([...core, ...args(current, ["read-tree", rollbackTree])], {
          cwd: current.worktree,
        })
        if (rollback.code !== 0) {
          log.error("failed to rollback snapshot index after restore failure", {
            snapshot,
            rollbackTree,
            exitCode: rollback.code,
            stderr: rollback.stderr,
          })
        } else {
          for (const file of introducedFiles) {
            await remove(file).catch((rollbackError) => {
              log.error("failed to remove introduced file while rolling back snapshot restore", {
                snapshot,
                rollbackTree,
                file,
                error: rollbackError,
              })
            })
          }
          const rollbackCheckout = await checkoutIndex(current)
          if (rollbackCheckout.code !== 0) {
            log.error("failed to rollback snapshot working tree after restore failure", {
              snapshot,
              rollbackTree,
              exitCode: rollbackCheckout.code,
              stderr: rollbackCheckout.stderr,
            })
          }
        }
        log.error("failed to restore snapshot", {
          snapshot,
          exitCode: checkout.code,
          stderr: checkout.stderr,
        })
        throw new Error(`Snapshot restore failed: checkout-index exited with code ${checkout.code}`)
      }
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: result.code,
        stderr: result.stderr,
      })
      throw new Error(`Snapshot restore failed: read-tree exited with code ${result.code}`)
    })
  }

  /**
   * A restore can be blocked by a directory at the target path (the turn
   * replaced a snapshot file with a directory). Only a now-empty directory is
   * removed; one with content fails the revert closed — a directory holding
   * user content must never be recursively deleted (see "revert refuses to
   * recursively delete a directory that replaced a new file").
   */
  async function clearRestoreTarget(file: string) {
    const stat = await fs.lstat(file).catch(() => undefined)
    if (!stat?.isDirectory()) return
    try {
      // Only a path explicitly being restored as a file may lose its empty
      // directory tree. Ordinary file deletion must preserve pre-existing cwd
      // and user directories, which Git trees do not record.
      const entries = await fs.readdir(file, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) throw new Error(`Snapshot revert failed: ${file} is a non-empty directory`)
        await clearRestoreTarget(path.join(file, entry.name))
      }
      await fs.rmdir(file)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOTEMPTY" || code === "EEXIST") {
        throw new Error(`Snapshot revert failed: ${file} is a non-empty directory`)
      }
      throw error
    }
  }

  export async function revert(patches: Patch[]) {
    const current = await state()
    return withOperationLock(current, async () => {
      const seen = new Set<string>()
      const targets: Array<{ file: string; hash: string }> = []
      const realWorktree = await fs.realpath(path.resolve(current.worktree))
      // Hand-built or persisted patches can still name a path their baseline
      // excluded from staging; reverting it would write that tree's stale
      // last-staged content over the file's current bytes.
      const exclusions = new Map<string, Set<string>>()
      for (const item of patches) {
        if (!valid(item.hash)) continue
        for (const requestedFile of item.files) {
          const file = await revertPath(current, requestedFile, realWorktree)
          if (seen.has(file)) continue
          seen.add(file)
          let excluded = exclusions.get(item.hash)
          if (!excluded) {
            excluded = await snapshotExclusions(current, item.hash)
            exclusions.set(item.hash, excluded)
          }
          const rel = path.relative(current.worktree, file).split(path.sep).join("/")
          if (excluded.has(rel)) {
            log.warn("skipped file excluded from the snapshot baseline in revert", { hash: item.hash, file: rel })
            continue
          }
          targets.push({ file, hash: item.hash })
        }
      }
      if (targets.length === 0) return

      for (const hash of new Set(targets.map((target) => target.hash))) {
        const object = await runGit([...core, ...args(current, ["cat-file", "-e", `${hash}^{tree}`])], {
          cwd: current.worktree,
        })
        if (object.code === 0) continue
        log.error("snapshot object is unavailable", { hash, exitCode: object.code, stderr: object.stderr })
        throw new Error(`Snapshot revert failed: snapshot object is unavailable: ${hash}`)
      }

      current.prevHash = undefined
      await add(current)
      const savedTree = await runGit([...core, ...args(current, ["write-tree"])], { cwd: current.worktree })
      if (savedTree.code !== 0) {
        log.error("failed to prepare snapshot revert rollback", {
          exitCode: savedTree.code,
          stderr: savedTree.stderr,
        })
        throw new Error(`Snapshot revert failed: write-tree exited with code ${savedTree.code}`)
      }
      const rollbackTree = savedTree.text.trim()
      const applied: typeof targets = []

      const applyTarget = async (target: (typeof targets)[number]) => {
        log.info("reverting", target)
        const rel = path.relative(current.worktree, target.file)
        await clearRestoreTarget(target.file)
        // Patch paths name individual files, including brackets used in routes.
        // Git's `--` ends options but still expands wildcard and magic pathspecs.
        const result = await runGit(
          [...core, "--literal-pathspecs", ...args(current, ["checkout", target.hash, "--", rel])],
          {
            cwd: current.worktree,
          },
        )
        if (result.code !== 0) {
          const tree = await runGit(
            [...core, "--literal-pathspecs", ...args(current, ["ls-tree", target.hash, "--", rel])],
            {
              cwd: current.worktree,
            },
          )
          if (tree.code !== 0) {
            log.error("failed to inspect file in snapshot", {
              file: target.file,
              hash: target.hash,
              exitCode: tree.code,
              stderr: tree.stderr,
            })
            throw new Error(`Snapshot revert failed for ${target.file}: ls-tree exited with code ${tree.code}`)
          }
          if (tree.text.trim()) {
            log.error("file existed in snapshot but checkout failed", {
              file: target.file,
              hash: target.hash,
              exitCode: result.code,
              stderr: result.stderr,
            })
            throw new Error(`Snapshot revert failed for ${target.file}: checkout exited with code ${result.code}`)
          }
          log.info("file did not exist in snapshot, deleting", target)
          await remove(target.file)
        }
      }

      const applyHashGroup = async (hash: string, group: typeof targets) => {
        for (let offset = 0; offset < group.length; offset += revertPathBatch) {
          const chunk = group.slice(offset, offset + revertPathBatch)
          const rels = chunk.map((target) => path.relative(current.worktree, target.file))
          const tree = await runGit(
            [...core, "--literal-pathspecs", ...args(current, ["ls-tree", "-z", hash, "--", ...rels])],
            { cwd: current.worktree },
          )
          if (tree.code !== 0) {
            for (const target of chunk) {
              applied.push(target)
              await applyTarget(target)
            }
            continue
          }
          const present = new Set<string>()
          for (const record of tree.text.split("\0")) {
            const file = parseLsTreePath(record, { nulDelimited: true })
            if (file) present.add(file)
          }
          const restore: typeof chunk = []
          const missing: typeof chunk = []
          for (let index = 0; index < chunk.length; index++) {
            const rel = rels[index]!.split(path.sep).join("/")
            if (present.has(rel)) restore.push(chunk[index]!)
            else missing.push(chunk[index]!)
          }
          // Deletions run before restores: a restore can create or replace
          // the path a deletion still needs (EISDIR), while a deletion can
          // free a path a restore needs for a file (ENOTDIR).
          for (const target of missing) {
            applied.push(target)
            log.info("file did not exist in snapshot, deleting", target)
            await remove(target.file)
          }
          if (restore.length > 0) {
            applied.push(...restore)
            for (const target of restore) await clearRestoreTarget(target.file)
            const restoreRels = restore.map((target) => path.relative(current.worktree, target.file))
            const result = await runGit(
              [...core, "--literal-pathspecs", ...args(current, ["checkout", hash, "--", ...restoreRels])],
              { cwd: current.worktree },
            )
            if (result.code !== 0) {
              for (const target of restore) await applyTarget(target)
            }
          }
        }
      }

      try {
        const byHash = new Map<string, typeof targets>()
        for (const target of targets) {
          const group = byHash.get(target.hash)
          if (group) group.push(target)
          else byHash.set(target.hash, [target])
        }
        for (const [hash, group] of byHash) await applyHashGroup(hash, group)
      } catch (error) {
        const rollback = await runGit([...core, ...args(current, ["read-tree", rollbackTree])], {
          cwd: current.worktree,
        })
        if (rollback.code !== 0) {
          log.error("failed to rollback snapshot index after revert failure", {
            rollbackTree,
            exitCode: rollback.code,
            stderr: rollback.stderr,
          })
        } else {
          for (const target of applied) {
            const rel = path.relative(current.worktree, target.file)
            const tree = await runGit(
              [...core, "--literal-pathspecs", ...args(current, ["ls-tree", rollbackTree, "--", rel])],
              {
                cwd: current.worktree,
              },
            )
            if (tree.code !== 0) {
              log.error("failed to inspect file while rolling back snapshot revert", {
                file: target.file,
                rollbackTree,
                exitCode: tree.code,
                stderr: tree.stderr,
              })
              continue
            }
            if (!tree.text.trim()) {
              await remove(target.file).catch((rollbackError) => {
                log.error("failed to remove file while rolling back snapshot revert", {
                  file: target.file,
                  rollbackTree,
                  error: rollbackError,
                })
              })
              continue
            }
            const checkout = await runGit([...core, ...args(current, ["checkout-index", "-f", "--", rel])], {
              cwd: current.worktree,
            })
            if (checkout.code !== 0) {
              log.error("failed to restore file while rolling back snapshot revert", {
                file: target.file,
                rollbackTree,
                exitCode: checkout.code,
                stderr: checkout.stderr,
              })
            }
          }
        }
        throw error
      }
    })
  }

  export async function previewRevert(patches: Patch[]) {
    const current = await state()
    const baselines = new Map<string, { hash: string; file: string }>()
    const realWorktree = patches.some((item) => valid(item.hash) && item.files.length > 0)
      ? await fs.realpath(path.resolve(current.worktree))
      : undefined
    for (const item of patches) {
      if (!valid(item.hash)) continue
      for (const requestedFile of item.files) {
        const resolved = await revertPath(current, requestedFile, realWorktree)
        const file = path.relative(current.worktree, resolved).split(path.sep).join("/")
        if (!baselines.has(file)) baselines.set(file, { hash: item.hash, file })
      }
    }
    if (baselines.size === 0) return []

    // Like revert, preview needs a fresh tree: a fail-open stale baseline would
    // diff against itself and claim the undo changes nothing.
    const currentHash = await track({ requireFresh: true })
    if (!currentHash) return []
    const filesByHash = new Map<string, Set<string>>()
    for (const item of baselines.values()) {
      const files = filesByHash.get(item.hash)
      if (files) files.add(item.file)
      else filesByHash.set(item.hash, new Set([item.file]))
    }

    const diffs = new Map<string, FileDiff>()
    for (const [hash, files] of filesByHash) {
      for (const diff of await diffFull(hash, currentHash, [...files])) {
        diffs.set(`${hash}\0${diff.file}`, diff)
      }
    }
    return [...baselines.values()].flatMap((item) => {
      const diff = diffs.get(`${item.hash}\0${item.file}`)
      return diff ? [diff] : []
    })
  }

  export async function diff(hash: string) {
    const current = await state()
    return withOperationLock(current, async () => {
      if (!valid(hash)) {
        log.warn("failed to get diff", {
          hash,
          stderr: "invalid snapshot hash",
        })
        return ""
      }
      await add(current)
      const result = await runGit([...quote, ...args(current, ["diff", "--no-ext-diff", hash, "--", "."])], {
        cwd: current.worktree,
      })
      if (result.code !== 0) {
        log.warn("failed to get diff", {
          hash,
          exitCode: result.code,
          stderr: result.stderr,
        })
        return ""
      }
      return result.text.trim()
    })
  }

  export async function diffFull(from: string, to: string, files?: string[]) {
    const current = await state()
    return withOperationLock(current, async () => {
      if (!valid(from) || !valid(to)) return []

      const result: Snapshot.FileDiff[] = []
      const status = new Map<string, "added" | "deleted" | "modified">()
      const pathspecs =
        files === undefined ? ["."] : [...new Set(files.map((file) => file.split(path.sep).join("/")).filter(Boolean))]
      if (pathspecs.length === 0) return []
      // Whole-tree diffs must not be scoped to current.directory (see add()).
      // Callers that already know the files (previewRevert) pass a pathspec so
      // git does not re-walk the rest of the tree.
      const flags = files === undefined ? quote : [...quote, "--literal-pathspecs"]

      const entries: NumstatEntry[] = []
      for (let offset = 0; offset < pathspecs.length; offset += revertPathBatch) {
        const chunk = pathspecs.slice(offset, offset + revertPathBatch)
        const statuses = await runGit(
          [
            ...flags,
            ...args(current, ["diff", "--no-ext-diff", "--name-status", "--no-renames", from, to, "--", ...chunk]),
          ],
          { cwd: current.worktree },
        )
        if (statuses.code !== 0) {
          log.error("failed to get snapshot name-status diff", {
            from,
            to,
            exitCode: statuses.code,
            stderr: statuses.stderr,
          })
          throw new Error(`Snapshot diff failed: name-status exited with code ${statuses.code}`)
        }

        for (const line of statuses.text.split("\n")) {
          if (!line) continue
          const parsed = parseNameStatusLine(line)
          if (!parsed) continue
          const { code, file } = parsed
          status.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
        }

        const numstat = await runGit(
          [
            ...flags,
            ...args(current, ["diff", "--no-ext-diff", "--no-renames", "--numstat", from, to, "--", ...chunk]),
          ],
          { cwd: current.worktree },
        )
        if (numstat.code !== 0) {
          log.error("failed to get snapshot numstat diff", {
            from,
            to,
            exitCode: numstat.code,
            stderr: numstat.stderr,
          })
          throw new Error(`Snapshot diff failed: numstat exited with code ${numstat.code}`)
        }

        for (const line of numstat.text.split("\n")) {
          if (!line) continue
          const parsed = parseNumstatLine(line)
          if (parsed) entries.push(parsed)
        }
      }
      // Per-file content fetches are read-only git calls against the snapshot
      // gitdir, so they are safe to parallelize; bound the concurrency to
      // keep the subprocess count contained. Results are written back at
      // their original index so the output stays in numstat order.
      const ordered: Snapshot.FileDiff[] = new Array(entries.length)
      await work(
        4,
        entries.map((parsed, index) => ({ parsed, index })),
        async ({ parsed, index }) => {
          const contents = parsed.binary
            ? []
            : await Promise.allSettled([show(current, from, parsed.file), show(current, to, parsed.file)])
          for (const content of contents) {
            if (content.status === "rejected") throw content.reason
          }
          const [before, after] = contents.map((content) => (content.status === "fulfilled" ? content.value : ""))
          ordered[index] = {
            file: parsed.file,
            before: before ?? "",
            after: after ?? "",
            additions: parsed.additions,
            deletions: parsed.deletions,
            status: status.get(parsed.file) ?? "modified",
          }
        },
      )
      for (const diff of ordered) result.push(diff)

      return result
    })
  }
}
