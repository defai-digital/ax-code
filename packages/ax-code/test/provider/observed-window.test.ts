import { describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { ObservedWindow } from "@/provider/observed-window"
import { Filesystem } from "@/util/filesystem"
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
    expect(ObservedWindow.extractStatedLimit("The prompt is too long: context length is only 8192 tokens")).toBe(8_192)
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
    expect(ObservedWindow.extractStatedLimit("HTTP 400", JSON.stringify({ error: { context_window: 24576 } }))).toBe(
      24_576,
    )
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
  test.each(["expiry", "catalog"] as const)(
    "invalidated stated evidence permits recalibration after %s",
    async (reason) => {
      let now = 1_000_000
      const s = store({ now: () => now })
      await s.recordSuccess(ROUTE, 80_000, { catalogLimit: CATALOG })
      await s.recordOverflow(ROUTE, 100_000, { statedLimit: 90_000, catalogLimit: CATALOG })
      if (reason === "expiry") now += ObservedWindow.WINDOW_TTL_MS + 1
      const catalogLimit = reason === "catalog" ? 65_536 : CATALOG
      await s.recordOverflow(ROUTE, 20_000, { catalogLimit })
      expect(await s.effectiveWindow(ROUTE, catalogLimit)).toBe(20_000)
    },
  )

  test("success after expiry cannot revive stale calibration", async () => {
    let now = 1_000_000
    const s = store({ now: () => now })
    await s.recordOverflow(ROUTE, 40_000, { statedLimit: 32_768, catalogLimit: CATALOG })
    now += ObservedWindow.WINDOW_TTL_MS + 1
    await s.recordSuccess(ROUTE, 40_000, { catalogLimit: CATALOG })
    expect((await s.resolveWindow(ROUTE, CATALOG)).kind).toBe("catalog")
    await s.recordOverflow(ROUTE, 30_000, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "ignores unusable overflow size %s without disabling compaction",
    async (tokens) => {
      const s = store()
      await s.recordOverflow(ROUTE, tokens, { catalogLimit: CATALOG })
      expect(await s.resolveWindow(ROUTE, CATALOG)).toEqual({ kind: "catalog" })
      expect(s.snapshot()).toEqual({ records: {}, unknown: [] })
      await s.recordOverflow(ROUTE, tokens, { statedLimit: 32_768, catalogLimit: CATALOG })
      expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(32_768)
    },
  )

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
    expect(
      await fs.access(filePath).then(
        () => true,
        () => false,
      ),
    ).toBe(false)

    await first.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    expect(
      await fs.access(filePath).then(
        () => true,
        () => false,
      ),
    ).toBe(true)

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

  test("a non-ratcheting success does not refresh the TTL clock", async () => {
    let now = 1_000_000
    const s = store({ now: () => now })
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
    now += ObservedWindow.WINDOW_TTL_MS - 1
    // A success BELOW the calibrated window must not extend freshness, or a
    // stale shrunken window (compaction keeps prompts under it, so it can
    // never ratchet up) would be pinned forever.
    await s.recordSuccess(ROUTE, 30_000, { catalogLimit: CATALOG })
    now += 2
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBeUndefined()
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
  test.each(["expiry", "catalog"] as const)(
    "invalidates negative evidence after %s, including after reload",
    async (reason) => {
      await using tmp = await tmpdir()
      const filePath = path.join(tmp.path, "windows.json")
      let now = 1000
      const s = store({ filePath, now: () => now })
      await s.recordOverflow(ROUTE, 100, { statedLimit: 100, catalogLimit: CATALOG })
      if (reason === "expiry") now += ObservedWindow.WINDOW_TTL_MS + 1
      const limit = reason === "catalog" ? CATALOG * 2 : CATALOG
      for (const current of [s, store({ filePath, now: () => now })]) {
        expect(await current.resolveWindow(ROUTE, limit)).toEqual({ kind: "catalog" })
        await current.recordOverflow(ROUTE, 8000, { catalogLimit: limit })
        expect(await current.effectiveWindow(ROUTE, limit)).toBe(8000)
      }
    },
  )

  test("legacy negative evidence without provenance cannot disable compaction forever", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "windows.json")
    await fs.writeFile(filePath, JSON.stringify({ version: 1, records: {}, unknown: [ROUTE] }))
    expect(await store({ filePath }).resolveWindow(ROUTE, CATALOG)).toEqual({ kind: "catalog" })
  })

  test("bounds negative records as well as positive records", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "windows.json")
    let now = 1000
    const s = store({ filePath, now: () => now++ })
    for (let index = 0; index < ObservedWindow.MAX_RECORDS + 5; index++) {
      await s.recordOverflow(`route-${index}`, 100, { catalogLimit: CATALOG })
    }
    expect(s.snapshot().unknown).toHaveLength(ObservedWindow.MAX_RECORDS)
    expect(await store({ filePath }).resolveWindow("route-0", CATALOG)).toEqual({ kind: "catalog" })
  })

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

  test("success does not persist a boundary without a second overflow", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "observed-windows.json")
    const s = store({ filePath })
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    await s.recordSuccess(ROUTE, 30_000, { catalogLimit: CATALOG })
    expect(await store({ filePath }).effectiveWindow(ROUTE, CATALOG)).toBeUndefined()
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    expect(await store({ filePath }).effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
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
    await fs.writeFile(filePath, JSON.stringify({ version: 999, records: { [ROUTE]: { window: 40_000 } } }))
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
  test.each(["overflow", "clear"] as const)("serializes persistence while recording %s", async (operation) => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "observed-windows.json")
    const s = store({ filePath })
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const write = Filesystem.write
    let calls = 0
    const spy = vi.spyOn(Filesystem, "write").mockImplementation(async (...args) => {
      calls++
      if (calls === 1) {
        started.resolve()
        await release.promise
      }
      return write(...args)
    })
    let second: Promise<void> | undefined
    const first = s.recordOverflow(ROUTE, 50_000, { statedLimit: 32_768, catalogLimit: CATALOG })
    try {
      await started.promise
      second =
        operation === "clear"
          ? s.clear()
          : s.recordOverflow("other/route", 50_000, { statedLimit: 16_384, catalogLimit: CATALOG })
      // Let the second operation run while the first disk write is blocked.
      await new Promise<void>((resolve) => setImmediate(resolve))
      const writesBeforeRelease = calls
      release.resolve()
      await Promise.all([first, second])
      expect(writesBeforeRelease).toBe(1)
      const reloaded = store({ filePath })
      if (operation === "clear") {
        expect(await reloaded.effectiveWindow(ROUTE, CATALOG)).toBeUndefined()
      } else {
        expect(await reloaded.effectiveWindow(ROUTE, CATALOG)).toBe(32_768)
        expect(await reloaded.effectiveWindow("other/route", CATALOG)).toBe(16_384)
      }
    } finally {
      release.resolve()
      await Promise.allSettled([first, second])
      spy.mockRestore()
    }
  })

  test.each([true, false])("clear resets success floors (single route: %s)", async (single) => {
    const s = store()
    await s.recordSuccess(ROUTE, 80_000)
    await s.clear(single ? ROUTE : undefined)
    await s.recordOverflow(ROUTE, 20_000, { catalogLimit: CATALOG })
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(20_000)
  })

  test("another route's write cannot persist an unconfirmed boundary", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "observed-windows.json")
    const s = store({ filePath })
    await s.recordOverflow(ROUTE, 40_000, { catalogLimit: CATALOG })
    await s.recordOverflow("other/route", 50_000, { statedLimit: 32_768, catalogLimit: CATALOG })
    const reloaded = store({ filePath })
    expect(await reloaded.effectiveWindow(ROUTE, CATALOG)).toBeUndefined()
    expect(await reloaded.effectiveWindow("other/route", CATALOG)).toBe(32_768)
    expect(await s.effectiveWindow(ROUTE, CATALOG)).toBe(40_000)
  })

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
    expect(ObservedWindow.routeKeyFor(model({}))).toMatch(/^deployment-v2:[a-f0-9]{64}$/)
  })

  test("changing the upstream model behind an alias does not reuse its observed window", async () => {
    const s = store()
    const first = model({ api: { id: "upstream-a", url: "https://api.example.com/v1", npm: "@ai-sdk/openai" } })
    const second = { ...first, api: { ...first.api, id: "upstream-b" } }
    await s.recordOverflow(ObservedWindow.routeKeyFor(first), 50_000, {
      statedLimit: 32_768,
      catalogLimit: CATALOG,
    })
    expect(await s.resolveWindow(ObservedWindow.routeKeyFor(second), CATALOG)).toEqual({ kind: "catalog" })
  })

  test("aliases for the same upstream model share calibration and token anchors", () => {
    const original = model({ api: { id: "upstream-model", url: "https://api.example.com/v1", npm: "@ai-sdk/openai" } })
    const alias = { ...original, id: "other-alias" } as typeof original
    expect(ObservedWindow.routeKeyFor(alias)).toBe(ObservedWindow.routeKeyFor(original))
  })

  test("separates endpoints, including paths on the same host", () => {
    const first = model({
      api: { id: "model-id", url: "https://gpu.example.com/a/v1", npm: "@ai-sdk/openai-compatible" },
    })
    const other = { ...first, api: { ...first.api, url: "https://gpu.example.com/b/v1" } }
    expect(ObservedWindow.routeKeyFor(first)).not.toBe(ObservedWindow.routeKeyFor(other))
  })

  test("unresolved endpoints have distinct opaque identities", () => {
    const first = model({ api: { id: "model-id", url: "not a url", npm: "@ai-sdk/openai-compatible" } })
    const other = { ...first, api: { ...first.api, url: "other unresolved url" } }
    expect(ObservedWindow.routeKeyFor(first)).not.toBe(ObservedWindow.routeKeyFor(other))
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
