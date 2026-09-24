import { beforeEach, describe, expect, test } from "vitest"
import type { ModelMessage } from "ai"
import { TokenLedger } from "@/provider/token-ledger"
import { TokenEstimate } from "@/provider/token-estimate"
import { USAGE_SOURCE_KEY } from "@/provider/usage"

const ROUTE = "test-provider/test-model"

function anchorInput(overrides: Partial<Parameters<TokenLedger.SessionTokenLedger["recordAnchor"]>[0]> = {}) {
  return {
    messageIDs: ["m1", "m2"],
    revision: "0",
    toolSchemaHash: "tool-hash",
    systemHash: "system-hash",
    usage: { input: 1_000, cacheRead: 100, cacheWrite: 50, source: "exact" as const },
    routeKey: ROUTE,
    at: 1_000,
    ...overrides,
  }
}

function userMessage(text: string): ModelMessage {
  return { role: "user", content: text }
}

describe("SessionTokenLedger", () => {
  beforeEach(() => {
    TokenLedger._resetDrift()
  })

  test("anchors exact input-side usage (input + cache read + cache write only)", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    const anchor = ledger.recordAnchor(anchorInput())
    expect(anchor).toBeDefined()
    expect(anchor!.measuredInputTokens).toBe(1_150)
    // The API has no field for output/reasoning: anchors are input-side only
    // (ADR-139 D2) — step totals must never become prefix anchors.
  })

  test("ignores non-exact usage (failed/partial streams never anchor)", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    expect(
      ledger.recordAnchor(anchorInput({ usage: { input: 1, cacheRead: 0, cacheWrite: 0, source: "estimated" } })),
    ).toBeUndefined()
    expect(
      ledger.recordAnchor(anchorInput({ usage: { input: 1, cacheRead: 0, cacheWrite: 0, source: "missing" } })),
    ).toBeUndefined()
    expect(ledger.findAnchor({ messageIDs: ["m1", "m2"], revision: "0" })).toBeUndefined()
  })

  test("current() reports measured prefix plus drift-corrected tail estimate", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1", "m2"] }))
    const tail = [userMessage("a".repeat(400))]
    // Callers pass the FULL current request messages; the ledger slices the
    // tail after the anchor index internally.
    const breakdown = ledger.current({
      messageIDs: ["m1", "m2", "m3"],
      revision: "0",
      tail: { system: [], messages: [userMessage("x"), userMessage("y"), ...tail] },
    })
    expect(breakdown.measured).toBe(1_150)
    expect(breakdown.estimated).toBe(TokenEstimate.requestTokens({ system: [], messages: tail }))
    expect(breakdown.total).toBe(breakdown.measured + breakdown.estimated)
    expect(breakdown.strategy).toBe("measured+estimated")
    expect(breakdown.confidence).toBeCloseTo(breakdown.measured / breakdown.total, 5)
    expect(breakdown.cache).toEqual({ read: 100, write: 50 })
  })

  test("selects the newest anchor whose message IDs still prefix the request", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(
      anchorInput({ messageIDs: ["m1"], usage: { input: 500, cacheRead: 0, cacheWrite: 0, source: "exact" }, at: 1 }),
    )
    ledger.recordAnchor(
      anchorInput({
        messageIDs: ["m1", "m2"],
        usage: { input: 900, cacheRead: 0, cacheWrite: 0, source: "exact" },
        at: 2,
      }),
    )
    const found = ledger.findAnchor({ messageIDs: ["m1", "m2", "m3"], revision: "0" })
    expect(found?.index).toBe(1)
    expect(found?.anchor.measuredInputTokens).toBe(900)
  })

  test("degrades to fully estimated when compaction rewrites the prefix", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1", "m2"] }))
    // Compaction replaced history: the old IDs are gone.
    const rewritten = ledger.current({
      messageIDs: ["c1"],
      revision: "0",
      tail: { system: [], messages: [userMessage("a".repeat(400))] },
    })
    expect(rewritten.strategy).toBe("estimated")
    expect(rewritten.measured).toBe(0)
    expect(rewritten.confidence).toBe(0)
  })

  test("revision bump invalidates pre-compaction anchors and recovery re-anchors", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1", "m2"], revision: "0" }))
    // Same IDs but a post-compaction revision: no match.
    expect(ledger.findAnchor({ messageIDs: ["m1", "m2"], revision: "1" })).toBeUndefined()
    // Next exact response re-anchors at the new revision.
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1", "m2"], revision: "1", at: 2 }))
    const found = ledger.findAnchor({ messageIDs: ["m1", "m2", "m3"], revision: "1" })
    expect(found).toBeDefined()
  })

  test("system or tool-schema hash mismatch invalidates the anchor", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1"], toolSchemaHash: "a", systemHash: "s" }))
    expect(ledger.findAnchor({ messageIDs: ["m1"], revision: "0", toolSchemaHash: "b" })).toBeUndefined()
    expect(ledger.findAnchor({ messageIDs: ["m1"], revision: "0", systemHash: "t" })).toBeUndefined()
    expect(ledger.findAnchor({ messageIDs: ["m1"], revision: "0", toolSchemaHash: "a", systemHash: "s" })).toBeDefined()
    // Callers without hashes (context_status) still match on IDs + revision.
    expect(ledger.findAnchor({ messageIDs: ["m1"], revision: "0" })).toBeDefined()
  })

  test("ring holds at most 8 anchors and evicts the oldest", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    for (let i = 0; i < 10; i++) {
      ledger.recordAnchor(
        anchorInput({
          messageIDs: [`m${i}`],
          usage: { input: i, cacheRead: 0, cacheWrite: 0, source: "exact" },
          at: i,
        }),
      )
    }
    // m0 and m1 were evicted; m2 is the oldest remaining.
    expect(ledger.findAnchor({ messageIDs: ["m0", "m1"], revision: "0" })).toBeUndefined()
    expect(ledger.findAnchor({ messageIDs: ["m2", "m9"], revision: "0" })).toBeDefined()
  })

  test("switching routes never reuses another model's measured tokens", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(anchorInput())
    const tail = { system: [], messages: [userMessage("first"), userMessage("second")] }
    const breakdown = ledger.current({
      messageIDs: ["m1", "m2"],
      revision: "0",
      routeKey: "other-provider/other-model",
      tail,
    })
    expect(breakdown.measured).toBe(0)
    expect(breakdown.strategy).toBe("estimated")
    expect(breakdown.total).toBe(TokenEstimate.requestTokens(tail))
    expect(
      ledger.findAnchor({ messageIDs: ["m1", "m2"], revision: "0", routeKey: "other-provider/other-model" }),
    ).toBeUndefined()
    ledger.recordAnchor(anchorInput({ routeKey: "other-provider/other-model" }))
    expect(ledger.findAnchor({ messageIDs: ["m1", "m2"], revision: "0", routeKey: ROUTE })?.anchor.routeKey).toBe(ROUTE)
  })

  test("tracks the last computed total for overflow calibration", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    expect(ledger.lastTotal()).toBeUndefined()
    ledger.recordAnchor(anchorInput())
    expect(ledger.lastTotal()).toBe(1_150)
    ledger.current({ messageIDs: ["m1", "m2", "m3"], revision: "0", tail: { system: [], messages: [] } })
    expect(ledger.lastTotal()).toBe(1_150)
  })

  test("tool-schema hashing is order-insensitive so local-inference sorting cannot break anchors", () => {
    const read = { description: "Read", inputSchema: { type: "object" } }
    const bash = { description: "Bash", inputSchema: { type: "object" } }
    // The clamp hashes the key-sorted surface the local-inference resolver
    // returns; the anchor hashes the unsorted request surface. Same set must
    // hash the same or every anchor silently stops matching.
    expect(TokenLedger.toolSchemaHashForRecord({ read, bash })).toBe(
      TokenLedger.toolSchemaHashForRecord({ bash, read }),
    )
  })

  test("prices the tool surface only when no anchor matches", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    const tools = { big: { description: "d".repeat(4_000), inputSchema: { type: "object" } } }
    const toolTokens = TokenEstimate.toolSchemaTokens([
      { id: "big", description: "d".repeat(4_000), inputSchema: { type: "object" } },
    ])
    expect(toolTokens).toBeGreaterThan(0)
    // No anchor yet: the whole tool surface must be estimated, otherwise the
    // first request of a session under-counts `used` and over-clamps.
    const unmatched = ledger.current({
      messageIDs: ["m1", "m2"],
      revision: "0",
      routeKey: ROUTE,
      tail: { system: [], messages: [] },
      tools,
    })
    expect(unmatched.estimated).toBe(toolTokens)
    // A matched anchor's measured tokens already covered the tool surface, so
    // adding it again would double-count.
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1", "m2"] }))
    const matched = ledger.current({
      messageIDs: ["m1", "m2"],
      revision: "0",
      routeKey: ROUTE,
      tail: { system: [], messages: [] },
      tools,
    })
    expect(matched.measured).toBe(1_150)
    expect(matched.estimated).toBe(0)
  })

  test("lastPrediction exposes the raw, drift-uncorrected tail base", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    expect(ledger.lastPrediction()).toBeUndefined()
    TokenLedger.recordDrift(ROUTE, 100, 200) // EWMA -> 1.3
    const tail = [userMessage("x".repeat(400))]
    ledger.current({ messageIDs: ["m1"], revision: "0", routeKey: ROUTE, tail: { system: [], messages: tail } })
    const rawBase = TokenEstimate.requestTokens({ system: [], messages: tail })
    const prediction = ledger.lastPrediction()
    expect(prediction?.measured).toBe(0)
    // The base stays raw so the drift EWMA converges to the bias, not its sqrt.
    expect(prediction?.base).toBe(rawBase)
    expect(ledger.lastTotal()).toBe(Math.round(rawBase * 1.3))
  })

  test("a hash-verified match does not double-count the system prompt", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    const toolSchemaHash = "tool-hash"
    const systemHash = "system-hash"
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1"], toolSchemaHash, systemHash }))
    // The measured input covered the anchored request's system prompt and
    // tool schemas; a verified match proves they are unchanged, so the tail
    // estimate must price messages only.
    const system = ["x".repeat(4_000)]
    const tail = [userMessage("a".repeat(400))]
    const verified = ledger.current({
      messageIDs: ["m1", "m2"],
      revision: "0",
      toolSchemaHash,
      systemHash,
      tail: { system, messages: [userMessage("y"), ...tail] },
    })
    expect(verified.estimated).toBe(TokenEstimate.requestTokens({ system: [], messages: tail }))
    expect(verified.measured).toBe(1_150)
    expect(verified.total).toBe(verified.measured + verified.estimated)
  })

  test("an IDs-only match keeps estimating the system prompt (unverified)", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1"] }))
    // Without hashes the match cannot prove the system prompt is unchanged —
    // the conservative estimate must keep pricing it.
    const system = ["x".repeat(4_000)]
    const tail = [userMessage("a".repeat(400))]
    const unverified = ledger.current({
      messageIDs: ["m1", "m2"],
      revision: "0",
      tail: { system, messages: [userMessage("y"), ...tail] },
    })
    expect(unverified.estimated).toBe(TokenEstimate.requestTokens({ system, messages: tail }))
    expect(unverified.measured).toBe(1_150)
  })

  test("a systemHash-only verified match still counts tool schemas as measured", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    const systemHash = "system-hash"
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1"], systemHash }))
    // Callers that know the system but not the tool surface (systemHash only)
    // still get the double-count fix for the system prompt; tool schemas
    // remain covered by the measurement (the tool surface is stable within a
    // turn and far smaller than a fixed AX Engine system prompt).
    const system = ["x".repeat(4_000)]
    const tail = [userMessage("a".repeat(400))]
    const breakdown = ledger.current({
      messageIDs: ["m1", "m2"],
      revision: "0",
      systemHash,
      tail: { system, messages: [userMessage("y"), ...tail] },
    })
    expect(breakdown.estimated).toBe(TokenEstimate.requestTokens({ system: [], messages: tail }))
  })

  test("findAnchor reports whether the match was hash-verified", () => {
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1"], toolSchemaHash: "t", systemHash: "s" }))
    expect(ledger.findAnchor({ messageIDs: ["m1", "m2"], revision: "0" })?.hashVerified).toBe(false)
    expect(ledger.findAnchor({ messageIDs: ["m1", "m2"], revision: "0", systemHash: "s" })?.hashVerified).toBe(true)
    expect(
      ledger.findAnchor({ messageIDs: ["m1", "m2"], revision: "0", systemHash: "s", toolSchemaHash: "t" })
        ?.hashVerified,
    ).toBe(true)
  })
})

describe("recordDrift EWMA", () => {
  beforeEach(() => {
    TokenLedger._resetDrift()
  })

  test("blends toward the reported/predicted ratio with alpha 0.3", () => {
    const first = TokenLedger.recordDrift(ROUTE, 1_000, 1_300) // ratio 1.3, prior 1.0
    expect(first).toBeCloseTo(0.7 * 1.0 + 0.3 * 1.3, 5)
    const second = TokenLedger.recordDrift(ROUTE, 1_000, 1_300)
    expect(second).toBeCloseTo(0.7 * first + 0.3 * 1.3, 5)
    const third = TokenLedger.recordDrift(ROUTE, 1_000, 100) // ratio 0.1
    expect(third).toBeCloseTo(0.7 * second + 0.3 * 0.1, 5)
  })

  test("repeated extreme ratios converge against the clamp bounds", () => {
    let value = 1
    for (let i = 0; i < 50; i++) value = TokenLedger.recordDrift("route-converge", 100, 10_000)
    expect(value).toBe(2.0)
    TokenLedger._resetDrift()
    value = 1
    for (let i = 0; i < 50; i++) value = TokenLedger.recordDrift("route-converge-low", 10_000, 100)
    expect(value).toBe(0.5)
  })

  test("clamps the coefficient to [0.5, 2.0]", () => {
    expect(TokenLedger.recordDrift("route-a", 100, 10_000)).toBe(2.0)
    TokenLedger._resetDrift()
    let low = 1
    for (let i = 0; i < 30; i++) low = TokenLedger.recordDrift("route-b", 10_000, 100)
    expect(low).toBe(0.5)
  })

  test("ignores unusable samples", () => {
    expect(TokenLedger.recordDrift("route-c", 0, 500)).toBe(1)
    expect(TokenLedger.recordDrift("route-c", 500, -5)).toBe(1)
  })

  test("drift coefficient scales the estimated tail", () => {
    TokenLedger._resetDrift()
    const drift = TokenLedger.recordDrift(ROUTE, 100, 200)
    expect(drift).toBeGreaterThan(1)
    const ledger = new TokenLedger.SessionTokenLedger()
    ledger.recordAnchor(anchorInput({ messageIDs: ["m1"] }))
    const tail = [userMessage("a".repeat(400))]
    const breakdown = ledger.current({
      messageIDs: ["m1", "m2"],
      revision: "0",
      routeKey: ROUTE,
      tail: { system: [], messages: [userMessage("x"), ...tail] },
    })
    expect(breakdown.estimated).toBe(Math.round(TokenEstimate.requestTokens({ system: [], messages: tail }) * drift))
  })
})

describe("fingerprint", () => {
  test("covers ordered message IDs, revision, and both hashes — never content", () => {
    const base = {
      messageIDs: ["m1", "m2"],
      revision: "0",
      toolSchemaHash: "t",
      systemHash: "s",
    }
    const a = TokenLedger.fingerprint(base)
    expect(a).toBe(TokenLedger.fingerprint({ ...base }))
    // Order matters.
    expect(TokenLedger.fingerprint({ ...base, messageIDs: ["m2", "m1"] })).not.toBe(a)
    // Every component matters.
    expect(TokenLedger.fingerprint({ ...base, revision: "1" })).not.toBe(a)
    expect(TokenLedger.fingerprint({ ...base, toolSchemaHash: "t2" })).not.toBe(a)
    expect(TokenLedger.fingerprint({ ...base, systemHash: "s2" })).not.toBe(a)
    // Extra messages change the fingerprint (prefix extension).
    expect(TokenLedger.fingerprint({ ...base, messageIDs: ["m1", "m2", "m3"] })).not.toBe(a)
  })

  test("isAnchorable accepts only exact usage, mirroring the anchor rule", () => {
    const exact = { inputTokens: 10, outputTokens: 5 }
    Object.defineProperty(exact, USAGE_SOURCE_KEY, { value: "exact", enumerable: false })
    expect(TokenLedger.isAnchorable(exact)).toBe(true)
    const estimated = { inputTokens: 10, outputTokens: 5 }
    Object.defineProperty(estimated, USAGE_SOURCE_KEY, { value: "estimated", enumerable: false })
    expect(TokenLedger.isAnchorable(estimated)).toBe(false)
  })
})

describe("session registry", () => {
  test("forSession returns one ledger per session; disposeSession cleans up", () => {
    TokenLedger._resetSessions()
    const a = TokenLedger.forSession("session-a")
    expect(TokenLedger.forSession("session-a")).toBe(a)
    expect(TokenLedger.forSession("session-b")).not.toBe(a)
    TokenLedger.disposeSession("session-a")
    expect(TokenLedger.forSession("session-a")).not.toBe(a)
    TokenLedger._resetSessions()
  })

  test("revision bumps are per session", () => {
    TokenLedger._resetSessions()
    expect(TokenLedger.revisionFor("s1")).toBe("0")
    TokenLedger.bumpRevision("s1")
    expect(TokenLedger.revisionFor("s1")).toBe("1")
    expect(TokenLedger.revisionFor("s2")).toBe("0")
    TokenLedger._resetSessions()
  })
})
