export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
export const MAX_CONSECUTIVE_ERRORS = 3
// Global step ceiling now mirrors the autonomous-mode default so the two
// caps move together. A user-supplied ~20-task batch typically generates
// 5-10 tool calls each (read + grep + edit + write + bash), which used
// to bump the previous 200 default after the first dozen tasks (#179).
export const GLOBAL_STEP_LIMIT = 500
export const DOOM_LOOP_THRESHOLD = 3

// Autonomous mode hardening (ADR-004 / PRD v4.2.0).
// These bound a single autonomous session. Defaults are wide enough that
// ordinary use does not trip them; narrow enough that a runaway loop
// fails loudly with a specific error class. Override per-session via
// `experimental.autonomous_caps` in ax-code.json.
//
// AUTONOMOUS_MAX_STEPS was 200 prior to this change; raised to 500 after
// #179 ("Maximum step reached error when processing large task lists").
// A ~20-task batch routinely uses 5-10 tool calls per task (read, grep,
// edit, write, bash, etc.), so 200 was tripping at task ~12-15 and
// abandoning the rest. 500 covers ~50 tasks at the same density, which
// matches the largest realistic batch size we see; runaway loops still
// fail loudly via the per-tool perTool caps below well before 500.
export const AUTONOMOUS_MAX_STEPS = 500
export const AUTONOMOUS_MAX_FILES_CHANGED = 50
export const AUTONOMOUS_MAX_LINES_CHANGED = 5_000

// Glob patterns matched via `Wildcard.match`, which converts `*` to regex
// `.*` and anchors `^...$`. Because the matcher does not distinguish `*`
// from `**`, "anywhere"-style patterns like `**/secrets/**` only match
// when there is at least one path segment before `secrets/` — they do
// NOT match top-level `secrets/file` or nested-only `.env` files. To
// cover both placements every "anywhere"-shaped guard is listed twice:
// once anchored and once with a leading `**/` so files at any depth
// trip the block. See ADR-004 / PRD v4.2.0 P0-1 for context.
export const AUTONOMOUS_BLOCKED_PATHS: readonly string[] = [
  // dotenv (top-level + nested)
  ".env",
  "**/.env",
  ".env.*",
  "**/.env.*",
  // secrets directory at any depth, including the worktree root
  "secrets/**",
  "**/secrets/**",
  // git hooks at any depth (catches both top-level `.git/hooks/x` and
  // nested submodule layouts)
  ".git/hooks/**",
  "**/.git/hooks/**",
  // Infrastructure surfaces — already top-level by convention, kept as-is
  "infra/**",
  "terraform/**",
  ".github/workflows/**",
]

// Doom-loop cycle detection window (P1-1). The detector inspects up to
// the last `2 * AUTONOMOUS_MAX_CYCLE_LEN` tool calls.
export const AUTONOMOUS_MAX_CYCLE_LEN = 4

// Per-tool call-count caps for autonomous mode (PRD v4.2.1 P2-3).
// Catches mass-rewrite / bash-flood failure modes that slip under the
// per-session aggregate caps. Only tools that mutate state, run code,
// or reach the network are listed — read/grep/glob/list cost only
// tokens, which the provider already rate-limits.
//
// Tools NOT listed here are unrestricted at the per-tool layer and
// remain bounded only by AUTONOMOUS_MAX_STEPS. Override per session
// via `experimental.autonomous_caps.perTool` in ax-code.json (set 0
// or negative to disable a per-tool cap entirely).
export const AUTONOMOUS_PER_TOOL_MAX_CALLS: Readonly<Record<string, number>> = {
  bash: 50,
  edit: 100,
  write: 50,
  apply_patch: 50,
  multiedit: 50,
}
