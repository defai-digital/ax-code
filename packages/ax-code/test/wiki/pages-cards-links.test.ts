import { describe, expect, test } from "vitest"
import { mkdtemp, mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import {
  parseWikiFrontmatter,
  cardsFromPages,
  renderCardsMarkdown,
  buildSymbolIndex,
  findPagesForSymbol,
  loadWikiPages,
  isWikiStale,
  evaluateLint,
} from "../../src/wiki"
import type { WikiDetectResult } from "../../src/wiki"

describe("wiki frontmatter + cards + links + lint", () => {
  test("parseWikiFrontmatter extracts symbols list and title", () => {
    const raw = `---
title: Auth
symbols:
  - AuthService
  - login
---

# Auth

Hello world paragraph.
`
    const { meta, symbols, body } = parseWikiFrontmatter(raw)
    expect(meta.title).toBe("Auth")
    expect(symbols).toEqual(["AuthService", "login"])
    expect(body).toContain("Hello world")
  })

  test("parseWikiFrontmatter supports inline array", () => {
    const { symbols } = parseWikiFrontmatter(`---
symbols: [Foo, Bar]
---
body
`)
    expect(symbols).toEqual(["Foo", "Bar"])
  })

  test("cardsFromPages and renderCardsMarkdown", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ax-wiki-cards-"))
    const wiki = path.join(root, "openwiki")
    await mkdir(wiki, { recursive: true })
    await writeFile(
      path.join(wiki, "auth.md"),
      `---
title: Auth
symbols:
  - AuthService
---

# Auth

Authentication entrypoints live here.
`,
      "utf-8",
    )
    await writeFile(path.join(wiki, "quickstart.md"), "# Quickstart\n\nIndex page.\n", "utf-8")
    const pages = await loadWikiPages({ root, wikiDir: wiki })
    const cards = cardsFromPages(pages)
    expect(cards.some((c) => c.title === "Auth")).toBe(true)
    const md = renderCardsMarkdown({ wikiDirRelative: "openwiki", cards })
    expect(md).toContain("AuthService")
    expect(md).toContain("openwiki/auth.md")
  })

  test("symbol index resolves case-insensitively", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ax-wiki-links-"))
    const wiki = path.join(root, "openwiki")
    await mkdir(wiki, { recursive: true })
    await writeFile(
      path.join(wiki, "x.md"),
      `---
symbols:
  - AuthService
---
# X
`,
      "utf-8",
    )
    const pages = await loadWikiPages({ root, wikiDir: wiki })
    const index = buildSymbolIndex(pages)
    expect(findPagesForSymbol(index, "AuthService")).toHaveLength(1)
    expect(findPagesForSymbol(index, "authservice")).toHaveLength(1)
    expect(findPagesForSymbol(index, "Missing")).toHaveLength(0)
  })

  test("isWikiStale prefix-aware", () => {
    expect(isWikiStale(undefined, "abc")).toBe(false)
    expect(isWikiStale("abcdef", "abcdef123")).toBe(false)
    expect(isWikiStale("abcdef123", "abcdef")).toBe(false)
    expect(isWikiStale("aaaa", "bbbb")).toBe(true)
  })

  test("evaluateLint flags missing wiki and stale cursor", () => {
    const det: WikiDetectResult = {
      root: "/tmp/p",
      wikiDir: "/tmp/p/openwiki",
      wikiDirRelative: "openwiki",
      wikiExists: true,
      hasIndex: true,
      lastUpdate: { commit: "aaa" },
      binary: { found: true, command: "openwiki" },
    }
    const report = evaluateLint({
      det,
      headCommit: "bbb",
      pageCount: 2,
      linkedPageCount: 0,
      symbolCount: 0,
      emptySummaryCount: 0,
      hasEmptyBodies: 0,
    })
    expect(report.stale).toBe(true)
    expect(report.ok).toBe(true) // no hard errors
    expect(report.issues.some((i) => i.code === "wiki.stale")).toBe(true)
    expect(report.issues.some((i) => i.code === "wiki.no_symbol_links")).toBe(true)
  })
})
