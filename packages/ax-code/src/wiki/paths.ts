/**
 * OpenWiki / repo-wiki path and marker constants (ADR-050).
 */

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
