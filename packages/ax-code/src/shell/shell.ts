import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import path from "path"
import { execFile, spawn } from "child_process"
import { setTimeout as sleep } from "node:timers/promises"

const SIGKILL_TIMEOUT_MS = 200
type KillableProcess = {
  pid?: number
  kill: (signal?: NodeJS.Signals | number) => boolean | void
}

/**
 * Pids of every descendant of `root`, deepest first, from one `ps` snapshot.
 * Empty when `ps` is unavailable; callers fall back to the direct child.
 */
function descendantPids(root: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile("ps", ["-A", "-o", "pid=,ppid="], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([])
      const children = new Map<number, number[]>()
      for (const line of stdout.split("\n")) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number)
        if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
        children.set(ppid, [...(children.get(ppid) ?? []), pid])
      }
      const order: number[] = []
      const walk = (parent: number, seen: Set<number>) => {
        for (const child of children.get(parent) ?? []) {
          if (seen.has(child)) continue
          seen.add(child)
          walk(child, seen)
          order.push(child)
        }
      }
      walk(root, new Set([root]))
      resolve(order)
    })
  })
}

function signalPid(pid: number, signal: NodeJS.Signals | number) {
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone, or not ours to signal.
  }
}

export namespace Shell {
  export async function killTree(
    proc: KillableProcess,
    opts?: { exited?: () => boolean; signal?: NodeJS.Signals | number },
  ): Promise<void> {
    const pid = proc.pid
    if (!pid) return
    const signal: NodeJS.Signals | number = opts?.signal ?? "SIGTERM"

    if (process.platform === "win32") {
      if (opts?.exited?.()) return
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        })
        killer.once("exit", () => resolve())
        killer.once("error", () => resolve())
      })
      return
    }

    let signaledGroup = false
    try {
      process.kill(-pid, signal)
      signaledGroup = true
    } catch {
      // The process may not be a group leader. Fall back to its direct PID.
    }

    if (signaledGroup) {
      await sleep(SIGKILL_TIMEOUT_MS)
      try {
        // The leader can exit on SIGTERM while a descendant ignores it. Probe
        // the process group itself instead of using the leader's exit state.
        process.kill(-pid, 0)
        process.kill(-pid, "SIGKILL")
      } catch {
        // ESRCH means the entire group exited during the grace period.
      }
      return
    }

    // Not a group leader (for example an MCP stdio child). Signaling only the
    // direct pid would orphan its descendants, such as a browser launched by an
    // npx-run bridge, so snapshot them first and reap them with the child.
    const descendants = await descendantPids(pid)
    for (const child of descendants) signalPid(child, signal)

    if (opts?.exited?.() && descendants.length === 0) return
    try {
      if (!opts?.exited?.()) proc.kill(signal)
      await sleep(SIGKILL_TIMEOUT_MS)
      for (const child of descendants) signalPid(child, "SIGKILL")
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    } catch {
      // Process already exited — nothing left to kill.
    }
  }
  const BLACKLIST = new Set(["fish", "nu"])

  function shellName(shell: string, platform = process.platform) {
    const base = platform === "win32" ? path.win32.basename(shell) : path.basename(shell)
    return platform === "win32" ? base.replace(/\.(?:exe|cmd|bat|com)$/i, "").toLowerCase() : base.toLowerCase()
  }

  export function isAcceptable(shell: string, platform = process.platform) {
    return !BLACKLIST.has(shellName(shell, platform))
  }

  function fallback() {
    if (process.platform === "win32") {
      if (Flag.AX_CODE_GIT_BASH_PATH) return Flag.AX_CODE_GIT_BASH_PATH
      const git = which("git")
      if (git) {
        // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
        // bash.exe is at: C:\Program Files\Git\bin\bash.exe
        const bash = path.join(git, "..", "..", "bin", "bash.exe")
        if (Filesystem.stat(bash)?.size) return bash
      }
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") return "/bin/zsh"
    const bash = which("bash")
    if (bash) return bash
    return "/bin/sh"
  }

  const _preferred = lazy(() => {
    return resolveShellFromEnv((shell) => shell.length > 0)
  })

  const _acceptable = lazy(() => {
    return resolveShellFromEnv((shell) => isAcceptable(shell))
  })

  export function preferred(configShell?: string): string {
    if (configShell && configShell.length > 0) return configShell
    return _preferred()
  }

  export function acceptable(configShell?: string): string {
    if (configShell) {
      if (isAcceptable(configShell)) return configShell
    }
    return _acceptable()
  }

  function resolveShellFromEnv(accept: (value: string) => boolean): string {
    const shell = process.env.SHELL
    if (shell && accept(shell)) return shell
    return fallback()
  }
}
