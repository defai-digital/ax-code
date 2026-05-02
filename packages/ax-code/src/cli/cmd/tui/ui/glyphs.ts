// Nerd Font glyph helpers for the TUI.
//
// ax-code does not control the terminal's font — that is the user's
// terminal-emulator setting (iTerm2, Alacritty, WezTerm, etc.). What this
// module controls is which Unicode codepoints we emit. When Nerd Font is
// enabled we emit Private-Use-Area glyphs (file-type icons, branch icon,
// folder icon) that only render correctly in fonts patched with the Nerd
// Font glyph set (e.g. "Cascadia Code NF", "JetBrains Mono Nerd Font").
//
// The recommended terminal font for ax-code is **Cascadia Code Nerd Font**.
//
// Resolution priority (highest first):
//   1. AX_CODE_NERD_FONT=1 / =0 — explicit env override (CI, docs)
//   2. kv "nerd_font_enabled" — user preference toggled from the settings
//      menu, persisted in ~/.local/share/ax-code/kv.json
//   3. default false — preserves backward compatibility for users without
//      a Nerd Font installed.
//
// Existing safe-Unicode glyphs (◆ ● ✓ ✗ ▲ █ ░ → ←) render in any monospace
// font and are unchanged regardless of this flag. This module only adds
// **new** icons that would otherwise not exist (e.g. file-type icons in
// the file picker).

import { Flag } from "@/flag/flag"
import path from "node:path"

export const NERD_FONT_KV_KEY = "nerd_font_enabled"

// Resolve the effective nerd-font flag from env + a kv getter. Pure
// function so it is unit-testable without solid context.
export function resolveNerdFontEnabled(input: { env?: boolean; kv?: boolean }): boolean {
  if (input.env !== undefined) return input.env
  return input.kv ?? false
}

// File-type glyph table. Codepoints come from the Nerd Font "seti" and
// "dev" glyph blocks. Picked extensions cover the languages and config
// formats ax-code users see most often. Falls back to a generic file
// glyph for unknown extensions.
//
// Full list: https://www.nerdfonts.com/cheat-sheet
const NERD_FILE_GLYPHS: Record<string, string> = {
  // TypeScript / JavaScript
  ts: "",
  tsx: "",
  mts: "",
  cts: "",
  js: "",
  jsx: "",
  mjs: "",
  cjs: "",
  // Python / Rust / Go
  py: "",
  rs: "",
  go: "",
  // Web
  html: "",
  htm: "",
  css: "",
  scss: "",
  sass: "",
  // Data formats
  json: "",
  yaml: "",
  yml: "",
  toml: "",
  xml: "",
  // Docs
  md: "",
  markdown: "",
  // Shell / build
  sh: "",
  bash: "",
  zsh: "",
  fish: "",
  dockerfile: "",
  makefile: "",
  // Other languages
  c: "",
  h: "",
  cpp: "",
  hpp: "",
  cc: "",
  java: "",
  rb: "",
  php: "",
  swift: "",
  kt: "",
  lua: "",
  // Lock / package files
  lock: "",
}

// Generic glyphs (used for non-extension cases).
const NERD_GENERIC = {
  file: "", // generic file
  folder: "", // closed folder
  branch: "", // git branch
} as const

// Public glyph set. When Nerd Font is OFF, every getter returns "" so
// callers can safely concat without conditionals.
export type GlyphSet = {
  enabled: boolean
  fileType: (filename: string) => string
  folder: () => string
  branch: () => string
}

const SAFE_GLYPHS: GlyphSet = {
  enabled: false,
  fileType: () => "",
  folder: () => "",
  branch: () => "",
}

const NERD_GLYPHS: GlyphSet = {
  enabled: true,
  fileType(filename: string) {
    if (!filename) return NERD_GENERIC.file
    if (filename.endsWith("/")) return NERD_GENERIC.folder
    const base = path.basename(filename).toLowerCase()
    if (base === "dockerfile") return NERD_FILE_GLYPHS.dockerfile
    if (base === "makefile") return NERD_FILE_GLYPHS.makefile
    if (base === "package.json") return NERD_FILE_GLYPHS.json
    const ext = path.extname(filename).slice(1).toLowerCase()
    return NERD_FILE_GLYPHS[ext] ?? NERD_GENERIC.file
  },
  folder: () => NERD_GENERIC.folder,
  branch: () => NERD_GENERIC.branch,
}

export function buildGlyphSet(enabled: boolean): GlyphSet {
  return enabled ? NERD_GLYPHS : SAFE_GLYPHS
}

// Resolve the glyph set without solid context — for non-reactive call
// sites and tests. Reads env override at call time.
export function getGlyphSet(input: { kv?: boolean } = {}): GlyphSet {
  const enabled = resolveNerdFontEnabled({ env: Flag.AX_CODE_NERD_FONT_ENV, kv: input.kv })
  return buildGlyphSet(enabled)
}
