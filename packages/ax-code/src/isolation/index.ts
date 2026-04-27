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

  function resolvePath(filepath: string) {
    return Filesystem.resolve(filepath)
  }

  function roots(directory: string, worktree: string) {
    const result = [resolvePath(directory)]
    if (worktree && worktree !== "/" && resolvePath(worktree) !== result[0]) result.push(resolvePath(worktree))
    return result
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

  export function resolve(config: IsolationConfig | undefined, directory: string, worktree = directory): State {
    const mode = Flag.AX_CODE_ISOLATION_MODE ?? config?.mode ?? "full-access"
    const network = Flag.AX_CODE_ISOLATION_NETWORK ?? config?.network
    const protectedPaths = roots(directory, worktree).flatMap((root) =>
      DEFAULT_PROTECTED.map((item) => path.resolve(root, item)),
    )
    if (config?.protected) {
      for (const root of roots(directory, worktree)) {
        for (const item of config.protected) protectedPaths.push(path.resolve(root, item))
      }
    }
    return {
      mode,
      network: mode === "full-access" ? true : (network ?? false),
      protected: Array.from(new Set(protectedPaths.map(resolvePath))),
    }
  }

  export function isProtected(state: State, filepath: string): boolean {
    if (state.mode === "full-access") return false
    const resolved = resolvePath(filepath)
    return state.protected.some((p) => Filesystem.contains(p, resolved))
  }

  export function canWrite(state: State, filepath: string, directory: string, worktree: string): boolean {
    if (state.mode === "full-access") return true
    if (state.mode === "read-only") return false
    const resolved = resolvePath(filepath)
    const dir = resolvePath(directory)
    const tree = worktree !== "/" ? resolvePath(worktree) : worktree
    if (isProtected(state, resolved)) return false
    if (Filesystem.contains(dir, resolved)) return true
    if (tree !== "/" && Filesystem.contains(tree, resolved)) return true
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
    const dir = resolvePath(directory)
    const tree = worktree !== "/" ? resolvePath(worktree) : worktree
    const current = resolvePath(cwd)
    // workspace-write: check cwd is within workspace
    if (!Filesystem.contains(dir, current) && !(tree !== "/" && Filesystem.contains(tree, current))) {
      throw new DeniedError("bash", `Bash working directory is outside workspace boundary: ${cwd}`)
    }
    // check all resolved paths from parsed commands
    for (const p of resolvedPaths) {
      const target = resolvePath(p)
      if (isProtected(state, target)) {
        throw new DeniedError("bash", `Bash command targets protected path: ${p}`)
      }
      if (!Filesystem.contains(dir, target) && !(tree !== "/" && Filesystem.contains(tree, target))) {
        throw new DeniedError("bash", `Bash command targets path outside workspace boundary: ${p}`)
      }
    }
  }
}
