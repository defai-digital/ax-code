import { describe, expect, test } from "bun:test"
import { LSP } from "../../src/lsp"
import type { LSPClient } from "../../src/lsp/client"
import type { LSPServer } from "../../src/lsp/server"

function client(input: {
  serverID: string
  priority?: number
  support?: Partial<Record<LSPServer.Method, LSPClient.MethodSupport>>
}): LSPClient.Info {
  return {
    serverID: input.serverID,
    priority: input.priority ?? 0,
    root: "/repo",
    semantic: true,
    methodSupport: (method) => input.support?.[method] ?? "unknown",
  } as LSPClient.Info
}

describe("LSP.computeBackoff", () => {
  test("returns base delay for first failure", () => {
    // 30s base, first attempt
    expect(LSP.computeBackoff(1)).toBe(30_000)
  })

  test("quadruples on each subsequent failure", () => {
    expect(LSP.computeBackoff(2)).toBe(120_000) // 2m
    expect(LSP.computeBackoff(3)).toBe(480_000) // 8m
    expect(LSP.computeBackoff(4)).toBe(1_920_000) // 32m
  })

  test("caps at the configured maximum", () => {
    // 60m cap. At failure 5 the raw value would be 128m (8m * 16 = 128m),
    // which exceeds the cap.
    const cap = 60 * 60 * 1000
    expect(LSP.computeBackoff(5)).toBe(cap)
    expect(LSP.computeBackoff(6)).toBe(cap)
    expect(LSP.computeBackoff(100)).toBe(cap)
  })

  test("returns zero when failures is zero or negative", () => {
    expect(LSP.computeBackoff(0)).toBe(0)
    expect(LSP.computeBackoff(-1)).toBe(0)
  })

  test("is monotonically non-decreasing", () => {
    let prev = 0
    for (let i = 1; i <= 20; i++) {
      const curr = LSP.computeBackoff(i)
      expect(curr).toBeGreaterThanOrEqual(prev)
      prev = curr
    }
  })
})

describe("LSP.markBroken / LSP.isBroken", () => {
  test("unmarked key is not broken", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    expect(LSP.isBroken(broken, "root:typescript")).toBe(false)
  })

  test("newly marked key is broken", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    LSP.markBroken(broken, "root:typescript")
    expect(LSP.isBroken(broken, "root:typescript")).toBe(true)
    expect(broken.get("root:typescript")?.failures).toBe(1)
  })

  test("repeat markBroken increments failure count and extends backoff", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    LSP.markBroken(broken, "key")
    const first = broken.get("key")!
    LSP.markBroken(broken, "key")
    const second = broken.get("key")!
    expect(second.failures).toBe(2)
    // Second failure schedules a later nextAttempt than the first
    expect(second.nextAttempt).toBeGreaterThan(first.nextAttempt)
  })

  test("isBroken returns false for expired entries without removing them", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    // Hand-construct an expired entry (nextAttempt in the past)
    broken.set("key", { failures: 1, nextAttempt: Date.now() - 1000 })
    expect(LSP.isBroken(broken, "key")).toBe(false)
    // Entry is kept so markBroken can compound failures for backoff escalation
    expect(broken.has("key")).toBe(true)
  })

  test("isBroken leaves non-expired entries in place", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    broken.set("key", { failures: 1, nextAttempt: Date.now() + 60_000 })
    expect(LSP.isBroken(broken, "key")).toBe(true)
    expect(broken.has("key")).toBe(true)
  })

  test("isBroken does not affect other keys when an entry expires", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    broken.set("expired", { failures: 1, nextAttempt: Date.now() - 1000 })
    broken.set("fresh", { failures: 1, nextAttempt: Date.now() + 60_000 })
    expect(LSP.isBroken(broken, "expired")).toBe(false)
    expect(LSP.isBroken(broken, "fresh")).toBe(true)
    expect(broken.has("expired")).toBe(true)
    expect(broken.has("fresh")).toBe(true)
  })

  test("backoff compounds correctly across several failures", () => {
    const broken = new Map<string, LSP.BrokenEntry>()
    LSP.markBroken(broken, "key")
    expect(broken.get("key")?.failures).toBe(1)

    LSP.markBroken(broken, "key")
    expect(broken.get("key")?.failures).toBe(2)

    LSP.markBroken(broken, "key")
    expect(broken.get("key")?.failures).toBe(3)

    // After 3 failures the backoff should match computeBackoff(3) = 8 minutes
    const entry = broken.get("key")!
    const expectedBackoff = LSP.computeBackoff(3)
    const actualBackoff = entry.nextAttempt - Date.now()
    // Allow ~50ms of clock drift between the markBroken call and this assert
    expect(actualBackoff).toBeLessThanOrEqual(expectedBackoff)
    expect(actualBackoff).toBeGreaterThan(expectedBackoff - 50)
  })

  test("markBroken bounds the broken-server cache", () => {
    const broken = new Map<string, LSP.BrokenEntry>()

    for (let i = 0; i < 125; i++) {
      LSP.markBroken(broken, `root-${i}:typescript`)
    }

    expect(broken.size).toBeLessThanOrEqual(100)
    expect(broken.has("root-0:typescript")).toBe(false)
    expect(broken.has("root-124:typescript")).toBe(true)
  })
})

describe("LSP.clientModeMatchesServer", () => {
  test("'all' mode includes semantic and auxiliary servers", () => {
    expect(LSP.clientModeMatchesServer("all", true)).toBe(true)
    expect(LSP.clientModeMatchesServer("all", false)).toBe(true)
    expect(LSP.clientModeMatchesServer("all")).toBe(true)
  })

  test("'semantic' mode excludes auxiliary servers", () => {
    expect(LSP.clientModeMatchesServer("semantic", true)).toBe(true)
    expect(LSP.clientModeMatchesServer("semantic")).toBe(true)
    expect(LSP.clientModeMatchesServer("semantic", false)).toBe(false)
  })
})

describe("LSP.clientMethodMatchesServer", () => {
  test("allows all servers when no method is requested", () => {
    expect(LSP.clientMethodMatchesServer(undefined, undefined)).toBe(true)
    expect(LSP.clientMethodMatchesServer(undefined, { references: false })).toBe(true)
  })

  test("skips servers that are statically marked unsupported for a method", () => {
    expect(LSP.clientMethodMatchesServer("references", { references: false })).toBe(false)
    expect(LSP.clientMethodMatchesServer("callHierarchy", { callHierarchy: false })).toBe(false)
  })

  test("keeps servers with positive or unknown method hints eligible", () => {
    expect(LSP.clientMethodMatchesServer("hover", { hover: true })).toBe(true)
    expect(LSP.clientMethodMatchesServer("documentSymbol", undefined)).toBe(true)
  })

  test("supports multi-method selection when any requested method is eligible", () => {
    expect(LSP.clientMethodMatchesServer(["documentSymbol", "references"], { documentSymbol: true })).toBe(true)
    expect(LSP.clientMethodMatchesServer(["documentSymbol", "references"], { references: true })).toBe(true)
    expect(LSP.clientMethodMatchesServer(["documentSymbol", "references"], undefined)).toBe(true)
  })

  test("skips servers only when every requested method is statically unsupported", () => {
    expect(LSP.clientMethodMatchesServer(["documentSymbol", "references"], { documentSymbol: false })).toBe(true)
    expect(
      LSP.clientMethodMatchesServer(["documentSymbol", "references"], {
        documentSymbol: false,
        references: false,
      }),
    ).toBe(false)
  })
})

describe("LSP client selection helpers", () => {
  test("deduplicates method and methods options while preserving order", () => {
    expect(
      LSP.requestedMethods({
        method: "references",
        methods: ["references", "documentSymbol", "hover", "documentSymbol"],
      }),
    ).toEqual(["references", "documentSymbol", "hover"])
  })

  test("prefers clients with explicit support for a single method", () => {
    const selected = LSP.filterClientsForSelection(
      [
        client({ serverID: "maybe", priority: 100 }),
        client({ serverID: "supported-low", priority: 1, support: { references: "supported" } }),
        client({ serverID: "unsupported", priority: 200, support: { references: "unsupported" } }),
      ],
      { method: "references" },
    )

    expect(selected.map((item) => item.serverID)).toEqual(["supported-low"])
  })

  test("falls back to maybe-supported clients before unsupported clients", () => {
    const selected = LSP.filterClientsForSelection(
      [
        client({ serverID: "unsupported", priority: 100, support: { hover: "unsupported" } }),
        client({ serverID: "maybe", priority: 1 }),
      ],
      { method: "hover" },
    )

    expect(selected.map((item) => item.serverID)).toEqual(["maybe"])
  })

  test("orders multi-method clients by supported count, maybe count, priority, then server id", () => {
    const selected = LSP.filterClientsForSelection(
      [
        client({
          serverID: "beta",
          priority: 10,
          support: { documentSymbol: "supported", references: "unsupported", hover: "unknown" },
        }),
        client({
          serverID: "alpha",
          priority: 10,
          support: { documentSymbol: "supported", references: "unsupported", hover: "unknown" },
        }),
        client({
          serverID: "strong",
          priority: 0,
          support: { documentSymbol: "supported", references: "supported", hover: "unsupported" },
        }),
        client({
          serverID: "maybe-only",
          priority: 100,
          support: { documentSymbol: "unknown", references: "unsupported", hover: "unknown" },
        }),
      ],
      { methods: ["documentSymbol", "references", "hover"] },
    )

    expect(selected.map((item) => item.serverID)).toEqual(["strong", "alpha", "beta", "maybe-only"])
  })
})
