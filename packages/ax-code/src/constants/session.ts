export const COMPACTION_BUFFER = 20_000
export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
export const MAX_CONSECUTIVE_ERRORS = 3
export const GLOBAL_STEP_LIMIT = 200
export const DOOM_LOOP_THRESHOLD = 3

// Autonomous mode hardening (ADR-004 / PRD v4.2.0).
// These bound a single autonomous session. Defaults are wide enough that
// ordinary use does not trip them; narrow enough that a runaway loop
// fails loudly with a specific error class. Override per-session via
// `experimental.autonomous_caps` in ax-code.json.
export const AUTONOMOUS_MAX_STEPS = 200
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
