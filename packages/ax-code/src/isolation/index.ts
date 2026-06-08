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

  const CASE_INSENSITIVE_FS = process.platform === "darwin" || process.platform === "win32"

  // Containment check for protected paths that is case-insensitive on
  // case-insensitive filesystems (macOS, Windows). resolveClosestExistingPath
  // only canonicalizes the EXISTING prefix of a path, so a not-yet-existing
  // protected dir (e.g. `.ax-code`, `.git`) can be addressed via a case
  // variant (`.AX-CODE`, `.GIT`) that never gets case-corrected. A plain
  // case-sensitive comparison would then let that variant slip past the guard,
  // allowing a write into `.ax-code/policy.json` or `.git/hooks/*` on a fresh
  // checkout. Fold case here so the variant is still recognized as protected.
  function isInsideProtected(protectedPath: string, target: string): boolean {
    if (Filesystem.contains(protectedPath, target)) return true
    if (CASE_INSENSITIVE_FS) return Filesystem.contains(protectedPath.toLowerCase(), target.toLowerCase())
    return false
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
    return targets.some((target) => state.protected.some((p) => isInsideProtected(p, target)))
  }

  function isBypassed(state: State, resolved: string): boolean {
    if (!state.bypass?.length) return false
    // Re-validate against the canonical form so a symlink can't smuggle
    // a protected path past an "approved" bypass. Example threat: a tool
    // creates /tmp/safe.txt → /etc/passwd, the user approves bypass for
    // /tmp/safe.txt, and a bash `rm /tmp/safe.txt` would otherwise carry
    // the bypass through to /etc/passwd.
    const canonical = resolveClosestExistingPath(resolved)
    // Refuse bypass when the canonical target is in a protected path.
    // Even an explicit approval cannot override DEFAULT_PROTECTED
    // (.git, .ax-code) or user-configured protected entries.
    for (const protectedPath of state.protected) {
      if (isInsideProtected(protectedPath, canonical)) return false
    }
    // A bypass entry matches if it equals either the literal resolved
    // form or the canonical form. Compare both representations so an
    // approval recorded one way still matches the same path expressed
    // the other way.
    for (const entry of state.bypass) {
      if (entry === resolved || entry === canonical) return true
      if (resolveClosestExistingPath(entry) === canonical) return true
    }
    return false
  }

  export function canWrite(state: State, filepath: string, directory: string, worktree: string): boolean {
    if (state.mode === "full-access") return true
    // read-only is an absolute floor: even an explicit per-path bypass cannot
    // grant a write here. Checked before isBypassed so the bypass list can never
    // override read-only (mirrors assertBash, which rejects read-only first).
    if (state.mode === "read-only") return false
    if (isBypassed(state, resolvePath(filepath))) return true
    const targetPaths = securityPaths(filepath)
    const writeRoots = securityPaths(directory)
    // Guard worktree truthiness the same way roots() does. A "" or undefined
    // worktree must NOT be passed to securityPaths(): it resolves to the process
    // cwd and would silently widen the write boundary (or throw on undefined).
    if (worktree && worktree !== "/") writeRoots.push(...securityPaths(worktree))
    if (isProtected(state, filepath)) return false
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
    // Same worktree truthiness guard as roots()/canWrite — a "" worktree
    // resolves to cwd and would widen the bash boundary; undefined would throw.
    if (worktree && worktree !== "/") roots.push(...securityPaths(worktree))
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
