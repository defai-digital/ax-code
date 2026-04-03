import path from "path"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import type { Isolation as IsolationConfig } from "@/config/schema"

export namespace Isolation {
  export const DEFAULT_PROTECTED = [".git", ".ax-code"]

  export type Mode = "read-only" | "workspace-write" | "full-access"

  export interface State {
    mode: Mode
    network: boolean
    protected: string[]
  }

  export class DeniedError extends Error {
    constructor(
      public readonly reason: "write" | "network" | "bash",
      message: string,
    ) {
      super(message)
      this.name = "IsolationDeniedError"
    }
  }

  export function resolve(config: IsolationConfig | undefined, directory: string): State {
    const mode = Flag.AX_CODE_ISOLATION_MODE ?? config?.mode ?? "workspace-write"
    const network = Flag.AX_CODE_ISOLATION_NETWORK ?? config?.network
    const protectedPaths = DEFAULT_PROTECTED.map((p) => path.resolve(directory, p))
    if (config?.protected) {
      for (const p of config.protected) protectedPaths.push(path.resolve(directory, p))
    }
    return {
      mode,
      network: mode === "full-access" ? true : (network ?? false),
      protected: protectedPaths,
    }
  }

  export function isProtected(state: State, filepath: string): boolean {
    if (state.mode === "full-access") return false
    return state.protected.some((p) => Filesystem.contains(p, filepath))
  }

  export function canWrite(state: State, filepath: string, directory: string, worktree: string): boolean {
    if (state.mode === "full-access") return true
    if (state.mode === "read-only") return false
    if (isProtected(state, filepath)) return false
    if (Filesystem.contains(directory, filepath)) return true
    if (worktree !== "/" && Filesystem.contains(worktree, filepath)) return true
    return false
  }

  export function assertWrite(state: State | undefined, filepath: string, directory: string, worktree: string) {
    if (!state) return
    if (canWrite(state, filepath, directory, worktree)) return
    if (state.mode === "read-only") {
      throw new DeniedError("write", `Isolation mode is read-only. Cannot write to: ${filepath}`)
    }
    if (isProtected(state, filepath)) {
      throw new DeniedError("write", `Path is protected by isolation policy: ${filepath}`)
    }
    throw new DeniedError("write", `Path is outside workspace boundary: ${filepath}`)
  }

  export function assertNetwork(state: State | undefined) {
    if (!state) return
    if (state.network) return
    throw new DeniedError(
      "network",
      `Network access is disabled by isolation policy (mode: ${state.mode}). Set isolation.network to true or use full-access mode.`,
    )
  }

  export function assertBash(
    state: State | undefined,
    cwd: string,
    directory: string,
    worktree: string,
    resolvedPaths: string[],
  ) {
    if (!state) return
    if (state.mode === "full-access") return
    if (state.mode === "read-only") {
      throw new DeniedError("bash", "Isolation mode is read-only. Bash commands are not allowed.")
    }
    // workspace-write: check cwd is within workspace
    if (!Filesystem.contains(directory, cwd) && !(worktree !== "/" && Filesystem.contains(worktree, cwd))) {
      throw new DeniedError("bash", `Bash working directory is outside workspace boundary: ${cwd}`)
    }
    // check all resolved paths from parsed commands
    for (const p of resolvedPaths) {
      if (isProtected(state, p)) {
        throw new DeniedError("bash", `Bash command targets protected path: ${p}`)
      }
      if (!Filesystem.contains(directory, p) && !(worktree !== "/" && Filesystem.contains(worktree, p))) {
        throw new DeniedError("bash", `Bash command targets path outside workspace boundary: ${p}`)
      }
    }
  }
}
