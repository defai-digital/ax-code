/**
 * Enumerate and lightly parse OpenWiki markdown pages.
 */

import path from "path"
import { readdir, readFile } from "fs/promises"

export type WikiPage = {
  /** Absolute path */
  absPath: string
  /** Path relative to project root */
  relPath: string
  /** Path relative to wiki dir */
  wikiRel: string
  title: string
  summary: string
  /** Symbol names from frontmatter (if any) */
  symbols: string[]
  /** Raw frontmatter keys (string values only) */
  meta: Record<string, string>
  body: string
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".openwiki"])

export async function listMarkdownFiles(wikiDir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        await walk(full)
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        out.push(full)
      }
    }
  }
  await walk(wikiDir)
  return out.sort()
}

/**
 * Minimal frontmatter parser (no full YAML). Supports:
 *   title: Foo
 *   symbols:
 *     - Bar
 *     - Baz
 *   symbols: [Bar, Baz]
 * Also accepts ax_symbols / ax-code-symbols as aliases.
 */
export function parseWikiFrontmatter(content: string): {
  meta: Record<string, string>
  symbols: string[]
  body: string
} {
  const meta: Record<string, string> = {}
  const symbols: string[] = []
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!fm) {
    return { meta, symbols, body: content }
  }

  const block = fm[1]
  const body = content.slice(fm[0].length)
  const lines = block.split(/\r?\n/)
  let inSymbols = false

  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === "") continue

    const listItem = line.match(/^\s*-\s+(.+?)\s*$/)
    if (inSymbols && listItem) {
      const name = stripQuotes(listItem[1])
      if (name) symbols.push(name)
      continue
    }
    inSymbols = false

    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const raw = kv[2].trim()

    if (key === "symbols" || key === "ax_symbols" || key === "ax-code-symbols") {
      if (raw.startsWith("[") && raw.endsWith("]")) {
        for (const part of raw.slice(1, -1).split(",")) {
          const name = stripQuotes(part.trim())
          if (name) symbols.push(name)
        }
      } else if (raw === "" || raw === "|" || raw === ">") {
        inSymbols = true
      } else {
        const name = stripQuotes(raw)
        if (name) symbols.push(name)
      }
      continue
    }

    meta[key] = stripQuotes(raw)
  }

  return { meta, symbols: unique(symbols), body }
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim()
  }
  return t
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

export function extractTitle(body: string, meta: Record<string, string>, fileName: string): string {
  if (meta.title?.trim()) return meta.title.trim()
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return fileName.replace(/\.md$/i, "")
}

export function extractSummary(body: string, maxLen = 200): string {
  const lines = body.split(/\r?\n/)
  const paras: string[] = []
  let buf: string[] = []
  for (const line of lines) {
    if (line.startsWith("#")) continue
    if (line.trim() === "") {
      if (buf.length) {
        paras.push(buf.join(" ").trim())
        buf = []
      }
      continue
    }
    if (line.startsWith("```") || line.startsWith("|") || line.startsWith("- ") || line.startsWith("* ")) {
      if (buf.length) {
        paras.push(buf.join(" ").trim())
        buf = []
      }
      continue
    }
    buf.push(line.trim())
  }
  if (buf.length) paras.push(buf.join(" ").trim())
  const text = paras[0] ?? ""
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1).trimEnd() + "…"
}

export async function loadWikiPages(input: {
  root: string
  wikiDir: string
}): Promise<WikiPage[]> {
  const files = await listMarkdownFiles(input.wikiDir)
  const pages: WikiPage[] = []
  for (const abs of files) {
    let content: string
    try {
      content = await readFile(abs, "utf-8")
    } catch {
      continue
    }
    const { meta, symbols, body } = parseWikiFrontmatter(content)
    const base = path.basename(abs)
    pages.push({
      absPath: abs,
      relPath: path.relative(input.root, abs).replace(/\\/g, "/"),
      wikiRel: path.relative(input.wikiDir, abs).replace(/\\/g, "/"),
      title: extractTitle(body, meta, base),
      summary: extractSummary(body),
      symbols,
      meta,
      body,
    })
  }
  return pages
}
