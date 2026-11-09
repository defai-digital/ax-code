import { createRequire } from "node:module"
import { expect, test } from "vitest"
import type { Hunk } from "../src/protocol.js"
const { createDiffEngine } = (await import(
  new URL("../dist/node.js", import.meta.url).href
)) as typeof import("../src/node.js")
const native = createRequire(import.meta.url)("@ax-code/diff") as {
  DiffCancellation: new () => object
  PatchCancellation: new () => object
  diffPreviewAsync(before: string, after: string, normalize: boolean, cancel: object): Promise<string>
  applyPatchContentAsync(file: string, original: string, chunks: string, cancel: object): Promise<string>
}
test("Wasm preview equals native and hunks roundtrip exact bytes across randomized edits", async () => {
  const engine = createDiffEngine()
  try {
    const texts = ["", "a", "a\n", "a\r\n", "\n", "\r", "中文😀\r\nb", "\0", "same\n".repeat(30)]
    const pairs = texts.flatMap((before) => texts.map((after) => [before, after] as const))
    let seed = 91
    const pick = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % n
    }
    const words = ["a", "b", "中文", "😀", "e\u0301", "", "\0", "\r"]
    const sample = () => Array.from({ length: pick(60) }, () => words[pick(words.length)]).join(pick(2) ? "\r\n" : "\n")
    for (let i = 0; i < 250; i++) pairs.push([sample(), sample()])
    for (const [before, after] of pairs) {
      const preview = await engine.diff(before, after)
      expect(preview).toEqual(
        JSON.parse(await native.diffPreviewAsync(before, after, false, new native.DiffCancellation())),
      )
      expect(await engine.applyHunks(before, preview.hunks)).toBe(after)
    }
    const normalized = await engine.diff("a\r\nb", "a\nb\n", { normalize: true })
    expect(normalized).toEqual(
      JSON.parse(await native.diffPreviewAsync("a\r\nb", "a\nb\n", true, new native.DiffCancellation())),
    )
    expect(await engine.applyHunks("a\nb", normalized.hunks)).toBe("a\nb\n")
    const before = Array.from({ length: 100 }, (_, i) => `${i}\n`).join("")
    const after = before.replace("2\n", "two\n").replace("90\n", "ninety\n")
    const separated = await engine.diff(before, after)
    expect(separated.hunks).toHaveLength(2)
    expect(await engine.applyHunks(before, separated.hunks)).toBe(after)
  } finally {
    await engine.close()
  }
})
test("hunk rejection is atomic for stale context, malformed coordinates and EOF markers", async () => {
  const engine = createDiffEngine()
  try {
    const { hunks } = await engine.diff("a\nb\n", "a\nc\n")
    await expect(engine.applyHunks("a\nx\n", hunks)).rejects.toThrow("mismatched")
    const h = hunks[0]!
    for (const bad of [
      { ...h, oldStart: 0 },
      { ...h, oldLines: 0 },
      { ...h, newStart: 9 },
      { ...h, lines: ["?bad"] },
      { ...h, lines: ["+x", "\\ No newline at end of file", "+y"] },
    ] as Hunk[])
      await expect(engine.applyHunks("a\nb\n", [bad])).rejects.toThrow()
    await expect(engine.applyHunks("a\nb\n", [h, h])).rejects.toThrow()
    expect(await engine.applyHunks("a\nb\n", hunks)).toBe("a\nc\n")
    await expect(engine.diff("\ud800", "")).rejects.toThrow("well-formed")
    await expect(engine.diff("x".repeat(16 * 1024 * 1024 + 1), "")).rejects.toThrow("limit")
  } finally {
    await engine.close()
  }
})
test("patch chunks retain native matching and final-newline semantics", async () => {
  const engine = createDiffEngine()
  try {
    for (const original of ["a\nb", "a\r\nb\r\n", "  a  \nb\n", "a\nb\na\nb\n"]) {
      const chunks = [{ old_lines: ["b"], new_lines: ["中文😀"], is_end_of_file: true }]
      expect(await engine.applyPatch("example.txt", original, chunks)).toBe(
        await native.applyPatchContentAsync(
          "example.txt",
          original,
          JSON.stringify(chunks),
          new native.PatchCancellation(),
        ),
      )
    }
    await expect(
      engine.applyPatch("example.txt", "a\n", [{ old_lines: ["missing"], new_lines: ["x"] }]),
    ).rejects.toThrow()
  } finally {
    await engine.close()
  }
})
test("work-budget overruns return an approximate preview that still roundtrips", async () => {
  const engine = createDiffEngine()
  try {
    const rewrite = (tag: string, eol: string) =>
      Array.from(
        { length: 10_000 },
        (_, i) => `  const v${i} = compute(${(i * 7919) % 10007}, "${tag}${i}")${eol}`,
      ).join("")
    for (const eol of ["\n", "\r\n"]) {
      const before = rewrite("a", eol)
      const after = "head 中文😀" + eol + rewrite("b", eol) + "tail without newline"
      const started = performance.now()
      const preview = await engine.diff(before, after)
      const elapsed = performance.now() - started
      expect(preview.approximate).toBe(true)
      expect(preview.version).toBe(1)
      expect(preview).toMatchObject({ additions: 10_002, deletions: 10_000 })
      expect(elapsed).toBeLessThan(5_000)
      expect(await engine.applyHunks(before, preview.hunks)).toBe(after)
      await expect(native.diffPreviewAsync(before, after, false, new native.DiffCancellation())).rejects.toThrow(
        "resource limit",
      )
    }
    const exact = await engine.diff("a\nb\n", "a\nc\n")
    expect("approximate" in exact).toBe(false)
  } finally {
    await engine.close()
  }
})
