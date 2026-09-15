// Visual capability resolution for the primitives layer (ADR-031).
//
// Primitives never read env vars or kv directly — the effective capability
// is resolved once from explicit inputs and provided through context
// (capability-context.tsx). Pure so it is unit-testable without solid.

export interface VisualCapability {
  // Terminal can render 24-bit color, so gradients and alpha tints are
  // worth emitting. Without it primitives fall back to single theme colors.
  truecolor: boolean
  // Per-frame animation is allowed (user setting + runtime mode).
  animations: boolean
  // Nerd Font glyphs are enabled (see ui/glyphs.ts for the glyph table).
  nerdFont: boolean
}

// Terminals that render 24-bit color but do not always advertise it via
// COLORTERM. Allowlist-only — never probe the terminal (escape-sequence
// capability probes are a known hang class, see renderer.ts).
const TRUECOLOR_TERM_PROGRAMS = new Set(["WezTerm", "iTerm.app", "ghostty", "vscode"])

export function resolveVisualCapability(input: {
  advancedTerminal: boolean
  colorterm?: string
  termProgram?: string
  term?: string
  animationsEnabled: boolean
  nerdFont: boolean
}): VisualCapability {
  const colorterm = input.colorterm?.toLowerCase() ?? ""
  const truecolor =
    colorterm.includes("truecolor") ||
    colorterm.includes("24bit") ||
    input.term === "xterm-kitty" ||
    (input.termProgram !== undefined && TRUECOLOR_TERM_PROGRAMS.has(input.termProgram)) ||
    input.advancedTerminal
  return {
    truecolor,
    animations: input.animationsEnabled,
    nerdFont: input.nerdFont,
  }
}
