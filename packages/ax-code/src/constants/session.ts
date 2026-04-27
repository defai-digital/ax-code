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
