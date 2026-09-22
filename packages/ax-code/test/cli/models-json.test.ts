import { describe, expect, test } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { buildModelsDocument } from "../../src/cli/cmd/models"

const providers = {
  anthropic: {
    id: "anthropic",
    models: {
      "claude-sonnet-4": { capabilities: { toolcall: true, output: { text: true } } },
      "claude-opus-4": { capabilities: { toolcall: true, output: { text: true } } },
    },
  },
  "grok-build-cli": {
    id: "grok-build-cli",
    models: {
      "grok-4.6": { capabilities: { toolcall: true, output: { text: true } } },
    },
  },
}

function document(result: ReturnType<typeof buildModelsDocument>) {
  if (!("document" in result)) throw new Error("expected a document, got an error")
  return result.document
}

describe("models --json", () => {
  test("produces a single parseable document with id/provider/model/connected fields", () => {
    const result = buildModelsDocument({ providers, connected: ["anthropic"] })
    const doc = document(result)
    expect(doc).toHaveProperty("models")
    expect(Array.isArray(doc.models)).toBe(true)
    for (const entry of doc.models) {
      expect(entry).toHaveProperty("id")
      expect(entry).toHaveProperty("provider")
      expect(entry).toHaveProperty("model")
      expect(entry).toHaveProperty("connected")
      expect(typeof entry.connected).toBe("boolean")
    }
    // A single document must round-trip through JSON.parse without error.
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow()
  })

  test("marks connected providers true and the rest false", () => {
    const doc = document(buildModelsDocument({ providers, connected: ["anthropic"] }))
    const anthropic = doc.models.filter((m) => m.provider === "anthropic")
    const grok = doc.models.filter((m) => m.provider === "grok-build-cli")
    expect(anthropic.length).toBeGreaterThan(0)
    expect(grok.length).toBeGreaterThan(0)
    expect(anthropic.every((m) => m.connected === true)).toBe(true)
    expect(grok.every((m) => m.connected === false)).toBe(true)
  })

  test("honors the provider filter positional", () => {
    const doc = document(buildModelsDocument({ providers, connected: ["anthropic"], provider: "grok-build-cli" }))
    expect(doc.models.length).toBe(1)
    expect(doc.models.every((m) => m.provider === "grok-build-cli")).toBe(true)
  })

  test("normalizes the provider filter through ProviderID.make like text mode", async () => {
    // F8: the --json filter must resolve the provider id exactly like the
    // text mode (ProviderID.make), so a future non-identity normalization in
    // ProviderID.make applies to both output modes at once. Today make is an
    // identity cast, so the behavioral assertion is the same lookup plus a
    // source pin that both modes route through it.
    const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/models.ts"), "utf-8")
    const jsonLookup = src.indexOf("const requestedProviderID = ProviderID.make(input.provider)")
    const textLookup = src.indexOf("const requestedProviderID = ProviderID.make(args.provider)")
    expect(jsonLookup).toBeGreaterThan(-1)
    expect(textLookup).toBeGreaterThan(-1)

    const doc = document(buildModelsDocument({ providers, connected: ["anthropic"], provider: "grok-build-cli" }))
    expect(doc.models.map((m) => m.model)).toEqual(["grok-4.6"])
  })

  test("returns the current error for an unknown provider filter", () => {
    const result = buildModelsDocument({ providers, connected: ["anthropic"], provider: "nope" })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toBe("Provider not found: nope")
  })

  test("handler sets exit code 1 for an unknown provider filter in both output modes", async () => {
    // The handler is not directly invokable here (it needs a full Instance
    // bootstrap), so pin the contract on the source: both the --json error
    // branch and the text-mode branch must fail the process, not exit 0.
    const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/models.ts"), "utf-8")

    const jsonError = src.indexOf('if ("error" in result) {')
    const jsonExit = src.indexOf("process.exitCode = 1", jsonError)
    expect(jsonError).toBeGreaterThan(-1)
    expect(jsonExit).toBeGreaterThan(jsonError)

    const textError = src.indexOf("UI.error(`Provider not found: ${args.provider}`)")
    const textExit = src.indexOf("process.exitCode = 1", textError)
    expect(textError).toBeGreaterThan(-1)
    expect(textExit).toBeGreaterThan(textError)
  })

  test("id is provider/model and matches the provider and model fields", () => {
    const doc = document(buildModelsDocument({ providers, connected: ["anthropic"], provider: "anthropic" }))
    for (const entry of doc.models) {
      expect(entry.id).toBe(`${entry.provider}/${entry.model}`)
    }
  })

  test("includes metadata only when verbose is set", () => {
    const verbose = document(
      buildModelsDocument({ providers, connected: ["anthropic"], provider: "anthropic", verbose: true }),
    )
    const plain = document(buildModelsDocument({ providers, connected: ["anthropic"], provider: "anthropic" }))
    expect(verbose.models.every((m) => "metadata" in m)).toBe(true)
    expect(plain.models.every((m) => !("metadata" in m))).toBe(true)
  })

  test("connected is derived from the same Provider.list() keys the handler lists (G9)", async () => {
    // The listing source is Provider.list() — the same map whose keys
    // `providers list --json` (src/cli/cmd/providers-impl.ts) uses as its
    // connected set — never the catalog merge, so no catalog-only provider
    // can appear in `models` output and every listed entry is connected by
    // construction. The field stays because the --json shape is documented;
    // the source pin keeps the invariant honest if the listing source ever
    // changes to a catalog merge (at which point connected must become
    // discriminating again).
    const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/models.ts"), "utf-8")
    // Comment phrase pins are whitespace-normalized (Prettier wraps comments
    // across lines, so each phrase half is pinned independently).
    const normalized = src.replace(/\s+/g, " ")
    expect(normalized).toContain("const connectedProviderIDs = Object.keys(providers)")
    expect(normalized).toContain("connected: connectedProviderIDs")
    expect(normalized).toContain("no catalog-only provider can")
    expect(normalized).toContain("appear here and every listed entry is connected by construction")
    // The builder itself still discriminates when a narrower connected set is
    // passed (the shape contract other callers rely on).
    const doc = document(buildModelsDocument({ providers, connected: [] }))
    expect(doc.models.length).toBeGreaterThan(0)
    expect(doc.models.every((m) => m.connected === false)).toBe(true)
  })
})
