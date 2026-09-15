import { Env } from "./env"

/** Ghostty identifies itself as TERM_PROGRAM=ghostty and TERM=xterm-ghostty. */
export function isGhosttyTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env["TERM_PROGRAM"] ?? "") === "ghostty") return true
  return (env["TERM"] ?? "") === "xterm-ghostty"
}

/**
 * Advanced TUI profile: explicit env wins. When unset, Ghostty is allowlisted
 * because it is a known-good GPU terminal for capability probes and Digital
 * Code pixel rain. Other terminals stay compatibility-first.
 */
export function resolveTuiAdvancedTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  const parsed = Env.parseBoolean(env["AX_CODE_TUI_ADVANCED_TERMINAL"])
  if (parsed !== undefined) return parsed
  return isGhosttyTerminal(env)
}
