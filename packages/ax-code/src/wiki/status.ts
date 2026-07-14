/**
 * Compose wiki detect results with health recommendations.
 */

import type { WikiDetectResult } from "./detect"
import { detectWiki } from "./detect"
import { OPENWIKI_INSTALL_HINT } from "./runner"

export type WikiStatus = WikiDetectResult & {
  healthy: boolean
  recommendations: string[]
}

export function buildRecommendations(
  det: WikiDetectResult,
  extras?: { stale?: boolean; cardsHint?: boolean },
): string[] {
  const recs: string[] = []

  if (!det.wikiExists) {
    recs.push(`No wiki directory at ${det.wikiDirRelative}/. Run: ax-code wiki generate`)
  } else if (!det.hasIndex) {
    recs.push(
      `Wiki directory exists but no index page (quickstart.md / index.md / README.md). Re-run: ax-code wiki generate`,
    )
  }

  if (!det.binary.found) {
    recs.push(`OpenWiki CLI not found ("${det.binary.command}"). ${OPENWIKI_INSTALL_HINT}`)
  }

  if (extras?.stale) {
    recs.push("Wiki appears stale vs git HEAD. Run: ax-code wiki update  (or ax-code wiki lint for details)")
  }

  if (det.wikiExists && det.binary.found && !extras?.stale) {
    recs.push("To refresh after code changes: ax-code wiki update")
  }

  if (det.wikiExists && det.hasIndex) {
    recs.push(
      "Agent routing: architecture questions → read wiki index first; precise symbols → code_intelligence / lsp.",
    )
    if (extras?.cardsHint !== false) {
      recs.push("Dense index: ax-code wiki cards → .ax-code/wiki-cards.md; symbol jump: ax-code wiki related <Name>")
    }
  }

  if (recs.length === 0) {
    recs.push("Wiki setup looks healthy.")
  }

  return recs
}

export function isHealthy(det: WikiDetectResult): boolean {
  // Healthy for agent consumption means wiki content exists; binary is only needed to regenerate.
  return det.wikiExists && det.hasIndex
}

export async function getWikiStatus(input: {
  root: string
  dir?: string
  command?: string
  /** When true, include stale-vs-HEAD recommendation (extra git call). Default false. */
  checkStale?: boolean
}): Promise<WikiStatus> {
  const det = await detectWiki(input)
  let stale = false
  if (input.checkStale && det.wikiExists) {
    try {
      const { isWikiStale, gitHeadCommit } = await import("./lint")
      const head = await gitHeadCommit(input.root)
      stale = isWikiStale(det.lastUpdate?.commit, head)
    } catch {
      // ignore
    }
  }
  return {
    ...det,
    healthy: isHealthy(det),
    recommendations: buildRecommendations(det, { stale }),
  }
}
