import { describe, expect, test, vi } from "vitest"
import {
  buildPure,
  emptyEvidenceBundle,
  utf8ByteLength,
  utf8ByteSpan,
  type Completeness,
  type WikiEvidenceReader,
  type WikiPageGenerator,
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

function generator(): WikiPageGenerator {
  return vi.fn(async (request) => ({
    summary: `Source-backed guide for ${request.page.title} and its repository responsibilities.`,
    body: `## Purpose\n\nThis page explains ${request.page.purpose} The claims are grounded in the selected repository files and should be verified against code before structural changes.\n\n## Change guidance\n\nStart with the cited source files, run the repository tests, and use code intelligence for exact callers and references.`,
    symbols: request.page.kind === "module" ? [`${request.page.title.replace(/ Module$/, "")}Value`] : [],
  }))
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
  const baseInput = () => ({
    root: "/virtual/root",
    wikiDir: "ax-wiki",
    action: "generate" as const,
    sources: inMemorySources(),
    config: {},
    generator: generator(),
    evidenceReader,
    readExistingPage: async () => undefined,
    now: () => new Date("2026-01-01T00:00:00Z"),
  })

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
})
