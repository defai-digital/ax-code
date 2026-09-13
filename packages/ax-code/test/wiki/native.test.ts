import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock("ai", () => ({
  streamObject: (request: unknown) => {
    let result: any
    return {
      fullStream: (async function* () {
        result = await generateObject(request)
        if (result.streamError) yield { type: "error", error: result.streamError }
      })(),
      get object() {
        return Promise.resolve(result.object)
      },
    }
  },
}))

vi.mock("@ax-code/ax-wiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ax-code/ax-wiki")>()
  return {
    ...actual,
    buildAxWiki: vi.fn(),
  }
})

vi.mock("../../src/code-intelligence/graph-context", () => ({
  GraphContext: {
    build: vi.fn(),
  },
}))

import { buildAxWiki, type EvidenceBundle, type WikiPageGenerationRequest, type WikiSource } from "@ax-code/ax-wiki"
import { GraphContext, type GraphContextPack } from "../../src/code-intelligence/graph-context"
import { CodeNodeID } from "../../src/code-intelligence/id"
import { Installation } from "../../src/installation"
import { Instance } from "../../src/project/instance"
import { runNativeWiki } from "../../src/wiki/native"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  vi.clearAllMocks()
})

const PAGE = {
  path: "overview.md",
  title: "Overview",
  purpose: "Describe the repository",
  selectors: [] as string[],
  kind: "quickstart" as const,
}

const SOURCE: WikiSource = {
  path: "src/index.ts",
  hash: "abc123",
  bytes: 32,
  category: "code",
  language: "typescript",
}

function emptyPack(overrides: Partial<GraphContextPack> = {}): GraphContextPack {
  return {
    query: `${PAGE.title}. ${PAGE.purpose}`,
    output: "# Graph Context\n",
    symbols: [],
    relationships: [],
    snippets: [],
    frameworkBindings: [],
    heuristicBindings: [],
    notes: [],
    omitted: { symbols: 0, snippets: 0, relationships: 0 },
    candidateCapped: false,
    recommendations: [],
    envelope: {
      data: {},
      source: "graph",
      completeness: "empty",
      timestamp: 1_700_000_000_000,
      serverIDs: [],
      degraded: false,
    },
    ...overrides,
  }
}

function generatedPage() {
  return {
    object: {
      summary: "A long enough summary of the generated wiki page for schema.",
      body: "A long enough generated wiki page body so the schema minimum length is satisfied.",
      symbols: [],
    },
  }
}

function wikiResult(root: string, request: WikiPageGenerationRequest) {
  return {
    action: "update" as const,
    root,
    wikiDir: "openwiki",
    plan: request.plan,
    generatedPages: ["overview.md"],
    unchangedPages: [],
    removedPages: [],
    conflicts: [],
    manifest: {} as never,
    validation: {} as never,
  }
}

async function runNative(
  tmpPath: string,
  invokeEvidence = false,
  streamError?: Error,
): Promise<{ evidence?: EvidenceBundle }> {
  vi.mocked(generateObject).mockResolvedValue({ ...generatedPage(), streamError })
  let evidence: EvidenceBundle | undefined
  vi.mocked(buildAxWiki).mockImplementation(async (input) => {
    const request: WikiPageGenerationRequest = {
      action: "update",
      root: tmpPath,
      wikiDir: "openwiki",
      page: PAGE,
      plan: { schemaVersion: 1, pages: [], modules: [], sourceCount: 0 },
      sources: [{ ...SOURCE, content: "export {}", truncated: false }],
      sourceInventory: [SOURCE],
    }
    if (invokeEvidence && input.evidenceProvider) {
      evidence = await input.evidenceProvider.provide({
        root: tmpPath,
        page: PAGE,
        sources: [SOURCE],
      })
      request.evidence = evidence
    }
    await input.generator(request)
    return wikiResult(tmpPath, request)
  })

  await Instance.provide({
    directory: tmpPath,
    init: async () => {
      const { Env } = await import("../../src/env")
      Env.set("GROQ_API_KEY", "test-api-key")
    },
    fn: async () => {
      await runNativeWiki({ root: tmpPath, action: "update", model: "groq/openai/gpt-oss-20b" })
    },
  })
  return { evidence }
}

describe("wiki native generator", () => {
  test("rejects stream errors instead of publishing a partial wiki page", async () => {
    await using tmp = await tmpdir({ git: true })
    await expect(runNative(tmp.path, false, new Error("stream disconnected"))).rejects.toThrow("stream disconnected")
  })

  test("sends a bounded output limit on every page generateObject call", async () => {
    await using tmp = await tmpdir({ git: true })
    await runNative(tmp.path)

    expect(generateObject).toHaveBeenCalledTimes(1)
    const request = vi.mocked(generateObject).mock.calls[0]?.[0] as { maxOutputTokens?: number }
    expect(request.maxOutputTokens).toEqual(expect.any(Number))
    expect(request.maxOutputTokens).toBeGreaterThan(0)
    expect(generateObject.mock.calls[0][0].messages[0].content).toContain("json object with summary")
  })

  test("passes typed evidenceProvider and a stable generator identity", async () => {
    await using tmp = await tmpdir({ git: true })
    await runNative(tmp.path)
    const input = vi.mocked(buildAxWiki).mock.calls[0]?.[0]
    expect(input?.evidenceProvider).toBeDefined()
    expect(input?.graphContext).toBeUndefined()
    expect(input?.generatorIdentity).toEqual({
      name: "ax-wiki",
      version: Installation.VERSION,
      promptVersion: "native-page-v2",
      model: input?.model,
    })
  })

  test("queries GraphContext with the existing seeds, budgets, and options", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.mocked(GraphContext.build).mockResolvedValue(emptyPack())
    await runNative(tmp.path, true)
    expect(GraphContext.build).toHaveBeenCalledTimes(1)
    expect(GraphContext.build).toHaveBeenCalledWith(expect.any(String), {
      query: "Overview. Describe the repository",
      seeds: [{ kind: "file", value: path.join(tmp.path, SOURCE.path) }],
      maxSymbols: 12,
      maxSnippets: 6,
      maxDepth: 1,
      includeImpact: false,
      freshness: "allowStaleWithWarning",
      scope: "worktree",
    })
  })

  test("returns a truthful queried-zero-results bundle and renders it for the model", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.mocked(GraphContext.build).mockResolvedValue(emptyPack())
    const { evidence } = await runNative(tmp.path, true)
    expect(evidence?.completeness).toBe("queried-zero-results")
    expect(evidence?.capability.graph).toBe(true)
    const prompt = (
      vi.mocked(generateObject).mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> }
    ).messages.find((message) => message.role === "user")?.content
    expect(prompt).toContain("completeness: queried-zero-results")
    expect(prompt).toContain("# Semantic Evidence")
  })

  test("returns a truthful failed bundle when GraphContext.build throws", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.mocked(GraphContext.build).mockRejectedValue(new Error("index unavailable"))
    const { evidence } = await runNative(tmp.path, true)
    const prompt = (
      vi.mocked(generateObject).mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> }
    ).messages.find((message) => message.role === "user")?.content
    expect(prompt).toContain("completeness: failed")
    expect(prompt).toContain("method=none")
    expect(evidence?.sources.map((source) => source.path)).toEqual([SOURCE.path])
  })

  test("marks tree-sitter-only symbols as syntactic partial evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.mocked(GraphContext.build).mockResolvedValue(
      emptyPack({
        symbols: [
          {
            id: CodeNodeID.make("code_node_partial"),
            kind: "function",
            name: "boot",
            qualifiedName: "src/index.ts::boot",
            file: `${tmp.path}/src/index.ts`,
            range: { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } },
            explain: {
              source: "code-graph",
              indexedAt: 1_700_000_000_000,
              completeness: "partial",
              queryId: "q_partial",
            },
          },
        ],
      }),
    )

    const { evidence } = await runNative(tmp.path, true)
    expect(evidence).toMatchObject({
      completeness: "partial",
      capability: { semantic: false, syntactic: true, graph: true },
      provenance: { method: "tree-sitter" },
    })
    expect(evidence?.symbols[0]?.provenance.method).toBe("tree-sitter")
  })

  test("maps indexed symbols into the typed bundle rendered for the model", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = `${tmp.path}/src/index.ts`
    vi.mocked(GraphContext.build).mockResolvedValue(
      emptyPack({
        symbols: [
          {
            id: CodeNodeID.make("code_node_test"),
            kind: "function",
            name: "boot",
            qualifiedName: "src/index.ts::boot",
            file,
            range: { start: { line: 3, character: 0 }, end: { line: 8, character: 1 } },
            signature: "function boot(): void",
            explain: {
              source: "code-graph",
              indexedAt: 1_700_000_000_000,
              completeness: "full",
              queryId: "q_volatile",
            },
          },
        ],
        envelope: {
          data: {},
          source: "graph",
          completeness: "full",
          timestamp: 1_700_000_000_000,
          serverIDs: [],
          degraded: false,
        },
      }),
    )
    await runNative(tmp.path, true)
    const prompt = (
      vi.mocked(generateObject).mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> }
    ).messages.find((message) => message.role === "user")?.content
    expect(prompt).toContain("completeness: complete")
    expect(prompt).toContain("[function] src/index.ts::boot")
    expect(prompt).toContain("src/index.ts:4")
  })
})
