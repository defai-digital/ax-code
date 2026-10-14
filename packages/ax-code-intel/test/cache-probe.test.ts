import { afterAll, describe, expect, test } from "vitest"
import { codeIntelHost, configureCodeIntelHost } from "../src/host"
import { run } from "../src/cache-probe"
import type { SemanticEnvelope } from "../src/envelope"
import "./harness"

// `configureCodeIntelHost` replaces the whole host, so start from the one the
// harness installed and put it back afterwards.
const base = codeIntelHost()

let content = "A"
const rows = new Map<string, SemanticEnvelope<string>>()
const store = {
  enabled: () => true,
  hashFile: async () => content,
  lookup: (input: { contentHash: string }) => rows.get(input.contentHash),
  write: (input: { contentHash: string; envelope: SemanticEnvelope<string> }) => {
    rows.set(input.contentHash, input.envelope)
  },
}
configureCodeIntelHost({ ...base, cacheStore: store as never })
afterAll(() => configureCodeIntelHost(base))

function envelope(data: string): SemanticEnvelope<string> {
  return { data, source: "lsp", completeness: "full", timestamp: Date.now(), serverIDs: ["fake"] }
}

describe("cache probe write", () => {
  test("does not file a result under content the file no longer has", async () => {
    const input = {
      operation: "documentSymbol" as const,
      filePath: "/project/f.ts",
      line: -1,
      character: -1,
      cachedMetric: "cached",
      liveMetric: "live",
      execute: async () => {
        // The file changed while this request was queued: the answer is B's.
        content = "B"
        return envelope("symbols-B")
      },
    }

    await run(input)

    content = "A"
    const second = await run({ ...input, execute: async () => envelope("symbols-A") })
    expect(second.data).toBe("symbols-A")
  })
})
