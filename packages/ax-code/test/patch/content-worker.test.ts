import { afterEach, describe, expect, test, vi } from "vitest"
import { NativeAddon } from "../../src/native/addon"
import { Patch } from "../../src/patch"

const native = NativeAddon.diff()
const enabled = !!native?.applyPatchContentAsync && !!native.PatchCancellation
afterEach(() => vi.restoreAllMocks())
const file = "a file😀.ts"
const update = (old_lines: string[], new_lines: string[], extra: Partial<Patch.UpdateFileChunk> = {}) => ({
  old_lines,
  new_lines,
  ...extra,
})
const direct = (original: string, chunks: Patch.UpdateFileChunk[]) =>
  native!.applyPatchContentAsync!(file, original, JSON.stringify(chunks), new native!.PatchCancellation!())

describe.skipIf(!enabled)("native patch content worker", () => {
  test("legacy parity for EOL, trailing blanks, all matching passes, EOF and insertion ordering", async () => {
    const fixtures: Array<[string, Patch.UpdateFileChunk[]]> = [
      ["a\n\n", [update(["a", ""], []), update([], ["x"])]],
      ["", []],
      ["", [update([], ["x"])]],
      ["a", []],
      ["\n", []],
      ["a\n\n", []],
      ["a\r\n\r\n", []],
      ["a\r\nb\nc\r\n", [update(["b"], ["B"])]],
      ["a\n", [update(["a"], [])]],
      ["a\nb\n", [update(["a", ""], ["A", ""])]],
      ["a\na\n", [update(["a"], ["A"], { is_end_of_file: true })]],
      ["a \na\n", [update(["a"], ["A"], { is_end_of_file: true })]],
      ["a\nb\n", [update([], ["x"], { change_context: "a" }), update([], ["y"], { change_context: "" })]],
      ["a\n", [update([], ["x"]), update([], ["y"]), update([], ["z"])]],
      ["a\n\n", [update([], ["x"]), update([], ["y"])]],
      ["a\n", [update(["missing"], [])]],
      ["a\n", [update([], ["x"], { change_context: "missing" })]],
      ["a\n", [update([""], ["x"])]],
      ["a\nb\n", [update([], ["x"], { change_context: "a" }), update(["b"], ["B"])]],
    ]
    for (const prefix of ["", " ", "\t", "\uFEFF", "\u0085", "\u2028", "\u2029", "😀"])
      for (const suffix of ["", " ", "\uFEFF", "\u0085"])
        fixtures.push([`${prefix}“a”—…${suffix}\na\u0085\n\uFEFFa\n`, [update(['"a"-...'], ["changed😀"])]])
    // Native whitespace wins before a possible JS whitespace match; EOF is retried per pass.
    fixtures.push(["\uFEFFa\na\u0085\n", [update(["a"], ["A"])]])
    for (const [original, chunks] of fixtures) {
      let expected: string
      try {
        expected = Patch.deriveContentFromChunks(original, file, chunks)
      } catch (error) {
        await expect(direct(original, chunks)).rejects.toThrow((error as Error).message)
        continue
      }
      expect(await direct(original, chunks), JSON.stringify([original, chunks])).toBe(expected)
      expect(await Patch.deriveContentFromChunksAsync(original, file, chunks)).toBe(expected)
    }
  })

  test("seeded differential patches retain exact content", async () => {
    let seed = 917
    const pick = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % n
    }
    const words = ["a", "b", "", "😀", "\uFEFFx", "x\u0085", " ‘x’ ", "x\r"]
    for (let i = 0; i < 400; i++) {
      const lines = Array.from({ length: 5 + pick(25) }, () => words[pick(words.length)])
      const at = pick(lines.length)
      const end = at + 1 + pick(lines.length - at)
      const ending = pick(2) ? "\n" : "\r\n"
      const original = lines.join(ending) + (pick(2) ? ending : "")
      const chunks = [
        update(lines.slice(at, end), [words[pick(words.length)], words[pick(words.length)]], {
          is_end_of_file: !!pick(2),
        }),
      ]
      let expected: string
      try {
        expected = Patch.deriveContentFromChunks(original, file, chunks)
      } catch (error) {
        await expect(direct(original, chunks)).rejects.toThrow((error as Error).message)
        continue
      }
      expect(await direct(original, chunks)).toBe(expected)
    }
  })

  test("linear assembly agrees with reverse splicing across multi-chunk edits", async () => {
    for (let variant = 0; variant < 40; variant++) {
      const lines = Array.from({ length: 100 }, (_, i) => `unique ${i}😀`)
      const chunks: Patch.UpdateFileChunk[] = []
      const edits: Array<[number, number, string[]]> = []
      for (let at = 0; at < 95; at += 5) {
        const removed = 1 + ((at + variant) % 3)
        const added = Array.from({ length: (at + variant) % 4 }, (_, i) => `added ${at}:${i}`)
        chunks.push(update(lines.slice(at, at + removed), added))
        edits.push([at, removed, added])
      }
      for (const added of [["first"], ["second", "third"]]) {
        chunks.push(update([], added))
        edits.push([lines.length, 0, added])
      }
      const expected = [...lines]
      for (const [start, removed, added] of edits.reverse()) expected.splice(start, removed, ...added)
      const original = lines.join("\n") + "\n"
      expect(await direct(original, chunks)).toBe(expected.join("\n") + "\n")
      expect(Patch.deriveContentFromChunks(original, file, chunks)).toBe(expected.join("\n") + "\n")
    }
  })

  test("resource limits accept their output, line and chunk boundaries", async () => {
    const original = "x".repeat(16 * 1024 * 1024 - 1)
    expect((await direct(original, [])).length).toBe(16 * 1024 * 1024)
    expect(await direct("a\n".repeat(199_999), [])).toBe("a\n".repeat(199_999))
    expect(
      await direct(
        "a\n",
        Array.from({ length: 4096 }, () => update([], [])),
      ),
    ).toBe("a\n")
  })

  test("large real dispatch and compatibility fallback agree", async () => {
    const original = "anchor\r\n" + "unchanged\r\n".repeat(10_000) + "\r\n"
    const chunks = [
      update(
        [],
        Array.from({ length: 2000 }, (_, i) => `new ${i}`),
        { change_context: "anchor" },
      ),
    ]
    const expected = Patch.deriveContentFromChunks(original, file, chunks)
    expect(await Patch.deriveContentFromChunksAsync(original, file, chunks)).toBe(expected)
    vi.spyOn(NativeAddon, "diff").mockReturnValue({ ...native!, applyPatchContentAsync: undefined })
    expect(await Patch.deriveContentFromChunksAsync(original, file, chunks)).toBe(expected)
    vi.mocked(NativeAddon.diff).mockReturnValue(undefined)
    expect(await Patch.deriveContentFromChunksAsync(original, file, chunks)).toBe(expected)
  })

  test("native pre-cancel and cancellation after dispatch reject", async () => {
    const cancellation = new native!.PatchCancellation!()
    cancellation.cancel()
    await expect(native!.applyPatchContentAsync!(file, "a", "[]", cancellation)).rejects.toThrow("cancelled")
    const running = new native!.PatchCancellation!()
    const old = [...Array(2000).fill("a"), "b"]
    const promise = native!.applyPatchContentAsync!(
      file,
      "a\n".repeat(100_000),
      JSON.stringify([update(old, [])]),
      running,
    )
    running.cancel()
    await expect(promise).rejects.toThrow("cancelled")
    expect(await direct("a\n", [update(["a"], ["b"])])).toBe("b\n")
  })

  test("native rejects input, line, chunk, matching and output limits", async () => {
    await expect(direct("a\n".repeat(200_000), [])).rejects.toThrow("resource limit")
    await expect(
      direct(
        "",
        Array.from({ length: 4097 }, () => update([], [])),
      ),
    ).rejects.toThrow("resource limit")
    await expect(direct("", [update([], Array(200_001).fill(""))])).rejects.toThrow("resource limit")
    await expect(direct("x".repeat(32 * 1024 * 1024), [])).rejects.toThrow("resource limit")
    await expect(direct("x".repeat(16 * 1024 * 1024), [])).rejects.toThrow("resource limit")
    await expect(direct("a\n".repeat(5000), [update([...Array(3000).fill("a"), "b"], [])])).rejects.toThrow(
      "resource limit",
    )
    await expect(native!.applyPatchContentAsync!(file, "a", "{}", new native!.PatchCancellation!())).rejects.toThrow(
      "Invalid patch chunks",
    )
  })
})

test("bounded JS lane preserves lone surrogates and rejects adversarial matching", async () => {
  const call = vi.fn()
  vi.spyOn(NativeAddon, "diff").mockReturnValue({ ...native!, applyPatchContentAsync: call })
  const original = "a\n".repeat(40_000) + "\uD800\n"
  expect(await Patch.deriveContentFromChunksAsync(original, file, [update(["\uD800"], ["\uDFFF"])])).toBe(
    original.replace("\uD800", "\uDFFF"),
  )
  expect(call).not.toHaveBeenCalled()
  vi.mocked(NativeAddon.diff).mockReturnValue(undefined)
  await expect(
    Patch.deriveContentFromChunksAsync("a\n".repeat(5000), file, [update([...Array(3000).fill("a"), "b"], [])]),
  ).rejects.toThrow("resource limit")
  await expect(Patch.deriveContentFromChunksAsync("x".repeat(16 * 1024 * 1024), file, [])).rejects.toThrow(
    "resource limit",
  )
})

test("host rejects excessive input and pre-abort before dispatch", async () => {
  const call = vi.fn()
  vi.spyOn(NativeAddon, "diff").mockReturnValue({ ...native!, applyPatchContentAsync: call })
  await expect(Patch.deriveContentFromChunksAsync("a\n".repeat(200_000), file, [])).rejects.toThrow("resource limit")
  await expect(
    Patch.deriveContentFromChunksAsync(
      "",
      file,
      Array.from({ length: 4097 }, () => update([], [])),
    ),
  ).rejects.toThrow("resource limit")
  const signal = AbortSignal.abort(new Error("cancel test"))
  await expect(Patch.deriveContentFromChunksAsync("a", file, [], signal)).rejects.toThrow("cancel test")
  expect(call).not.toHaveBeenCalled()
})

test("native failure is surfaced without compatibility retry", async () => {
  const call = vi.fn().mockRejectedValue(new Error("worker failed"))
  vi.spyOn(NativeAddon, "diff").mockReturnValue({
    ...native!,
    applyPatchContentAsync: call,
    PatchCancellation: class {
      cancel() {}
    },
  })
  await expect(Patch.deriveContentFromChunksAsync("a\n".repeat(40_000), file, [])).rejects.toThrow("worker failed")
  expect(call).toHaveBeenCalledTimes(1)
})

test("aborted workers retain their slots until the underlying work settles", async () => {
  const resolvers: Array<(result: string) => void> = []
  const cancel = vi.fn()
  const call = vi.fn(() => new Promise<string>((resolve) => resolvers.push(resolve)))
  vi.spyOn(NativeAddon, "diff").mockReturnValue({
    ...native!,
    applyPatchContentAsync: call,
    PatchCancellation: class {
      cancel = cancel
    },
  })
  const original = "a\n".repeat(40_000)
  const controllers = Array.from({ length: 34 }, () => new AbortController())
  const pending = controllers.map((controller) =>
    Patch.deriveContentFromChunksAsync(original, file, [], controller.signal).catch((e) => e),
  )
  expect(call).toHaveBeenCalledTimes(2)
  await expect(Patch.deriveContentFromChunksAsync(original, file, [])).rejects.toThrow("queue is full")
  controllers[0].abort(new Error("stop"))
  expect((await pending[0]).message).toBe("stop")
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(call).toHaveBeenCalledTimes(2)
  for (const controller of controllers.slice(1)) controller.abort()
  for (const resolve of resolvers) resolve("unused")
  await Promise.all(pending)
  await new Promise((resolve) => setImmediate(resolve))
})
