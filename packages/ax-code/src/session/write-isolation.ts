/**
 * Write isolation policy for multi-agent fan-out (ADR-048).
 *
 * Parallel explore is encouraged; concurrent writers are rejected unless a
 * stronger isolation mode (worktree) is explicitly allowed in a later phase.
 */

import { evaluate } from "../permission/evaluate"

export namespace WriteIsolation {
  export type AgentWriteClass = "read-only" | "writer"

  export type AgentLike = {
    name: string
    permission: ReadonlyArray<{
      permission: string
      pattern: string
      action: "allow" | "deny" | "ask"
    }>
  }

  export type ParallelDecision =
    | { ok: true; writers: string[]; readers: string[] }
    | { ok: false; reason: "multi_writer"; writers: string[]; message: string }

  /** Tools that can mutate the workspace when allowed. */
  const MUTATION_PERMISSIONS = ["edit", "write", "apply_patch", "multiedit", "bash"] as const

  /**
   * Known read-only specialist names used when permission rules are sparse.
   * Explore is always treated as research-only even if rules are incomplete.
   */
  const READ_ONLY_AGENT_NAMES = new Set(["explore", "title", "summary", "compaction"])

  export function classifyAgentWriteClass(agent: AgentLike): AgentWriteClass {
    if (READ_ONLY_AGENT_NAMES.has(agent.name)) return "read-only"

    const rules = agent.permission.map((rule) => ({
      permission: rule.permission,
      pattern: rule.pattern,
      action: rule.action,
    }))

    // If every mutation permission is deny, treat as read-only.
    let sawExplicitAllow = false
    let allDenied = true
    for (const permission of MUTATION_PERMISSIONS) {
      const rule = evaluate(permission, "*", rules)
      if (rule.action === "allow") {
        sawExplicitAllow = true
        allDenied = false
      } else if (rule.action === "ask") {
        // ask still permits mutation after approval — count as writer capability
        allDenied = false
      } else if (rule.action !== "deny") {
        allDenied = false
      }
    }

    if (allDenied && !sawExplicitAllow) {
      // Wildcard deny-all with only read tools allowed (explore pattern).
      const wildcard = evaluate("*", "*", rules)
      if (wildcard.action === "deny") return "read-only"
    }

    // If edit/write/apply_patch/multiedit are all deny and bash is deny → read-only
    const editDenied = MUTATION_PERMISSIONS.every((permission) => evaluate(permission, "*", rules).action === "deny")
    if (editDenied) return "read-only"

    return "writer"
  }

  /**
   * Parallel fan-out is allowed when at most one writer is present.
   * Zero writers (all explore) is the preferred path.
   * Two or more writers require worktree isolation (not implemented in Phase 1).
   */
  export function evaluateParallelAgents(agents: readonly AgentLike[]): ParallelDecision {
    const writers: string[] = []
    const readers: string[] = []
    for (const agent of agents) {
      const klass = classifyAgentWriteClass(agent)
      if (klass === "writer") writers.push(agent.name)
      else readers.push(agent.name)
    }

    if (writers.length > 1) {
      return {
        ok: false,
        reason: "multi_writer",
        writers,
        message:
          `Parallel fan-out refuses concurrent writers (${writers.join(", ")}). ` +
          `Use read-only agents (e.g. explore) for concurrent digs, run writers one at a time, ` +
          `or use worktree isolation for multi-writer workflows.`,
      }
    }

    return { ok: true, writers, readers }
  }
}
