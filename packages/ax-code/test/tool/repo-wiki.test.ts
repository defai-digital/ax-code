import { describe, expect, test } from "vitest"
import path from "node:path"
import { writeFile, readFile, mkdir, cp, symlink } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { buildAxWiki, type WikiPageGenerationRequest } from "@ax-code/ax-wiki/node"
import { RepoWikiTool } from "../../src/tool/repo_wiki"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { parseJsonStrict } from "../../src/util/json-value"
import { queryWikiCodingInsights, CODING_INSIGHT_LIMITS } from "../../src/wiki/coding-insights"

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
  test("insights supply file evidence and checks, and re-query the current edited bytes", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path)
    const index = "packages/core/src/index.ts"
    const consumer = "packages/core/src/consumer.ts"
    await writeFile(
      path.join(tmp.path, consumer),
      'import { coreValue } from "./index"\nexport const value = coreValue()\n',
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        const query = async () => {
          const result = await tool.execute({ operation: "insights", targets: [index, consumer] }, ctx)
          expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(CODING_INSIGHT_LIMITS.outputBytes)
          return parseJsonStrict(result.output) as {
            evidenceId: string
            targets: Array<{
              path: string
              dependents: { files: string[] }
              source: { hash: string }
              relatedPages: Array<{ targetFreshness: string }>
              checks: Array<{ kind: string }>
            }>
            unavailable: string[]
          }
        }
        const first = await query()
        const target = first.targets.find((target) => target.path === index)!
        expect(target.dependents.files).toContain(consumer)
        expect(target.checks.some((check) => check.kind === "inspect-dependents")).toBe(true)
        expect(target.relatedPages.every((page) => page.targetFreshness === "fresh")).toBe(true)
        expect(first.unavailable).toContain("git-co-change")
        await writeFile(path.join(tmp.path, index), "export function coreValue() { return 2 }\n")
        const next = await query()
        expect(next.evidenceId).not.toBe(first.evidenceId)
        const updated = next.targets.find((target) => target.path === index)!
        expect(updated.source.hash).not.toBe(target.source.hash)
        expect(updated.relatedPages.every((page) => page.targetFreshness === "stale")).toBe(true)
      },
    })
  })

  test("insights respect source and resolver-config read denials and cancellation", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path)
    await writeFile(
      path.join(tmp.path, "tsconfig.json"),
      '{"compilerOptions":{"paths":{"@/*":["packages/core/src/*"]}}}',
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        for (const blocked of ["tsconfig.json", "packages/core/src/index.ts"]) {
          const asked: string[] = []
          await expect(
            tool.execute(
              { operation: "insights", targets: ["packages/core/src/index.ts"] },
              {
                ...ctx,
                ask: async (request) => {
                  asked.push(...request.patterns)
                  if (request.patterns.includes(blocked)) throw new Error(`denied ${blocked}`)
                },
              },
            ),
          ).rejects.toThrow(`denied ${blocked}`)
          expect(asked).toContain(blocked)
        }
        const abort = new AbortController()
        abort.abort(new Error("cancel insights"))
        await expect(
          tool.execute(
            { operation: "insights", targets: ["packages/core/src/index.ts"] },
            { ...ctx, abort: abort.signal },
          ),
        ).rejects.toThrow("cancel insights")
      },
    })
  })

  test("insights reject escaping targets and do not follow source-directory symlinks", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    await buildFixtureWiki(tmp.path)
    await writeFile(path.join(outside.path, "secret.ts"), 'export const secret = "DO_NOT_EXPOSE"\n')
    await symlink(outside.path, path.join(tmp.path, "linked"))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RepoWikiTool.init()
        await expect(tool.execute({ operation: "insights", targets: ["../secret.ts"] }, ctx)).rejects.toThrow(
          "safe repository-relative",
        )
        const result = await tool.execute({ operation: "insights", targets: ["linked/secret.ts"] }, ctx)
        expect(result.output).not.toContain("DO_NOT_EXPOSE")
        const payload = parseJsonStrict(result.output) as {
          targets: Array<{ source: { status: string }; checks: Array<{ kind: string }> }>
        }
        expect(payload.targets[0].source.status).toBe("unavailable")
        expect(payload.targets[0].checks.some((check) => check.kind === "verify-coverage")).toBe(true)
      },
    })
  })

  test("insights use a linked worktree's bytes rather than the primary checkout", async () => {
    await using tmp = await tmpdir({ git: true })
    await using sandbox = await tmpdir()
    await buildFixtureWiki(tmp.path)
    const worktree = path.join(sandbox.path, "linked")
    await promisify(execFile)("git", ["worktree", "add", "--detach", worktree], { cwd: tmp.path })
    await cp(path.join(tmp.path, ".ax-wiki"), path.join(worktree, ".ax-wiki"), { recursive: true })
    await mkdir(path.join(worktree, "packages/core/src"), { recursive: true })
    await writeFile(path.join(worktree, "packages/core/src/index.ts"), "export function coreValue() { return 99 }\n")
    const read = async (directory: string) =>
      Instance.provide({
        directory,
        fn: async () => {
          const result = await (
            await RepoWikiTool.init()
          ).execute({ operation: "insights", targets: ["packages/core/src/index.ts"] }, ctx)
          return parseJsonStrict(result.output) as {
            worktreeId: string
            targets: Array<{ source: { hash: string }; relatedPages: Array<{ targetFreshness: string }> }>
          }
        },
      })
    const main = await read(tmp.path)
    const linked = await read(worktree)
    expect(linked.worktreeId).not.toBe(main.worktreeId)
    expect(linked.targets[0].source.hash).not.toBe(main.targets[0].source.hash)
    expect(linked.targets[0].relatedPages.every((page) => page.targetFreshness === "stale")).toBe(true)
  })

  test("insights disclose prefix reads instead of certifying source freshness", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path)
    await writeFile(path.join(tmp.path, "large.ts"), "//" + "x".repeat(270_000))
    const result = await queryWikiCodingInsights({
      root: tmp.path,
      wikiDir: ".ax-wiki",
      targets: ["large.ts"],
      context: ctx,
    })
    const payload = parseJsonStrict(result!.output) as {
      targets: Array<{ source: { hashScope: string }; checks: Array<{ kind: string }> }>
    }
    expect(payload.targets[0].source.hashScope).toBe("prefix")
    expect(payload.targets[0].checks.some((check) => check.kind === "verify-coverage")).toBe(true)
  })

  test("large insight neighborhoods remain valid bounded JSON with honest omitted counts", async () => {
    await using tmp = await tmpdir({ git: true })
    await buildFixtureWiki(tmp.path)
    const directory = `src/${"長".repeat(65)}`
    await mkdir(path.join(tmp.path, directory), { recursive: true })
    const targets = Array.from({ length: 5 }, (_, index) => `${directory}/target-${index}.ts`)
    const parents = Array.from({ length: 24 }, (_, index) => `${directory}/consumer-${index}.ts`)
    for (const target of targets) await writeFile(path.join(tmp.path, target), "export const value = 1\n")
    for (const parent of parents)
      await writeFile(path.join(tmp.path, parent), targets.map((_, index) => `import "./target-${index}"`).join("\n"))
    const manifestPath = path.join(tmp.path, ".ax-wiki/.manifest.json")
    const manifest = parseJsonStrict(await readFile(manifestPath, "utf8")) as {
      pages: Record<string, { sources: string[] }>
    }
    manifest.pages["quickstart.md"].sources.push(...targets, ...parents)
    await writeFile(manifestPath, JSON.stringify(manifest))
    const result = await queryWikiCodingInsights({ root: tmp.path, wikiDir: ".ax-wiki", targets, context: ctx })
    expect(Buffer.byteLength(result!.output)).toBeLessThanOrEqual(CODING_INSIGHT_LIMITS.outputBytes)
    const payload = parseJsonStrict(result!.output) as {
      outputReduced: boolean
      targets: Array<{ dependents: { count: number; files: string[]; omitted: number } }>
    }
    expect(payload.outputReduced).toBe(true)
    for (const target of payload.targets) {
      expect(target.dependents.count).toBe(24)
      expect(target.dependents.files.length + target.dependents.omitted).toBe(24)
    }
  })

  test("disabled and missing wiki insight queries do not scan source files", async () => {
    await using tmp = await tmpdir({ git: true, config: { wiki: { enabled: false } } })
    await buildFixtureWiki(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const requests: string[] = []
        const tool = await RepoWikiTool.init()
        for (const operation of ["index", "read", "related", "insights"] as const) {
          const result = await tool.execute(
            { operation, page: "quickstart.md", symbol: "coreValue", targets: ["packages/core/src/index.ts"] },
            {
              ...ctx,
              ask: async (request) => {
                requests.push(...request.patterns)
              },
            },
          )
          expect(result.metadata.available).toBe(false)
          expect(result.output).toContain("AX Wiki is disabled")
          expect(result.output).toContain("focused read/search")
        }
        expect(requests).toEqual([])
      },
    })
    await using empty = await tmpdir()
    const result = await queryWikiCodingInsights({
      root: empty.path,
      wikiDir: ".ax-wiki",
      targets: ["any.ts"],
      context: {
        ...ctx,
        ask: async () => {
          throw new Error("unexpected source read")
        },
      },
    })
    expect(result).toBeUndefined()
  })

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
        expect(result.output).toContain("Continue with current source")
      },
    })
  })
})
