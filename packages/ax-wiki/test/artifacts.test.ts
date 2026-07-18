import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  AX_WIKI_END,
  AX_WIKI_START,
  defaultAxWikiBlock,
  ensureAgentsWikiPointers,
  parseFrontmatter,
  renderWikiPage,
  upsertAxWikiBlock,
} from "../src"

describe("AX Wiki artifacts", () => {
  test("round-trips generated frontmatter including empty lists", () => {
    const content = renderWikiPage({
      page: {
        path: "quickstart.md",
        title: "Quickstart",
        purpose: "Orient readers",
        selectors: ["README.md"],
        kind: "quickstart",
      },
      result: {
        summary: "A source-backed introduction to this repository.",
        body: "## Overview\n\nThis repository overview contains enough content to guide a new contributor through setup and verification without guessing behavior.",
        symbols: [],
      },
      sources: [],
    })
    const parsed = parseFrontmatter(content)
    expect(parsed.symbols).toEqual([])
    expect(parsed.sources).toEqual([])
    expect(parsed.generatedBy).toBe("ax-wiki")
  })

  test("updates only the managed AX Wiki pointer block", () => {
    const first = upsertAxWikiBlock("# Rules\n\nKeep me.\n", defaultAxWikiBlock("docs/wiki"))
    const second = upsertAxWikiBlock(first, defaultAxWikiBlock("ax-wiki"))
    expect(second).toContain("Keep me.")
    expect(second).toContain("`ax-wiki/quickstart.md`")
    expect(second).not.toContain("`docs/wiki/quickstart.md`")
  })

  test("repairs incomplete pointer markers", () => {
    const repairedStart = upsertAxWikiBlock(`# Rules\n\n${AX_WIKI_START}\nbroken managed text`)
    expect(repairedStart.match(new RegExp(AX_WIKI_START, "g"))).toHaveLength(1)
    expect(repairedStart).toContain(AX_WIKI_END)
    const repairedEnd = upsertAxWikiBlock(`# Rules\n\n${AX_WIKI_END}\nKeep me.`)
    expect(repairedEnd).toContain("Keep me.")
    expect(repairedEnd.match(new RegExp(AX_WIKI_END, "g"))).toHaveLength(1)
  })

  test.runIf(process.platform !== "win32")("refuses to follow instruction-file symlinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-wiki-agents-"))
    const outside = `${root}-outside.md`
    try {
      await writeFile(outside, "outside\n")
      await symlink(outside, path.join(root, "AGENTS.md"))
      await expect(ensureAgentsWikiPointers(root)).rejects.toThrow("symlinked instruction file")
      expect(await readFile(outside, "utf8")).toBe("outside\n")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { force: true })
    }
  })
})
