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
