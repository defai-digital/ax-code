/**
 * OpenWiki / repo-wiki path and marker constants (ADR-050).
 */

import path from "path"

export const WIKI_DIR_DEFAULT = "openwiki"
export const OPENWIKI_COMMAND_DEFAULT = "openwiki"

/** Canonical markers used by LangChain OpenWiki — do not invent a second pair. */
export const OPENWIKI_START = "<!-- OPENWIKI:START -->"
export const OPENWIKI_END = "<!-- OPENWIKI:END -->"

/** Best-effort metadata file written by some OpenWiki versions. */
export const LAST_UPDATE_FILE = ".last-update.json"

/** Preferred index entrypoints inside the wiki directory (first match wins). */
export const INDEX_CANDIDATES = ["quickstart.md", "index.md", "README.md", "Index.md"] as const

export const AGENTS_FILENAME = "AGENTS.md"
export const CLAUDE_FILENAME = "CLAUDE.md"

/**
 * Normalize and validate a wiki directory relative to the project root.
 * Rejects absolute paths and `..` segments so config/CLI cannot escape the repo.
 * Returns the default when input is empty or invalid.
 */
export function sanitizeWikiDirRel(input?: string, fallback: string = WIKI_DIR_DEFAULT): string {
  const raw = (input ?? "").trim().replace(/\\/g, "/")
  if (!raw) return fallback

  // Absolute (posix or windows drive) — never join as-is under root.
  if (path.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw) || raw.startsWith("/")) {
    return fallback
  }

  const parts = raw.split("/").filter((p) => p && p !== ".")
  if (parts.length === 0) return fallback
  if (parts.some((p) => p === "..")) return fallback

  return parts.join("/")
}
