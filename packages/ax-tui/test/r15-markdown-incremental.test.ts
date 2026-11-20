import { describe, expect, test } from "vitest"
import { Lexer } from "marked"
import { parseMarkdownIncremental } from "../src/renderables/markdown-parser.js"

const hasLink = (tokens: unknown[]) => JSON.stringify(tokens).includes('"type":"link"')

describe("incremental markdown must not keep links resolved against removed defs", () => {
  test("deleting a trailing def drops the resolved link from reused tokens", () => {
    const before = "See [docs].\n\nP2\n\nP3\n\n[docs]: https://example.com"
    const after = "See [docs].\n\nP2\n\nP3\n\nP4"
    const s1 = parseMarkdownIncremental(before, null, 2)
    expect(hasLink(s1.tokens)).toBe(true)

    const s2 = parseMarkdownIncremental(after, s1, 2)
    expect(hasLink(s2.tokens)).toBe(false)
    expect(JSON.stringify(s2.tokens)).not.toContain("https://example.com")
  })

  test("truncating to the stable prefix still re-resolves against the discarded def", () => {
    const before = "See [docs].\n\nP2\n\nP3\n\n[docs]: https://example.com"
    const s1 = parseMarkdownIncremental(before, null, 0)
    const truncated = "See [docs]."
    const s2 = parseMarkdownIncremental(truncated, s1, 0)
    expect(hasLink(s2.tokens)).toBe(false)
  })
})

describe("incremental markdown must see defs nested in blockquotes and lists", () => {
  test("appended reference resolves against a def inside a blockquote", () => {
    const base = "> [docs]: https://example.com\n\nP1\n\nP2"
    const s1 = parseMarkdownIncremental(base, null, 2)
    const s2 = parseMarkdownIncremental(base + "\n\nSee [docs].", s1, 2)
    const last = s2.tokens[s2.tokens.length - 1]
    expect(hasLink([last])).toBe(true)
    expect(JSON.stringify(last)).toContain("https://example.com")
  })

  test("appended blockquote def re-resolves references in the stable prefix", () => {
    const base = "See [docs].\n\nP1\n\nP2"
    const s1 = parseMarkdownIncremental(base, null, 2)
    expect(hasLink(s1.tokens)).toBe(false)
    const s2 = parseMarkdownIncremental(base + "\n\n> [docs]: https://example.com", s1, 2)
    expect(hasLink(s2.tokens)).toBe(true)
  })

  test("appended reference resolves against a def inside a list item", () => {
    const base = "- [docs]: https://example.com\n\nP1\n\nP2"
    const s1 = parseMarkdownIncremental(base, null, 2)
    const s2 = parseMarkdownIncremental(base + "\n\nSee [docs].", s1, 2)
    const full = Lexer.lex(s2.content, { gfm: true })
    expect(hasLink(s2.tokens)).toBe(hasLink(full))
  })
})
