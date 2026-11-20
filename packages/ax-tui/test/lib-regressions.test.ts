import { expect, test } from "vitest"
import { isBunfsPath } from "../src/lib/bunfs.js"
import { parseKeypress } from "../src/lib/parse.keypress.js"
import { ProcessQueue } from "../src/lib/queue.js"
import { treeSitterToTextChunks } from "../src/lib/tree-sitter-styled-text.js"
import { isValidDirectoryName } from "../src/lib/validate-dir-name.js"
import type { SyntaxStyle } from "../src/core/syntax-style.js"

test("Windows reserved device names are rejected even with an extension", () => {
  for (const name of ["CON.txt", "NUL.txt", "COM1.log", "aux.js", "con", "LPT9.tar.gz"]) {
    expect(isValidDirectoryName(name), name).toBe(false)
  }
  expect(isValidDirectoryName("CONSOLE")).toBe(true)
  expect(isValidDirectoryName("mydir")).toBe(true)
})

test("bunfs detection matches only the embedded filesystem roots", () => {
  expect(isBunfsPath("/$bunfs/root/x.wasm")).toBe(true)
  expect(isBunfsPath("/Users/me/$bunfs-local/x.wasm")).toBe(false)
  expect(isBunfsPath("B:\\~BUN\\root\\x")).toBe(true)
  expect(isBunfsPath("B:/~BUN/root/x")).toBe(true)
  expect(isBunfsPath("B:\\~BUNNY\\x")).toBe(false)
})

test("modified F3 reports parse as keys outside the probe window, plain CPR stays a response", () => {
  const shiftF3 = parseKeypress("\x1b[1;2R", { cprAsFunctionKey: true })
  expect(shiftF3?.name).toBe("f3")
  expect(shiftF3?.shift).toBe(true)
  expect(shiftF3?.raw).toBe("\x1b[1;2R")

  const ctrlF3 = parseKeypress("\x1b[1;5R", { cprAsFunctionKey: true })
  expect(ctrlF3?.name).toBe("f3")
  expect(ctrlF3?.ctrl).toBe(true)

  // Row 1 column 1 (including zero-padded forms) is a real CPR, never a key.
  expect(parseKeypress("\x1b[1;1R", { cprAsFunctionKey: true })).toBeNull()
  expect(parseKeypress("\x1b[1;01R", { cprAsFunctionKey: true })).toBeNull()
  // Other rows are ordinary cursor position reports.
  expect(parseKeypress("\x1b[12;40R", { cprAsFunctionKey: true })).toBeNull()
  // Without the option the sequence stays a response in every case.
  expect(parseKeypress("\x1b[1;2R")).toBeNull()

  const kittyF3 = parseKeypress("\x1b[1;2R", { useKittyKeyboard: true, cprAsFunctionKey: true })
  expect(kittyF3?.name).toBe("f3")
  expect(kittyF3?.shift).toBe(true)
})

test("kitty shifted letter text uses locale-independent uppercasing", () => {
  const key = parseKeypress("\x1b[105;2u", { useKittyKeyboard: true })
  expect(key?.name).toBe("i")
  expect(key?.shift).toBe(true)
  expect(key?.sequence).toBe("I")
})

test("a conceal-end space skip is not rewound by a highlight starting at the same offset", () => {
  const style = { getStyle: () => undefined } as unknown as SyntaxStyle
  const chunks = treeSitterToTextChunks(
    "] ",
    [
      [0, 1, "conceal", { conceal: " " }],
      [1, 2, "markup.link.url"],
    ],
    style,
  )
  expect(chunks).toEqual([{ __isChunk: true, text: " ", contentStart: 0, contentEnd: 1, attributes: 0 }])
})

test("a conceal-end newline skip is not rewound by a highlight starting at the same offset", () => {
  const style = { getStyle: () => undefined } as unknown as SyntaxStyle
  const chunks = treeSitterToTextChunks(
    "a\nb",
    [
      [0, 1, "conceal", { concealLines: "true" }],
      [1, 3, "comment"],
    ],
    style,
  )
  expect(chunks).toEqual([{ __isChunk: true, text: "b", contentStart: 2, contentEnd: 3, attributes: 0 }])
})

test("manual process pumps a non-auto queue once and keeps FIFO order", async () => {
  const seen: number[] = []
  const queue = new ProcessQueue<number>((item) => {
    seen.push(item)
  }, false)
  queue.enqueue(1)
  queue.enqueue(2)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(seen).toEqual([])
  expect(queue.size()).toBe(2)
  queue.process()
  queue.process()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(seen).toEqual([1, 2])
  expect(queue.isProcessing()).toBe(false)
  expect(queue.size()).toBe(0)
})
