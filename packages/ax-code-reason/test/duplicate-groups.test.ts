import { afterEach, expect, test } from "vitest"
import { compareDuplicateGroups } from "../src/duplicate-groups"
import { detectDuplicatesImpl, normalizeSignature } from "../src/detect-duplicates"
import { installTestHost, resetTestHost } from "./fixture/host"
afterEach(() => resetTestHost())

test("fallback keeps greedy non-transitive groups and floating point boundary scores", async () => {
  installTestHost()
  const rows = [new Set(["a", "b"]), new Set(["a", "b", "c"]), new Set(["b", "c"])]
  expect(await compareDuplicateGroups(rows, 0.6)).toEqual([{ indices: [0, 1], score: 2 / 3 }])
  expect(await compareDuplicateGroups([new Set(), new Set()], 1)).toEqual([{ indices: [0, 1], score: 1 }])
  expect(await compareDuplicateGroups([new Set(["a"]), new Set(["a", "b", "c"])], 1 / 3)).toEqual([
    { indices: [0, 1], score: 1 / 3 },
  ])
  expect(await compareDuplicateGroups(rows, NaN)).toEqual([])
})

test("full report keeps exact/structural/semantic tiers, ordering and audit fields", async () => {
  const { graph } = installTestHost()
  for (const [id, signature] of [
    ["exacta", "function exact(value: number): void"],
    ["exactb", "function exact(value: number): void"],
    ["structa", "function structurala(value: number = 1): void"],
    ["structb", "function structurala(other: number = 2): void"],
    ["neara", "function left(value: number): void"],
    ["nearb", "function right(value: number): void"],
  ])
    graph.addSymbol({
      id,
      signature,
      file: `/repo/src/${id}.ts`,
      range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
    })
  const result = await detectDuplicatesImpl("project" as never, {
    scope: "none",
    kinds: ["function"],
    similarityThreshold: 0.65,
  })
  expect(
    result.clusters.map((c) => ({ id: c.id, tier: c.tier, ids: c.members.map((m) => m.id), lines: c.sharedLines })),
  ).toEqual([
    { id: "cluster_0", tier: "exact", ids: ["exacta", "exactb"], lines: 6 },
    { id: "cluster_1", tier: "structural", ids: ["structa", "structb"], lines: 6 },
    { id: "cluster_2", tier: "semantic", ids: ["neara", "nearb"], lines: 6 },
  ])
  expect(result.totalDuplicateLines).toBe(18)
  expect(result.auditCaveat).toContain("Heuristic scan")
})

test("candidate cap truncation and abort remain owned by the caller", async () => {
  const { graph } = installTestHost()
  for (let i = 0; i < 12; i++) graph.addSymbol({ id: `s${i}`, signature: "function exact(value: number): void" })
  const report = await detectDuplicatesImpl("project" as never, { scope: "none", maxCandidates: 10 })
  expect(report.truncated).toBe(true)
  expect(report.clusters[0].members).toHaveLength(10)
  const reason = new Error("stop")
  await expect(detectDuplicatesImpl("project" as never, {}, AbortSignal.abort(reason))).rejects.toBe(reason)
})

test("fallback is bounded and yields so cancellation can stop large comparisons", async () => {
  installTestHost()
  const controller = new AbortController()
  const pending = compareDuplicateGroups(
    Array.from({ length: 2000 }, (_, i) => new Set([`token${i}`])),
    0.85,
    controller.signal,
  )
  controller.abort(new Error("cancelled"))
  await expect(pending).rejects.toThrow("cancelled")
  const wideController = new AbortController()
  const wide = compareDuplicateGroups(
    [new Set(Array.from({ length: 100000 }, (_, i) => `wide${i}`)), new Set(["other"])],
    0.85,
    wideController.signal,
  )
  setImmediate(() => wideController.abort(new Error("wide cancelled")))
  await expect(wide).rejects.toThrow("wide cancelled")
  await expect(
    compareDuplicateGroups(
      Array.from({ length: 10001 }, () => new Set()),
      0.85,
    ),
  ).rejects.toThrow("resource limit")
  await expect(
    compareDuplicateGroups([new Set(Array.from({ length: 200001 }, (_, i) => `${i}`))], 0.85),
  ).rejects.toThrow("resource limit")
})

// Frozen old parameter-name walk: only the expensive unchanged-word case was optimized.
function oldDrop(inner: string) {
  let out = "",
    i = 0
  while (i < inner.length) {
    const ch = inner[i]
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1
      while (j < inner.length && /[\w$]/.test(inner[j])) j++
      let k = j
      while (k < inner.length && (inner[k] === " " || inner[k] === "\t")) k++
      if (inner[k] === ":") {
        out += ":"
        i = k + 1
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

test("linear parameter-name normalization preserves the old walk", () => {
  let seed = 7253
  const pick = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % n
  }
  const words = ["arg", "Type", "foo0", "_x", "$arg", "é", "😀", ":", ",", " ", "\t", "-", "0", "<", ">"]
  for (let i = 0; i < 500; i++) {
    const inner = Array.from({ length: pick(40) }, () => words[pick(words.length)]).join("")
    // Independently compose the old transforms for this corpus without
    // nested parentheses, quotes or defaults.
    const normalizedInner = inner.replace(/[ \t\n\r\f]+/g, " ")
    const expected = `function f(${oldDrop(normalizedInner)})`.replace(/\b\d+(\.\d+)?\b/g, "N").trim()
    expect(normalizeSignature(`function f(${inner})`)).toBe(expected)
  }
  expect(normalizeSignature(`function f(x: ${"A".repeat(100000)})`)).toBe(`function f(: ${"A".repeat(100000)})`)
})

test("oversized admitted signatures fail before normalization", async () => {
  const { graph } = installTestHost()
  graph.addSymbol({ id: "huge", signature: "a".repeat(1024 * 1024 + 1) })
  await expect(detectDuplicatesImpl("project" as never, { scope: "none" })).rejects.toThrow("signature resource limit")
})

test("worker reports retain the admitted graph snapshot", async () => {
  const { graph, host } = installTestHost()
  for (let i = 0; i < 256; i++) {
    const label = String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26))
    graph.addSymbol({
      id: `s${i}`,
      signature: `function name${label}(param: Type${label}): Result${label}`,
      file: "/repo/src/all.ts",
    })
  }
  let complete!: (json: string) => void
  host.native = {
    fs: () => undefined,
    perfRun: (_n, _m, fn) => fn(),
    diff: () => ({
      DiffCancellation: class {
        cancel() {}
      },
      duplicateGroupsAsync: () =>
        new Promise<string>((resolve) => {
          complete = resolve
        }),
    }),
  }
  const old = graph.symbols.get("s0")!
  const signature = old.signature
  const pending = detectDuplicatesImpl("project" as never, { scope: "none", similarityThreshold: 0.1 })
  old.file = "/changed.ts"
  old.signature = "changed"
  old.range.end.line = 99
  old.explain.indexedAt = 999
  complete(JSON.stringify({ version: 1, groups: [{ indices: Array.from({ length: 256 }, (_, i) => i), score: 0.25 }] }))
  const report = await pending
  expect(report.clusters[0].members[0]).toMatchObject({
    file: "/repo/src/all.ts",
    signature,
    range: { end: { line: 0 } },
    explain: { indexedAt: 1000 },
  })
  expect(report.totalDuplicateLines).toBe(255)
})
