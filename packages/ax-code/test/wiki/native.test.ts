import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock("ai", async (load) => ({
  ...(await load<typeof import("ai")>()),
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

vi.mock("@ax-code/ax-wiki/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ax-code/ax-wiki/node")>()
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

import {
  buildAxWiki,
  type EvidenceBundle,
  type WikiPageGenerationRequest,
  type WikiSource,
} from "@ax-code/ax-wiki/node"
import { GraphContext, type GraphContextPack } from "../../src/code-intelligence/graph-context"
import { CodeNodeID } from "../../src/code-intelligence/id"
import { Installation } from "../../src/installation"
import { Instance } from "../../src/project/instance"
import {
  repairWikiPageText,
  resolveWikiModelRef,
  runNativeWiki,
  wikiPageOutputTokens,
  wikiPageProviderOptions,
  WIKI_PAGE_OUTPUT_TOKEN_MAX,
} from "../../src/wiki/native"
import { parseJsonStrict } from "../../src/util/json-value"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
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
    // groq/openai/gpt-oss-20b is non-GLM: it gets its full aux budget
    // min(65536, 32000, GROQ_OUTPUT_TOKEN_MAX=4096), not the GLM 8192 page cap.
    expect(request.maxOutputTokens).toBe(4_096)
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
      promptVersion: "native-page-v3",
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

  test("marks omitted graph relationships as partial instead of complete", async () => {
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
            explain: {
              source: "code-graph",
              indexedAt: 1_700_000_000_000,
              completeness: "full",
              queryId: "q_omitted",
            },
          },
        ],
        omitted: { symbols: 0, snippets: 0, relationships: 4 },
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

    const { evidence } = await runNative(tmp.path, true)
    expect(evidence?.completeness).toBe("partial")
    const prompt = (
      vi.mocked(generateObject).mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> }
    ).messages.find((message) => message.role === "user")?.content
    expect(prompt).toContain("completeness: partial")
  })
})

describe("wiki native page repair", () => {
  test("attaches a deterministic repair that rescues bound-only violations", async () => {
    await using tmp = await tmpdir({ git: true })
    await runNative(tmp.path)
    const request = vi.mocked(generateObject).mock.calls[0]?.[0] as {
      experimental_repairText?: (options: { text: string; error: unknown }) => Promise<string | null>
    }
    expect(request.experimental_repairText).toEqual(expect.any(Function))

    const overflowing = JSON.stringify({
      summary: `The ${"very ".repeat(160)}long summary`,
      body: "A long enough generated wiki page body so the schema minimum length is satisfied.",
      symbols: Array.from({ length: 120 }, (_, index) => `symbol${index}`),
    })
    const repaired = await request.experimental_repairText!({ text: overflowing, error: new Error("too big") })
    expect(repaired).not.toBeNull()
    const value = parseJsonStrict(repaired!) as { summary: string; symbols: string[] }
    expect(value.symbols).toHaveLength(80)
    expect(value.summary.length).toBeLessThanOrEqual(600)
  })

  test("returns null for unparseable text and for output without bound violations", () => {
    expect(repairWikiPageText("not json")).toBeNull()
    expect(
      repairWikiPageText(
        JSON.stringify({ summary: "a within-bounds summary value", body: "x".repeat(100), symbols: ["alpha"] }),
      ),
    ).toBeNull()
  })

  test("caps symbols at 80 and drops non-string entries", () => {
    const repaired = repairWikiPageText(
      JSON.stringify({
        summary: "a within-bounds summary value",
        body: "x".repeat(100),
        symbols: [...Array.from({ length: 90 }, (_, index) => `s${index}`), 42, null],
      }),
    )
    expect(repaired).not.toBeNull()
    const value = parseJsonStrict(repaired!) as { symbols: unknown[] }
    expect(value.symbols).toHaveLength(80)
    expect(value.symbols.every((symbol) => typeof symbol === "string")).toBe(true)
  })

  test("clamps over-long summaries to the schema maximum", () => {
    const repaired = repairWikiPageText(
      JSON.stringify({ summary: "y".repeat(700), body: "x".repeat(100), symbols: [] }),
    )
    expect(repaired).not.toBeNull()
    const value = parseJsonStrict(repaired!) as { summary: string }
    expect(value.summary.length).toBeLessThanOrEqual(600)
  })

  test("caps symbol glosses and drops invalid entries", () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({
      name: `s${index}`,
      summary: `Gloss number ${index} here.`,
    }))
    entries[5] = { name: "s5", summary: `  ${"z".repeat(400)}  ` }
    entries[7] = { name: "short", summary: "tiny" }
    const repaired = repairWikiPageText(
      JSON.stringify({
        summary: "a within-bounds summary value",
        body: "x".repeat(100),
        symbols: ["alpha"],
        symbolSummaries: [
          ...entries,
          { name: "", summary: "Nameless gloss is dropped from the page." },
          { name: "short", summary: "tiny" },
          null,
          "nope",
        ],
      }),
    )
    expect(repaired).not.toBeNull()
    const value = parseJsonStrict(repaired!) as { symbolSummaries: Array<{ name: string; summary: string }> }
    expect(value.symbolSummaries).toHaveLength(19)
    expect(value.symbolSummaries.map((gloss) => gloss.name)).not.toContain("short")
    expect(value.symbolSummaries.find((gloss) => gloss.name === "s5")!.summary).toBe("z".repeat(300))
    expect(value.symbolSummaries.every((gloss) => gloss.summary.length <= 300)).toBe(true)
    expect(value.symbolSummaries.every((gloss) => gloss.summary.length >= 10)).toBe(true)
  })

  test("returns null when symbol glosses are already within bounds", () => {
    expect(
      repairWikiPageText(
        JSON.stringify({
          summary: "a within-bounds summary value",
          body: "x".repeat(100),
          symbols: ["alpha"],
          symbolSummaries: [{ name: "alpha", summary: "Starts the runtime cleanly." }],
        }),
      ),
    ).toBeNull()
  })

  test("coerces an object map of symbol glosses into the array schema", () => {
    const map: Record<string, unknown> = {}
    for (let index = 0; index < 25; index++) {
      map[`feature${index}`] = `Exported function that returns the constant \`${index}\`.`
    }
    map.tiny = "short"
    map["  "] = "Nameless key is dropped from the gloss list."
    map.nested = { name: "renamed", summary: "Uses the record name when the model nests the gloss." }
    map.drop = 42
    const repaired = repairWikiPageText(
      JSON.stringify({
        summary: "a within-bounds summary value",
        body: "x".repeat(100),
        symbols: ["feature0"],
        symbolSummaries: map,
      }),
    )
    expect(repaired).not.toBeNull()
    const value = parseJsonStrict(repaired!) as { symbolSummaries: Array<{ name: string; summary: string }> }
    expect(value.symbolSummaries).toHaveLength(20)
    expect(value.symbolSummaries[0]).toEqual({
      name: "feature0",
      summary: "Exported function that returns the constant `0`.",
    })
    expect(value.symbolSummaries.map((gloss) => gloss.name)).not.toContain("tiny")
    expect(value.symbolSummaries.map((gloss) => gloss.name)).not.toContain("renamed")
    expect(value.symbolSummaries.every((gloss) => gloss.summary.length <= 300)).toBe(true)
    expect(value.symbolSummaries.every((gloss) => gloss.summary.length >= 10)).toBe(true)
  })

  test("uses a nested gloss name and turns an empty map into an empty array", () => {
    const nested = repairWikiPageText(
      JSON.stringify({
        summary: "a within-bounds summary value",
        body: "x".repeat(100),
        symbols: ["feature0"],
        symbolSummaries: {
          feature0: { summary: "Exported function that returns the constant `0`." },
          alias: { name: "canonical", summary: "Prefers the nested name over the map key." },
        },
      }),
    )
    const nestedValue = parseJsonStrict(nested!) as { symbolSummaries: Array<{ name: string; summary: string }> }
    expect(nestedValue.symbolSummaries).toEqual([
      { name: "feature0", summary: "Exported function that returns the constant `0`." },
      { name: "canonical", summary: "Prefers the nested name over the map key." },
    ])

    const empty = repairWikiPageText(
      JSON.stringify({
        summary: "a within-bounds summary value",
        body: "x".repeat(100),
        symbols: [],
        symbolSummaries: {},
      }),
    )
    const emptyValue = parseJsonStrict(empty!) as { symbolSummaries: unknown[] }
    expect(emptyValue.symbolSummaries).toEqual([])
  })
})

function wikiModel(overrides: {
  id: string
  providerID?: string
  apiID?: string
  url?: string
  reasoning?: boolean
}): Provider.Model {
  const id = overrides.id
  return {
    id,
    providerID: overrides.providerID ?? "defai-01-ax-trust-com",
    name: id,
    api: {
      id: overrides.apiID ?? id,
      url: overrides.url ?? "https://defai-01.ax-trust.com/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    capabilities: {
      temperature: true,
      reasoning: overrides.reasoning ?? true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 128_000, output: 128_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  } as Provider.Model
}

describe("wiki page generation budget", () => {
  test("caps a large aux output limit and keeps a smaller model limit", () => {
    expect(wikiPageOutputTokens(wikiModel({ id: "glm-5.3-flash" }))).toBe(WIKI_PAGE_OUTPUT_TOKEN_MAX)
    const small = wikiModel({ id: "glm-5.3-flash" })
    small.limit.output = 1_024
    expect(wikiPageOutputTokens(small)).toBe(1_024)
  })

  test("keeps the full aux budget for non-GLM models", () => {
    // Regression: the global 8192 cap truncated deepseek-flash page JSON
    // mid-object (finishReason=length), failing every wiki update. Only
    // GLM-class gateways are capped; other models use their aux budget.
    const deepseek = wikiModel({ id: "deepseek-flash", apiID: "deepseek-flash" })
    deepseek.limit.output = 16_384
    expect(wikiPageOutputTokens(deepseek)).toBe(16_384)
    expect(wikiPageOutputTokens(wikiModel({ id: "gpt-4.1", reasoning: false }))).toBe(32_000)
  })

  test("asks a GLM flash gateway for low reasoning effort", () => {
    expect(wikiPageProviderOptions(wikiModel({ id: "glm-5.3-flash" }))).toEqual({
      openaiCompatible: { reasoningEffort: "low" },
      "defai-01-ax-trust-com": { reasoningEffort: "low" },
    })
  })

  test("keeps the GLM thinking switch on the provider id", () => {
    expect(wikiPageProviderOptions(wikiModel({ id: "glm-5.3", apiID: "glm-5.3" }))).toEqual({
      openaiCompatible: { reasoningEffort: "low" },
      "defai-01-ax-trust-com": { reasoningEffort: "low", thinking: { type: "enabled" } },
    })
  })

  test("puts a thinking-off switch on the provider id without forcing reasoning effort", () => {
    expect(wikiPageProviderOptions(wikiModel({ id: "deepseek-flash", apiID: "deepseek-flash" }))).toEqual({
      "defai-01-ax-trust-com": { thinking: { type: "disabled" } },
    })
  })

  test("does not send reasoning effort for excluded or non-GLM models", () => {
    expect(wikiPageProviderOptions(wikiModel({ id: "glm-5.3-flash", providerID: "groq" }))).toBeUndefined()
    expect(wikiPageProviderOptions(wikiModel({ id: "gpt-4.1", reasoning: false }))).toBeUndefined()
    expect(
      wikiPageProviderOptions(
        wikiModel({ id: "glm-5.3-flash", url: "https://dashscope.aliyuncs.com/compatible-mode/v1" }),
      ),
    ).toBeUndefined()
  })
})

describe("wiki model resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const PIN = { providerID: "pinned-provider", modelID: "pinned-model" }
  const SESSION_MODEL = { providerID: "session-provider", modelID: "session-model" }
  const FALLBACK = { providerID: "default-provider", modelID: "default-model" }
  const ID = SessionID.make("ses_wiki_model_fixture")

  function userMessage(model: unknown) {
    return [{ info: { role: "user", model } }] as never
  }

  test("an explicit pin wins without consulting the session", async () => {
    vi.spyOn(Provider, "resolvePinnedModel").mockResolvedValue(PIN as never)
    const messages = vi.spyOn(Session, "messages")
    const fallback = vi.spyOn(Provider, "defaultModel")
    expect(await resolveWikiModelRef({ model: "pinned-provider/pinned-model", sessionID: ID })).toEqual(PIN)
    expect(messages).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  test("falls back to the invoking session model when no pin is given", async () => {
    vi.spyOn(Session, "messages").mockResolvedValue(userMessage(SESSION_MODEL))
    vi.spyOn(Provider, "resolveRequestedModel").mockResolvedValue(SESSION_MODEL as never)
    const fallback = vi.spyOn(Provider, "defaultModel")
    expect(await resolveWikiModelRef({ sessionID: ID })).toEqual(SESSION_MODEL)
    expect(fallback).not.toHaveBeenCalled()
  })

  test("uses the last user message when the session ran several models", async () => {
    vi.spyOn(Session, "messages").mockResolvedValue([
      { info: { role: "user", model: { providerID: "old-provider", modelID: "old-model" } } },
      { info: { role: "assistant" } },
      { info: { role: "user", model: SESSION_MODEL } },
    ] as never)
    const requested = vi.spyOn(Provider, "resolveRequestedModel").mockResolvedValue(SESSION_MODEL as never)
    expect(await resolveWikiModelRef({ sessionID: ID })).toEqual(SESSION_MODEL)
    expect(requested).toHaveBeenCalledWith(SESSION_MODEL)
  })

  test("falls back to the default model without user messages or on lookup failure", async () => {
    vi.spyOn(Provider, "defaultModel").mockResolvedValue(FALLBACK as never)
    vi.spyOn(Session, "messages").mockResolvedValue([])
    expect(await resolveWikiModelRef({ sessionID: ID })).toEqual(FALLBACK)
    vi.restoreAllMocks()
    vi.spyOn(Provider, "defaultModel").mockResolvedValue(FALLBACK as never)
    vi.spyOn(Session, "messages").mockRejectedValue(new Error("gone"))
    expect(await resolveWikiModelRef({ sessionID: ID })).toEqual(FALLBACK)
    expect(await resolveWikiModelRef({})).toEqual(FALLBACK)
  })
})
