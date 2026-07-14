import { describe, expect, test } from "vitest"
import { mkdtemp, mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { detectWiki, ensureAgentsWikiPointers } from "../../src/wiki"

describe("wiki/detect + ensureAgents (fs)", () => {
  test("detects missing wiki", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ax-wiki-"))
    const det = await detectWiki({ root, command: "openwiki-definitely-missing-xyz" })
    expect(det.wikiExists).toBe(false)
    expect(det.hasIndex).toBe(false)
    expect(det.binary.found).toBe(false)
  })

  test("does not treat a file named openwiki as a wiki directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ax-wiki-"))
    await writeFile(path.join(root, "openwiki"), "not a dir\n", "utf-8")
    const det = await detectWiki({ root, command: "openwiki-definitely-missing-xyz" })
    expect(det.wikiExists).toBe(false)
  })

  test("rejects path-traversal dir and falls back to openwiki", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ax-wiki-"))
    await mkdir(path.join(root, "openwiki"), { recursive: true })
    await writeFile(path.join(root, "openwiki", "quickstart.md"), "# QS\n", "utf-8")
    const det = await detectWiki({
      root,
      dir: "../outside",
      command: "openwiki-definitely-missing-xyz",
    })
    expect(det.wikiDirRelative).toBe("openwiki")
    expect(det.wikiExists).toBe(true)
  })

  test("detects wiki with quickstart and page count", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ax-wiki-"))
    await mkdir(path.join(root, "openwiki"), { recursive: true })
    await writeFile(path.join(root, "openwiki", "quickstart.md"), "# Quickstart\n", "utf-8")
    await writeFile(path.join(root, "openwiki", "arch.md"), "# Arch\n", "utf-8")
    await writeFile(
      path.join(root, "openwiki", ".last-update.json"),
      JSON.stringify({ commit: "abc", timestamp: "2026-07-14T00:00:00Z", model: "test" }),
      "utf-8",
    )

    const det = await detectWiki({ root, command: "openwiki-definitely-missing-xyz" })
    expect(det.wikiExists).toBe(true)
    expect(det.hasIndex).toBe(true)
    expect(det.indexRelative).toBe("openwiki/quickstart.md")
    expect(det.pageCount).toBe(2)
    expect(det.lastUpdate?.commit).toBe("abc")
  })

  test("ensureAgentsWikiPointers writes AGENTS.md markers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ax-wiki-"))
    await writeFile(path.join(root, "AGENTS.md"), "# Project\n\nRules here.\n", "utf-8")
    const result = await ensureAgentsWikiPointers(root)
    expect(result.updated).toContain("AGENTS.md")
    const again = await ensureAgentsWikiPointers(root)
    expect(again.updated).toEqual([])
    expect(again.skipped).toContain("AGENTS.md")
  })
})
