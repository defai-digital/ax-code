import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { discoverSources } from "./discovery"
import { parseFrontmatter } from "./frontmatter"
import { sha256 } from "./hash"
import { AX_WIKI_DIR_DEFAULT, INDEX_CANDIDATES, normalizePath, resolveInside, sanitizeWikiDir } from "./paths"
import { createWikiPlan } from "./plan"
import { validateWikiCandidate } from "./validate"
import { loadAxWikiConfig, loadWikiManifest } from "./build"
import { assertWikiDirectorySafe } from "./safety"
import type { AxWikiConfig, WikiCard, WikiManifest, WikiPage, WikiValidationReport } from "./types"

async function exists(file: string): Promise<boolean> {
  return access(file)
    .then(() => true)
    .catch(() => false)
}

export async function listMarkdownFiles(directory: string): Promise<string[]> {
  const output: string[] = []
  async function walk(current: string) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile() && entry.name.endsWith(".md")) output.push(absolute)
    }
  }
  await walk(directory)
  return output.sort()
}

export async function loadWikiPages(input: { root: string; wikiDir?: string }): Promise<WikiPage[]> {
  const wikiDir = sanitizeWikiDir(input.wikiDir)
  await assertWikiDirectorySafe(input.root, wikiDir)
  const absolute = resolveInside(input.root, wikiDir)
  const files = await listMarkdownFiles(absolute)
  const pages: WikiPage[] = []
  for (const file of files) {
    const content = await readFile(file, "utf8")
    const meta = parseFrontmatter(content)
    const relativePath = normalizePath(path.relative(absolute, file))
    const heading = meta.body.match(/^#\s+(.+)$/m)?.[1]?.trim()
    pages.push({
      path: file,
      relativePath,
      title: meta.title ?? heading ?? path.posix.basename(relativePath, ".md"),
      summary: meta.summary,
      symbols: meta.symbols,
      sources: meta.sources,
      body: meta.body,
      content,
    })
  }
  return pages
}

export function cardsFromPages(pages: WikiPage[]): WikiCard[] {
  return pages
    .filter((page) => !["index.md", "Index.md"].includes(path.posix.basename(page.relativePath)))
    .map((page) => ({
      path: page.relativePath,
      title: page.title,
      summary: page.summary,
      symbols: page.symbols,
      sources: page.sources,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function cardFromPage(page: WikiPage): WikiCard {
  return {
    path: page.relativePath,
    title: page.title,
    summary: page.summary,
    symbols: page.symbols,
    sources: page.sources,
  }
}

export function renderCardsMarkdown(cards: WikiCard[]): string {
  const lines = [
    "# AX Wiki cards",
    "",
    "High-density index generated from the source-backed AX Wiki. Read linked pages for details; use code intelligence for structural proof.",
    "",
  ]
  for (const card of cards) {
    lines.push(`## [${card.title}](${card.path})`, "")
    if (card.summary) lines.push(card.summary, "")
    if (card.symbols.length) lines.push(`Symbols: ${card.symbols.map((symbol) => `\`${symbol}\``).join(", ")}`, "")
    if (card.sources.length)
      lines.push(
        `Sources: ${card.sources
          .slice(0, 8)
          .map((source) => `\`${source}\``)
          .join(", ")}`,
        "",
      )
  }
  return `${lines.join("\n").trimEnd()}\n`
}

export async function buildWikiCards(input: { root: string; wikiDir?: string }): Promise<{
  cards: WikiCard[]
  markdown: string
  wikiDir: string
  defaultOutputPath: string
}> {
  const wikiDir = sanitizeWikiDir(input.wikiDir)
  const cards = cardsFromPages(await loadWikiPages({ root: input.root, wikiDir }))
  return {
    cards,
    markdown: renderCardsMarkdown(cards),
    wikiDir,
    defaultOutputPath: resolveInside(input.root, path.posix.join(".ax-code", "wiki-cards.md")),
  }
}

export async function writeWikiCards(file: string, markdown: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, markdown, "utf8")
}

export async function relatedWikiPages(input: {
  root: string
  symbol: string
  wikiDir?: string
  mentionFallback?: boolean
}): Promise<{ symbol: string; matches: Array<WikiCard & { via: "symbol" | "mention" }>; pageCount: number }> {
  const pages = await loadWikiPages({ root: input.root, wikiDir: input.wikiDir })
  const query = input.symbol.trim().toLowerCase()
  const exact = pages.filter((page) => page.symbols.some((symbol) => symbol.toLowerCase() === query))
  const matches: Array<WikiCard & { via: "symbol" | "mention" }> = exact.map((page) => ({
    ...cardFromPage(page),
    via: "symbol",
  }))
  if (matches.length === 0 && input.mentionFallback !== false) {
    for (const page of pages) {
      if (!page.body.toLowerCase().includes(query)) continue
      matches.push({ ...cardFromPage(page), via: "mention" })
      if (matches.length >= 10) break
    }
  }
  return { symbol: input.symbol.trim(), matches, pageCount: pages.length }
}

export type WikiStatus = {
  root: string
  wikiDir: string
  exists: boolean
  hasIndex: boolean
  index?: string
  pageCount: number
  manifest?: WikiManifest
  stale: boolean
  healthy: boolean
  recommendations: string[]
}

export async function getWikiStatus(input: {
  root: string
  wikiDir?: string
  repositoryHead?: string
}): Promise<WikiStatus> {
  const root = path.resolve(input.root)
  const wikiDir = sanitizeWikiDir(input.wikiDir)
  await assertWikiDirectorySafe(root, wikiDir)
  const absolute = resolveInside(root, wikiDir)
  const directory = await stat(absolute)
    .then((value) => value.isDirectory())
    .catch(() => false)
  const index = directory
    ? await (async () => {
        for (const candidate of INDEX_CANDIDATES) if (await exists(path.join(absolute, candidate))) return candidate
        return undefined
      })()
    : undefined
  const pages = directory ? await listMarkdownFiles(absolute) : []
  const manifest = await loadWikiManifest(root, wikiDir)
  const stale = Boolean(
    input.repositoryHead && manifest?.repositoryHead && input.repositoryHead !== manifest.repositoryHead,
  )
  const healthy = directory && Boolean(index) && Boolean(manifest)
  const recommendations: string[] = []
  if (!directory) recommendations.push(`No AX Wiki at ${wikiDir}/. Run: ax-code wiki generate`)
  else if (!index) recommendations.push("AX Wiki has no quickstart.md. Run: ax-code wiki generate")
  if (!manifest) recommendations.push("AX Wiki manifest is missing or invalid. Run: ax-code wiki generate")
  if (stale) recommendations.push("AX Wiki is behind git HEAD. Run: ax-code wiki update")
  if (healthy && !stale) recommendations.push("AX Wiki is ready. Use ax-code wiki update after substantial changes.")
  return {
    root,
    wikiDir,
    exists: directory,
    hasIndex: Boolean(index),
    index,
    pageCount: pages.length,
    manifest,
    stale,
    healthy,
    recommendations,
  }
}

export async function lintWiki(input: {
  root: string
  wikiDir?: string
  repositoryHead?: string
  config?: AxWikiConfig
}): Promise<WikiValidationReport & { stale: boolean; wikiDir: string }> {
  const root = path.resolve(input.root)
  const wikiDir = sanitizeWikiDir(input.wikiDir)
  const diskConfig = await loadAxWikiConfig(root)
  const explicitConfig = Object.fromEntries(
    Object.entries(input.config ?? {}).filter((entry) => entry[1] !== undefined),
  ) as AxWikiConfig
  const config = { ...diskConfig, ...explicitConfig }
  const sources = await discoverSources({ root, wikiDir, config })
  const plan = createWikiPlan(sources, config)
  const manifest = await loadWikiManifest(root, wikiDir)
  const pages = new Map((await loadWikiPages({ root, wikiDir })).map((page) => [page.relativePath, page.content]))
  const report = validateWikiCandidate({ plan, pages, sources, manifest })
  const staleByHead = Boolean(
    input.repositoryHead && manifest?.repositoryHead && input.repositoryHead !== manifest.repositoryHead,
  )
  const staleBySource =
    Boolean(manifest && sources.some((source) => manifest.sources[source.path] !== source.hash)) ||
    Boolean(
      manifest && Object.keys(manifest.sources).some((source) => !sources.some((current) => current.path === source)),
    )
  const stale = staleByHead || staleBySource
  if (stale)
    report.issues.push({
      level: "warning",
      code: "wiki.stale",
      message: "AX Wiki sources differ from the current repository",
    })
  return { ...report, stale, wikiDir }
}

export function pageContentHash(content: string): string {
  return sha256(content)
}
