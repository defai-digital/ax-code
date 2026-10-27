import { afterEach, describe, expect, test, vi } from "vitest"
import { NativeAddon } from "../../src/native/addon"
import { replace, replaceAsync } from "../../src/tool/edit-impl"

const native = NativeAddon.diff()
const enabled = !!native?.editReplaceSlim && !!native.editReplaceAsync && !!native.EditCancellation
const fixtures: Array<[string, string, string, boolean?]> = [
  ["hello world", "world", "$&"],
  ["a a a", "a", "$'", true],
  ["foo\nfoo", "foo", "bar"],
  ["a a\n a ", "a", "new"],
  ["head\nwrong\nend\nlet longVariable = 1;\nend", "head\nlet longVariable = 2;\nend", "new"],
  ["foo", "missing", "bar"],
  ["foo", "foo", "foo"],
  ["abc\n", "", "X"],
  ["😀 intro\n  target  \nend", "target", "changed"],
  ["a\r\n  target\nend\r\n", "target", "new\nlines"],
  ["😀 a\r\nb\nc\r\n", "😀 a\nb", "😁 changed\nnew"],
  ["one\ntwo\nthree", "one\\ntwo", "new"],
  ["one\\ntwo\nthree", "one\ntwo", "new"],
  ["prefix  a  b  c  d  e  f  g suffix", "a b c d e f g", "new"],
  ["prefix  a  b  suffix\nprefix a\tb suffix", "a b", "new"],
  ["\uFEFF target\nother", "target", "new"],
  ["\u0085target\nother", "target", "new"],
  ["\u3000foo\n  bar\n  baz", "\u3000foo\nbar", "new"],
  ["head\nlet longVariable = 1;\ntail", "head\nlet longVariable = 2;\ntail", "new"],
  ["head\nWRONG\ntail", "head\nentirely different\ntail", "new"],
  ["head\n\ntail\nhead\n\ntail", "head\n\ntail", "new"],
  ["foo bar\nother", "  foo bar  ", "new"],
  ["   \n\n", " \n", "new"],
  ["aaabaa", "aa", "b"],
  ["a\r\na\n", "a", "b", true],
  ["a\r\nb\na\nb\r\n", "a\r\nb", "Z", true],
  ["foo\nxfoo\n", "foo", "BAR"],
  [`head\n${"a".repeat(2001)}\ntail`, `head\n${"a".repeat(2000)}b\ntail`, "new"],
]
function outcome(run: () => string) {
  try {
    return { content: run() }
  } catch (error) {
    return { error: (error as Error).message }
  }
}
afterEach(() => vi.restoreAllMocks())

describe.skipIf(!enabled)("slim native edit parity", () => {
  test.each(fixtures)("matches the canonical JS result for %#", async (content, old, next, all = false) => {
    const expected = outcome(() => replace(content, old, next, all))
    expect(outcome(() => native!.editReplaceSlim!(content, old, next, all))).toEqual(expected)
    const cancellation = new native!.EditCancellation!()
    if ("content" in expected)
      expect(await native!.editReplaceAsync!(content, old, next, all, cancellation)).toBe(expected.content)
    else await expect(native!.editReplaceAsync!(content, old, next, all, cancellation)).rejects.toThrow(expected.error)
  })

  test("matches a deterministic corpus of whitespace, anchors, Unicode and line endings", () => {
    let seed = 12345
    const pick = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed % n
    }
    const words = ["alpha", "beta", "😀", "é", "", "const value = 1", "tail"]
    const spaces = ["", " ", "  ", "\t", "\uFEFF", "\u0085", "\u3000"]
    for (let i = 0; i < 500; i++) {
      const lines = Array.from(
        { length: 3 + pick(8) },
        () => spaces[pick(spaces.length)] + words[pick(words.length)] + spaces[pick(spaces.length)],
      )
      const ending = pick(2) ? "\n" : "\r\n"
      const content = lines.join(ending)
      const from = pick(lines.length),
        count = 1 + pick(lines.length - from)
      let old = lines
        .slice(from, from + count)
        .map((line) => (pick(2) ? line.trim() : line))
        .join("\n")
      if (!old) old = " "
      if (pick(4) === 0) old = " " + old + " \n"
      const expected = outcome(() => replace(content, old, "replacement\n😀", false))
      expect(
        outcome(() => native!.editReplaceSlim!(content, old, "replacement\n😀", false)),
        `seed case ${i}`,
      ).toEqual(expected)
    }
  })

  test("cancellation rejects without publishing a replacement", async () => {
    const cancelled = new native!.EditCancellation!()
    cancelled.cancel()
    await expect(native!.editReplaceAsync!("a", "a", "b", false, cancelled)).rejects.toThrow("cancelled")
    const controller = new AbortController()
    const promise = replaceAsync("x\n".repeat(100_000), "missing", "new", false, controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow()
  })
})

test("an empty oldString is rejected instead of matching every offset", () => {
  // `multiedit` passes the model's oldString straight through, so this is
  // reachable. Without the guard, `replaceAll` spliced the replacement between
  // every character and the single-match pipeline hung in
  // MultiOccurrenceReplacer (indexOf("", 0) never advances). The native worker
  // already rejects an empty search; the JS path has to agree.
  expect(() => replace("a b c\n", "", "X")).toThrow("oldString must not be empty.")
  expect(() => replace("a b c\n", "", "X", true)).toThrow("oldString must not be empty.")
})

test("missing and old addons, small literal edits and ill-formed UTF-16 retain JS behavior", async () => {
  const spy = vi.spyOn(NativeAddon, "diff").mockReturnValue(undefined)
  expect(await replaceAsync("a\r\nb", "a", "new")).toBe(replace("a\r\nb", "a", "new"))
  const fn = vi.fn()
  spy.mockReturnValue({ editReplaceAsync: fn } as unknown as ReturnType<typeof NativeAddon.diff>)
  expect(await replaceAsync("abc", "b", "new")).toBe("anewc")
  expect(await replaceAsync("\ud800" + "x".repeat(70_000), "x", "y", true)).toBe("\ud800" + "y".repeat(70_000))
  expect(fn).not.toHaveBeenCalled()
})

test("the actual edit tool never retries a timed-out worker through normalized EOL matching", async () => {
  const { tmpdir } = await import("../fixture/fixture")
  const { Instance } = await import("../../src/project/instance")
  const { FileTime } = await import("../../src/file/time")
  const { EditTool } = await import("../../src/tool/edit-impl")
  const { SessionID, MessageID } = await import("../../src/session/schema")
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "mixed.txt")
  const content = "header\r\n" + "line\n".repeat(14_000)
  await fs.writeFile(file, content)
  const deadline = new DOMException("Work deadline exceeded", "TimeoutError")
  const worker = vi.fn(async () => {
    throw deadline
  })
  class Cancellation {
    cancel() {}
  }
  vi.spyOn(NativeAddon, "diff").mockReturnValue({
    EditCancellation: Cancellation,
    editReplaceAsync: worker,
  } as unknown as ReturnType<typeof NativeAddon.diff>)
  const ask = vi.fn()
  const ctx = {
    sessionID: SessionID.make("ses_edit_worker_timeout"),
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata() {},
    ask,
  }
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await FileTime.read(ctx.sessionID, file)
        const tool = await EditTool.init()
        await expect(
          tool.execute({ filePath: file, oldString: "line\nline", newString: "changed" }, ctx),
        ).rejects.toThrow(deadline.message)
        expect(worker).toHaveBeenCalledTimes(1)
        expect(ask).not.toHaveBeenCalled()
        expect(await fs.readFile(file, "utf8")).toBe(content)
      },
    })
  } finally {
    await Instance.disposeAll()
  }
})
