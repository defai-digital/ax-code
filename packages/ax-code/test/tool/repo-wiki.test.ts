import { describe, expect, test } from "vitest"
import path from "node:path"
import { writeFile, mkdir } from "node:fs/promises"
import { buildAxWiki, type WikiPageGenerationRequest } from "@ax-code/ax-wiki/node"
import { RepoWikiTool } from "../../src/tool/repo_wiki"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// The tool reads repository files through the real wiki pipeline; this context
// stub keeps permissions, abort signals, and metadata callbacks out of the way.
const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

function generator(symbols: string[] = []) {
  return async (_request: WikiPageGenerationRequest) => ({
    summary: "A source-backed page about repository responsibilities and workflows.",
    body: "## Purpose\n\nThis page describes repository responsibilities and how to verify them against the cited source files.\n",
    symbols,
  })
}

async function buildFixtureWiki(root: string, symbols: string[] = []) {
  await mkdir(path.join(root, "packages/core/src"), { recursive: true })
  await writeFile(path.join(root, "README.md"), "# Fixture\n\nA repository used to test AX Wiki.\n")
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "vitest" } }))
  await writeFile(path.join(root, "packages/core/src/index.ts"), "export function coreValue() { return 1 }\n")
  await buildAxWiki({ root, action: "generate", generator: generator(symbols) })
}

describe("tool.repo_wiki", () => {
  test("index lists wiki pages with their sources", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        const result = await tool.execute({ operation: "index" }, ctx)
        expect(result.output).toContain("quickstart.md")
        expect(result.output).toContain("sources:")
        expect(result.output).toContain("quickstart.md [fresh]")
        expect(result.metadata.pageCount).toBeGreaterThan(0)
      },
    })
  })

  test("read returns the page body plus the sources to verify", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        const result = await tool.execute({ operation: "read", page: "quickstart.md" }, ctx)
        expect(result.metadata.found).toBe(true)
        expect(result.output).toContain("sources")
        expect(result.output).toContain("page freshness: fresh")
        expect(result.metadata.pageFreshness).toBe("fresh")
        expect(result.metadata.ungroundedSymbols).toEqual([])
      },
    })
  })

  test("read flags a changed cited source and unverified symbols for that page only", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path, ["GhostSymbol"])
    await writeFile(path.join(tmp.path, "README.md"), "# Fixture changed\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        const result = await tool.execute({ operation: "read", page: "quickstart.md" }, ctx)
        expect(result.metadata.pageFreshness).toBe("stale")
        expect(result.output).toContain("changed sources")
        expect(result.output).toContain("- README.md")
        expect(result.metadata.ungroundedSymbols).toEqual(["GhostSymbol"])
        expect(result.output).toContain("unverified symbols")
      },
    })
  })

  test("read of an unknown page suggests real pages instead of failing", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        const result = await tool.execute({ operation: "read", page: "quick.md" }, ctx)
        expect(result.metadata.found).toBe(false)
        expect(result.output).toContain("quickstart.md")
      },
    })
  })

  test("related resolves pages by body mention when no exact symbol matches", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        const result = await tool.execute({ operation: "related", symbol: "repository" }, ctx)
        expect(result.output).toContain('related to "repository"')
        expect(result.metadata.matchCount).toBeGreaterThan(0)
      },
    })
  })

  test("missing wiki returns a soft-fail message rather than throwing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        const result = await tool.execute({ operation: "index" }, ctx)
        expect(result.metadata.available).toBe(false)
        expect(result.output).toContain("ax-code wiki generate")
      },
    })
  })
})
