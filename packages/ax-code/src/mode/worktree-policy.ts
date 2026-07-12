/**
 * Worktree isolation policy for multi-writer arena (ADR-049 D6 / Phase 3).
 * Pure — decides whether parallel writers are allowed given isolation mode.
 */

import { WriteIsolation } from "../session/write-isolation"

export namespace WorktreePolicy {
  export type IsolationMode = "shared" | "worktree" | "serial"

  export type Decision =
    | { ok: true; mode: IsolationMode; writers: string[]; readers: string[] }
    | {
        ok: false
        reason: "multi_writer_needs_worktree" | "multi_writer_serial_only"
        writers: string[]
        message: string
      }

  /**
   * Evaluate whether a set of agents may run in parallel under the given isolation mode.
   * - shared: at most one writer (ADR-048 default)
   * - worktree: multi-writer allowed (caller must place each writer in its own worktree)
   * - serial: multi-writer rejected; must run one after another
   */
  export function evaluate(input: {
    agents: readonly WriteIsolation.AgentLike[]
    isolation: IsolationMode
  }): Decision {
    const base = WriteIsolation.evaluateParallelAgents(input.agents)
    if (base.ok) {
      return { ok: true, mode: input.isolation, writers: base.writers, readers: base.readers }
    }

    // multi_writer
    if (input.isolation === "worktree") {
      return {
        ok: true,
        mode: "worktree",
        writers: base.writers,
        readers: [],
      }
    }

    if (input.isolation === "serial") {
      return {
        ok: false,
        reason: "multi_writer_serial_only",
        writers: base.writers,
        message:
          `Multiple writers (${base.writers.join(", ")}) must run serially on the main workspace. ` +
          `Use isolation=worktree for parallel implement arena, or run one writer at a time.`,
      }
    }

    return {
      ok: false,
      reason: "multi_writer_needs_worktree",
      writers: base.writers,
      message:
        `Parallel fan-out refuses concurrent writers (${base.writers.join(", ")}) on the shared workspace. ` +
        `Use read-only agents, serial writers, or worktree isolation for multi-writer arena.`,
    }
  }

  export function requiredWorktrees(writerCount: number, isolation: IsolationMode): number {
    if (isolation !== "worktree") return 0
    return Math.max(0, writerCount)
  }
}
