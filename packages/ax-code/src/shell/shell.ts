import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import path from "path"
import { spawn } from "child_process"
import { setTimeout as sleep } from "node:timers/promises"

const SIGKILL_TIMEOUT_MS = 200
type KillableProcess = {
  pid?: number
  kill: (signal?: NodeJS.Signals | number) => boolean | void
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

    if (opts?.exited?.()) return
    try {
      proc.kill(signal)
      await sleep(SIGKILL_TIMEOUT_MS)
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
