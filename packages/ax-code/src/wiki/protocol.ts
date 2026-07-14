/**
 * System-prompt helpers for repo wiki routing (ADR-050).
 */

import { detectWiki } from "./detect"
import { WIKI_DIR_DEFAULT } from "./paths"

export function renderRepoWikiProtocol(input: {
  wikiRel?: string
  indexRel?: string
  wikiExists: boolean
  enabled?: boolean
}): string | undefined {
  if (input.enabled === false) return undefined
  if (!input.wikiExists) return undefined

  const wikiRel = (input.wikiRel ?? WIKI_DIR_DEFAULT).replace(/\\/g, "/")
  const indexRel = input.indexRel?.replace(/\\/g, "/") ?? `${wikiRel}/quickstart.md`

  return [
    `<repo_wiki>`,
    `  A compiled OpenWiki repository wiki is available under ${wikiRel}/.`,
    `  Start at ${indexRel} for architecture, module responsibilities, and design intent.`,
    `  Prefer reading wiki pages before wide greps when answering "how does X work?" or cross-module design questions.`,
    `  For precise symbol locations, callers, callees, and references, use code_intelligence or lsp — not the wiki alone.`,
    `  If wiki content conflicts with the current code, trust the code and suggest updating the wiki (ax-code wiki update).`,
    `  Do not dump the entire wiki into the conversation; read the index, then drill into relevant pages.`,
    `</repo_wiki>`,
  ].join("\n")
}

export async function maybeRenderRepoWikiProtocol(
  root: string,
  opts?: { dir?: string; enabled?: boolean; command?: string },
): Promise<string | undefined> {
  if (opts?.enabled === false) return undefined
  try {
    const det = await detectWiki({ root, dir: opts?.dir, command: opts?.command })
    return renderRepoWikiProtocol({
      wikiRel: det.wikiDirRelative,
      indexRel: det.indexRelative,
      wikiExists: det.wikiExists,
      enabled: opts?.enabled,
    })
  } catch {
    return undefined
  }
}
