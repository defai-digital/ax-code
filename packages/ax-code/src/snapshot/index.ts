import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Config } from "../config/config"
import { Global } from "../global"
import type { Shape } from "../project/instance"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { git } from "../util/git"
import { Log } from "../util/log"

export namespace Snapshot {
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
  const maxFileSize = 1024 * 1024
  const core = ["-c", "core.longpaths=true", "-c", "core.symlinks=true"]
  const cfg = ["-c", "core.autocrlf=false", ...core]
  const quote = [...cfg, "-c", "core.quotepath=false"]

  interface State {
    directory: string
    worktree: string
    gitdir: string
    vcs: Shape["project"]["vcs"]
    prevHash?: string
    cleanupDelay?: ReturnType<typeof setTimeout>
    cleanupInterval?: ReturnType<typeof setInterval>
  }

  function valid(hash: string) {
    return /^[0-9a-f]{40}$/.test(hash)
  }

  function snapshotRef(hash: string) {
    return `refs/snapshots/${hash}`
  }

  function decode(file: string) {
    if (!file.startsWith('"')) return file
    try {
      return JSON.parse(file) as string
    } catch {
      return file
    }
  }

  function parsePair(line: string) {
    const idx = line.indexOf("\t")
    if (idx < 0) return
    return [line.slice(0, idx), decode(line.slice(idx + 1))] as const
  }

  function parseNumstat(line: string) {
    const first = line.indexOf("\t")
    if (first < 0) return
    const second = line.indexOf("\t", first + 1)
    if (second < 0) return
    return [line.slice(0, first), line.slice(first + 1, second), decode(line.slice(second + 1))] as const
  }

  async function runGit(args: string[], options?: { cwd?: string; env?: Record<string, string> }) {
    const result = await git(args, {
      cwd: options?.cwd ?? Instance.directory,
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
        gitdir: path.join(Global.Path.data, "snapshot", current.project.id),
        vcs: current.project.vcs,
      }

      const scheduleCleanup = () => {
        next.cleanupDelay = setTimeout(() => {
          void cleanupFor(next)
          next.cleanupInterval = setInterval(() => {
            void cleanupFor(next)
          }, 60 * 60 * 1000)
          next.cleanupInterval.unref?.()
        }, 60 * 1000)
        next.cleanupDelay.unref?.()
      }

      scheduleCleanup()
      return next
    },
    async (entry) => {
      if (entry.cleanupDelay) clearTimeout(entry.cleanupDelay)
      if (entry.cleanupInterval) clearInterval(entry.cleanupInterval)
    },
  )

  function args(current: State, cmd: string[]) {
    return ["--git-dir", current.gitdir, "--work-tree", current.worktree, ...cmd]
  }

  async function exists(file: string) {
    return Filesystem.exists(file)
  }

  async function read(file: string) {
    return Filesystem.readText(file).catch(() => "")
  }

  async function remove(file: string) {
    await fs.rm(file, { recursive: true, force: true }).catch(() => undefined)
  }

  async function size(current: State, hash: string, file: string) {
    const tree = await runGit([...core, ...args(current, ["ls-tree", "-l", hash, "--", file])], {
      cwd: current.worktree,
    })
    const line = tree.text.trim()
    if (!line) return
    const meta = parsePair(line)?.[0]
    if (!meta) return
    const parts = meta.trim().split(/\s+/)
    const raw = parts[3]
    if (!raw || raw === "-") return
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  async function show(current: State, hash: string, file: string) {
    const next = await size(current, hash, file)
    if (next !== undefined && next > maxFileSize) return ""
    return (
      await runGit([...cfg, ...args(current, ["show", `${hash}:${file}`])], {
        cwd: current.worktree,
      })
    ).text
  }

  async function enabled(current: State) {
    if (current.vcs !== "git") return false
    return (await Config.get()).snapshot !== false
  }

  async function excludes(current: State) {
    const result = await runGit(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], {
      cwd: current.worktree,
    })
    const file = result.text.trim()
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

  async function add(current: State) {
    await syncExclude(current)
    await runGit([...cfg, ...args(current, ["add", "."])], { cwd: current.directory })
  }

  async function cleanupFor(current: State) {
    if (!(await enabled(current))) return
    if (!(await exists(current.gitdir))) return
    const result = await runGit(args(current, ["gc", `--prune=${prune}`]), { cwd: current.directory })
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
    const existed = await exists(current.gitdir)
    await fs.mkdir(current.gitdir, { recursive: true })
    if (existed) return

    await runGit(["init"], {
      cwd: current.worktree,
      env: { GIT_DIR: current.gitdir, GIT_WORK_TREE: current.worktree },
    })
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
    await cleanupFor(await state())
  }

  export async function track() {
    const current = await state()
    if (!(await enabled(current))) return

    await ensureRepo(current)

    if (current.prevHash) {
      const status = await runGit([...cfg, ...args(current, ["status", "--porcelain"])], { cwd: current.directory })
      if (status.text.trim() === "") {
        log.info("tracking (unchanged)", { hash: current.prevHash })
        return current.prevHash
      }
    }

    await add(current)
    const result = await runGit(args(current, ["write-tree"]), { cwd: current.directory })
    if (result.code !== 0) {
      log.error("failed to write snapshot tree", {
        cwd: current.directory,
        exitCode: result.code,
        stderr: result.stderr,
      })
      return current.prevHash
    }
    const hash = result.text.trim()
    if (!valid(hash)) {
      log.error("failed to validate snapshot tree hash", { hash })
      return current.prevHash
    }
    await runGit([...core, ...args(current, ["update-ref", snapshotRef(hash), hash])], { cwd: current.directory })
    current.prevHash = hash
    log.info("tracking", { hash, cwd: current.directory, git: current.gitdir })
    return hash
  }

  export async function patch(hash: string) {
    const current = await state()
    if (!valid(hash)) {
      log.warn("failed to get diff", { hash, error: "invalid snapshot hash" })
      return { hash, files: [] }
    }
    await add(current)
    const result = await runGit([...quote, ...args(current, ["diff", "--no-ext-diff", "--name-only", hash, "--", "."])], {
      cwd: current.directory,
    })
    if (result.code !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.code })
      return { hash, files: [] }
    }
    return {
      hash,
      files: result.text
        .trim()
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => path.join(current.worktree, item).replaceAll("\\", "/")),
    }
  }

  export async function restore(snapshot: string) {
    const current = await state()
    if (!valid(snapshot)) {
      log.error("failed to restore snapshot", {
        snapshot,
        stderr: "invalid snapshot hash",
      })
      return
    }
    log.info("restore", { commit: snapshot })
    const result = await runGit([...core, ...args(current, ["read-tree", snapshot])], { cwd: current.worktree })
    if (result.code === 0) {
      const checkout = await runGit([...core, ...args(current, ["checkout-index", "-a", "-f"])], {
        cwd: current.worktree,
      })
      if (checkout.code === 0) return
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: checkout.code,
        stderr: checkout.stderr,
      })
      return
    }
    log.error("failed to restore snapshot", {
      snapshot,
      exitCode: result.code,
      stderr: result.stderr,
    })
  }

  export async function revert(patches: Patch[]) {
    const current = await state()
    const seen = new Set<string>()
    for (const item of patches) {
      if (!valid(item.hash)) continue
      for (const file of item.files) {
        if (seen.has(file)) continue
        seen.add(file)
        log.info("reverting", { file, hash: item.hash })
        const rel = path.relative(current.worktree, file)
        const result = await runGit([...core, ...args(current, ["checkout", item.hash, "--", rel])], {
          cwd: current.worktree,
        })
        if (result.code !== 0) {
          const tree = await runGit([...core, ...args(current, ["ls-tree", item.hash, "--", rel])], {
            cwd: current.worktree,
          })
          if (tree.code === 0 && tree.text.trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", { file })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await remove(file)
          }
        }
      }
    }
  }

  export async function diff(hash: string) {
    const current = await state()
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
  }

  export async function diffFull(from: string, to: string) {
    const current = await state()
    if (!valid(from) || !valid(to)) return []

    const result: Snapshot.FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    const statuses = await runGit(
      [...quote, ...args(current, ["diff", "--no-ext-diff", "--name-status", "--no-renames", from, to, "--", "."])],
      { cwd: current.directory },
    )

    for (const line of statuses.text.trim().split("\n")) {
      if (!line) continue
      const parsed = parsePair(line)
      const code = parsed?.[0]
      const file = parsed?.[1]
      if (!code || !file) continue
      status.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
    }

    const numstat = await runGit(
      [...quote, ...args(current, ["diff", "--no-ext-diff", "--no-renames", "--numstat", from, to, "--", "."])],
      { cwd: current.directory },
    )

    for (const line of numstat.text.trim().split("\n")) {
      if (!line) continue
      const parsed = parseNumstat(line)
      const adds = parsed?.[0]
      const dels = parsed?.[1]
      const file = parsed?.[2]
      if (!file || adds === undefined || dels === undefined) continue
      const binary = adds === "-" && dels === "-"
      const [before, after] = binary ? ["", ""] : await Promise.all([show(current, from, file), show(current, to, file)])
      const additions = binary ? 0 : parseInt(adds, 10)
      const deletions = binary ? 0 : parseInt(dels, 10)
      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
        status: status.get(file) ?? "modified",
      })
    }

    return result
  }
}
