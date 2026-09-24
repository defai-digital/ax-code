import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { ObservedWindow } from "@/provider/observed-window"
import { tmpdir } from "../fixture/fixture"

const ROUTE = "test-provider/test-model"
const CATALOG = 131_072

function store(options: { filePath?: string; now?: () => number } = {}) {
  return new ObservedWindow.ObservedWindowStore(options)
}

describe("extractStatedLimit", () => {
  test("DeepSeek/vLLM 'maximum context length is N tokens'", () => {
    expect(ObservedWindow.extractStatedLimit("This model's maximum context length is 32768 tokens")).toBe(32_768)
    expect(
      ObservedWindow.extractStatedLimit(
        "HTTP 400: input exceeds the context window, maximum context length is 65536 tokens. Please reduce the length of the messages.",
      ),
    ).toBe(65_536)
  })

  test("vLLM 'context length is only N tokens'", () => {
    expect(
      ObservedWindow.extractStatedLimit("The prompt is too long: context length is only 8192 tokens"),
    ).toBe(8_192)
  })

  test("xAI 'maximum prompt length is N' without the tokens suffix", () => {
    expect(ObservedWindow.extractStatedLimit("request failed: maximum prompt length is 4096")).toBe(4_096)
  })

  test("GitHub Copilot 'exceeds the limit of N' family", () => {
    expect(ObservedWindow.extractStatedLimit("prompt exceeds the limit of 10000 tokens")).toBe(10_000)
  })

  test("falls back to the response body text", () => {
    expect(
      ObservedWindow.extractStatedLimit("HTTP 400 Bad Request", '{"error":"maximum context length is 16384 tokens"}'),
    ).toBe(16_384)
  })

  test("structured context_window / max_model_len fields in the body", () => {
    expect(
      ObservedWindow.extractStatedLimit("HTTP 400", JSON.stringify({ error: { context_window: 24576 } })),
    ).toBe(24_576)
    expect(
      ObservedWindow.extractStatedLimit(
        "HTTP 400",
        JSON.stringify({ error: { message: "too long", metadata: { max_model_len: "32768" } } }),
      ),
    ).toBe(32_768)
  })

  test("message text wins over the body", () => {
    expect(ObservedWindow.extractStatedLimit("maximum context length is 32768 tokens", "context_window: 99999")).toBe(
      32_768,
    )
  })

  test("returns undefined when nothing is stated", () => {
    expect(ObservedWindow.extractStatedLimit("input exceeds the context window")).toBeUndefined()
    expect(ObservedWindow.extractStatedLimit("HTTP 400", "not json at all")).toBeUndefined()
  })
})

describe("ObservedWindowStore boundary model", () => {
  test("stated limit wins with one confirmation and persists immediately", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, ".ax-code", "observed-windows.json")
    const first = store({ filePath })
    await first.recordOverflow(ROUTE, 50_000, { statedLimit: 32_768, catalogLimit: CATALOG })
    expect(await first.effectiveWindow(ROUTE, CATALOG)).toBe(32_768)
    // Provider-stated evidence persisted on first sight.
    const text = await fs.readFile(filePath, "utf-8")
    expect(text).toContain("provider-stated")

    // A reload sees it.
    const reloaded = store({ filePath })
    expect(await reloaded.effectiveWindow(ROUTE, CATALOG)).toBe(32_768)
  })

  test("boundary evidence is in-memory immediately but persists only at two confirmations", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, ".ax-code", "observed-windows.json")
    const first = store({ filePath })
    await first.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    // In-memory effective immediately.
    expect(await first.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
    // Not persisted yet.
    expect(await fs.access(filePath).then(() => true, () => false)).toBe(false)

    await first.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    expect(await fs.access(filePath).then(() => true, () => false)).toBe(true)

    const reloaded = store({ filePath })
    expect(await reloaded.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
    expect((await reloaded.resolveWindow(ROUTE, CATALOG)).kind).toBe("observed")
  })

  test("never above the catalog limit and never below the success floor", async () => {
    const s = store()
    // Stated limit above the catalog clamps down.
    await s.recordOverflow(ROUTE, 200_000, { statedLimit: 200_000, catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(CATALOG)

    const route2 = "p2/m2"
    await s.recordSuccess(route2, 30_000)
    // Failure below the observed-success floor keeps the floor.
    await s.recordOverflow(route2, 20_000, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(route2, CATALOG)).toBe(30_000)
  })

  test("success ratchets a stored window upward", async () => {
    const s = store()
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    await s.recordSuccess(ROUTE, 45_000)
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(45_000)
    // Ratchet only moves up.
    await s.recordSuccess(ROUTE, 10_000)
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(45_000)
  })

  test("later success floor raises the boundary window on the next overflow", async () => {
    const s = store()
    await s.recordSuccess(ROUTE, 25_000)
    await s.recordOverflow(ROUTE, 25_500, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(25_500)
  })

  test("provider-stated evidence survives later boundary overflows", async () => {
    const s = store()
    await s.recordOverflow(ROUTE, 50_000, { statedLimit: 32_768, catalogLimit: CATALOG })
    await s.recordOverflow(ROUTE, 60_000, { catalogLimit: CATALOG })
    const resolved = await s.resolveWindow(ROUTE, CATALOG)
    expect(resolved.kind).toBe("observed")
    if (resolved.kind === "observed") expect(resolved.record.evidence).toBe("provider-stated")
  })

  test("TTL expiry falls back to the catalog", async () => {
    let now = 1_000_000
    const s = store({ now: () => now })
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
    now += ObservedWindow.WINDOW_TTL_MS + 1
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBeUndefined()
    expect((await s.resolveWindow(ROUTE, CATALOG)).kind).toBe("catalog")
  })

  test("catalog-fingerprint change invalidates the record", async () => {
    const s = store()
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
    // Catalog snapshot changed (e.g. refresh): fingerprint mismatch.
    expect(await s.effectiveWindow(ROUTE, 65_536)).toBeUndefined()
  })

  test("a catalog shrink invalidates the record instead of serving an above-catalog window", async () => {
    const s = store()
    await s.recordSuccess(ROUTE, 100_000, { catalogLimit: CATALOG })
    await s.recordOverflow(ROUTE, 120_000, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(120_000)
    // The catalog snapshot changed (shrink): the fingerprint mismatch
    // invalidates the record, which also guarantees the observed window can
    // never stand above the new catalog limit.
    expect(await s.effectiveWindow(ROUTE, 90_000)).toBeUndefined()
    expect((await s.resolveWindow(ROUTE, 90_000)).kind).toBe("catalog")
  })
})

describe("ObservedWindowStore unknown-window mode", () => {
  test("a below-plausibility failure marks the route unknown instead of clamping", async () => {
    const s = store()
    await s.recordOverflow(ROUTE, 2_000, { catalogLimit: CATALOG })
    expect((await s.resolveWindow(ROUTE, CATALOG)).kind).toBe("unknown")
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBeUndefined()
  })

  test("a stated limit below the plausibility floor also marks unknown", async () => {
    const s = store()
    await s.recordOverflow(ROUTE, 1_000, { statedLimit: 2_048, catalogLimit: CATALOG })
    expect((await s.resolveWindow(ROUTE, CATALOG)).kind).toBe("unknown")
  })

  test("unknown disables auto-compaction semantics and persists across reloads", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, ".ax-code", "observed-windows.json")
    const first = store({ filePath })
    await first.recordOverflow(ROUTE, 2_000, { catalogLimit: CATALOG })
    const reloaded = store({ filePath })
    expect((await reloaded.resolveWindow(ROUTE, CATALOG)).kind).toBe("unknown")
  })

  test("success at or above the plausibility floor recovers an unknown route", async () => {
    const s = store()
    await s.recordOverflow(ROUTE, 2_000, { catalogLimit: CATALOG })
    expect((await s.resolveWindow(ROUTE, CATALOG)).kind).toBe("unknown")
    await s.recordSuccess(ROUTE, 50_000, { catalogLimit: CATALOG })
    const resolved = await s.resolveWindow(ROUTE, CATALOG)
    expect(resolved.kind).toBe("observed")
    if (resolved.kind === "observed") expect(resolved.window).toBe(50_000)
  })
})

describe("ObservedWindowStore persistence validation", () => {
  test("corrupted JSON files load as empty state", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "observed-windows.json")
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, "{ not json")
    const s = store({ filePath })
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
  })

  test("schema-invalid entries are dropped while valid ones survive", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "observed-windows.json")
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        records: {
          [ROUTE]: {
            window: 40_000,
            evidence: "boundary",
            confirmations: 2,
            maxSuccessfulPromptTokens: 30_000,
            catalogFingerprint: ObservedWindow.catalogFingerprintFor(CATALOG),
            updatedAt: Date.now(),
          },
          "bad/route": { window: "not-a-number" },
        },
      }),
    )
    const s = store({ filePath })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
    expect(await s.effectiveWindow("bad/route", CATALOG)).toBeUndefined()
  })

  test("wrong-version files are ignored", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "observed-windows.json")
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ version: 2, records: { [ROUTE]: { window: 40_000 } } }))
    const s = store({ filePath })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBeUndefined()
  })

  test("the store stays bounded at 256 entries", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "observed-windows.json")
    let now = 0
    const s = store({ filePath, now: () => now })
    for (let i = 0; i < 300; i++) {
      now = i
      await s.recordOverflow(`route-${i}`, 40_000, { catalogLimit: CATALOG })
      await s.recordOverflow(`route-${i}`, 40_000, { catalogLimit: CATALOG })
    }
    const text = await fs.readFile(filePath, "utf-8")
    const parsed = JSON.parse(text) as { records: Record<string, unknown> }
    expect(Object.keys(parsed.records).length).toBeLessThanOrEqual(ObservedWindow.MAX_RECORDS)
    // Newest routes survive the eviction.
    expect(await s.effectiveWindow("route-299", CATALOG)).toBe(40_000)
  })
})

describe("ObservedWindowStore clear", () => {
  test("clear(routeKey) drops one route; clear() drops everything", async () => {
    const s = store()
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    await s.recordOverflow("other/route", 40_000, { catalogLimit: CATALOG })
    await s.clear(ROUTE)
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBeUndefined()
    expect(await s.effectiveWindow("other/route", CATALOG)).toBe(40_000)
    await s.clear()
    expect(await s.effectiveWindow("other/route", CATALOG)).toBeUndefined()
  })
})

describe("routeKeyFor", () => {
  function model(overrides: {
    providerID?: string
    api?: { id: string; url: string; npm: string }
  }): Parameters<typeof ObservedWindow.routeKeyFor>[0] {
    return {
      id: "model-id",
      providerID: overrides.providerID ?? "provider-id",
      api: overrides.api ?? { id: "model-id", url: "https://api.example.com/v1", npm: "@ai-sdk/openai" },
    } as Parameters<typeof ObservedWindow.routeKeyFor>[0]
  }

  test("uses provider ID + resolved model ID", () => {
    expect(ObservedWindow.routeKeyFor(model({}))).toBe("provider-id/model-id")
  })

  test("appends the endpoint origin for OpenAI-compatible custom providers", () => {
    expect(
      ObservedWindow.routeKeyFor(
        model({
          providerID: "custom-private-gpu",
          api: { id: "model-id", url: "https://gpu.example.com/v1", npm: "@ai-sdk/openai-compatible" },
        }),
      ),
    ).toBe("custom-private-gpu/model-id@https://gpu.example.com")
  })

  test("skips an unparseable endpoint URL", () => {
    expect(
      ObservedWindow.routeKeyFor(
        model({ api: { id: "model-id", url: "not a url", npm: "@ai-sdk/openai-compatible" } }),
      ),
    ).toBe("provider-id/model-id")
  })
})

describe("recordOverflowEvidence", () => {
  test("ignores routes without a catalog limit and never throws", async () => {
    await expect(
      ObservedWindow.recordOverflowEvidence({
        routeKey: ROUTE,
        catalogLimit: 0,
        message: "maximum context length is 100 tokens",
      }),
    ).resolves.toBeUndefined()
    await expect(
      ObservedWindow.recordOverflowEvidence({
        message: "maximum context length is 100 tokens",
        catalogLimit: CATALOG,
      }),
    ).resolves.toBeUndefined()
  })
})
