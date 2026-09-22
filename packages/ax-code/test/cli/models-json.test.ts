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
})
