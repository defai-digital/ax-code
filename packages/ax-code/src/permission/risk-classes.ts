/**
 * Permission risk classification for autonomous mode (ADR-004 / PRD v4.2.0).
 *
 * Replaces the legacy "all-or-nothing" autonomous bypass with a hybrid
 * model: SAFE permissions auto-approve as before, RISK permissions fall
 * back to the configured ruleset (the user can still pre-approve via
 * `always` rules), and unknown permissions follow `autonomous_strict_permission`
 * config (default: allow, log a warning).
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
  "list_directory",
  "ls",
  "codesearch",
])

/**
 * Permissions that mutate state, run code, or reach the network.
 * Autonomous mode does NOT auto-approve these — they fall through to
 * the agent ruleset (which often contains a wildcard allow added by
 * the user, but this explicit pass guarantees user-defined deny rules
 * still take effect).
 */
export const RISK_PERMISSIONS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "apply_patch",
  "multiedit",
  "bash",
  "network",
  "package_install",
  "exa_fetch",
])

export function classify(permission: string): RiskClass {
  if (SAFE_PERMISSIONS.has(permission)) return "safe"
  if (RISK_PERMISSIONS.has(permission)) return "risk"
  return "unknown"
}
