import { afterEach, describe, expect, test, vi } from "vitest"
import { NativeAddon } from "../../src/native/addon"
import { compareDuplicateGroups } from "@ax-code/ax-code-reason/duplicate-groups"
import { detectDuplicatesImpl } from "@ax-code/ax-code-reason/detect-duplicates"
import { installTestHost, resetTestHost } from "@ax-code/ax-code-reason/testing"
import { parseJsonStrict } from "@ax-code/util/json-value"
const native = NativeAddon.diff()
const enabled = !!native?.duplicateGroupsAsync && !!native.DiffCancellation
function useNative(diff: unknown = native) {
  const { host } = installTestHost()
  host.native = { fs: () => undefined, diff: () => diff, perfRun: (_n, _m, fn) => fn() }
  return host
}
afterEach(() => {
  vi.restoreAllMocks()
  resetTestHost()
})
function reference(rows: Set<string>[], threshold: number) {
  const paired = new Set<number>(),
    groups = []
  for (let i = 0; i < rows.length; i++) {
    if (paired.has(i)) continue
    const indices = [i]
    let score = 1
    for (let j = i + 1; j < rows.length; j++) {
      if (paired.has(j)) continue
      const a = rows[i],
        b = rows[j]
      let intersection = 0
      for (const t of a) if (b.has(t)) intersection++
      const union = a.size + b.size - intersection
      const value = a.size === 0 && b.size === 0 ? 1 : union === 0 ? 0 : intersection / union
      if (value >= threshold) {
        indices.push(j)
        paired.add(j)
        score = Math.min(score, value)
      }
    }
    if (indices.length > 1) {
      paired.add(i)
      groups.push({ indices, score })
    }
  }
  return groups
}
function up(value: number) {
  const b = new ArrayBuffer(8),
    view = new DataView(b)
  view.setFloat64(0, value)
  view.setBigUint64(0, view.getBigUint64(0) + 1n)
  return view.getFloat64(0)
}

describe.skipIf(!enabled)("native greedy duplicate comparison", () => {
  test("seeded parity across empty sets, duplicate tokens, Unicode and threshold boundaries", async () => {
    useNative()
    let seed = 8741
    const pick = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % n
    }
    const words = ["a", "b", "abc", "emoji😀", "İ", "", "_x"]
    for (let i = 0; i < 300; i++) {
      const rows = Array.from(
        { length: pick(40) },
        () => new Set(Array.from({ length: pick(8) }, () => words[pick(words.length)])),
      )
      for (const threshold of [0, 1 / 3, up(1 / 3), 2 / 3, up(2 / 3), 0.85, 1, 1.1, -0.1]) {
        const result = parseJsonStrict(
          await native!.duplicateGroupsAsync!(
            JSON.stringify(rows.map((r) => [...r])),
            threshold,
            new native!.DiffCancellation!(),
          ),
        ) as { groups: unknown }
        expect(result.groups).toEqual(reference(rows, threshold))
      }
    }
  })
  test("real large dispatch and old/missing addon fallback agree", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => new Set(["common", `token${i}`]))
    useNative()
    expect(await compareDuplicateGroups(rows, 0.85)).toEqual(reference(rows, 0.85))
    useNative({ ...native, duplicateGroupsAsync: undefined })
    expect(await compareDuplicateGroups(rows, 0.85)).toEqual(reference(rows, 0.85))
    useNative(null)
    expect(await compareDuplicateGroups(rows, 0.85)).toEqual(reference(rows, 0.85))
  })
  test("complete report parity retains raw tokens, tier IDs, stable rank and provenance", async () => {
    const { graph, host } = installTestHost()
    for (let i = 0; i < 400; i++)
      graph.addSymbol({
        id: `s${i}`,
        signature: `function unique${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}(raw${i}: Type${i}): Result${i}`,
        file: "/repo/src/all.ts",
      })
    graph.addSymbol({ id: "samea", signature: "function same(arg: number): void" })
    graph.addSymbol({ id: "sameb", signature: "function same(arg: number): void" })
    const expected = await detectDuplicatesImpl("project" as never, { scope: "none", similarityThreshold: 0.95 })
    host.native = { fs: () => undefined, diff: () => native, perfRun: (_n, _m, fn) => fn() }
    const actual = await detectDuplicatesImpl("project" as never, { scope: "none", similarityThreshold: 0.95 })
    expect({ ...actual, explain: { ...actual.explain, queryId: "ignored" } }).toEqual({
      ...expected,
      explain: { ...expected.explain, queryId: "ignored" },
    })
  })
  test("native cancellation, malformed input and admission limits reject", async () => {
    const token = new native!.DiffCancellation!()
    token.cancel()
    await expect(native!.duplicateGroupsAsync!("[]", 0.85, token)).rejects.toThrow("cancelled")
    const running = new native!.DiffCancellation!()
    const pending = native!.duplicateGroupsAsync!(
      JSON.stringify(Array.from({ length: 10000 }, (_, i) => [`t${i}`])),
      0.85,
      running,
    )
    running.cancel()
    await expect(pending).rejects.toThrow("cancelled")
    await expect(native!.duplicateGroupsAsync!("{}", 0.85, new native!.DiffCancellation!())).rejects.toThrow(
      "Invalid duplicate tokens",
    )
    await expect(
      native!.duplicateGroupsAsync!(
        JSON.stringify(Array.from({ length: 10001 }, () => [])),
        0.85,
        new native!.DiffCancellation!(),
      ),
    ).rejects.toThrow("resource limit")
    await expect(
      native!.duplicateGroupsAsync!(
        JSON.stringify([["x".repeat(16 * 1024 * 1024)]]),
        0.85,
        new native!.DiffCancellation!(),
      ),
    ).rejects.toThrow("resource limit")
    await expect(
      native!.duplicateGroupsAsync!(JSON.stringify([Array(200001).fill("x")]), 0.85, new native!.DiffCancellation!()),
    ).rejects.toThrow("resource limit")
    // Admission is valid, but an adversarial all-disjoint scan exhausts
    // the worker's merge-step budget instead of returning partial groups.
    await expect(
      native!.duplicateGroupsAsync!(
        JSON.stringify(Array.from({ length: 10000 }, (_, i) => Array.from({ length: 20 }, (_, j) => `${i}_${j}`))),
        0.85,
        new native!.DiffCancellation!(),
      ),
    ).rejects.toThrow("resource limit")
  })
})

test("native errors and invalid memberships never trigger JS retry", async () => {
  const call = vi.fn().mockRejectedValue(new Error("worker failed"))
  useNative({
    duplicateGroupsAsync: call,
    DiffCancellation: class {
      cancel() {}
    },
  })
  const rows = Array.from({ length: 256 }, () => new Set(["a"]))
  await expect(compareDuplicateGroups(rows, 0.85)).rejects.toThrow("worker failed")
  call.mockResolvedValue(JSON.stringify({ version: 1, groups: [{ indices: [0, 0], score: 1 }] }))
  await expect(compareDuplicateGroups(rows, 0.85)).rejects.toThrow("membership")
  expect(call).toHaveBeenCalledTimes(2)
})

test("lone-surrogate and nonfinite compatibility inputs stay in JS", async () => {
  const call = vi.fn()
  useNative({
    duplicateGroupsAsync: call,
    DiffCancellation: class {
      cancel() {}
    },
  })
  const rows = Array.from({ length: 256 }, () => new Set(["\uD800"]))
  expect(await compareDuplicateGroups(rows, 1)).toEqual(reference(rows, 1))
  expect(await compareDuplicateGroups(rows, NaN)).toEqual([])
  expect(await compareDuplicateGroups(rows, Infinity)).toEqual([])
  expect(await compareDuplicateGroups(rows, -Infinity)).toEqual(reference(rows, -Infinity))
  expect(call).not.toHaveBeenCalled()
})

test("aborted active work keeps its slot until the native promise settles", async () => {
  const resolvers: Array<(s: string) => void> = [],
    cancel = vi.fn()
  const call = vi.fn(() => new Promise<string>((r) => resolvers.push(r)))
  useNative({
    duplicateGroupsAsync: call,
    DiffCancellation: class {
      cancel = cancel
    },
  })
  const rows = Array.from({ length: 256 }, () => new Set(["a"]))
  const controllers = Array.from({ length: 34 }, () => new AbortController())
  const pending = controllers.map((c) => compareDuplicateGroups(rows, 0.85, c.signal).catch((e) => e))
  expect(call).toHaveBeenCalledTimes(2)
  await expect(compareDuplicateGroups(rows, 0.85)).rejects.toThrow("queue is full")
  controllers[0].abort(new Error("stop"))
  expect((await pending[0]).message).toBe("stop")
  expect(call).toHaveBeenCalledTimes(2)
  expect(cancel).toHaveBeenCalledTimes(1)
  for (const c of controllers.slice(1)) c.abort()
  for (const resolve of resolvers) resolve('{"version":1,"groups":[]}')
  await Promise.all(pending)
  await new Promise((r) => setImmediate(r))
})

test("worker deadlines cancel native work and never become a successful fallback", async () => {
  vi.useFakeTimers()
  let complete!: (json: string) => void
  const cancel = vi.fn()
  useNative({
    DiffCancellation: class {
      cancel = cancel
    },
    duplicateGroupsAsync: () =>
      new Promise<string>((resolve) => {
        complete = resolve
      }),
  })
  try {
    const pending = compareDuplicateGroups(
      Array.from({ length: 256 }, () => new Set(["a"])),
      0.85,
    )
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" })
    await vi.advanceTimersByTimeAsync(30000)
    await rejected
    expect(cancel).toHaveBeenCalledTimes(1)
    complete('{"version":1,"groups":[]}')
  } finally {
    vi.useRealTimers()
  }
  await new Promise((resolve) => setImmediate(resolve))
})
