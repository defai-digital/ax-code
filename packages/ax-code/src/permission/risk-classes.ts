/**
 * Permission risk classification for autonomous mode (ADR-004 / PRD v4.2.0).
 *
 * Replaces the legacy "all-or-nothing" autonomous bypass with a hybrid
 * model: SAFE permissions auto-approve as before, RISK permissions fall
 * back to the configured ruleset (the user can still pre-approve via
 * `always` rules), and unknown permissions ask by default. Setting
 * `autonomous_strict_permission: false` explicitly preserves the legacy
 * allow behavior.
 *
 * The names below MUST match the strings actually emitted by tool runtimes
 * via `Permission.ask({ permission: ... })`. Edit-class tools (write,
 * apply_patch, multiedit, edit, refactor_apply) all map to the single
 * `"edit"` permission name (see `EDIT_TOOLS` in permission/index.ts), so
 * only `"edit"` itself is listed here. A non-existent name in either set
 * is dead code: classify() never sees it.
 */

type RiskClass = "safe" | "risk" | "unknown"

/**
 * Read-only / observation permissions. Autonomous mode auto-approves
 * these without consulting the ruleset.
 */
const SAFE_PERMISSIONS: ReadonlySet<string> = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "lsp",
  "code_intelligence",
  "skill",
  "todoread",
  // Cloud Operations control-plane records (PRD-2026-09-04): opening a plan,
  // attaching a diff artifact, verifying with read-only assertions, and
  // reading the journal. None of these mutate external state — ops_apply is
  // the only mutation path and is classified RISK below.
  "ops_plan",
  "ops_diff",
  "ops_verify",
  "ops_journal",
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
 *   - `todowrite`         — modifies session todos; auto-approval would
 *                            silently rewrite the user's plan list.
 *   - `memorywrite`       — persists project/global memory outside the
 *                            current conversation.
 *   - `webfetch`          — arbitrary URL fetch; potential exfiltration
 *                            channel.
 *   - `websearch`         — external search network egress; queries can
 *                            contain private repository context.
 *   - `codesearch`        — external code/doc search network egress.
 *   - `monitor`           — background process watchers.
 *   - `image_gen`         — generates images (cost).
 *   - `computer`          — drives the user's real desktop (mouse/keyboard)
 *                            through a computer-use backend.
 */
const RISK_PERMISSIONS: ReadonlySet<string> = new Set([
  "edit",
  "bash",
  "external_directory",
  "task",
  "todowrite",
  "memorywrite",
  "webfetch",
  "websearch",
  "codesearch",
  "monitor",
  "image_gen",
  "computer",
  // Cloud Operations sanctioned mutation path (PRD-2026-09-04). The
  // capability check lives in ops_apply itself (single-use plan-bound
  // approval token); the permission still never auto-approves outside
  // full-access isolation.
  "ops_apply",
  // Cloud Operations approval gate: issues the single-use plan-bound token
  // that authorizes ops_apply. Per-call by design (no always patterns,
  // mirroring bash_destructive) — an autonomous agent must never approve
  // its own mutation plan.
  "ops_approve",
  // Opens a URL in the user's real browser — an external surface comparable
  // to webfetch (network egress plus a prompt-injection vector aimed at the
  // human).
  "browser_open",
  // Destructive bash gate and sandbox escalation. Both are also
  // INTERACTIVE_ONLY (permission/index.ts), so no wildcard rule can
  // pre-approve them; classifying them as RISK documents that autonomous
  // mode must never auto-approve either.
  "bash_destructive",
  "isolation_escalation",
  // Multi-agent orchestration: parallel subagents and ensemble fan-outs
  // carry the same cost/privilege implications as `task`, and the runtime
  // already deny-gates them in restricted agent rulesets.
  "task_parallel",
  "arena",
  "council",
  // Asking the user a question surfaces UI but has no side effects; the
  // runtime still deny-gates it inside restricted agent contexts, so it
  // stays in the risk class rather than auto-approving.
  "question",
])

export function classify(permission: string): RiskClass {
  if (SAFE_PERMISSIONS.has(permission)) return "safe"
  if (RISK_PERMISSIONS.has(permission)) return "risk"
  return "unknown"
}
