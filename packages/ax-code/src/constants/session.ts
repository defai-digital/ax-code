export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
export const MAX_CONSECUTIVE_ERRORS = 3
// Global step ceiling now mirrors the autonomous-mode default so the two
// caps move together. A user-supplied ~20-task batch typically generates
// 5-10 tool calls each (read + grep + edit + write + bash), which used
// to bump the previous 200 default after the first dozen tasks (#179).
export const GLOBAL_STEP_LIMIT = 500
export const DOOM_LOOP_THRESHOLD = 3
// Cumulative step ceiling for Super-Long runs, expressed as a multiple of the
// per-continuation step limit. Super-Long lifts the continuation cap, so this
// is the backstop that keeps a 72h run finite: 500 × 40 = 20,000 total steps
// (~one step every 13s for the full 72h window) — far above any legitimate
// supervised run, low enough that a stuck loop cannot burn tokens forever.
// Overridable via `session.max_total_steps`.
export const SUPER_LONG_TOTAL_STEP_HEADROOM = 40
// Cumulative step ceiling for active-goal runs, as a multiple of the
// per-continuation step limit. Goals lift the continuation cap exactly like
// Super-Long (they run until complete / blocked / budget-limited), but they
// used to keep the plain-autonomous ceiling (step limit × (continuations + 1)),
// so legitimate long goal runs died with a step-limit error a few
// continuations in while the model was still making progress. Aliased to the
// Super-Long headroom so the two long-run backstops move together.
// Overridable via `session.max_total_steps`.
export const GOAL_TOTAL_STEP_HEADROOM = SUPER_LONG_TOTAL_STEP_HEADROOM
// How close (in remaining total steps) an active-goal run gets to its
// cumulative ceiling before the prompt loop injects the one-shot convergence
// warning telling the model to wrap up (verify + complete, or hand off)
// instead of flying into the hard stop mid-edit. Wide enough for a
// verification run plus a hand-off summary; narrow enough that a default
// 20,000-step run spends well under 1% of its budget converging.
export const GOAL_CEILING_CONVERGENCE_STEPS = 50

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

// Paths whose writes do not count toward AUTONOMOUS_MAX_LINES_CHANGED
// (they still count toward the file cap). Regenerating a lockfile or a
// generated snapshot rewrites tens of thousands of lines in one tool
// call — e.g. provider/models-snapshot.json (~160k lines) consumed 10x
// the entire default line budget in a single write, after which every
// tool call failed with AutonomousLimitExceededError. The lines cap is
// meant to bound hand-authored change footprint, not generated output.
// Matched via `Wildcard.match` (`*` crosses path segments, `^...$`
// anchored), so a leading `*` also covers absolute paths; bare names are
// listed too for worktree-root writes. Override per session via
// `autonomy.budget.changes.lines_exempt_paths` (alias
// `experimental.autonomous_caps.linesExemptPaths`).
export const AUTONOMOUS_LINES_EXEMPT_PATHS: readonly string[] = [
  // Package-manager lockfiles
  "pnpm-lock.yaml",
  "*/pnpm-lock.yaml",
  "package-lock.json",
  "*/package-lock.json",
  "yarn.lock",
  "*/yarn.lock",
  "bun.lock",
  "*/bun.lock",
  "bun.lockb",
  "*/bun.lockb",
  "Cargo.lock",
  "*/Cargo.lock",
  "poetry.lock",
  "*/poetry.lock",
  "uv.lock",
  "*/uv.lock",
  "Gemfile.lock",
  "*/Gemfile.lock",
  "composer.lock",
  "*/composer.lock",
  // Generated snapshots (test snapshots, data snapshots like
  // provider/models-snapshot.json)
  "*.snap",
  "*-snapshot.json",
]

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
