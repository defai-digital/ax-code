import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./repo_wiki.txt"
import {
  buildWikiCards,
  findUngroundedSymbols,
  getPageFreshness,
  getWikiStatus,
  loadWikiPages,
  relatedWikiPages,
  type WikiCard,
  type WikiPage,
  type WikiPageFreshness,
} from "@ax-code/ax-wiki/node"
import { wikiProjectRoot } from "../wiki/root"
import { engineConfig, resolveWikiRuntimeConfig } from "../wiki/config"

// Read-only access to the AX Wiki. The wiki is a compiled navigation layer,
// not structural truth: `read` always returns the page's `sources` so the
// model can verify claims against the real files before acting on them.
//
// Deliberately a tool (not only a prompt pointer): models reliably call tools
// they are given, so this turns "there is a wiki somewhere" into one cheap
// first action. See .internal/adr and docs/integrations/wiki.md.

const operations = ["index", "read", "related"] as const

type RepoWikiMetadata = {
  available?: boolean
  freshness?: string
  pageCount?: number
  pageFreshness?: string
  ungroundedSymbols?: string[]
  found?: boolean
  truncated?: boolean
  sources?: string[]
  matchCount?: number
}

// Bound the in-context cost. Cards are already small (12 pages by default),
// but a `read` must not dump a 24 KB quickstart unchecked.
const MAX_INDEX_CARDS = 40
const MAX_READ_CHARS = 20_000
const MAX_RELATED = 10

function freshnessTag(entry: WikiPageFreshness | undefined): string {
  if (!entry) return "unknown"
  return entry.freshness === "stale" ? `stale: ${entry.changed.length} cited source(s) changed` : entry.freshness
}

function formatCard(card: WikiCard, entry: WikiPageFreshness | undefined): string {
  const lines = [`- ${card.path} [${freshnessTag(entry)}] - ${card.title}`]
  if (card.summary) lines.push(`  ${card.summary}`)
  if (card.symbols.length) lines.push(`  symbols: ${card.symbols.slice(0, 10).join(", ")}`)
  if (card.sources.length) lines.push(`  sources: ${card.sources.slice(0, 6).join(", ")}`)
  return lines.join("\n")
}

function normalizePageQuery(query: string, wikiDir: string): string {
  let value = query
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
  if (value.startsWith(`${wikiDir}/`)) value = value.slice(wikiDir.length + 1)
  return value
}

function renderPage(
  page: WikiPage,
  entry: WikiPageFreshness | undefined,
  ungrounded: string[],
): { output: string; truncated: boolean } {
  const clipped = page.body.length > MAX_READ_CHARS
  const body = clipped ? page.body.slice(0, MAX_READ_CHARS) : page.body
  const header = [
    `# ${page.title} (${page.relativePath})`,
    `page freshness: ${freshnessTag(entry)}`,
    ...(entry?.changed.length
      ? [
          `changed sources (the page may be out of date for these):\n${entry.changed.map((source) => `- ${source}`).join("\n")}`,
        ]
      : []),
    ...(ungrounded.length
      ? [`unverified symbols (not found in the cited sources; do not rely on them): ${ungrounded.join(", ")}`]
      : []),
    page.summary ? `summary: ${page.summary}` : "",
    page.sources.length
      ? `sources (read these to verify before relying on the page):\n${page.sources.map((source) => `- ${source}`).join("\n")}`
      : "sources: (none recorded)",
    clipped
      ? `\n(page body truncated to ${MAX_READ_CHARS} characters; open ${page.relativePath} for the full page)`
      : "",
    "",
  ]
  return { output: [...header, body].filter((line) => line !== undefined).join("\n"), truncated: clipped }
}

const parameters = z.object({
  operation: z.enum(operations).describe("Which AX Wiki query to run"),
  page: z
    .string()
    .optional()
    .describe(
      "Page to open for `read`, repo-relative to the wiki dir (e.g. quickstart.md or modules/ax-code/src/tool.md)",
    ),
  symbol: z.string().optional().describe("Symbol or source path to look up for `related`"),
})

export const RepoWikiTool = Tool.define<typeof parameters, RepoWikiMetadata>("repo_wiki", {
  description: DESCRIPTION,
  parameters,
  concurrencySafe: () => true,
  execute: async (args, ctx) => {
    const root = await wikiProjectRoot()
    const runtime = await resolveWikiRuntimeConfig()
    const wikiDir = runtime.dir

    await ctx.ask({
      permission: "read",
      patterns: [wikiDir],
      always: ["*"],
      metadata: {},
    })

    const status = await getWikiStatus({ root, wikiDir, config: engineConfig(runtime) })
    if (!status.healthy) {
      return {
        title: "repo_wiki",
        output: `No usable AX Wiki found at ${wikiDir}/ (freshness: ${status.freshness}). Run \`ax-code wiki generate\` to build it, then retry.`,
        metadata: { available: false, freshness: status.freshness },
      }
    }

    if (args.operation === "index") {
      const { cards } = await buildWikiCards({ root, wikiDir })
      const pageFreshness = await getPageFreshness({ root, wikiDir })
      const bounded = cards.slice(0, MAX_INDEX_CARDS)
      const output = [
        `AX Wiki index: ${cards.length} page(s); repo-wide freshness: ${status.freshness}. Per-page tags show whether a page's own cited sources changed.`,
        `Use \`repo_wiki read <page>\` to open one; each page lists the source files to verify against.`,
        "",
        ...bounded.map((card) => formatCard(card, pageFreshness.get(card.path))),
        ...(cards.length > bounded.length ? [`...and ${cards.length - bounded.length} more page(s)`] : []),
      ].join("\n")
      return { title: "repo_wiki index", output, metadata: { freshness: status.freshness, pageCount: cards.length } }
    }

    if (args.operation === "read") {
      if (!args.page?.trim()) throw new Error("repo_wiki read requires `page`")
      const pages = await loadWikiPages({ root, wikiDir })
      const wanted = normalizePageQuery(args.page, wikiDir)
      const page = pages.find((entry) => entry.relativePath === wanted)
      if (!page) {
        const paths = pages.map((entry) => entry.relativePath)
        const substring = paths.filter((candidate) => candidate.toLowerCase().includes(wanted.toLowerCase()))
        const suggestions = (substring.length ? substring : paths).slice(0, 5)
        return {
          title: "repo_wiki read",
          output: `No wiki page named "${wanted}".${suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""} Use \`repo_wiki index\` to list pages.`,
          metadata: { available: true, freshness: status.freshness, found: false },
        }
      }
      const entry = (await getPageFreshness({ root, wikiDir, pages: [page.relativePath] })).get(page.relativePath)
      const ungrounded = await findUngroundedSymbols({ root, page })
      const { output, truncated } = renderPage(page, entry, ungrounded)
      return {
        title: page.relativePath,
        output,
        metadata: {
          freshness: status.freshness,
          pageFreshness: entry?.freshness,
          found: true,
          truncated,
          sources: page.sources,
          ungroundedSymbols: ungrounded,
        },
      }
    }

    // related
    if (!args.symbol?.trim()) throw new Error("repo_wiki related requires `symbol`")
    const query = args.symbol.trim()
    const related = await relatedWikiPages({ root, wikiDir, symbol: query })
    const pages = await loadWikiPages({ root, wikiDir })
    const byPath = pages
      .filter((entry) => entry.sources.some((source) => source === query || source.endsWith(`/${query}`)))
      .map((entry) => entry.relativePath)
    const seen = new Set<string>()
    const lines: string[] = []
    for (const match of related.matches.slice(0, MAX_RELATED)) {
      if (seen.has(match.path)) continue
      seen.add(match.path)
      lines.push(`- ${match.path} (${match.via}) - ${match.title}`)
    }
    for (const path of byPath) {
      if (seen.has(path)) continue
      seen.add(path)
      lines.push(`- ${path} (source)`)
    }
    const output = lines.length
      ? [`Pages related to "${query}" in ${related.pageCount} page(s):`, "", ...lines].join("\n")
      : `No wiki page references "${query}".`
    return {
      title: `repo_wiki related: ${query}`,
      output,
      metadata: { freshness: status.freshness, matchCount: seen.size },
    }
  },
})
