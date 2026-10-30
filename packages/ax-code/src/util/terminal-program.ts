import { Env } from "./env"

/** Ghostty identifies itself as TERM_PROGRAM=ghostty and TERM=xterm-ghostty. */
export function isGhosttyTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env["TERM_PROGRAM"] ?? "") === "ghostty") return true
  return (env["TERM"] ?? "") === "xterm-ghostty"
}

/**
 * AkiTTY (defai-digital/akitty) exports TERM_PROGRAM=Akitty and leaves TERM at
 * xterm-256color, so the program identity is the only marker. Since 0.8.0 it
 * answers the Kitty graphics and keyboard probes, which the renderer detects
 * at startup; older builds fail the probes and fall back to text. It never
 * supports sixel, PNG/file image transfer, or OSC 9/9;4.
 */
const ADVANCED_TERM_PROGRAMS = new Set(["ghostty", "Akitty"])

function hasValue(env: NodeJS.ProcessEnv, name: string): boolean {
  return (env[name]?.trim().length ?? 0) > 0
}

// Host markers can survive SSH, multiplexers, and nested terminal launches.
// They do not establish the capabilities of the terminal currently receiving
// our output. Explicit user overrides remain available for these paths.
function requiresCompatibleTerminal(env: NodeJS.ProcessEnv): boolean {
  if (
    ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "MOSH_CONNECTION", "TMUX", "TMUX_PANE", "STY", "ZELLIJ"].some((name) =>
      hasValue(env, name),
    )
  ) {
    return true
  }
  const term = env["TERM"] ?? ""
  return /^(?:dumb|linux|vt100)$/.test(term) || /^(?:screen|tmux)(?:[.-]|$)/.test(term)
}

/** Detect a direct Windows Terminal session, including its WSL shells. */
export function isWindowsTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  // An explicit TERM_PROGRAM identifies a nested host (for example VS Code)
  // more precisely than the inherited Windows Terminal session marker.
  return !requiresCompatibleTerminal(env) && !hasValue(env, "TERM_PROGRAM") && hasValue(env, "WT_SESSION")
}

function isVteTerminal(env: NodeJS.ProcessEnv): boolean {
  const version = env["VTE_VERSION"] ?? ""
  // VTE exports a positive decimal version. Require its normal terminal type
  // as well: Ubuntu/WSL identity or truecolor alone is not terminal identity.
  return (
    !hasValue(env, "TERM_PROGRAM") &&
    /^[1-9]\d*$/.test(version) &&
    Number.isSafeInteger(Number(version)) &&
    (env["TERM"] === "xterm" || env["TERM"] === "xterm-256color")
  )
}

/**
 * Advanced TUI profile: explicit env wins, then direct terminal identity.
 * Ghostty, AkiTTY, Windows Terminal, and VTE hosts (including GNOME Terminal)
 * opt in automatically. Unknown, remote, and multiplexed terminals stay
 * compatible. This selection never grants pixel graphics or Nerd Font
 * capabilities.
 */
export function resolveTuiAdvancedTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  const parsed = Env.parseBoolean(env["AX_CODE_TUI_ADVANCED_TERMINAL"])
  if (parsed !== undefined) return parsed
  if (requiresCompatibleTerminal(env)) return false
  // A nested terminal's program identity wins over inherited host markers,
  // including xterm-ghostty left behind by an outer Ghostty session.
  if (hasValue(env, "TERM_PROGRAM")) return ADVANCED_TERM_PROGRAMS.has(env["TERM_PROGRAM"] ?? "")
  return isGhosttyTerminal(env) || isWindowsTerminal(env) || isVteTerminal(env)
}
