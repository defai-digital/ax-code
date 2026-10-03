import { describe, expect, test, vi } from "vitest"
import {
  buildPure,
  emptyEvidenceBundle,
  fingerprintEvidenceBundle,
  utf8ByteLength,
  utf8ByteSpan,
  type Completeness,
  type EvidenceBundle,
  type EvidenceProvider,
  type Provenance,
  type WikiEvidenceReader,
  type WikiPageGenerationRequest,
  type WikiPageGenerationResult,
  type WikiSource,
} from "../src"
import { projectWikiManifest } from "../src/graph.js"

// Fully in-memory fixture: no filesystem, git, or network. Proves the compiler core
// runs entirely on injected effects (AC2).
const CONTENTS: Record<string, string> = {
  "README.md": "# Fixture\n\nA repository used to test the AX Wiki pure core.\n",
  "package.json": JSON.stringify({ name: "fixture", scripts: { test: "vitest" } }),
  "packages/core/src/index.ts": "export function coreValue() { return 1 }\n",
  "packages/web/src/index.ts": "export function webValue() { return 'web' }\n",
}

function inMemorySources(): WikiSource[] {
  return Object.entries(CONTENTS).map(([path, content]) => ({
    path,
    hash: `hash-${path}`,
    bytes: Buffer.byteLength(content, "utf8"),
    category: path.endsWith(".md")
      ? ("documentation" as const)
      : path.endsWith(".json")
        ? ("configuration" as const)
        : ("code" as const),
    language: path.endsWith(".ts") ? "typescript" : undefined,
  }))
}

const evidenceReader: WikiEvidenceReader = async ({ sources }) =>
  sources.map((source) => ({ ...source, content: CONTENTS[source.path] ?? "", truncated: false }))

// The graph projector accepts source hashes only as real SHA-256 digests, so a
// manifest that must project uses 64-hex hashes instead of readable test labels.
function projectableSources(): WikiSource[] {
  return inMemorySources().map((source, index) => ({ ...source, hash: index.toString(16).padStart(64, "0") }))
}

function generator() {
  return vi.fn(async (request: WikiPageGenerationRequest) => ({
    summary: `Source-backed guide for ${request.page.title} and its repository responsibilities.`,
    body: `## Purpose\n\nThis page explains ${request.page.purpose} The claims are grounded in the selected repository files and should be verified against code before structural changes.\n\n## Change guidance\n\nStart with the cited source files, run the repository tests, and use code intelligence for exact callers and references.`,
    symbols: request.page.kind === "module" ? [`${request.page.title.replace(/ Module$/, "")}Value`] : [],
  }))
}

function baseInput() {
  return {
    root: "/virtual/root",
    wikiDir: "ax-wiki",
    action: "generate" as const,
    sources: inMemorySources(),
    config: {},
    generator: generator(),
    evidenceReader,
    readExistingPage: async () => undefined,
    now: () => new Date("2026-01-01T00:00:00Z"),
  }
}

describe("buildPure (in-memory, no filesystem)", () => {
  test("retries a failed existing page after a source inventory changes the plan", async () => {
    const first = await buildPure(baseInput())
    const sources = [
      ...inMemorySources(),
      {
        path: "packages/new/src/index.ts",
        hash: "new-module",
        bytes: 40,
        category: "code" as const,
        language: "typescript",
      },
    ]
    const make = generator()
    const partial = await buildPure({
      ...baseInput(),
      action: "update",
      sources,
      previous: first.manifest,
      readExistingPage: async (page) => first.candidate.get(page),
      generator: async (request) => {
        if (request.page.path === "modules/core.md") throw new Error("temporary failure")
        return make(request)
      },
    })
    expect(partial.failedPages.map((page) => page.path)).toEqual(["modules/core.md"])
    const retry = generator()
    const recovered = await buildPure({
      ...baseInput(),
      action: "update",
      sources,
      previous: partial.manifest,
      readExistingPage: async (page) => partial.candidate.get(page),
      generator: retry,
    })
    expect(recovered.generatedPages).toEqual(["modules/core.md"])
    expect(retry).toHaveBeenCalledTimes(1)
  })

  test("runs a full build purely on injected providers", async () => {
    const result = await buildPure({
      root: "/virtual/root",
      wikiDir: "ax-wiki",
      action: "generate",
      sources: inMemorySources(),
      config: {},
      generator: generator(),
      evidenceReader,
      readExistingPage: async () => undefined,
      now: () => new Date("2026-01-01T00:00:00Z"),
    })
    expect(result.validation.ok).toBe(true)
    expect(result.generatedPages).toHaveLength(5)
    expect(result.manifest.generator).toBe("ax-wiki")
    expect(result.manifest.schemaVersion).toBe(1)
    // Every planned page has rendered content with the generator frontmatter marker.
    for (const page of result.plan.pages) {
      const content = result.candidate.get(page.path)
      expect(content).toBeDefined()
      expect(content).toContain("generated_by: ax-wiki")
    }
  })

  test("is deterministic for identical injected inputs", async () => {
    const run = () =>
      buildPure({
        root: "/virtual/root",
        wikiDir: "ax-wiki",
        action: "generate",
        sources: inMemorySources(),
        config: {},
        generator: generator(),
        evidenceReader,
        readExistingPage: async () => undefined,
        now: () => new Date("2026-01-01T00:00:00Z"),
      })
    const a = await run()
    const b = await run()
    expect(a.manifest.planHash).toBe(b.manifest.planHash)
    expect([...a.candidate.entries()]).toEqual([...b.candidate.entries()])
  })

  test("records sanitized symbol glosses in the manifest", async () => {
    const gen = generator()
    gen.mockImplementation(async (request: WikiPageGenerationRequest) => ({
      summary: `Source-backed guide for ${request.page.title} and its repository responsibilities.`,
      body: `## Purpose\n\nThis page explains ${request.page.purpose} The claims are grounded in the selected repository files and should be verified against code before structural changes.\n\n## Change guidance\n\nStart with the cited source files, run the repository tests, and use code intelligence for exact callers and references.`,
      symbols: ["coreValue"],
      symbolSummaries: [
        { name: "coreValue", summary: "Returns the core value." },
        { name: " coreValue ", summary: "Duplicate gloss is dropped." },
        { name: "", summary: "Nameless gloss is dropped." },
        { name: "long", summary: `${"y".repeat(400)} tail` },
      ],
    }))
    const result = await buildPure({ ...baseInput(), generator: gen })
    expect(result.validation.ok).toBe(true)
    const pages = Object.values(result.manifest.pages)
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      // Deduped, trimmed, and length-clamped.
      expect(page.symbolSummaries).toEqual([
        { name: "coreValue", summary: "Returns the core value." },
        { name: "long", summary: "y".repeat(300) },
      ])
      expect(page.symbolSummaries!.every((gloss) => gloss.summary.length <= 300)).toBe(true)
    }
    // The unlisted-name gloss is kept in the manifest but flagged.
    expect(result.validation.issues.some((issue) => issue.code === "wiki.gloss_unlisted_symbol")).toBe(true)
  })

  test("cleans generator output so the recorded manifest projects in the graph viewer", async () => {
    const gen = generator()
    gen.mockImplementation(async (request: WikiPageGenerationRequest) => ({
      summary: `Grounded guide\nfor ${request.page.title}\twith details.`,
      body: `## Purpose\n\nThis page explains ${request.page.purpose} The claims are grounded in the selected repository files and should be verified against code before structural changes.\n\n## Change guidance\n\nStart with the cited source files, run the repository tests, and use code intelligence for exact callers and references.`,
      symbols: ["Foo", "", "  Bar  ", "Foo", "x".repeat(300), "bad\nname"],
      symbolSummaries: [
        { name: "Foo", summary: "Has a\nnewline." },
        { name: "bad\nname", summary: "A newline in the name is dropped." },
        { name: "Bar", summary: "  A normal gloss.  " },
      ],
    }))
    const result = await buildPure({ ...baseInput(), sources: projectableSources(), generator: gen })
    expect(result.validation.ok).toBe(true)
    const pagePath = result.plan.pages[0]!.path
    const page = result.manifest.pages[pagePath]!
    // The summary is flattened to single spaces and carries no control characters.
    expect(page.summary).toBe(`Grounded guide for ${page.title} with details.`)
    expect(page.summary).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
    // Only projectable, deduped names survive, in recorded order.
    expect(page.symbols).toEqual(["Foo", "Bar"])
    // The newline-named gloss is dropped; the rest are cleaned.
    expect(page.symbolSummaries).toEqual([
      { name: "Foo", summary: "Has a newline." },
      { name: "Bar", summary: "A normal gloss." },
    ])
    // The writer's own output must project without throwing.
    expect(() => projectWikiManifest(result.manifest, { snapshot: "t" })).not.toThrow()
  })

  test("records a clean generator result unchanged", async () => {
    const gen = generator()
    gen.mockImplementation(async (request: WikiPageGenerationRequest) => ({
      summary: `Source-backed guide for ${request.page.title}.`,
      body: `## Purpose\n\nThis page explains ${request.page.purpose} The claims are grounded in the selected repository files and should be verified against code before structural changes.\n\n## Change guidance\n\nStart with the cited source files, run the repository tests, and use code intelligence for exact callers and references.`,
      symbols: ["Alpha", "Beta", "Gamma"],
      symbolSummaries: [
        { name: "Alpha", summary: "First gloss." },
        { name: "Beta", summary: "Second gloss." },
      ],
    }))
    const result = await buildPure({ ...baseInput(), sources: projectableSources(), generator: gen })
    const pagePath = result.plan.pages[0]!.path
    const page = result.manifest.pages[pagePath]!
    expect(page.symbols).toEqual(["Alpha", "Beta", "Gamma"])
    expect(page.symbolSummaries).toEqual([
      { name: "Alpha", summary: "First gloss." },
      { name: "Beta", summary: "Second gloss." },
    ])
    expect(() => projectWikiManifest(result.manifest, { snapshot: "t" })).not.toThrow()
  })
})

describe("completeness truth table (gate C2/C4)", () => {
  const STATES: Completeness[] = ["complete", "partial", "lsp-only", "unsupported", "failed", "queried-zero-results"]
  const provenance = { producer: "test", producerVersion: "0.0.0", method: "injected" as const }

  test("every completeness state is representable and distinct", () => {
    const bundles = STATES.map((completeness) =>
      emptyEvidenceBundle({ root: "/virtual/root", completeness, provenance }),
    )
    const seen = new Set(bundles.map((bundle) => bundle.completeness))
    expect(seen.size).toBe(STATES.length)
    for (const bundle of bundles) {
      expect(bundle.schemaVersion).toBe(1)
      expect(bundle.sources).toEqual([])
      expect(bundle.symbols).toEqual([])
      expect(bundle.capability).toEqual({ semantic: false, syntactic: false, diagnostics: false, graph: false })
    }
  })

  test("an empty/failed acquisition is never reported as complete", () => {
    for (const state of ["unsupported", "failed", "queried-zero-results"] as const) {
      const bundle = emptyEvidenceBundle({ root: "/virtual/root", completeness: state, provenance })
      expect(bundle.completeness).not.toBe("complete")
    }
  })
})

describe("UTF-8 byte budgeting and spans (gate C6)", () => {
  test("byte length counts UTF-8 bytes, not UTF-16 code units", () => {
    // "é" is 2 bytes, "日" is 3 bytes, "𝄞" (astral) is 4 bytes / 2 UTF-16 units.
    expect(utf8ByteLength("abc")).toBe(3)
    expect(utf8ByteLength("é")).toBe(2)
    expect(utf8ByteLength("日")).toBe(3)
    expect(utf8ByteLength("𝄞")).toBe(4)
    expect(utf8ByteLength("a日b")).toBe(1 + 3 + 1)
  })

  test("byte spans are code-point aligned and never split multibyte sequences", () => {
    const text = "a日b𝄞c" // code points: a(1) 日(3) b(1) 𝄞(4) c(1) = 10 bytes
    // Span covering "日b" (code points 1..3).
    const span = utf8ByteSpan(text, 1, 3)
    expect(span.byteStart).toBe(1) // after "a"
    expect(span.byteEnd).toBe(1 + 3 + 1) // "日"(3) + "b"(1)
    // Decoding the byte span round-trips to the exact code-point slice.
    const bytes = Buffer.from(text, "utf8")
    expect(bytes.subarray(span.byteStart, span.byteEnd).toString("utf8")).toBe("日b")
  })

  test("span endpoints clamp to the code-point length", () => {
    const text = "日"
    expect(utf8ByteSpan(text, -5, 99)).toEqual({ byteStart: 0, byteEnd: 3 })
    expect(utf8ByteSpan(text, 1, 0)).toEqual({ byteStart: 3, byteEnd: 3 })
  })
})

describe("per-page fingerprint (gate C5)", () => {
  test("is present on every page and stable for identical inputs", async () => {
    const a = await buildPure(baseInput())
    const b = await buildPure(baseInput())
    for (const page of a.plan.pages) {
      const fa = a.manifest.pages[page.path]?.fingerprint
      expect(fa).toBeDefined()
      expect(fa).toBe(b.manifest.pages[page.path]?.fingerprint)
    }
  })

  test("changes when generator identity changes", async () => {
    const a = await buildPure(baseInput())
    const b = await buildPure({
      ...baseInput(),
      generatorIdentity: { name: "ax-wiki", version: "9.9.9", promptVersion: "p2" },
    })
    const page = a.plan.pages[0]!.path
    expect(a.manifest.pages[page]!.fingerprint).not.toBe(b.manifest.pages[page]!.fingerprint)
  })

  test("changes when the model changes", async () => {
    const a = await buildPure({ ...baseInput(), model: "provider/model-a" })
    const b = await buildPure({ ...baseInput(), model: "provider/model-b" })
    const page = a.plan.pages[0]!.path
    expect(a.manifest.pages[page]!.fingerprint).not.toBe(b.manifest.pages[page]!.fingerprint)
  })

  test("changes when the semantic revision changes", async () => {
    const a = await buildPure({ ...baseInput(), semanticRevision: "rev-1" })
    const b = await buildPure({ ...baseInput(), semanticRevision: "rev-2" })
    const page = a.plan.pages[0]!.path
    expect(a.manifest.pages[page]!.fingerprint).not.toBe(b.manifest.pages[page]!.fingerprint)
  })

  test("an update build regenerates a page whose fingerprint changed even with no source changes", async () => {
    const readExistingPage = (candidate: Map<string, string>) => async (pagePath: string) => candidate.get(pagePath)
    const first = await buildPure({
      ...baseInput(),
      generatorIdentity: { name: "ax-wiki", version: "1.0.0", promptVersion: "p1" },
    })
    const previous = first.manifest
    const existing = first.candidate

    const unchanged = await buildPure({
      ...baseInput(),
      action: "update",
      previous,
      readExistingPage: readExistingPage(existing),
      generatorIdentity: { name: "ax-wiki", version: "1.0.0", promptVersion: "p1" },
    })
    expect(unchanged.generatedPages).toEqual([])

    const upgraded = await buildPure({
      ...baseInput(),
      action: "update",
      previous,
      readExistingPage: readExistingPage(existing),
      generatorIdentity: { name: "ax-wiki", version: "2.0.0", promptVersion: "p2" },
    })
    expect(new Set(upgraded.generatedPages)).toEqual(new Set(first.plan.pages.map((page) => page.path)))
  })
})

const provenance: Provenance = { producer: "test", producerVersion: "1.0.0", method: "injected" }

function baseBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    ...emptyEvidenceBundle({ root: "/virtual/root", completeness: "complete", provenance }),
    capability: { semantic: true, syntactic: false, diagnostics: false, graph: true },
    freshness: { stale: false, degraded: false },
    ...overrides,
  }
}

describe("typed evidence provider", () => {
  test("takes precedence over the legacy graphContext callback", async () => {
    const graphContext = vi.fn(async () => "legacy-graph-context")
    const provide = vi.fn(async ({ root }: { root: string }) =>
      emptyEvidenceBundle({ root, completeness: "partial", provenance }),
    )
    const generate = generator()
    const result = await buildPure({
      ...baseInput(),
      generator: generate,
      graphContext,
      evidenceProvider: { provide },
    })
    expect(graphContext).not.toHaveBeenCalled()
    expect(provide).toHaveBeenCalledTimes(result.plan.pages.length)
    for (const call of generate.mock.calls) {
      const request = call[0]
      expect(request.graphContext).toContain("# Semantic Evidence")
      expect(request.evidence?.completeness).toBe("partial")
    }
  })

  test("calls the provider once per planned page and reuses the cached bundle", async () => {
    let calls = 0
    const provide: EvidenceProvider["provide"] = async ({ root, page }) => {
      calls += 1
      return emptyEvidenceBundle({
        root,
        completeness: "complete",
        provenance: { ...provenance, queryId: `${page.path}:${calls}` },
      })
    }
    const generate = generator()
    const result = await buildPure({
      ...baseInput(),
      generator: generate,
      evidenceProvider: { provide },
    })
    expect(calls).toBe(result.plan.pages.length)
    const queryIds = generate.mock.calls.map((call) => call[0].evidence?.provenance.queryId)
    expect(queryIds).toEqual(result.plan.pages.map((page, index) => `${page.path}:${index + 1}`))
  })

  test("writes the same cached fingerprint used for the skip decision", async () => {
    const provide = vi.fn(async ({ root }: { root: string }) =>
      emptyEvidenceBundle({ root, completeness: "complete", provenance }),
    )
    const first = await buildPure({
      ...baseInput(),
      evidenceProvider: { provide },
    })
    const page = first.plan.pages[0]!.path
    const fingerprint = first.manifest.pages[page]!.fingerprint
    expect(fingerprint).toBeDefined()

    const second = await buildPure({
      ...baseInput(),
      action: "update",
      previous: first.manifest,
      readExistingPage: async (pagePath) => first.candidate.get(pagePath),
      evidenceProvider: { provide },
    })
    expect(second.generatedPages).toEqual([])
    expect(second.manifest.pages[page]!.fingerprint).toBe(fingerprint)
    expect(provide).toHaveBeenCalledTimes(first.plan.pages.length * 2)
  })

  test("ignores volatile timestamps when fingerprinting page evidence", async () => {
    const generate = (capturedAt: string, indexedAt: string, queryId: string) =>
      buildPure({
        ...baseInput(),
        evidenceProvider: {
          provide: async ({ root }) =>
            baseBundle({
              snapshot: {
                root,
                revision: { dirty: false },
                capturedAt,
              },
              provenance: { ...provenance, queryId },
              freshness: { indexedAt, stale: false, degraded: false },
            }),
        },
      })
    const a = await generate("2020-01-01T00:00:00.000Z", "2020-02-01T00:00:00.000Z", "q-1")
    const b = await generate("2024-12-31T23:59:59.000Z", "2025-01-01T00:00:00.000Z", "q-2")
    const page = a.plan.pages[0]!.path
    expect(a.manifest.pages[page]!.fingerprint).toBe(b.manifest.pages[page]!.fingerprint)
  })

  test("regenerates on update when stable evidence fields change", async () => {
    const first = await buildPure({
      ...baseInput(),
      evidenceProvider: {
        provide: async ({ root }) => emptyEvidenceBundle({ root, completeness: "complete", provenance }),
      },
    })
    const upgraded = await buildPure({
      ...baseInput(),
      action: "update",
      previous: first.manifest,
      readExistingPage: async (pagePath) => first.candidate.get(pagePath),
      evidenceProvider: {
        provide: async ({ root }) => emptyEvidenceBundle({ root, completeness: "partial", provenance }),
      },
    })
    expect(new Set(upgraded.generatedPages)).toEqual(new Set(first.plan.pages.map((page) => page.path)))
  })

  test("regenerates only the page whose typed evidence changed", async () => {
    const first = await buildPure({
      ...baseInput(),
      evidenceProvider: {
        provide: async ({ root, page }) =>
          baseBundle({
            snapshot: { root, revision: { dirty: false }, capturedAt: "2026-01-01T00:00:00.000Z" },
            provenance: { ...provenance, queryId: page.path },
          }),
      },
    })
    const changedPage = first.plan.pages[0]!.path
    const upgraded = await buildPure({
      ...baseInput(),
      action: "update",
      previous: first.manifest,
      readExistingPage: async (pagePath) => first.candidate.get(pagePath),
      evidenceProvider: {
        provide: async ({ root, page }) =>
          baseBundle({
            snapshot: { root, revision: { dirty: false }, capturedAt: "2026-01-02T00:00:00.000Z" },
            provenance: { ...provenance, queryId: page.path },
            completeness: page.path === changedPage ? "partial" : "complete",
          }),
      },
    })

    expect(upgraded.generatedPages).toEqual([changedPage])
    expect(new Set(upgraded.unchangedPages)).toEqual(
      new Set(first.plan.pages.map((page) => page.path).filter((pagePath) => pagePath !== changedPage)),
    )
  })

  test("legacy graphContext still reaches the generator when no evidenceProvider is set", async () => {
    const generate = generator()
    await buildPure({
      ...baseInput(),
      generator: generate,
      graphContext: async () => "legacy-graph-context",
    })
    expect(generate.mock.calls[0]![0].graphContext).toBe("legacy-graph-context")
    expect(generate.mock.calls[0]![0].evidence).toBeUndefined()
  })
})

describe("evidence fingerprint contents", () => {
  const range = { startLine: 1, startChar: 0, endLine: 1, endChar: 4 }

  test("is stable across volatile timestamps and record order", () => {
    const left = baseBundle({
      snapshot: { root: "/virtual/root", revision: { dirty: false }, capturedAt: "2020-01-01T00:00:00.000Z" },
      provenance: { ...provenance, queryId: "q-left" },
      freshness: { indexedAt: "2020-01-02T00:00:00.000Z", stale: false, degraded: true },
      symbols: [
        {
          id: "b",
          kind: "function",
          name: "b",
          qualifiedName: "mod.b",
          file: "b.ts",
          range,
          provenance: { ...provenance, queryId: "s-b" },
        },
        {
          id: "a",
          kind: "function",
          name: "a",
          qualifiedName: "mod.a",
          file: "a.ts",
          range,
          provenance: { ...provenance, queryId: "s-a" },
        },
      ],
    })
    const right = baseBundle({
      snapshot: { root: "/virtual/root", revision: { dirty: false }, capturedAt: "2026-01-01T00:00:00.000Z" },
      provenance: { ...provenance, queryId: "q-right" },
      freshness: { indexedAt: "2026-01-02T00:00:00.000Z", stale: false, degraded: true },
      symbols: [...left.symbols].reverse().map((symbol, index) => ({
        ...symbol,
        provenance: { ...symbol.provenance, queryId: `other-${index}` },
      })),
    })
    expect(fingerprintEvidenceBundle(left)).toBe(fingerprintEvidenceBundle(right))
  })

  test("changes when schema, completeness, capability, producer, freshness flags, or records change", () => {
    const base = baseBundle({
      symbols: [
        {
          id: "a",
          kind: "function",
          name: "a",
          qualifiedName: "mod.a",
          file: "a.ts",
          range,
          provenance,
        },
      ],
    })
    const variants: EvidenceBundle[] = [
      { ...base, completeness: "partial" },
      { ...base, capability: { ...base.capability, diagnostics: true } },
      { ...base, provenance: { ...base.provenance, producer: "other" } },
      { ...base, provenance: { ...base.provenance, producerVersion: "9.9.9" } },
      { ...base, provenance: { ...base.provenance, method: "lsp" } },
      { ...base, freshness: { stale: true, degraded: false } },
      { ...base, freshness: { stale: false, degraded: true } },
      {
        ...base,
        sources: [
          {
            path: "a.ts",
            sha256: "abc123",
            bytes: 42,
            language: "typescript",
            category: "code",
          },
        ],
      },
      {
        ...base,
        symbols: [{ ...base.symbols[0]!, name: "renamed", qualifiedName: "mod.renamed" }],
      },
      {
        ...base,
        relationships: [
          {
            kind: "calls",
            from: { symbolId: "a" },
            to: { symbolId: "b" },
            provenance,
          },
        ],
      },
      {
        ...base,
        diagnostics: [
          {
            severity: "error",
            message: "broken",
            file: "a.ts",
            range,
          },
        ],
      },
    ]
    const seen = new Set(variants.map((bundle) => fingerprintEvidenceBundle(bundle)))
    expect(seen.size).toBe(variants.length)
    expect(seen.has(fingerprintEvidenceBundle(base))).toBe(false)
  })
})

describe("partial update (ADR-156)", () => {
  const identity = (promptVersion: string) => ({ name: "ax-wiki", version: "1.0.0", promptVersion })

  function faultyGenerator(failing: string) {
    const healthy = generator()
    return vi.fn(async (request: WikiPageGenerationRequest) => {
      if (request.page.path === failing) throw new Error("deterministic page failure")
      return await healthy(request)
    })
  }

  test("publishes the pages that succeeded and keeps the failed page's previous fingerprint", async () => {
    const first = await buildPure({ ...baseInput(), generatorIdentity: identity("p1") })
    const failing = first.plan.pages.find((page) => page.path !== "quickstart.md")!.path
    const partial = await buildPure({
      ...baseInput(),
      action: "update",
      previous: first.manifest,
      readExistingPage: async (pagePath) => first.candidate.get(pagePath),
      generator: faultyGenerator(failing),
      generatorIdentity: identity("p2"),
    })

    expect(partial.failedPages).toEqual([{ path: failing, error: "deterministic page failure" }])
    expect(partial.generatedPages).not.toContain(failing)
    expect(partial.unchangedPages).not.toContain(failing)
    expect(partial.validation.ok).toBe(true)
    // The failed page keeps the manifest entry that describes the content still on disk.
    expect(partial.manifest.pages[failing]).toEqual(first.manifest.pages[failing])
    // The other pages advanced to the new generator identity.
    const other = first.plan.pages.find((page) => page.path !== failing)!.path
    expect(partial.manifest.pages[other]!.fingerprint).not.toBe(first.manifest.pages[other]!.fingerprint)
    // The candidate keeps the failed page's previous content.
    expect(partial.candidate.get(failing)).toBe(first.candidate.get(failing))
  })

  test("a failed page with no file on disk stays absent instead of failing validation", async () => {
    const first = await buildPure({ ...baseInput(), generatorIdentity: identity("p1") })
    const failing = first.plan.pages[0]!.path
    const partial = await buildPure({
      ...baseInput(),
      action: "update",
      previous: first.manifest,
      readExistingPage: async (pagePath) => (pagePath === failing ? undefined : first.candidate.get(pagePath)),
      generator: faultyGenerator(failing),
      generatorIdentity: identity("p2"),
    })

    expect(partial.failedPages.map((page) => page.path)).toEqual([failing])
    expect(partial.manifest.pages[failing]).toBeUndefined()
    expect(partial.validation.ok).toBe(true)
  })

  test("a generate build still fails closed when a page fails", async () => {
    await expect(buildPure({ ...baseInput(), generator: faultyGenerator("quickstart.md") })).rejects.toThrow(
      "deterministic page failure",
    )
  })
})

function stagedCache() {
  const entries = new Map<string, WikiPageGenerationResult>()
  return {
    entries,
    read: vi.fn(async (page: string, key: string) => entries.get(`${page}:${key}`)),
    write: vi.fn(async (page: string, key: string, result: WikiPageGenerationResult) => {
      entries.set(`${page}:${key}`, result)
    }),
    remove: vi.fn(async (page: string, key: string) => {
      entries.delete(`${page}:${key}`)
    }),
  }
}

function gate() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release, wait }
}

describe("resumable bounded generation", () => {
  test("runs at most two pages concurrently and assembles results in plan order", async () => {
    const starts = Array.from({ length: 5 }, gate)
    const finishes = Array.from({ length: 5 }, gate)
    let active = 0
    let peak = 0
    let calls = 0
    const progress: number[] = []
    const make = generator()
    const input = baseInput()
    const pending = buildPure({
      ...input,
      config: { generationConcurrency: 2 },
      generator: async (request) => {
        const index = calls++
        peak = Math.max(peak, ++active)
        starts[index]!.release()
        await finishes[index]!.wait
        active--
        return make(request)
      },
      onProgress: (event) => {
        if (event.type === "page_complete") progress.push(event.completed!)
      },
    })
    await Promise.all([starts[0]!.wait, starts[1]!.wait])
    expect(calls).toBe(2)
    finishes[1]!.release()
    await starts[2]!.wait
    finishes[2]!.release()
    await starts[3]!.wait
    finishes[3]!.release()
    await starts[4]!.wait
    finishes[4]!.release()
    finishes[0]!.release()
    const result = await pending
    expect(peak).toBe(2)
    expect(result.generatedPages).toEqual(result.plan.pages.map((page) => page.path))
    expect([...result.generated.keys()]).toEqual(result.generatedPages)
    expect(progress).toEqual([1, 2, 3, 4, 5])
  })

  test("drains an in-flight page before rejecting and starts no new page after failure", async () => {
    const second = gate()
    const started = gate()
    const failed = gate()
    let calls = 0
    let settled = false
    const make = generator()
    const pending = buildPure({
      ...baseInput(),
      config: { generationConcurrency: 2 },
      generator: async (request) => {
        if (calls++ === 0) {
          await started.wait
          failed.release()
          throw new Error("first page failed")
        }
        started.release()
        await second.wait
        return make(request)
      },
    }).catch((error) => {
      settled = true
      throw error
    })
    const assertion = expect(pending).rejects.toThrow("first page failed")
    await failed.wait
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(calls).toBe(2)
    second.release()
    await assertion
    expect(calls).toBe(2)
  })

  test("detects broken links before generating remaining pages", async () => {
    const make = generator()
    make.mockImplementation(async (request) => ({
      summary: "A sufficiently long repository summary.",
      body: `This page explains ${request.page.purpose} and gives source-backed guidance. [Missing](missing.md)`,
      symbols: [],
    }))
    await expect(buildPure({ ...baseInput(), generator: make })).rejects.toThrow("wiki.link_broken")
    expect(make).toHaveBeenCalledTimes(1)
  })

  test("allows links to planned sibling pages that have not generated yet", async () => {
    const make = generator()
    make.mockImplementation(async (request) => ({
      summary: "A sufficiently long repository summary.",
      body:
        `This page explains ${request.page.purpose} and gives source-backed guidance. ` +
        (request.page.path === "quickstart.md" ? "[Architecture](architecture/overview.md)" : ""),
      symbols: [],
    }))
    expect((await buildPure({ ...baseInput(), generator: make })).validation.ok).toBe(true)
  })

  test("resumes completed results after cancellation without publishing a torn initial build", async () => {
    const cache = stagedCache()
    const abort = new AbortController()
    const input = baseInput()
    await expect(
      buildPure({
        ...input,
        signal: abort.signal,
        pageResultCache: cache,
        onProgress: (event) => {
          if (event.type === "page_complete") abort.abort()
        },
      }),
    ).rejects.toThrow()
    expect(input.generator).toHaveBeenCalledTimes(1)
    expect(cache.entries.size).toBe(1)
    const resumed = generator()
    const result = await buildPure({ ...baseInput(), pageResultCache: cache, generator: resumed })
    expect(resumed).toHaveBeenCalledTimes(4)
    expect(result.validation.ok).toBe(true)
    expect(result.generatedPages).toHaveLength(5)
  })

  test.each(["source", "instructions", "identity", "previous", "plan", "evidence"])(
    "does not reuse staged results after %s changes",
    async (change) => {
      const cache = stagedCache()
      const input = baseInput()
      const identity = { name: "fixture", version: "1", promptVersion: "1" }
      await buildPure({ ...input, generatorIdentity: identity, pageResultCache: cache })
      const make = generator()
      const modified: Parameters<typeof buildPure>[0] = {
        ...baseInput(),
        generator: make,
        generatorIdentity: identity,
        pageResultCache: cache,
      }
      if (change === "source")
        modified.sources = modified.sources.map((source) => ({ ...source, hash: source.hash + "changed" }))
      if (change === "instructions") modified.config = { instructions: "Updated maintainer guidance" }
      if (change === "identity") modified.generatorIdentity = { ...identity, promptVersion: "2" }
      if (change === "previous") modified.readExistingPage = async () => "Previous page content"
      if (change === "plan") modified.config = { maxPages: 3 }
      if (change === "evidence")
        modified.evidenceReader = async ({ sources }) =>
          sources.map((source) => ({ ...source, content: "Different source excerpt", truncated: true }))
      const result = await buildPure(modified)
      expect(make).toHaveBeenCalledTimes(result.generatedPages.length)
    },
  )

  test("changing concurrency does not invalidate existing page content", async () => {
    const first = await buildPure({ ...baseInput(), config: { generationConcurrency: 1 } })
    const make = generator()
    const second = await buildPure({
      ...baseInput(),
      action: "update",
      config: { generationConcurrency: 2 },
      generator: make,
      previous: first.manifest,
      readExistingPage: async (page) => first.candidate.get(page),
    })
    expect(make).not.toHaveBeenCalled()
    expect(second.generatedPages).toEqual([])
  })

  test("a broken-link page fails alone on update and preserves its previous fingerprint", async () => {
    const first = await buildPure(baseInput())
    const make = generator()
    make.mockImplementation(async (request) => ({
      summary: "A sufficiently long repository summary.",
      body:
        `This page explains ${request.page.purpose} and gives source-backed guidance. ` +
        (request.page.path === "quickstart.md" ? "[Missing](missing.md)" : ""),
      symbols: [],
    }))
    const result = await buildPure({
      ...baseInput(),
      action: "update",
      config: { instructions: "new", generationConcurrency: 2 },
      generator: make,
      previous: first.manifest,
      readExistingPage: async (page) => first.candidate.get(page),
    })
    expect(result.failedPages).toHaveLength(1)
    expect(result.failedPages[0]!.path).toBe("quickstart.md")
    expect(result.generatedPages).toHaveLength(4)
    expect(result.manifest.pages["quickstart.md"]).toEqual(first.manifest.pages["quickstart.md"])
  })
})
