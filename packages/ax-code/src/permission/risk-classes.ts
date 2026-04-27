/**
 * Permission risk classification for autonomous mode (ADR-004 / PRD v4.2.0).
 *
 * Replaces the legacy "all-or-nothing" autonomous bypass with a hybrid
 * model: SAFE permissions auto-approve as before, RISK permissions fall
 * back to the configured ruleset (the user can still pre-approve via
 * `always` rules), and unknown permissions follow `autonomous_strict_permission`
 * config (default: allow, log a warning).
 *
 * The names below MUST match the strings actually emitted by tool runtimes
 * via `Permission.ask({ permission: ... })`. Edit-class tools (write,
 * apply_patch, multiedit, edit, refactor_apply) all map to the single
 * `"edit"` permission name (see `EDIT_TOOLS` in permission/index.ts), so
 * only `"edit"` itself is listed here. A non-existent name in either set
 * is dead code: classify() never sees it.
 */

export type RiskClass = "safe" | "risk" | "unknown"

/**
 * Read-only / observation permissions. Autonomous mode auto-approves
 * these without consulting the ruleset.
 */
export const SAFE_PERMISSIONS: ReadonlySet<string> = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "codesearch",
  "lsp",
  "code_intelligence",
  "skill",
  "todoread",
  "websearch",
])

/**
 * Permissions that mutate state, run code, reach the network, or spawn
 * other agents. Autonomous mode does NOT auto-approve these — they fall
 * through to the agent ruleset (which often contains a wildcard allow
 * added by the user, but this explicit pass guarantees user-defined deny
 * rules still take effect).
 *
 *   - `edit`              — all write-class tools (write/edit/multiedit/
 *                            apply_patch/refactor_apply share this name).
 *   - `bash`              — arbitrary shell execution.
 *   - `external_directory`— writes outside the worktree; never auto-approve
 *                            even though it already has its own ask rules.
 *   - `task`              — spawns a subagent session; cost / privilege
 *                            implications.
 *   - `dispatcher`        — fans out to multiple subagents (ADR-005); same
 *                            reasoning as `task`.
 *   - `todowrite`         — modifies session todos; auto-approval would
 *                            silently rewrite the user's plan list.
 *   - `webfetch`          — arbitrary URL fetch; potential exfiltration
 *                            channel.
 */
export const RISK_PERMISSIONS: ReadonlySet<string> = new Set([
  "edit",
  "bash",
  "external_directory",
  "task",
  "dispatcher",
  "todowrite",
  "webfetch",
])

export function classify(permission: string): RiskClass {
  if (SAFE_PERMISSIONS.has(permission)) return "safe"
  if (RISK_PERMISSIONS.has(permission)) return "risk"
  return "unknown"
}
