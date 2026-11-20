import { expect, test } from "vitest"
import type { TextChunk } from "../src/core/text-buffer.js"
import { detectLinks } from "../src/lib/detect-links.js"

function chunk(text: string): TextChunk {
  return { __isChunk: true, text }
}

test("single-character chunks advance the content position", () => {
  const chunks = [chunk("a"), chunk("aa")]

  detectLinks(chunks, { content: "aaa", highlights: [[0, 1, "markup.link.url"]] })

  expect(chunks[0].link?.url).toBe("a")
  expect(chunks[1].link).toBeUndefined()
})

test("single-character chunks can be links themselves", () => {
  const chunks = [chunk("ab"), chunk("c")]

  detectLinks(chunks, { content: "abc", highlights: [[2, 3, "markup.link.url"]] })

  expect(chunks[0].link).toBeUndefined()
  expect(chunks[1].link?.url).toBe("c")
})

test("chunks with source spans stay aligned when conceal replaces text", () => {
  const chunks = [
    { __isChunk: true, text: "x", contentStart: 1, contentEnd: 2 },
    // The concealed "]" renders as a space, which also occurs later in the content.
    { __isChunk: true, text: " ", contentStart: 2, contentEnd: 3 },
    { __isChunk: true, text: "http://e.com", contentStart: 4, contentEnd: 16 },
  ] as TextChunk[]

  detectLinks(chunks, {
    content: "[x](http://e.com) tail",
    highlights: [
      [1, 2, "markup.link.label"],
      [2, 3, "conceal", { conceal: " " }],
      [4, 16, "markup.link.url"],
    ],
  })

  expect(chunks[0].link?.url).toBe("http://e.com")
  expect(chunks[1].link).toBeUndefined()
  expect(chunks[2].link?.url).toBe("http://e.com")
})

test("a bare URL does not steal an earlier link's label", () => {
  const chunks = [chunk("a"), chunk(" see "), chunk("http://y.com")]

  detectLinks(chunks, {
    content: "[a](http://x.com) see http://y.com",
    highlights: [
      [1, 2, "markup.link.label"],
      [22, 34, "markup.link.url"],
    ],
  })

  expect(chunks[0].link).toBeUndefined()
  expect(chunks[1].link).toBeUndefined()
  expect(chunks[2].link?.url).toBe("http://y.com")
})
