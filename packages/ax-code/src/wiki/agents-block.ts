/**
 * Pure helpers for OpenWiki AGENTS.md / CLAUDE.md marker blocks.
 * Only rewrites content between OPENWIKI:START and OPENWIKI:END.
 */

import path from "path"
import { readFile, writeFile, access } from "fs/promises"
import {
  OPENWIKI_END,
  OPENWIKI_START,
  AGENTS_FILENAME,
  CLAUDE_FILENAME,
  WIKI_DIR_DEFAULT,
  sanitizeWikiDirRel,
} from "./paths"

export function hasOpenWikiBlock(content: string): boolean {
  return content.includes(OPENWIKI_START) && content.includes(OPENWIKI_END)
}

export function defaultOpenWikiBlockBody(wikiRel: string = WIKI_DIR_DEFAULT): string {
  const rel = wikiRel.replace(/\\/g, "/").replace(/^\.\//, "") || WIKI_DIR_DEFAULT
  return [
    OPENWIKI_START,
    "## Repo Wiki (OpenWiki)",
    "",
    `This repository maintains an agent-oriented wiki under \`${rel}/\`.`,
    "",
    `- Start at \`${rel}/quickstart.md\` (or \`${rel}/index.md\` if present).`,
    "- Use the wiki for architecture, module responsibilities, and design intent.",
    "- Prefer `code_intelligence` / `lsp` for precise symbol locations, callers, and references.",
    "- If wiki and code disagree, trust the code and update the wiki.",
    "",
    "Refresh: `ax-code wiki update` (requires OpenWiki CLI) or `openwiki --update`.",
    OPENWIKI_END,
  ].join("\n")
}

/**
 * Insert or replace the OpenWiki marker block. Content outside markers is preserved.
 * END is always searched *after* START so a stray END earlier cannot block updates.
 * An orphan START (no END) is replaced through end-of-file rather than duplicating.
 */
export function upsertOpenWikiBlock(content: string, blockBody?: string): string {
  const block = (blockBody ?? defaultOpenWikiBlockBody()).trimEnd()
  const start = content.indexOf(OPENWIKI_START)

  if (start !== -1) {
    const end = content.indexOf(OPENWIKI_END, start + OPENWIKI_START.length)
    const before = content.slice(0, start).replace(/\s*$/, "\n\n")
    if (end !== -1) {
      const after = content.slice(end + OPENWIKI_END.length).replace(/^\s*/, "\n")
      return `${before}${block}${after}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
    }
    // Orphan START: drop the broken tail and write a complete block.
    return `${before}${block}\n`.replace(/\n{3,}/g, "\n\n")
  }

  const trimmed = content.replace(/\s*$/, "")
  if (!trimmed) return `${block}\n`
  return `${trimmed}\n\n${block}\n`
}

export type EnsureAgentsResult = {
  updated: string[]
  skipped: string[]
  dryRun: boolean
  previews: Record<string, string>
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure AGENTS.md (and optionally CLAUDE.md) contain the OpenWiki pointer block.
 */
export async function ensureAgentsWikiPointers(
  root: string,
  opts?: {
    wikiRel?: string
    dryRun?: boolean
    /** Always create AGENTS.md if missing. Default true. */
    createAgents?: boolean
    /** Update CLAUDE.md only when it already exists. Default true. */
    touchClaudeMd?: boolean
  },
): Promise<EnsureAgentsResult> {
  const wikiRel = sanitizeWikiDirRel(opts?.wikiRel, WIKI_DIR_DEFAULT)
  const dryRun = opts?.dryRun === true
  const createAgents = opts?.createAgents !== false
  const touchClaudeMd = opts?.touchClaudeMd !== false
  const block = defaultOpenWikiBlockBody(wikiRel)

  const updated: string[] = []
  const skipped: string[] = []
  const previews: Record<string, string> = {}

  const agentsPath = path.join(root, AGENTS_FILENAME)
  const agentsExists = await fileExists(agentsPath)
  if (agentsExists || createAgents) {
    const existing = agentsExists ? await readFile(agentsPath, "utf-8") : ""
    const next = upsertOpenWikiBlock(existing, block)
    previews[AGENTS_FILENAME] = next
    if (next !== existing) {
      if (!dryRun) await writeFile(agentsPath, next, "utf-8")
      updated.push(AGENTS_FILENAME)
    } else {
      skipped.push(AGENTS_FILENAME)
    }
  } else {
    skipped.push(AGENTS_FILENAME)
  }

  const claudePath = path.join(root, CLAUDE_FILENAME)
  if (touchClaudeMd && (await fileExists(claudePath))) {
    const existing = await readFile(claudePath, "utf-8")
    const next = upsertOpenWikiBlock(existing, block)
    previews[CLAUDE_FILENAME] = next
    if (next !== existing) {
      if (!dryRun) await writeFile(claudePath, next, "utf-8")
      updated.push(CLAUDE_FILENAME)
    } else {
      skipped.push(CLAUDE_FILENAME)
    }
  }

  return { updated, skipped, dryRun, previews }
}
