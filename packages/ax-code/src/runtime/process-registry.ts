import { execFile } from "node:child_process"
import fsp from "node:fs/promises"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import z from "zod"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import { parseJsonResult } from "@/util/json-value"
import { sleep } from "@/util/timeout"

// ADR-209: child-process registry and orphan sweep. Every spawned MCP stdio
// server, LSP server, background shell and Wiki worker is recorded as one JSON file
// under `<state>/processes/`; clean teardown removes it. When a backend dies
// hard (OOM, SIGKILL, a node:ffi crash) the entries survive, and the next
// startup sweeps children whose owner is gone — after verifying the child's
// identity by kernel start time so a reused pid is never signalled.

/**
 * Every registry write is best effort: a failed write must never break the
 * spawn it describes, and a failed sweep must never block startup.
 */
export namespace ProcessRegistry {
  export type Kind = "mcp" | "lsp" | "shell" | "wiki"

  const KINDS = ["mcp", "lsp", "shell", "wiki"] as const

  export const Entry = z.object({
    pid: z.number().int().min(2),
    // 0 = the child is not a process-group leader (an MCP stdio child lives
    // in the owner's group); such entries are signalled by pid only.
    pgid: z.number().int().nonnegative(),
    kind: z.enum(KINDS),
    // Kernel start-time identity ("btime:startticks" on Linux, `ps lstart`
    // elsewhere). null = could not be captured; such entries are never
    // signalled, because the pid alone is not trustworthy evidence.
    startedAt: z.string().nullable(),
    ownerPid: z.number().int().min(2),
    ownerStartedAt: z.string().nullable(),
    // Command basename only — arguments and environment are never recorded.
    commandBase: z.string(),
  })
  export type Entry = z.infer<typeof Entry>

  export type Deps = {
    /** Registry directory (default: `<Global.Path.state>/processes`). */
    dir?: string
    platform?: NodeJS.Platform
    now?: () => number
    /** Kernel start-time probe for a pid; undefined/throw = unverifiable. */
    readStartTime?: (pid: number) => string | undefined | Promise<string | undefined>
    /** Liveness probe (signal 0 semantics; EPERM counts as alive). */
    isAlive?: (pid: number) => boolean
    /** Signal a pid, or a negative process-group id. */
    signal?: (target: number, signal: NodeJS.Signals) => void
    sleep?: (ms: number) => Promise<void>
    /** Override the recorded owner identity (tests). */
    owner?: { pid: number; startedAt: string | null }
  }

  export type SweepReport = {
    checked: number
    keptLiveOwner: number
    killed: number
    alreadyDead: number
    pidReused: number
    unverified: number
    invalidRemoved: number
    errors: string[]
    skipped?: "non-posix"
  }

  export type ListedState = "live-owner" | "orphan" | "dead" | "pid-reused" | "unverified"

  export type ListedProcess = { entry: Entry; file: string; state: ListedState }

  const log = Log.create({ service: "runtime.process-registry" })

  // Grace periods mirroring Shell.killTree's bounded escalation.
  const TERM_GRACE_MS = 300
  const KILL_GRACE_MS = 200
  const PS_TIMEOUT_MS = 2_000

  let lastSweep: { report: SweepReport; at: number } | undefined
  let ownIdentity: { pid: number; startedAt: string | null } | undefined

  function registryDir(dir?: string): string {
    if (dir) return dir
    const state = Filesystem.resolve(Global.Path.state)
    const root = path.resolve(state, "processes")
    if (!Filesystem.contains(state, root)) throw new Error("Process registry path escapes the state directory")
    return root
  }

  function entryFile(dir: string, kind: Kind, pid: number): string {
    const resolved = Filesystem.resolve(dir)
    const file = path.resolve(resolved, `${kind}-${pid}.json`)
    if (!Filesystem.contains(resolved, file))
      throw new Error(`Process registry entry escapes its directory: ${kind}-${pid}`)
    return file
  }

  /** Basename of the first whitespace-separated token; no arguments are kept. */
  export function commandBase(command: string): string {
    const token = command.trim().split(/\s+/)[0] ?? ""
    return path.basename(token) || "unknown"
  }

  // `kill(-1, sig)` would signal every process the user owns and `kill(0)`
  // the owner's whole group; only a concrete pid or a group id below -1.
  function defaultSignal(target: number, signal: NodeJS.Signals): void {
    if (target === 0 || target === -1) return
    try {
      process.kill(target, signal)
    } catch {
      // Already gone, or not ours to signal.
    }
  }

  function defaultIsAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH"
    }
  }

  let linuxBootTime: string | null | undefined

  function readLinuxBootTime(): string | null {
    if (linuxBootTime !== undefined) return linuxBootTime
    try {
      linuxBootTime = /^btime (\d+)$/m.exec(fs.readFileSync("/proc/stat", "utf-8"))?.[1] ?? null
    } catch {
      linuxBootTime = null
    }
    return linuxBootTime
  }

  const execFileAsync = promisify(execFile)

  /**
   * Kernel start-time identity. Linux: `/proc/<pid>/stat` field 22 anchored
   * to the boot time from `/proc/stat` (so the same tick count across two
   * boots cannot alias). Other POSIX: `ps -o lstart=`.
   */
  export async function readProcessStartTime(pid: number): Promise<string | undefined> {
    if (process.platform === "linux") {
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8")
        const afterComm = stat.slice(stat.lastIndexOf(")") + 2)
        const starttime = afterComm.split(" ")[19]
        if (!starttime) return undefined
        return `${readLinuxBootTime() ?? "unknown-boot"}:${starttime}`
      } catch {
        return undefined
      }
    }
    try {
      const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], {
        timeout: PS_TIMEOUT_MS,
      })
      return stdout.trim() || undefined
    } catch {
      return undefined
    }
  }

  async function probe(pid: number, deps: Deps): Promise<string | undefined> {
    const read = deps.readStartTime ?? readProcessStartTime
    try {
      return (await read(pid)) ?? undefined
    } catch {
      return undefined
    }
  }

  async function identityOf(deps: Deps): Promise<{ pid: number; startedAt: string | null }> {
    if (deps.owner) return deps.owner
    if (ownIdentity?.pid === process.pid) return ownIdentity
    // A probe failure degrades to null, which later sweeps treat as "cannot
    // compare" (owner assumed alive — the safe direction).
    const startedAt = (await probe(process.pid, deps)) ?? null
    ownIdentity = { pid: process.pid, startedAt }
    return ownIdentity
  }

  async function writeAtomic(file: string, body: string): Promise<void> {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await fsp.writeFile(tmp, body, { mode: 0o600 })
    await fsp.rename(tmp, file)
  }

  /**
   * Record a spawned child. Never throws: a failed write is logged and the
   * spawn proceeds unprotected (the sweep simply never sees the child).
   * POSIX only — Windows has no sweep, so no entries are written there.
   */
  export async function register(
    input: { pid: number; pgid?: number; kind: Kind; command: string },
    deps: Deps = {},
  ): Promise<void> {
    try {
      if (!Number.isInteger(input.pid) || input.pid < 2) return
      if ((deps.platform ?? process.platform) === "win32") return
      const owner = await identityOf(deps)
      const dir = registryDir(deps.dir)
      const entry: Entry = {
        pid: input.pid,
        pgid: input.pgid && input.pgid >= 2 ? input.pgid : 0,
        kind: input.kind,
        startedAt: (await probe(input.pid, deps)) ?? null,
        ownerPid: owner.pid,
        ownerStartedAt: owner.startedAt,
        commandBase: commandBase(input.command),
      }
      await writeAtomic(entryFile(dir, entry.kind, entry.pid), `${JSON.stringify(entry, null, 2)}\n`)
    } catch (error) {
      log.warn("failed to register child process", {
        pid: input.pid,
        kind: input.kind,
        error: toErrorMessage(error),
      })
    }
  }

  /** Remove a child's entry on clean teardown. Never throws. */
  export async function unregister(pid: number, kind: Kind, deps: Deps = {}): Promise<void> {
    try {
      if (!Number.isInteger(pid) || pid < 2) return
      await fsp.rm(entryFile(registryDir(deps.dir), kind, pid), { force: true })
    } catch (error) {
      log.warn("failed to unregister child process", { pid, kind, error: toErrorMessage(error) })
    }
  }

  async function readEntries(
    deps: Deps,
  ): Promise<{ valid: { entry: Entry; file: string }[]; invalid: { file: string }[] }> {
    const dir = Filesystem.resolve(registryDir(deps.dir))
    const names = await fsp.readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[]
      throw error
    })
    const valid: { entry: Entry; file: string }[] = []
    const invalid: { file: string }[] = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      const file = path.resolve(dir, name)
      if (!Filesystem.contains(dir, file)) {
        invalid.push({ file })
        continue
      }
      try {
        const parsed = parseJsonResult(await fsp.readFile(file, "utf-8"))
        if (!parsed.ok) throw new Error("invalid registry record")
        valid.push({ entry: Entry.parse(parsed.value), file })
      } catch {
        invalid.push({ file })
      }
    }
    return { valid, invalid }
  }

  /**
   * Sweep orphaned children whose owner died. POSIX only. For every entry
   * whose owner is gone (dead pid, or alive with a different start time —
   * pid reuse), the child's identity is verified against its recorded start
   * time before any signal is sent; an unverifiable pid is never signalled.
   * Entries of live owners are never touched.
   */
  export async function sweepOrphans(deps: Deps = {}): Promise<SweepReport> {
    const report: SweepReport = {
      checked: 0,
      keptLiveOwner: 0,
      killed: 0,
      alreadyDead: 0,
      pidReused: 0,
      unverified: 0,
      invalidRemoved: 0,
      errors: [],
    }
    if ((deps.platform ?? process.platform) === "win32") {
      report.skipped = "non-posix"
      lastSweep = { report, at: (deps.now ?? Date.now)() }
      return report
    }
    try {
      const { valid, invalid } = await readEntries(deps)
      for (const { file } of invalid) {
        try {
          await fsp.rm(file, { force: true })
          report.invalidRemoved++
        } catch (error) {
          report.errors.push(toErrorMessage(error))
        }
      }
      for (const { entry, file } of valid) {
        report.checked++
        try {
          if (!(await ownerIsGone(entry, deps))) {
            report.keptLiveOwner++
            continue
          }
          if (!(deps.isAlive ?? defaultIsAlive)(entry.pid)) {
            await fsp.rm(file, { force: true })
            report.alreadyDead++
            continue
          }
          if (entry.pid === process.pid || entry.startedAt === null) {
            report.unverified++
            continue
          }
          const live = await probe(entry.pid, deps)
          if (live === undefined) {
            // The pid is alive but its identity cannot be checked — never
            // signal it, and keep the entry for a later sweep to retry.
            report.unverified++
            continue
          }
          if (live !== entry.startedAt) {
            // Verified pid reuse: this is not our child. The entry can never
            // be verified again, so drop it without signalling.
            await fsp.rm(file, { force: true })
            report.pidReused++
            continue
          }
          await terminate(entry, deps)
          await fsp.rm(file, { force: true })
          report.killed++
        } catch (error) {
          report.errors.push(toErrorMessage(error))
        }
      }
    } catch (error) {
      report.errors.push(toErrorMessage(error))
    }
    lastSweep = { report, at: (deps.now ?? Date.now)() }
    if (report.killed > 0) {
      log.info("orphan sweep killed stray child processes", { ...report, errors: report.errors.length })
    } else if (report.errors.length > 0) {
      log.warn("orphan sweep reported errors", { ...report, errors: report.errors.length })
    }
    return report
  }

  /** An owner is gone when its pid is dead, or alive with a different start time. */
  async function ownerIsGone(entry: Entry, deps: Deps): Promise<boolean> {
    const isAlive = deps.isAlive ?? defaultIsAlive
    if (!isAlive(entry.ownerPid)) return true
    if (entry.ownerStartedAt === null) return false
    const live = await probe(entry.ownerPid, deps)
    if (live === undefined) return false
    return live !== entry.ownerStartedAt
  }

  async function terminate(entry: Entry, deps: Deps): Promise<void> {
    const signal = deps.signal ?? defaultSignal
    const isAlive = deps.isAlive ?? defaultIsAlive
    const wait = deps.sleep ?? sleep
    if (entry.pgid >= 2) signal(-entry.pgid, "SIGTERM")
    signal(entry.pid, "SIGTERM")
    await wait(TERM_GRACE_MS)
    if (!isAlive(entry.pid)) return
    if (entry.pgid >= 2) signal(-entry.pgid, "SIGKILL")
    signal(entry.pid, "SIGKILL")
    await wait(KILL_GRACE_MS)
  }

  /**
   * Enumerate registered children without mutating anything (doctor). The
   * per-entry state mirrors the sweep's decision inputs.
   */
  export async function list(deps: Deps = {}): Promise<ListedProcess[]> {
    if ((deps.platform ?? process.platform) === "win32") return []
    try {
      const { valid } = await readEntries(deps)
      const isAlive = deps.isAlive ?? defaultIsAlive
      const results: ListedProcess[] = []
      for (const { entry, file } of valid) {
        if (!(await ownerIsGone(entry, deps))) {
          results.push({ entry, file, state: "live-owner" })
          continue
        }
        if (!isAlive(entry.pid)) {
          results.push({ entry, file, state: "dead" })
          continue
        }
        if (entry.startedAt === null) {
          results.push({ entry, file, state: "unverified" })
          continue
        }
        const live = await probe(entry.pid, deps)
        if (live === undefined) results.push({ entry, file, state: "unverified" })
        else if (live !== entry.startedAt) results.push({ entry, file, state: "pid-reused" })
        else results.push({ entry, file, state: "orphan" })
      }
      return results
    } catch (error) {
      log.warn("failed to list child process registry", { error: toErrorMessage(error) })
      return []
    }
  }

  /** The most recent startup sweep's report, for `doctor` (this process). */
  export function lastSweepReport(): { report: SweepReport; at: number } | undefined {
    if (!lastSweep) return undefined
    return { at: lastSweep.at, report: { ...lastSweep.report, errors: [...lastSweep.report.errors] } }
  }

  /** Test-only: clear cached identity and the recorded sweep. */
  export function resetForTests() {
    lastSweep = undefined
    ownIdentity = undefined
  }
}
