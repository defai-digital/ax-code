import { beforeEach, describe, expect, test } from "vitest"
import {
  analyzeBugImpl,
  detectStackFormat,
  parsePythonStack,
  parseStackTrace,
  parseTypeScriptStack,
  validateHypothesisCitations,
} from "../src/analyze-bug"
import { installTestHost, type TestHost } from "./fixture/host"

const TS_STACK = `Error: boom
    at handleRequest (/repo/src/server.ts:42:11)
    at /repo/src/routes.ts:10:3
    at Layer.handle (/repo/node_modules/express/lib/layer.js:95:5)`

const PY_STACK = `Traceback (most recent call last):
  File "/repo/app.py", line 10, in main
    main()
  File "/repo/lib.py", line 4, in explode
    raise ValueError("x")
ValueError: x`

describe("stack trace parsing", () => {
  test("parses V8 frames with and without symbol names", () => {
    const frames = parseTypeScriptStack(TS_STACK)
    expect(frames).toHaveLength(3)
    expect(frames[0]).toMatchObject({ symbolName: "handleRequest", file: "/repo/src/server.ts", line: 42 })
    // Form 2: no symbol name, file:line:col only.
    expect(frames[1]).toMatchObject({ file: "/repo/src/routes.ts", line: 10 })
    expect(frames[1].symbolName).toBeUndefined()
    expect(frames[2]).toMatchObject({ symbolName: "Layer.handle", file: "/repo/node_modules/express/lib/layer.js" })
  })

  test("parses Python tracebacks failure-frame-first", () => {
    const frames = parsePythonStack(PY_STACK)
    expect(frames).toHaveLength(2)
    // Python orders oldest-first; the parser reverses so frame 0 is the
    // failure site, matching V8 ordering.
    expect(frames[0]).toMatchObject({ file: "/repo/lib.py", line: 4, symbolName: "explode" })
    expect(frames[1]).toMatchObject({ file: "/repo/app.py", line: 10, symbolName: "main" })
  })

  test("detects stack formats and falls back to the TS parser for unknown input", () => {
    expect(detectStackFormat(PY_STACK)).toBe("python")
    expect(detectStackFormat(TS_STACK)).toBe("typescript")
    expect(detectStackFormat("totally unstructured output")).toBe("unknown")
    const parsed = parseStackTrace("totally unstructured output")
    expect(parsed.format).toBe("unknown")
    expect(parsed.frames).toEqual([])
  })

  test("skips malformed and unparseable frame lines", () => {
    const messy = [
      "Error: boom",
      "    at broken frame with no location",
      "    at Foo (not-a-path)",
      "    at good (/repo/src/ok.ts:7:2)",
      "    at also-missing-colons (/repo/src/ok.ts)",
      "garbage line",
    ].join("\n")
    const frames = parseTypeScriptStack(messy)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ symbolName: "good", file: "/repo/src/ok.ts", line: 7 })
  })
})

describe("analyzeBugImpl", () => {
  let testHost: TestHost

  beforeEach(() => {
    testHost = installTestHost()
  })

  test("returns an explicit empty result when there is nothing to resolve", async () => {
    const result = await analyzeBugImpl("test-project", { error: "boom" })
    expect(result.chain).toEqual([])
    expect(result.rootCauseHypothesis).toBeNull()
    expect(result.fixSuggestion).toBeNull()
    expect(result.confidence).toBe(0)
    expect(result.truncated).toBe(false)
    expect(result.explain.tool).toBe("analyze-bug")
  })

  test("resolves frames against the graph and filters framework noise", async () => {
    testHost.graph.addSymbol({
      id: "sym-handle",
      name: "handleRequest",
      qualifiedName: "server.handleRequest",
      file: "/repo/src/server.ts",
      range: { start: { line: 39, character: 0 }, end: { line: 50, character: 1 } },
    })
    testHost.graph.addSymbol({
      id: "sym-routes",
      name: "registerRoutes",
      qualifiedName: "routes.registerRoutes",
      file: "/repo/src/routes.ts",
      range: { start: { line: 5, character: 0 }, end: { line: 15, character: 1 } },
    })

    const result = await analyzeBugImpl("test-project", { error: "boom", stackTrace: TS_STACK })

    // The node_modules frame is dropped as noise; the two user frames stay.
    expect(result.chain).toHaveLength(2)
    expect(result.chain[0]).toMatchObject({ frame: 0, role: "failure", file: "/repo/src/server.ts", line: 42 })
    expect(result.chain[0].symbol?.id).toBe("sym-handle")
    expect(result.chain[1].symbol?.id).toBe("sym-routes")
    expect(result.explain.heuristicsApplied).toContain("ts-stack-regex")
    expect(result.explain.heuristicsApplied).toContain("rule-filter:noise(1)")
    // Fully resolved chain caps at 0.95 (ADR-005: never claim certainty).
    expect(result.confidence).toBe(0.95)
    expect(result.rootCauseHypothesis?.citedFrames).toEqual([0])
    expect(result.fixSuggestion).toContain("verify_project")
  })

  test("keeps the failure frame even when it is itself noisy", async () => {
    const noisyStack = `Error: boom
    at vendorChunk (/repo/dist/chunk-abc123.js:1:100)
    at handleRequest (/repo/src/server.ts:42:11)`
    testHost.graph.addSymbol({
      id: "sym-handle",
      name: "handleRequest",
      file: "/repo/src/server.ts",
      range: { start: { line: 39, character: 0 }, end: { line: 50, character: 1 } },
    })

    const result = await analyzeBugImpl("test-project", { error: "boom", stackTrace: noisyStack })
    // Frame 0 (dist bundle) is the failure site — noise filtering keeps it.
    expect(result.chain[0].file).toBe("/repo/dist/chunk-abc123.js")
    expect(result.chain[0].role).toBe("failure")
    expect(result.explain.heuristicsApplied).not.toContain("rule-filter:noise(1)")
  })

  test("keeps phantom frames as unresolved nulls and lowers confidence", async () => {
    const stack = `Error: boom
    at ghost (/repo/src/ghost.ts:9:1)
    at handleRequest (/repo/src/server.ts:42:11)`
    testHost.graph.addSymbol({
      id: "sym-handle",
      name: "handleRequest",
      file: "/repo/src/server.ts",
      range: { start: { line: 39, character: 0 }, end: { line: 50, character: 1 } },
    })

    const result = await analyzeBugImpl("test-project", { error: "boom", stackTrace: stack })
    expect(result.chain).toHaveLength(2)
    expect(result.chain[0].symbol).toBeNull()
    expect(result.chain[1].symbol?.id).toBe("sym-handle")
    // 1 of 2 frames resolved.
    expect(result.confidence).toBe(0.5)
    // The hypothesis anchors on the first RESOLVED frame, never a phantom.
    expect(result.rootCauseHypothesis?.citedFrames).toEqual([1])
  })

  test("terminates on caller cycles when walking up from an entry symbol", async () => {
    testHost.graph.addSymbol({ id: "a", name: "fnA" })
    testHost.graph.addSymbol({ id: "b", name: "fnB" })
    testHost.graph.addCallerEdge("a", "b")
    testHost.graph.addCallerEdge("b", "a")

    const result = await analyzeBugImpl("test-project", { error: "boom", entrySymbol: "a" })
    // a is the seed, b is its only unvisited caller, and b's caller (a) is
    // already visited — the walk stops instead of looping.
    expect(result.chain.map((f) => f.symbol?.id)).toEqual(["a", "b"])
    expect(result.truncated).toBe(false)
    expect(result.explain.heuristicsApplied).toContain("entry-symbol-seed:callers=1")
  })

  test("marks truncation when the caller walk is cut off by the depth cap", async () => {
    // Linear caller chain: seed ← c1 ← c2 ← ... ← c6
    testHost.graph.addSymbol({ id: "seed", name: "seedFn" })
    for (let i = 1; i <= 6; i++) testHost.graph.addSymbol({ id: `c${i}`, name: `caller${i}` })
    testHost.graph.addCallerEdge("seed", "c1")
    for (let i = 1; i < 6; i++) testHost.graph.addCallerEdge(`c${i}`, `c${i + 1}`)

    const truncated = await analyzeBugImpl("test-project", { error: "boom", entrySymbol: "seed", chainDepth: 3 })
    expect(truncated.chain.map((f) => f.symbol?.id)).toEqual(["seed", "c1", "c2", "c3"])
    expect(truncated.truncated).toBe(true)

    // Exactly as many callers as the depth budget is NOT truncation.
    const exact = await analyzeBugImpl("test-project", { error: "boom", entrySymbol: "c4", chainDepth: 2 })
    expect(exact.chain.map((f) => f.symbol?.id)).toEqual(["c4", "c5", "c6"])
    expect(exact.truncated).toBe(false)
  })

  test("clamps chainDepth into [1, 8]", async () => {
    testHost.graph.addSymbol({ id: "seed", name: "seedFn" })
    for (let i = 1; i <= 10; i++) testHost.graph.addSymbol({ id: `c${i}`, name: `caller${i}` })
    testHost.graph.addCallerEdge("seed", "c1")
    for (let i = 1; i < 10; i++) testHost.graph.addCallerEdge(`c${i}`, `c${i + 1}`)

    // Requested 100 → capped at MAX_CHAIN_DEPTH (8).
    const capped = await analyzeBugImpl("test-project", { error: "boom", entrySymbol: "seed", chainDepth: 100 })
    expect(capped.chain).toHaveLength(1 + 8)
    expect(capped.truncated).toBe(true)

    // Requested 0 → clamped up to 1.
    const floored = await analyzeBugImpl("test-project", { error: "boom", entrySymbol: "seed", chainDepth: 0 })
    expect(floored.chain).toHaveLength(1 + 1)
    expect(floored.truncated).toBe(true)
  })

  test("ignores a phantom entrySymbol", async () => {
    const result = await analyzeBugImpl("test-project", { error: "boom", entrySymbol: "missing-node" })
    expect(result.chain).toEqual([])
    expect(result.rootCauseHypothesis).toBeNull()
    expect(result.confidence).toBe(0)
  })
})

describe("validateHypothesisCitations (cite-or-drop)", () => {
  const chain = [
    { frame: 0, symbol: null, file: "/repo/a.ts", line: 1, role: "failure" as const },
    { frame: 1, symbol: null, file: "/repo/b.ts", line: 2, role: "entry" as const },
  ]

  test("drops cited frame indices that do not exist in the chain", () => {
    const hypothesis = { summary: "s", brokenInvariant: "b", citedFrames: [0, 7, 1] }
    expect(validateHypothesisCitations(hypothesis, chain)?.citedFrames).toEqual([0, 1])
  })

  test("drops the whole claim when nothing it cites survives", () => {
    const hypothesis = { summary: "s", brokenInvariant: "b", citedFrames: [9] }
    expect(validateHypothesisCitations(hypothesis, chain)).toBeNull()
  })
})
