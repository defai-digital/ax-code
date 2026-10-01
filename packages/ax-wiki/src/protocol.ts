import { buildWikiCards, getPageFreshness, getWikiStatus } from "./artifacts.js"
import type { WikiFreshness } from "./artifacts.js"
import type { AxWikiConfig, WikiCard } from "./types.js"
import { AX_WIKI_DIR_DEFAULT, sanitizeWikiDir } from "./paths.js"

// The card index rides in the system prompt, so it stays small and carries no
// per-page freshness: that would change on every edit and bust the prompt
// cache. Per-page freshness is served by the repo_wiki tool instead.
const PROTOCOL_MAX_CARDS = 16
const PROTOCOL_SUMMARY_MAX = 140

function cardLine(card: WikiCard): string {
  const flat = (card.summary ?? "").replace(/\s+/g, " ").trim()
  const summary = flat.length > PROTOCOL_SUMMARY_MAX ? `${flat.slice(0, PROTOCOL_SUMMARY_MAX - 3).trimEnd()}...` : flat
  return summary ? `  - ${card.path}: ${summary}` : `  - ${card.path}: ${card.title}`
}

export function renderAxWikiProtocol(input: {
  wikiDir?: string
  index?: string
  exists: boolean
  enabled?: boolean
  freshness?: WikiFreshness
  cards?: readonly WikiCard[]
  /** Repo files changed outside every page's cited sources; pages themselves still match. */
  coverageDrift?: boolean
}): string | undefined {
  if (input.enabled === false || !input.exists) return undefined
  const wikiDir = sanitizeWikiDir(input.wikiDir)
  const index = input.index ? `${wikiDir}/${input.index}` : `${wikiDir}/quickstart.md`
  const freshness = input.freshness ?? "unknown"
  const cards = (input.cards ?? []).slice(0, PROTOCOL_MAX_CARDS)
  return [
    "<repo_wiki>",
    `  A source-backed AX Wiki is available under ${wikiDir}/.`,
    `  Source freshness: ${freshness}.`,
    ...(input.coverageDrift && freshness === "fresh"
      ? [
          "  Repository files outside the pages' cited sources changed since the wiki was built; every page still matches its own sources. Run: ax-code wiki update to cover them.",
        ]
      : []),
    `  Start at ${index} for architecture, module responsibilities, workflows, and design intent.`,
    "  Each generated page records its source files; use those references to verify important claims.",
    freshness === "fresh"
      ? "  Prefer the wiki before wide repository searches for conceptual questions."
      : "  Use this wiki for navigation only; verify current original source before relying on any implementation claim. Run: ax-code wiki update.",
    "  Use the repo_wiki tool to list pages, read one page with its cited sources, or find pages for a symbol.",
    "  Use code_intelligence or LSP for precise symbols, callers, callees, references, and refactor impact.",
    "  If wiki content conflicts with code, trust code and suggest: ax-code wiki update.",
    "  Do not load the entire wiki; start at quickstart and drill into relevant pages.",
    ...(cards.length > 0
      ? [`  Pages (path: summary). Summaries only locate where to read; they are not proof:`, ...cards.map(cardLine)]
      : []),
    "</repo_wiki>",
  ].join("\n")
}

export async function maybeRenderAxWikiProtocol(
  root: string,
  options: { wikiDir?: string; enabled?: boolean; config?: AxWikiConfig } = {},
): Promise<string | undefined> {
  if (options.enabled === false) return undefined
  const status = await getWikiStatus({ root, wikiDir: options.wikiDir ?? AX_WIKI_DIR_DEFAULT, config: options.config })
  // The index is a convenience: a page that cannot be read must not remove the pointer.
  const cards = status.healthy
    ? await buildWikiCards({ root, wikiDir: status.wikiDir })
        .then((result) => result.cards)
        .catch(() => [])
    : []
  // Repo-wide freshness flips to stale when ANY eligible file is added or edited,
  // even one no page cites. For the prompt, judge each page by its own cited
  // sources so one unrelated file does not demote the whole wiki to
  // "navigation only". `wiki status` / lint keep the stricter repo-wide verdict.
  let freshness = status.freshness
  let coverageDrift = false
  if (status.healthy && freshness === "stale") {
    const pages = await getPageFreshness({ root, wikiDir: status.wikiDir }).catch(() => undefined)
    if (pages && pages.size > 0 && [...pages.values()].every((entry) => entry.freshness === "fresh")) {
      freshness = "fresh"
      coverageDrift = true
    }
  }
  return renderAxWikiProtocol({
    cards,
    coverageDrift,
    wikiDir: status.wikiDir,
    index: status.index,
    exists: status.healthy,
    enabled: options.enabled,
    freshness,
  })
}
