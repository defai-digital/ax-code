import { Flag } from "./flag"

/**
 * Directory-scoped runtime feature state.
 *
 * The autonomous / super-long settings persist per directory (ax-code.json)
 * but were historically mirrored into process-global env vars for in-process
 * readers (Permission, Question, Session). On a server hosting several
 * directories at once (the desktop app, CLI worktrees) the env is
 * last-writer-wins across projects, so toggling a flag in one project
 * changed runtime behavior for sessions in another.
 *
 * The routes and the config loader record each directory's resolved value
 * here alongside the env write. Readers resolve against the instance
 * directory active on the async context and fall back to the process-global
 * flag when no scoped value is known (single-directory CLI, externally-set
 * env, reads outside an instance context) — never worse than the env-only
 * behavior.
 */

export type ScopedFlagName = "AX_CODE_AUTONOMOUS" | "AX_CODE_SUPER_LONG"

let resolveDirectory: (() => string | undefined) | undefined
const valuesByDirectory = new Map<string, Map<ScopedFlagName, boolean>>()
// Flags whose process env has been (re)written by a route/config
// reconciliation in this process. Distinguishes a pristine user-set env
// (which should keep its "explicit env wins" semantics) from an env that
// merely mirrors whichever directory wrote it last.
const managed = new Set<ScopedFlagName>()

const SCOPED_FLAG_NAMES: ReadonlySet<string> = new Set(["AX_CODE_AUTONOMOUS", "AX_CODE_SUPER_LONG"])

export function isScopedFlagName(name: string): name is ScopedFlagName {
  return SCOPED_FLAG_NAMES.has(name)
}

export namespace ScopedFlag {
  /**
   * Registered once by the Instance module at load time; injected as a
   * callback to avoid a flag → instance import cycle.
   */
  export function setDirectoryResolver(resolver: () => string | undefined) {
    resolveDirectory = resolver
  }

  /**
   * Record the resolved value for the directory active on the current async
   * context. No-op outside an instance context (matching the callers, which
   * also write the process-global env as before).
   */
  export function recordCurrent(name: ScopedFlagName, value: boolean) {
    managed.add(name)
    const directory = resolveDirectory?.()
    if (!directory) return
    let values = valuesByDirectory.get(directory)
    if (!values) {
      values = new Map()
      valuesByDirectory.set(directory, values)
    }
    values.set(name, value)
  }

  /**
   * True once any directory has recorded this flag in this process — i.e.
   * the process env no longer holds a pristine user-provided value.
   */
  export function isManaged(name: ScopedFlagName): boolean {
    return managed.has(name)
  }

  /** Scoped value for the current instance directory, if one was recorded. */
  export function peek(name: ScopedFlagName): boolean | undefined {
    const directory = resolveDirectory?.()
    if (!directory) return undefined
    return valuesByDirectory.get(directory)?.get(name)
  }

  /** Autonomous mode for the current instance directory, env fallback. */
  export function autonomous(): boolean {
    return peek("AX_CODE_AUTONOMOUS") ?? Flag.AX_CODE_AUTONOMOUS
  }

  /**
   * Super-long for the current instance directory, or undefined when no
   * scoped value is known. Callers feed this into
   * SuperLongPolicy.runtimeState ahead of the env checks.
   */
  export function superLong(): boolean | undefined {
    return peek("AX_CODE_SUPER_LONG")
  }
}
