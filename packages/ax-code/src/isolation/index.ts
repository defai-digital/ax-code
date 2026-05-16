import path from "path"
import fs from "fs"
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
    /**
     * Paths the user has explicitly approved via `isolation_escalation`
     * for the current tool invocation. Scoped per-path so a single
     * approval inside a multi-hunk apply_patch does not silently
     * exempt every other hunk in the same call.
     */
    bypass?: string[]
  }

  export const DEFAULT_MODE: Mode = "workspace-write"

  function resolvePath(filepath: string) {
    return Filesystem.resolve(filepath)
  }

  function resolveClosestExistingPath(filepath: string) {
    const resolved = resolvePath(filepath)
    const suffix: string[] = []
    let current = resolved

    while (true) {
      try {
        return path.join(fs.realpathSync(current), ...suffix.slice().reverse())
      } catch (error) {
        if (!error || typeof error !== "object" || (error as NodeJS.ErrnoException).code !== "ENOENT") return resolved
        const parent = path.dirname(current)
        if (parent === current) return resolved
        suffix.push(path.basename(current))
        current = parent
      }
    }
  }

  function securityPaths(filepath: string) {
    return Array.from(new Set([resolvePath(filepath), resolveClosestExistingPath(filepath)]))
  }

  function isInsideAnyRoot(roots: string[], targets: string[]) {
    return targets.every((target) => roots.some((root) => Filesystem.contains(root, target)))
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
      public readonly path?: string,
    ) {
      super(message)
      this.name = "IsolationDeniedError"
    }
  }

  export function resolve(config: IsolationConfig | undefined, directory: string, worktree = directory): State {
    const mode = Flag.AX_CODE_ISOLATION_MODE ?? config?.mode ?? DEFAULT_MODE
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
    const targets = securityPaths(filepath)
    return targets.some((target) => state.protected.some((p) => Filesystem.contains(p, target)))
  }

  function isBypassed(state: State, resolved: string): boolean {
    if (!state.bypass?.length) return false
    return state.bypass.includes(resolved)
  }

  export function canWrite(state: State, filepath: string, directory: string, worktree: string): boolean {
    if (state.mode === "full-access") return true
    const resolved = resolvePath(filepath)
    if (isBypassed(state, resolved)) return true
    if (state.mode === "read-only") return false
    const targetPaths = securityPaths(filepath)
    const writeRoots = securityPaths(directory)
    if (worktree !== "/") writeRoots.push(...securityPaths(worktree))
    if (isProtected(state, resolved)) return false
    return isInsideAnyRoot(Array.from(new Set(writeRoots)), targetPaths)
  }

  export function assertWrite(state: State | undefined, filepath: string, directory: string, worktree: string) {
    if (!state) return
    if (canWrite(state, filepath, directory, worktree)) return
    const resolved = resolvePath(filepath)
    if (state.mode === "read-only") {
      throw new DeniedError("write", `Isolation mode is read-only. Cannot write to: ${filepath}`, resolved)
    }
    if (isProtected(state, filepath)) {
      throw new DeniedError("write", `Path is protected by isolation policy: ${filepath}`, resolved)
    }
    throw new DeniedError("write", `Path is outside workspace boundary: ${filepath}`, resolved)
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
    const roots = securityPaths(directory)
    if (worktree !== "/") roots.push(...securityPaths(worktree))
    const current = resolvePath(cwd)
    const currentPaths = securityPaths(cwd)
    // workspace-write: check cwd is within workspace
    if (!isInsideAnyRoot(Array.from(new Set(roots)), currentPaths)) {
      throw new DeniedError("bash", `Bash working directory is outside workspace boundary: ${cwd}`)
    }
    if (!isBypassed(state, current) && isProtected(state, current)) {
      throw new DeniedError("bash", `Bash working directory is a protected path: ${cwd}`, current)
    }
    // check all resolved paths from parsed commands
    for (const p of resolvedPaths) {
      const target = resolvePath(p)
      if (isBypassed(state, target)) continue
      if (isProtected(state, target)) {
        throw new DeniedError("bash", `Bash command targets protected path: ${p}`, target)
      }
      if (!isInsideAnyRoot(Array.from(new Set(roots)), securityPaths(p))) {
        throw new DeniedError("bash", `Bash command targets path outside workspace boundary: ${p}`, target)
      }
    }
  }
}
