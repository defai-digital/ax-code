/**
 * Dogfood engine selection for TUI Revamp 2 (ADR-054).
 *
 * Default remains OpenTUI. Opt in with AX_CODE_TUI_ENGINE=ratatui (case-insensitive).
 * Pure helpers — no I/O — so unit tests can lock the default path.
 */

export type TuiEngine = "opentui" | "ratatui"

export function parseTuiEngine(value: string | undefined | null): TuiEngine {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "ratatui" || normalized === "native" || normalized === "rust") {
    return "ratatui"
  }
  return "opentui"
}

export function resolveTuiEngine(env: NodeJS.ProcessEnv = process.env): TuiEngine {
  return parseTuiEngine(env.AX_CODE_TUI_ENGINE)
}

export function isRatatuiDogfood(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveTuiEngine(env) === "ratatui"
}

/** Candidate binary names / relative paths for the composition-root binary. */
export function ratatuiBinaryCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.AX_CODE_TUI_BIN?.trim()
  if (explicit) return [explicit]
  return [
    "ax-code-tui",
    // Dev workspace default (debug)
    "crates/target/debug/ax-code-tui",
    "crates/target/release/ax-code-tui",
  ]
}
