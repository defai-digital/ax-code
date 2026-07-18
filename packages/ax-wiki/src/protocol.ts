import { getWikiStatus } from "./artifacts"
import { AX_WIKI_DIR_DEFAULT, sanitizeWikiDir } from "./paths"

export function renderAxWikiProtocol(input: {
  wikiDir?: string
  index?: string
  exists: boolean
  enabled?: boolean
}): string | undefined {
  if (input.enabled === false || !input.exists) return undefined
  const wikiDir = sanitizeWikiDir(input.wikiDir)
  const index = input.index ? `${wikiDir}/${input.index}` : `${wikiDir}/quickstart.md`
  return [
    "<repo_wiki>",
    `  A source-backed AX Wiki is available under ${wikiDir}/.`,
    `  Start at ${index} for architecture, module responsibilities, workflows, and design intent.`,
    "  Each generated page records its source files; use those references to verify important claims.",
    "  Prefer the wiki before wide repository searches for conceptual questions.",
    "  Use code_intelligence or LSP for precise symbols, callers, callees, references, and refactor impact.",
    "  If wiki content conflicts with code, trust code and suggest: ax-code wiki update.",
    "  Do not load the entire wiki; start at quickstart and drill into relevant pages.",
    "</repo_wiki>",
  ].join("\n")
}

export async function maybeRenderAxWikiProtocol(
  root: string,
  options: { wikiDir?: string; enabled?: boolean } = {},
): Promise<string | undefined> {
  if (options.enabled === false) return undefined
  const status = await getWikiStatus({ root, wikiDir: options.wikiDir ?? AX_WIKI_DIR_DEFAULT })
  return renderAxWikiProtocol({
    wikiDir: status.wikiDir,
    index: status.index,
    exists: status.healthy,
    enabled: options.enabled,
  })
}
