import { createRequire } from "node:module"
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, expect, test } from "vitest"
import { createClient } from "../src/client.js"
import type { DuplicateComparator } from "../src/client.js"
import { decodeGroups, encodeRows } from "../src/protocol.js"
const reasonModule = "@ax-code/ax-code-reason/duplicate-groups"
const { compareDuplicateGroups } = (await import(reasonModule)) as {
  compareDuplicateGroups(rows: Set<string>[], threshold: number): Promise<import("../src/protocol.js").DuplicateGroup[]>
}
// Test built artifacts: worker URLs and Wasm loading must work without a TS loader.
const { createDuplicateComparator } = (await import(
  new URL("../dist/node.js", import.meta.url).href
)) as typeof import("../src/node.js")

const clients: DuplicateComparator[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})
function client() {
  const value = createDuplicateComparator()
  clients.push(value)
  return value
}
const require = createRequire(import.meta.url)
const native = require("@ax-code/diff") as {
  duplicateGroupsAsync(json: string, threshold: number, cancellation: object): Promise<string>
  DiffCancellation: new () => object
}

test("real Wasm matches native greedy grouping, Unicode, deduplication and threshold boundaries", async () => {
  const wasm = client()
  const fixtures: string[][][] = [
    [],
    [[], []],
    [
      ["a", "b"],
      ["a", "b", "c"],
      ["b", "c"],
    ],
    [["a"], ["a", "b", "c"]],
    [["a", "a"], ["a"]],
    [
      ["中文", "😀", "e\u0301", "\r\n", "\u0000"],
      ["中文", "😀", "e\u0301", "\r\n", "\u0000"],
    ],
  ]
  let seed = 42
  const pick = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % n
  }
  for (let i = 0; i < 20; i++)
    fixtures.push(Array.from({ length: 10 + pick(40) }, () => Array.from({ length: pick(12) }, () => `t${pick(20)}`)))
  for (const rows of fixtures)
    for (const threshold of [-1, 0, 1 / 3, 0.6, 1, 2]) {
      const expected = decodeGroups(
        await native.duplicateGroupsAsync(JSON.stringify(rows), threshold, new native.DiffCancellation()),
        rows.length,
      )
      expect(
        await compareDuplicateGroups(
          rows.map((row) => new Set(row)),
          threshold,
        ),
      ).toEqual(expected)
      expect(await wasm.compare(rows, threshold)).toEqual(expected)
    }
  expect(await wasm.compare(fixtures[2]!, 0.6)).toEqual([{ indices: [0, 1], score: 2 / 3 }])
})

test("admission rejects malformed Unicode, non-finite thresholds and bounded input", async () => {
  const wasm = client()
  await expect(wasm.compare([["\ud800"]], 0.5)).rejects.toThrow("well-formed")
  await expect(wasm.compare([], NaN)).rejects.toThrow("finite")
  await expect(
    wasm.compare(
      Array.from({ length: 10001 }, () => []),
      1,
    ),
  ).rejects.toThrow("row limit")
  await expect(wasm.compare([Array.from({ length: 200001 }, () => "")], 1)).rejects.toThrow("entry limit")
  expect(() => encodeRows([["x".repeat(16 * 1024 * 1024 + 1)]], 1)).toThrow("byte limit")
  await expect(wasm.compare([], 1, { timeoutMs: 0 })).rejects.toThrow("timeout")
  expect(await wasm.compare([[], []], 1)).toEqual([{ indices: [0, 1], score: 1 }])
})

test("busy admission, mid-compute cancellation, worker recreation and close preserve lifecycle", async () => {
  const wasm = client()
  await wasm.compare([], 1) // Warm the actual worker before cancellation.
  const controller = new AbortController()
  const reason = new Error("caller cancelled comparison")
  const rows = Array.from({ length: 10000 }, (_, i) => Array.from({ length: 20 }, (_, j) => `token-${i}-${j}`))
  const pending = wasm.compare(rows, 0.9, { signal: controller.signal })
  const rejected = expect(pending).rejects.toBe(reason)
  await expect(wasm.compare([], 1)).rejects.toThrow("busy")
  setTimeout(() => controller.abort(reason), 5)
  await rejected
  expect(await wasm.compare([[], []], 1)).toEqual([{ indices: [0, 1], score: 1 }])
  const closing = wasm.compare(rows, 0.9)
  const closed = expect(closing).rejects.toThrow("closed")
  await wasm.close()
  await closed
  await expect(wasm.compare([], 1)).rejects.toThrow("closed")
  await wasm.close()
})

test("pre-abort preserves reason and timeout terminates rather than returning partial success", async () => {
  const wasm = client(),
    reason = new Error("already stopped")
  await expect(wasm.compare([], 1, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
  await wasm.compare([], 1)
  const rows = Array.from({ length: 10000 }, (_, i) => Array.from({ length: 20 }, (_, j) => `token-${i}-${j}`))
  await expect(wasm.compare(rows, 0.9, { timeoutMs: 1 })).rejects.toThrow("timed out")
  expect(await wasm.compare([], 1)).toEqual([])
})

test("caller mutation of options cannot replace the admitted cancellation signal", async () => {
  const wasm = client()
  await wasm.compare([], 1)
  const first = new AbortController(),
    replacement = new AbortController()
  const options = { signal: first.signal }
  const rows = Array.from({ length: 10000 }, (_, i) => [`t${i}`])
  const pending = wasm.compare(rows, 0.9, options)
  const reason = new Error("original signal")
  const rejected = expect(pending).rejects.toBe(reason)
  options.signal = replacement.signal
  first.abort(reason)
  await rejected
  expect(await wasm.compare([], 1)).toEqual([])
})

test.each(["missing", "corrupt"])("real %s Wasm artifact rejects and closes the worker", async (kind) => {
  const dir = await mkdtemp(path.join(tmpdir(), "ax-diff-wasm-artifact-"))
  try {
    await cp(new URL("../dist/", import.meta.url), path.join(dir, "dist"), { recursive: true })
    await writeFile(path.join(dir, "package.json"), '{"type":"module"}')
    if (kind === "corrupt") {
      await mkdir(path.join(dir, "wasm"))
      await cp(new URL("../wasm/ax_code_diff_wasm.js", import.meta.url), path.join(dir, "wasm/ax_code_diff_wasm.js"))
      await writeFile(path.join(dir, "wasm/ax_code_diff_wasm_bg.wasm"), "invalid wasm")
    }
    const { createDuplicateComparator } = (await import(
      pathToFileURL(path.join(dir, "dist/node.js")).href
    )) as typeof import("../src/node.js")
    const wasm = createDuplicateComparator()
    try {
      await expect(wasm.compare([], 1, { timeoutMs: 5000 })).rejects.toThrow()
    } finally {
      await wasm.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("ABI mismatch and invalid groups fail closed and drain termination before admitting new work", async () => {
  let emit!: (value: unknown) => void, finish!: () => void
  const wasm = createClient((message) => {
    emit = message
    return {
      post() {},
      terminate: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    }
  })
  clients.push(wasm)
  const pending = wasm.compare([], 1)
  const rejected = expect(pending).rejects.toThrow("ABI")
  emit({ type: "ready", version: 999 })
  await Promise.resolve()
  await expect(wasm.compare([], 1)).rejects.toThrow("busy")
  finish()
  await rejected
  for (const groups of [
    [{ indices: [0, 0], score: 1 }],
    [{ indices: [0, 2], score: 1 }],
    [{ indices: [0, 1], score: 2 }],
    [
      { indices: [0, 1], score: 1 },
      { indices: [0, 1], score: 1 },
    ],
  ])
    expect(() => decodeGroups(JSON.stringify({ version: 1, groups }), 2)).toThrow()
  expect(() => decodeGroups("not json", 2)).toThrow()
})

test("result validation uses the admitted row count even if the caller mutates its array", async () => {
  const wasm = client()
  const rows = [["a"], ["a"]]
  const pending = wasm.compare(rows, 1)
  rows.length = 0
  expect(await pending).toEqual([{ indices: [0, 1], score: 1 }])
})
