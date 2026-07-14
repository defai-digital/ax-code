/**
 * Wiki ↔ symbol cross-links via optional frontmatter `symbols:` lists.
 *
 * Frontmatter example on a wiki page:
 *
 * ---
 * title: Auth flow
 * symbols:
 *   - AuthService
 *   - login
 * ---
 */

import type { WikiPage } from "./pages"
import { loadWikiPages } from "./pages"
import { detectWiki } from "./detect"

export type WikiSymbolLink = {
  symbol: string
  pages: Array<{ title: string; path: string; summary: string }>
}

export type WikiLinkIndex = {
  /** symbol (case-sensitive key as declared) → pages */
  bySymbol: Map<string, WikiPage[]>
  /** lower(symbol) → original keys */
  lowerToKeys: Map<string, string[]>
  pages: WikiPage[]
  linkedPageCount: number
  symbolCount: number
}

export function buildSymbolIndex(pages: WikiPage[]): WikiLinkIndex {
  const bySymbol = new Map<string, WikiPage[]>()
  const lowerToKeys = new Map<string, string[]>()

  for (const page of pages) {
    for (const sym of page.symbols) {
      const key = sym.trim()
      if (!key) continue
      const list = bySymbol.get(key) ?? []
      list.push(page)
      bySymbol.set(key, list)
      const low = key.toLowerCase()
      const keys = lowerToKeys.get(low) ?? []
      if (!keys.includes(key)) keys.push(key)
      lowerToKeys.set(low, keys)
    }
  }

  let linkedPageCount = 0
  for (const p of pages) {
    if (p.symbols.length) linkedPageCount++
  }

  return {
    bySymbol,
    lowerToKeys,
    pages,
    linkedPageCount,
    symbolCount: bySymbol.size,
  }
}

export function findPagesForSymbol(index: WikiLinkIndex, symbol: string): WikiPage[] {
  const exact = index.bySymbol.get(symbol)
  if (exact?.length) return exact
  const keys = index.lowerToKeys.get(symbol.toLowerCase()) ?? []
  const out: WikiPage[] = []
  const seen = new Set<string>()
  for (const k of keys) {
    for (const p of index.bySymbol.get(k) ?? []) {
      if (seen.has(p.relPath)) continue
      seen.add(p.relPath)
      out.push(p)
    }
  }
  return out
}

/**
 * Fallback: pages whose title or body mention the symbol as a whole word (bounded).
 */
export function findPagesByMention(pages: WikiPage[], symbol: string, limit = 10): WikiPage[] {
  const needle = symbol.trim()
  // Empty or tiny needles would match too broadly (or break word boundaries).
  if (needle.length < 2) return []
  const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i")
  const hits: WikiPage[] = []
  for (const p of pages) {
    if (re.test(p.title) || re.test(p.body)) {
      hits.push(p)
      if (hits.length >= limit) break
    }
  }
  return hits
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function relatedWikiPages(input: {
  root: string
  symbol: string
  dir?: string
  mentionFallback?: boolean
}): Promise<
  | {
      symbol: string
      matches: Array<{ title: string; path: string; summary: string; via: "frontmatter" | "mention" }>
      indexStats: { symbolCount: number; linkedPageCount: number; pageCount: number }
    }
  | { error: string }
> {
  const det = await detectWiki({ root: input.root, dir: input.dir })
  if (!det.wikiExists) {
    return { error: `No wiki directory at ${det.wikiDirRelative}/.` }
  }
  const pages = await loadWikiPages({ root: det.root, wikiDir: det.wikiDir })
  const index = buildSymbolIndex(pages)
  const fmHits = findPagesForSymbol(index, input.symbol)
  const matches: Array<{ title: string; path: string; summary: string; via: "frontmatter" | "mention" }> = fmHits.map(
    (p) => ({
      title: p.title,
      path: p.relPath,
      summary: p.summary,
      via: "frontmatter" as const,
    }),
  )

  if (matches.length === 0 && input.mentionFallback !== false) {
    for (const p of findPagesByMention(pages, input.symbol)) {
      matches.push({
        title: p.title,
        path: p.relPath,
        summary: p.summary,
        via: "mention",
      })
    }
  }

  return {
    symbol: input.symbol,
    matches,
    indexStats: {
      symbolCount: index.symbolCount,
      linkedPageCount: index.linkedPageCount,
      pageCount: pages.length,
    },
  }
}
