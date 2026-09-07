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
  type WikiSource,
} from "../src"

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
